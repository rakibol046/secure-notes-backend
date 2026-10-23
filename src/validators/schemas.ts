import { z } from "zod";
import { emailSchema, interestsSchema, nameSchema, objectIdSchema, passwordSchema, roleSchema } from "./common.js";

const atLeastOneField = (value: Record<string, unknown>) => Object.keys(value).length > 0;
const atLeastOneFieldMessage = { message: "at least one field must be provided" };

// --- auth -------------------------------------------------------------------
// .strict() rejects unknown keys, so `role` can never be supplied at registration.
export const registerSchema = z
  .object({
    name: nameSchema,
    email: emailSchema,
    password: passwordSchema,
    interests: interestsSchema.default([]),
  })
  .strict();

export const loginSchema = z
  .object({
    email: emailSchema,
    password: z.string().min(1).max(200),
  })
  .strict();

// --- own profile ------------------------------------------------------------
export const updateProfileSchema = z
  .object({ name: nameSchema, interests: interestsSchema })
  .partial()
  .strict()
  .refine(atLeastOneField, atLeastOneFieldMessage);

// --- admin user management --------------------------------------------------
export const adminCreateUserSchema = z
  .object({
    name: nameSchema,
    email: emailSchema,
    password: passwordSchema,
    role: roleSchema.default("user"),
    interests: interestsSchema.default([]),
  })
  .strict();

export const adminUpdateUserSchema = z
  .object({
    name: nameSchema,
    email: emailSchema,
    password: passwordSchema,
    role: roleSchema,
    interests: interestsSchema,
  })
  .partial()
  .strict()
  .refine(atLeastOneField, atLeastOneFieldMessage);

// --- notes ------------------------------------------------------------------
const noteTitle = z.string().trim().min(1).max(200);
const noteContent = z.string().trim().max(20_000);

export const createNoteSchema = z.object({ title: noteTitle, content: noteContent.default("") }).strict();

export const updateNoteSchema = z
  .object({ title: noteTitle, content: noteContent })
  .partial()
  .strict()
  .refine(atLeastOneField, atLeastOneFieldMessage);

// --- posts ------------------------------------------------------------------
export const createPostSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    content: z.string().trim().min(1).max(20_000),
  })
  .strict();

export const userIdParamsSchema = z.object({ userId: objectIdSchema });
