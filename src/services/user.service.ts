import type { PipelineStage, Types } from "mongoose";
import type { z } from "zod";
import { Note } from "../models/note.model.js";
import { Post } from "../models/post.model.js";
import { User } from "../models/user.model.js";
import { conflict, isDuplicateKeyError, notFound } from "../utils/errors.js";
import { buildPageMeta, type Pagination } from "../utils/pagination.js";
import { toUserDto } from "../utils/serializers.js";
import type { adminCreateUserSchema, adminUpdateUserSchema, updateProfileSchema } from "../validators/schemas.js";
import { hashPassword } from "./password.service.js";

// ---------------------------------------------------------------------------
// Own profile
// ---------------------------------------------------------------------------

export async function getUserById(id: Types.ObjectId) {
  const user = await User.findById(id).lean();
  if (!user) throw notFound("User");
  return toUserDto(user);
}

export async function updateOwnProfile(id: Types.ObjectId, input: z.infer<typeof updateProfileSchema>) {
  // Only name/interests reach this point (strict schema), so a user can never change their own role.
  const user = await User.findByIdAndUpdate(
    id,
    { $set: input },
    { returnDocument: "after", runValidators: true },
  ).lean();
  if (!user) throw notFound("User");
  return toUserDto(user);
}

// ---------------------------------------------------------------------------
// Admin user management
// ---------------------------------------------------------------------------

export async function listUsers(pagination: Pagination) {
  const [users, total] = await Promise.all([
    // No filter + sort on _id => backward scan of the built-in _id index (no SORT stage).
    User.find({}).sort({ _id: -1 }).skip(pagination.skip).limit(pagination.limit).lean(),
    // Unfiltered total comes from collection metadata (no scan, no index needed).
    User.estimatedDocumentCount(),
  ]);
  return { data: users.map(toUserDto), meta: buildPageMeta(pagination, total) };
}

export async function createUser(input: z.infer<typeof adminCreateUserSchema>) {
  const passwordHash = await hashPassword(input.password);
  try {
    const user = await User.create({
      name: input.name,
      email: input.email,
      passwordHash,
      role: input.role,
      interests: input.interests,
    });
    return toUserDto(user);
  } catch (error) {
    if (isDuplicateKeyError(error)) throw conflict("A user with this email already exists");
    throw error;
  }
}

/**
 * Rejects the change if `userId` is currently an admin and no other admin exists.
 * `exists` stops at the first matching document. role has no index on purpose:
 * this is a rare admin write-path guard on a two-value field, and an index on it
 * would add write cost to every user insert/update for little benefit.
 * Not race-proof against two admins demoting each other concurrently.
 */
async function assertNotLastAdmin(userId: Types.ObjectId): Promise<void> {
  const target = await User.findById(userId).select({ role: 1 }).lean();
  if (!target) throw notFound("User");
  if (target.role !== "admin") return;
  const anotherAdmin = await User.exists({ role: "admin", _id: { $ne: userId } });
  if (!anotherAdmin) throw conflict("Cannot remove or demote the last admin");
}

export async function updateUser(id: Types.ObjectId, input: z.infer<typeof adminUpdateUserSchema>) {
  const { password, ...fields } = input;
  const update: Record<string, unknown> = { ...fields };
  if (password) update.passwordHash = await hashPassword(password);
  if (fields.role === "user") await assertNotLastAdmin(id);

  try {
    const user = await User.findByIdAndUpdate(
      id,
      { $set: update },
      { returnDocument: "after", runValidators: true },
    ).lean();
    if (!user) throw notFound("User");
    return toUserDto(user);
  } catch (error) {
    if (isDuplicateKeyError(error)) throw conflict("A user with this email already exists");
    throw error;
  }
}

/**
 * Deletes a user and the notes/posts they own so no orphaned references remain.
 *
 * Not atomic: the target deployment is a standalone mongod, which has no
 * multi-document transactions. Dependents are deleted BEFORE the user and every
 * step is idempotent, so if any step fails the user still exists and simply
 * retrying the DELETE finishes the cleanup (no unreachable orphans). The
 * dependent deletes use the { ownerId, _id } / { authorId, _id } index prefixes.
 */
export async function deleteUser(id: Types.ObjectId): Promise<void> {
  await assertNotLastAdmin(id); // also 404s when the user does not exist
  await Promise.all([Note.deleteMany({ ownerId: id }), Post.deleteMany({ authorId: id })]);
  const { deletedCount } = await User.deleteOne({ _id: id });
  if (deletedCount === 0) throw notFound("User");
}

// ---------------------------------------------------------------------------
// Aggregation scenario 1: users grouped by interest
// ---------------------------------------------------------------------------

interface InterestGroupRow {
  interest: string;
  totalUsers: number;
  users: { id: Types.ObjectId; name: string }[];
}

interface InterestFacetResult {
  groups: InterestGroupRow[];
  total: { count: number }[];
}

/**
 * Exactly ONE `User.aggregate()` call produces both the page of interest groups
 * and the total group count (via $facet). No other database method is used.
 *
 * - Users with an empty `interests` array produce no rows from $unwind and are
 *   therefore not part of any group.
 * - $addToSet makes a user count once per interest even if stored data were to
 *   contain a duplicate interest (the write path also de-duplicates).
 * - Each group lists ALL of its users (not truncated). With very large groups a
 *   single $facet output document could approach the 16 MB BSON limit; see
 *   docs/INDEXING.md for the documented trade-off.
 * - Index: none. The pipeline has no filter or sort on a stored field, so it
 *   must read every user (COLLSCAN). See docs/INDEXING.md for the explain output.
 */
export const interestGroupsPipeline = ({ skip, limit }: Pick<Pagination, "skip" | "limit">): PipelineStage[] => [
  { $project: { _id: 1, name: 1, interests: 1 } },
  { $unwind: "$interests" },
  {
    $group: {
      _id: "$interests",
      users: { $addToSet: { id: "$_id", name: "$name" } },
    },
  },
  { $addFields: { totalUsers: { $size: "$users" } } },
  // Most popular interests first; interest name breaks ties deterministically.
  { $sort: { totalUsers: -1, _id: 1 } },
  {
    $facet: {
      groups: [
        { $skip: skip },
        { $limit: limit },
        {
          $project: {
            _id: 0,
            interest: "$_id",
            totalUsers: 1,
            users: { $sortArray: { input: "$users", sortBy: { name: 1, id: 1 } } },
          },
        },
      ],
      total: [{ $count: "count" }],
    },
  },
];

export async function groupUsersByInterests(pagination: Pagination) {
  const [result] = await User.aggregate<InterestFacetResult>(interestGroupsPipeline(pagination));

  const groups = result?.groups ?? [];
  const total = result?.total[0]?.count ?? 0;

  return {
    data: groups.map((group) => ({
      interest: group.interest,
      totalUsers: group.totalUsers,
      users: group.users.map((user) => ({ id: user.id.toString(), name: user.name })),
    })),
    meta: buildPageMeta(pagination, total),
  };
}
