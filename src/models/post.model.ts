import { Schema, model, type InferSchemaType, type Types } from "mongoose";

// Posts live in their own collection (not embedded in users) and reference
// their author, which is what the $lookup in user-posts joins on.
const postSchema = new Schema(
  {
    authorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    title: { type: String, required: true, trim: true, minlength: 1, maxlength: 200 },
    content: { type: String, required: true, trim: true, minlength: 1, maxlength: 20_000 },
  },
  { timestamps: true, versionKey: false },
);

// ---------------------------------------------------------------------------
// Indexes (see docs/INDEXING.md)
// ---------------------------------------------------------------------------
// GET /api/users/:userId/posts: the $lookup sub-pipelines run, per joined user,
//   { authorId: <user._id> } sorted by { _id: -1 } with $skip/$limit, plus a
//   { authorId } count. Equality then sort => IXSCAN, no blocking SORT, and the
//   count is answered from index keys alone. Also serves deleteMany({ authorId }).
postSchema.index({ authorId: 1, _id: -1 });
// Built-in _id index serves:
//   - GET /api/posts       find({}).sort({ _id: -1 })
//   - GET /api/posts/:id   findById

export type PostDoc = InferSchemaType<typeof postSchema> & { _id: Types.ObjectId };
export const Post = model("Post", postSchema);
