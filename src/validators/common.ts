import { Types } from "mongoose";
import { z } from "zod";
import { MAX_INTERESTS, MAX_INTEREST_LENGTH, ROLES } from "../models/user.model.js";
import { toPagination } from "../utils/pagination.js";

export const objectIdSchema = z
  .string()
  .refine((value) => /^[a-f\d]{24}$/i.test(value), { message: "must be a valid ObjectId" })
  .transform((value) => new Types.ObjectId(value));

export const idParamsSchema = z.object({ id: objectIdSchema });

export const MAX_PAGE_SIZE = 100;

export const paginationQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(100_000).default(1),
    limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(10),
  })
  .transform(({ page, limit }) => toPagination(page, limit));

export const nameSchema = z.string().trim().min(1).max(100);

export const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());

// bcrypt only uses the first 72 bytes of input, so longer passwords are rejected
// instead of being silently truncated.
export const passwordSchema = z
  .string()
  .min(8, "must be at least 8 characters")
  .refine((value) => Buffer.byteLength(value, "utf8") <= 72, { message: "must be at most 72 bytes" })
  .refine((value) => /[a-zA-Z]/.test(value) && /\d/.test(value), {
    message: "must contain at least one letter and one number",
  });

/** Trims, lowercases and de-duplicates interests so ["Chess", " chess "] becomes ["chess"]. */
export const interestsSchema = z
  .array(z.string().trim().toLowerCase().min(1).max(MAX_INTEREST_LENGTH))
  .max(MAX_INTERESTS)
  .transform((values) => [...new Set(values)]);

export const roleSchema = z.enum(ROLES);
