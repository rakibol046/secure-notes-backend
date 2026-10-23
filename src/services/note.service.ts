import type { Types } from "mongoose";
import type { z } from "zod";
import { Note } from "../models/note.model.js";
import { User } from "../models/user.model.js";
import { notFound } from "../utils/errors.js";
import { buildPageMeta, type Pagination } from "../utils/pagination.js";
import { toNoteDto } from "../utils/serializers.js";
import type { createNoteSchema, updateNoteSchema } from "../validators/schemas.js";

// Every owner-scoped operation puts BOTH _id and ownerId in the database filter,
// so a note that belongs to someone else is indistinguishable from a missing one
// (404) and can never be read or modified through these functions.

export async function createNote(ownerId: Types.ObjectId, input: z.infer<typeof createNoteSchema>) {
  const note = await Note.create({ ownerId, title: input.title, content: input.content });
  return toNoteDto(note);
}

export async function listOwnNotes(ownerId: Types.ObjectId, pagination: Pagination) {
  const filter = { ownerId };
  const [notes, total] = await Promise.all([
    // IXSCAN on { ownerId: 1, _id: -1 }: equality + index-provided sort.
    Note.find(filter).sort({ _id: -1 }).skip(pagination.skip).limit(pagination.limit).lean(),
    // Counted from the same index's { ownerId } prefix.
    Note.countDocuments(filter),
  ]);
  return { data: notes.map(toNoteDto), meta: buildPageMeta(pagination, total) };
}

export async function getOwnNote(ownerId: Types.ObjectId, id: Types.ObjectId) {
  const note = await Note.findOne({ _id: id, ownerId }).lean();
  if (!note) throw notFound("Note");
  return toNoteDto(note);
}

export async function updateOwnNote(
  ownerId: Types.ObjectId,
  id: Types.ObjectId,
  input: z.infer<typeof updateNoteSchema>,
) {
  const note = await Note.findOneAndUpdate(
    { _id: id, ownerId },
    { $set: input },
    { returnDocument: "after", runValidators: true },
  ).lean();
  if (!note) throw notFound("Note");
  return toNoteDto(note);
}

export async function deleteOwnNote(ownerId: Types.ObjectId, id: Types.ObjectId): Promise<void> {
  const { deletedCount } = await Note.deleteOne({ _id: id, ownerId });
  if (deletedCount === 0) throw notFound("Note");
}

// ---------------------------------------------------------------------------
// Admin: read-only access to every user's notes
// ---------------------------------------------------------------------------

type OwnerSummary = { _id: Types.ObjectId; name: string; email: string } | null;

const toAdminNoteDto = (note: Parameters<typeof toNoteDto>[0] & { owner: OwnerSummary }) => ({
  ...toNoteDto(note),
  owner: note.owner ? { id: note.owner._id.toString(), name: note.owner.name, email: note.owner.email } : null,
});

export async function listAllNotes(pagination: Pagination) {
  const [notes, total] = await Promise.all([
    // No filter + sort on _id => built-in _id index.
    Note.find({}).sort({ _id: -1 }).skip(pagination.skip).limit(pagination.limit).lean(),
    Note.estimatedDocumentCount(),
  ]);

  // Owner names for the page: one { _id: { $in } } query on the users _id index.
  const ownerIds = [...new Set(notes.map((note) => note.ownerId.toString()))];
  const owners = await User.find({ _id: { $in: ownerIds } })
    .select({ name: 1, email: 1 })
    .lean();
  const ownersById = new Map(owners.map((owner) => [owner._id.toString(), owner]));

  return {
    data: notes.map((note) => toAdminNoteDto({ ...note, owner: ownersById.get(note.ownerId.toString()) ?? null })),
    meta: buildPageMeta(pagination, total),
  };
}

export async function getAnyNote(id: Types.ObjectId) {
  const note = await Note.findById(id).lean();
  if (!note) throw notFound("Note");
  return toNoteDto(note);
}
