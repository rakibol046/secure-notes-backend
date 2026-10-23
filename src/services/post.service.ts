import type { PipelineStage, Types } from "mongoose";
import type { z } from "zod";
import { Post } from "../models/post.model.js";
import { User } from "../models/user.model.js";
import { notFound } from "../utils/errors.js";
import { buildPageMeta, type Pagination } from "../utils/pagination.js";
import { toAuthorDto, toPostDto } from "../utils/serializers.js";
import type { createPostSchema } from "../validators/schemas.js";

type AuthorSummary = { _id: Types.ObjectId; name: string } | null;

export async function createPost(authorId: Types.ObjectId, input: z.infer<typeof createPostSchema>) {
  // authorId always comes from the authenticated identity, never from the body.
  const post = await Post.create({ authorId, title: input.title, content: input.content });
  return { ...toPostDto(post), authorId: authorId.toString() };
}

export async function listPosts(pagination: Pagination) {
  const [posts, total] = await Promise.all([
    // No filter + sort on _id => built-in _id index.
    Post.find({})
      .sort({ _id: -1 })
      .skip(pagination.skip)
      .limit(pagination.limit)
      // Author name for display: one { _id: { $in } } query on the users _id index.
      .populate<{ authorId: AuthorSummary }>("authorId", { name: 1 })
      .lean(),
    Post.estimatedDocumentCount(),
  ]);
  return {
    data: posts.map((post) => ({ ...toPostDto(post), author: toAuthorDto(post.authorId) })),
    meta: buildPageMeta(pagination, total),
  };
}

export async function getPost(id: Types.ObjectId) {
  const post = await Post.findById(id).populate<{ authorId: AuthorSummary }>("authorId", { name: 1 }).lean();
  if (!post) throw notFound("Post");
  return { ...toPostDto(post), author: toAuthorDto(post.authorId) };
}

// ---------------------------------------------------------------------------
// Aggregation scenario 2: all posts of one user via $lookup
// ---------------------------------------------------------------------------

interface UserPostsRow {
  _id: Types.ObjectId;
  name: string;
  posts: { _id: Types.ObjectId; title: string; content: string; createdAt: Date; updatedAt: Date }[];
  totalPosts: number;
}

/**
 * ONE aggregation pipeline on the users collection that joins the separate
 * posts collection with $lookup. The user, the requested page of posts and the
 * total post count all come back from this single `User.aggregate()` call.
 *
 * Index usage (verified with explain, see docs/INDEXING.md):
 *   - $match { _id }                          -> built-in users _id index
 *   - $lookup "posts" (sort/skip/limit)       -> posts { authorId: 1, _id: -1 }:
 *     equality on authorId with the index already ordered by _id desc, so there
 *     is no blocking SORT and only skip+limit posts are fetched.
 *   - $lookup "postCount" ($count)            -> same index, keys only.
 *
 * Two $lookup stages are used instead of one $lookup + $facet: a $facet would
 * need every post of the user to flow into it before $skip/$limit, whereas here
 * the page lookup reads only skip+limit documents and the count never fetches
 * documents at all.
 */
export const userPostsPipeline = (
  userId: Types.ObjectId,
  { skip, limit }: Pick<Pagination, "skip" | "limit">,
): PipelineStage[] => [
  { $match: { _id: userId } },
  {
    $lookup: {
      from: Post.collection.name,
      localField: "_id",
      foreignField: "authorId",
      pipeline: [
        { $sort: { _id: -1 } },
        { $skip: skip },
        { $limit: limit },
        { $project: { title: 1, content: 1, createdAt: 1, updatedAt: 1 } },
      ],
      as: "posts",
    },
  },
  {
    $lookup: {
      from: Post.collection.name,
      localField: "_id",
      foreignField: "authorId",
      pipeline: [{ $count: "count" }],
      as: "postCount",
    },
  },
  {
    // Public endpoint: expose only the author's id and name.
    $project: {
      _id: 1,
      name: 1,
      posts: 1,
      totalPosts: { $ifNull: [{ $first: "$postCount.count" }, 0] },
    },
  },
];

export async function getUserPosts(userId: Types.ObjectId, pagination: Pagination) {
  const [row] = await User.aggregate<UserPostsRow>(userPostsPipeline(userId, pagination));

  if (!row) throw notFound("User");

  return {
    data: {
      user: { id: row._id.toString(), name: row.name },
      posts: row.posts.map((post) => ({ ...toPostDto(post), authorId: row._id.toString() })),
    },
    meta: buildPageMeta(pagination, row.totalPosts),
  };
}
