import bcrypt from "bcryptjs";
import { env } from "../config/env.js";

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, env.BCRYPT_ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

let dummyHash: Promise<string> | undefined;

/**
 * Runs a bcrypt comparison even when the account does not exist, so login
 * response time does not reveal which emails are registered.
 */
export async function burnPasswordCheck(plain: string): Promise<void> {
  dummyHash ??= bcrypt.hash("dummy-password-for-timing", env.BCRYPT_ROUNDS);
  await bcrypt.compare(plain, await dummyHash);
}
