import type { Request, Response } from "express";
import { requireAuth } from "../middleware/auth.js";
import * as postService from "../services/post.service.js";
import { idParamsSchema, paginationQuerySchema } from "../validators/common.js";
import { createPostSchema, userIdParamsSchema } from "../validators/schemas.js";

export async function create(req: Request, res: Response) {
  const post = await postService.createPost(requireAuth(req).id, createPostSchema.parse(req.body));
  res.status(201).json({ success: true, data: post });
}

export async function list(req: Request, res: Response) {
  const result = await postService.listPosts(paginationQuerySchema.parse(req.query));
  res.json({ success: true, ...result });
}

export async function getById(req: Request, res: Response) {
  const { id } = idParamsSchema.parse(req.params);
  res.json({ success: true, data: await postService.getPost(id) });
}

export async function listByUser(req: Request, res: Response) {
  const { userId } = userIdParamsSchema.parse(req.params);
  const result = await postService.getUserPosts(userId, paginationQuerySchema.parse(req.query));
  res.json({ success: true, ...result });
}
