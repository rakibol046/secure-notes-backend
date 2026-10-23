import type { NextFunction, Request, Response } from "express";
import mongoose from "mongoose";
import { ZodError } from "zod";
import { AppError, isDuplicateKeyError } from "../utils/errors.js";

interface ErrorBody {
  success: false;
  error: { code: string; message: string; details?: unknown };
}

const send = (res: Response, status: number, error: ErrorBody["error"]) =>
  res.status(status).json({ success: false, error } satisfies ErrorBody);

export function notFoundHandler(_req: Request, res: Response): void {
  send(res, 404, { code: "NOT_FOUND", message: "Route not found" });
}

/**
 * Central error translation. Clients only ever see a stable code + safe message;
 * MongoDB errors, stack traces and secrets are never serialized.
 */
// Express identifies error middleware by its 4-argument signature, so `_next` must stay.
export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (error instanceof AppError) {
    send(res, error.status, { code: error.code, message: error.message });
    return;
  }

  if (error instanceof ZodError) {
    send(res, 400, {
      code: "VALIDATION_ERROR",
      message: "Request validation failed",
      details: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    });
    return;
  }

  if (isDuplicateKeyError(error)) {
    send(res, 409, { code: "CONFLICT", message: "A user with this email already exists" });
    return;
  }

  if (error instanceof mongoose.Error.ValidationError || error instanceof mongoose.Error.CastError) {
    send(res, 400, { code: "VALIDATION_ERROR", message: "Request validation failed" });
    return;
  }

  // body-parser errors (malformed JSON, payload too large) carry a status and type.
  const bodyError = error as { status?: number; type?: string };
  if (bodyError?.type === "entity.parse.failed") {
    send(res, 400, { code: "INVALID_JSON", message: "Malformed JSON body" });
    return;
  }
  if (bodyError?.type === "entity.too.large") {
    send(res, 413, { code: "PAYLOAD_TOO_LARGE", message: "Request body is too large" });
    return;
  }

  console.error("Unhandled error:", error);
  send(res, 500, { code: "INTERNAL_ERROR", message: "Internal server error" });
}
