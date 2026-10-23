import type { z } from "zod";
import { User } from "../models/user.model.js";
import { conflict, isDuplicateKeyError, unauthorized } from "../utils/errors.js";
import { toUserDto } from "../utils/serializers.js";
import type { loginSchema, registerSchema } from "../validators/schemas.js";
import { burnPasswordCheck, hashPassword, verifyPassword } from "./password.service.js";
import { signAccessToken } from "./token.service.js";

export async function register(input: z.infer<typeof registerSchema>) {
  const passwordHash = await hashPassword(input.password);
  try {
    // Role is never taken from the request: public sign-up always creates "user".
    const user = await User.create({
      name: input.name,
      email: input.email,
      passwordHash,
      interests: input.interests,
      role: "user",
    });
    return toUserDto(user);
  } catch (error) {
    // The unique { email: 1 } index is the source of truth (no check-then-insert race).
    if (isDuplicateKeyError(error)) throw conflict("A user with this email already exists");
    throw error;
  }
}

export async function login(input: z.infer<typeof loginSchema>) {
  // Equality lookup on the unique { email: 1 } index; the hash is selected only here.
  const user = await User.findOne({ email: input.email }).select("+passwordHash").lean();

  if (!user) {
    await burnPasswordCheck(input.password);
    throw unauthorized("Invalid email or password");
  }
  if (!(await verifyPassword(input.password, user.passwordHash))) {
    throw unauthorized("Invalid email or password");
  }

  const { token, expiresIn } = signAccessToken(user._id.toString());
  return { token, tokenType: "Bearer" as const, expiresIn, user: toUserDto(user) };
}
