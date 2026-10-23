import type { Types } from "mongoose";
import type { Role } from "../models/user.model.js";

// Explicit allow-lists: API responses never contain fields that were not
// deliberately exposed (passwordHash in particular).

interface UserLike {
  _id: Types.ObjectId;
  name: string;
  email: string;
  role: Role;
  interests?: string[] | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export const toUserDto = (user: UserLike) => ({
  id: user._id.toString(),
  name: user.name,
  email: user.email,
  role: user.role,
  interests: user.interests ?? [],
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

interface NoteLike {
  _id: Types.ObjectId;
  ownerId: Types.ObjectId;
  title: string;
  content?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export const toNoteDto = (note: NoteLike) => ({
  id: note._id.toString(),
  ownerId: note.ownerId.toString(),
  title: note.title,
  content: note.content ?? "",
  createdAt: note.createdAt,
  updatedAt: note.updatedAt,
});

interface PostLike {
  _id: Types.ObjectId;
  title: string;
  content: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export const toPostDto = (post: PostLike) => ({
  id: post._id.toString(),
  title: post.title,
  content: post.content,
  createdAt: post.createdAt,
  updatedAt: post.updatedAt,
});

/** Public author summary: id and name only — no email, role or interests. */
export const toAuthorDto = (author: { _id: Types.ObjectId; name: string } | null) =>
  author ? { id: author._id.toString(), name: author.name } : null;
