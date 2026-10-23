import type { NextFunction, Request, Response } from "express";
import { Types } from "mongoose";
import { User, type Role } from "../models/user.model.js";
import { verifyAccessToken } from "../services/token.service.js";
import { forbidden, unauthorized } from "../utils/errors.js";
import type { AuthUser } from "../types/express.js";

/**
 * Requires a valid `Authorization: Bearer <jwt>` header. The token only proves
 * identity; the user's existence and current role are loaded from the database
 * (findById -> built-in _id index), so deleted users are rejected and role
 * changes apply immediately.
 */
export async function authenticate(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  const match = header?.match(/^Bearer ([^\s]+)$/);
  if (!match?.[1]) throw unauthorized();

  const userId = verifyAccessToken(match[1]);
  if (!Types.ObjectId.isValid(userId)) throw unauthorized("Invalid token");

  const user = await User.findById(userId).select({ role: 1 }).lean();
  if (!user) throw unauthorized("User no longer exists");

  req.auth = { id: user._id, role: user.role };
  next();
}

/** Role gate. Must be mounted after `authenticate`. */
export function authorizeRoles(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) throw unauthorized();
    if (!roles.includes(req.auth.role)) throw forbidden();
    next();
  };
}

/** Returns the authenticated identity; for handlers mounted behind `authenticate`. */
export function requireAuth(req: Request): AuthUser {
  if (!req.auth) throw unauthorized();
  return req.auth;
}
