import type { Request, Response } from "express";
import { requireAuth } from "../middleware/auth.js";
import * as noteService from "../services/note.service.js";
import { idParamsSchema, paginationQuerySchema } from "../validators/common.js";
import { createNoteSchema, updateNoteSchema } from "../validators/schemas.js";

// --- owner endpoints (users and admins, own notes only) ----------------------

export async function create(req: Request, res: Response) {
  const note = await noteService.createNote(requireAuth(req).id, createNoteSchema.parse(req.body));
  res.status(201).json({ success: true, data: note });
}

export async function listOwn(req: Request, res: Response) {
  const result = await noteService.listOwnNotes(requireAuth(req).id, paginationQuerySchema.parse(req.query));
  res.json({ success: true, ...result });
}

export async function getOwn(req: Request, res: Response) {
  const { id } = idParamsSchema.parse(req.params);
  res.json({ success: true, data: await noteService.getOwnNote(requireAuth(req).id, id) });
}

export async function updateOwn(req: Request, res: Response) {
  const { id } = idParamsSchema.parse(req.params);
  const note = await noteService.updateOwnNote(requireAuth(req).id, id, updateNoteSchema.parse(req.body));
  res.json({ success: true, data: note });
}

export async function removeOwn(req: Request, res: Response) {
  const { id } = idParamsSchema.parse(req.params);
  await noteService.deleteOwnNote(requireAuth(req).id, id);
  res.status(204).end();
}

// --- admin endpoints (read-only, any owner) -----------------------------------

export async function listAll(req: Request, res: Response) {
  const result = await noteService.listAllNotes(paginationQuerySchema.parse(req.query));
  res.json({ success: true, ...result });
}

export async function getAny(req: Request, res: Response) {
  const { id } = idParamsSchema.parse(req.params);
  res.json({ success: true, data: await noteService.getAnyNote(id) });
}
