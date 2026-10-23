import { Schema, model, type InferSchemaType, type Types } from "mongoose";

const noteSchema = new Schema(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    title: { type: String, required: true, trim: true, minlength: 1, maxlength: 200 },
    content: { type: String, trim: true, maxlength: 20_000, default: "" },
  },
  { timestamps: true, versionKey: false },
);

// ---------------------------------------------------------------------------
// Indexes (see docs/INDEXING.md)
// ---------------------------------------------------------------------------
// GET /api/notes: find({ ownerId }).sort({ _id: -1 }).skip().limit()
//   Equality (ownerId) then sort (_id) => IXSCAN with no in-memory SORT stage.
//   Its { ownerId } prefix also serves countDocuments({ ownerId }) for the page
//   total and deleteMany({ ownerId }) when an admin removes a user, so a
//   standalone { ownerId: 1 } index would be redundant.
noteSchema.index({ ownerId: 1, _id: -1 });
// Built-in _id index serves:
//   - GET/PATCH/DELETE /api/notes/:id   { _id, ownerId } (ownership-aware)
//   - GET /api/admin/notes/:id          findById
//   - GET /api/admin/notes              find({}).sort({ _id: -1 })

export type NoteDoc = InferSchemaType<typeof noteSchema> & { _id: Types.ObjectId };
export const Note = model("Note", noteSchema);
