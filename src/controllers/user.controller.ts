import type { Request, Response } from "express";
import { requireAuth } from "../middleware/auth.js";
import * as userService from "../services/user.service.js";
import { idParamsSchema, paginationQuerySchema } from "../validators/common.js";
import { adminCreateUserSchema, adminUpdateUserSchema, updateProfileSchema } from "../validators/schemas.js";

// --- own profile -------------------------------------------------------------

export async function getMe(req: Request, res: Response) {
  res.json({ success: true, data: await userService.getUserById(requireAuth(req).id) });
}

export async function updateMe(req: Request, res: Response) {
  const user = await userService.updateOwnProfile(requireAuth(req).id, updateProfileSchema.parse(req.body));
  res.json({ success: true, data: user });
}

// --- admin -------------------------------------------------------------------

export async function list(req: Request, res: Response) {
  const result = await userService.listUsers(paginationQuerySchema.parse(req.query));
  res.json({ success: true, ...result });
}

export async function getById(req: Request, res: Response) {
  const { id } = idParamsSchema.parse(req.params);
  res.json({ success: true, data: await userService.getUserById(id) });
}

export async function create(req: Request, res: Response) {
  const user = await userService.createUser(adminCreateUserSchema.parse(req.body));
  res.status(201).json({ success: true, data: user });
}

export async function update(req: Request, res: Response) {
  const { id } = idParamsSchema.parse(req.params);
  const user = await userService.updateUser(id, adminUpdateUserSchema.parse(req.body));
  res.json({ success: true, data: user });
}

export async function remove(req: Request, res: Response) {
  const { id } = idParamsSchema.parse(req.params);
  await userService.deleteUser(id);
  res.status(204).end();
}

export async function groupedByInterests(req: Request, res: Response) {
  const result = await userService.groupUsersByInterests(paginationQuerySchema.parse(req.query));
  res.json({ success: true, ...result });
}
