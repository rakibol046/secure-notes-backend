import { Schema, model, type InferSchemaType, type Types } from "mongoose";

export const ROLES = ["user", "admin"] as const;
export type Role = (typeof ROLES)[number];

export const MAX_INTERESTS = 20;
export const MAX_INTEREST_LENGTH = 40;

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 100 },
    // NOTE: uniqueness is enforced by the explicit schema.index() below, not by a
    // field-level `unique: true`, so every index is visible in one place.
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
    // Never returned by queries unless explicitly requested with .select("+passwordHash").
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, default: "user", required: true },
    interests: {
      type: [{ type: String, trim: true, lowercase: true, minlength: 1, maxlength: MAX_INTEREST_LENGTH }],
      default: [],
      validate: {
        validator: (value: string[]) => value.length <= MAX_INTERESTS && new Set(value).size === value.length,
        message: `interests must be unique and contain at most ${MAX_INTERESTS} entries`,
      },
    },
  },
  { timestamps: true, versionKey: false },
);

// ---------------------------------------------------------------------------
// Indexes (see docs/INDEXING.md)
// ---------------------------------------------------------------------------
// Login lookup (equality on email) + database-enforced uniqueness of accounts.
userSchema.index({ email: 1 }, { unique: true });
// Everything else on this collection uses the built-in _id index:
//   - GET /api/admin/users           find({}).sort({ _id: -1 })     -> _id index (backward scan)
//   - GET /api/admin/users/:id       findById                      -> _id index
//   - auth middleware                findById(sub)                 -> _id index
//   - GET /api/users/:userId/posts   $match { _id } (+ $lookup)    -> _id index
// Deliberately NO index on `interests`: the group-by-interests aggregation has
// no filter or sort on that field and must read every user; a multikey index
// cannot serve or cover $unwind/$group (verified with explain, see docs).

export type UserDoc = InferSchemaType<typeof userSchema> & { _id: Types.ObjectId };
export const User = model("User", userSchema);
