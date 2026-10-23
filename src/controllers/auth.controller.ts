import type { Request, Response } from "express";
import * as authService from "../services/auth.service.js";
import { loginSchema, registerSchema } from "../validators/schemas.js";

export async function register(req: Request, res: Response) {
  const user = await authService.register(registerSchema.parse(req.body));
  res.status(201).json({ success: true, data: user });
}

export async function login(req: Request, res: Response) {
  const result = await authService.login(loginSchema.parse(req.body));
  res.json({ success: true, data: result });
}
