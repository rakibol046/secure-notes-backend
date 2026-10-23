/**
 * Idempotent bootstrap of the first admin account.
 *
 *   ADMIN_NAME="Admin" ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD='...' npm run admin:create
 *
 * - Credentials come from the environment only (nothing hard-coded).
 * - If an admin with that email exists, nothing happens.
 * - If a NON-admin account already uses that email it is NOT promoted; the
 *   script exits with an error so an existing account is never silently elevated.
 */
import { connectDatabase, disconnectDatabase } from "../config/database.js";
import { User } from "../models/user.model.js";
import { hashPassword } from "../services/password.service.js";
import { isDuplicateKeyError } from "../utils/errors.js";
import { emailSchema, nameSchema, passwordSchema } from "../validators/common.js";

async function main(): Promise<number> {
  const name = nameSchema.safeParse(process.env.ADMIN_NAME ?? "Administrator");
  const email = emailSchema.safeParse(process.env.ADMIN_EMAIL);
  const password = passwordSchema.safeParse(process.env.ADMIN_PASSWORD);
  if (!name.success || !email.success || !password.success) {
    console.error(
      "Set ADMIN_EMAIL and ADMIN_PASSWORD (min 8 chars, at least one letter and one number); ADMIN_NAME is optional.",
    );
    return 1;
  }

  await connectDatabase();
  try {
    const existing = await User.findOne({ email: email.data }).select({ role: 1 }).lean();
    if (existing?.role === "admin") {
      console.log(`Admin ${email.data} already exists; nothing to do.`);
      return 0;
    }
    if (existing) {
      console.error(`A non-admin account already uses ${email.data}; refusing to promote it.`);
      return 1;
    }

    await User.create({
      name: name.data,
      email: email.data,
      passwordHash: await hashPassword(password.data),
      role: "admin",
    });
    console.log(`Admin ${email.data} created.`);
    return 0;
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      console.error(`${email.data} was created concurrently; re-run to check its role.`);
      return 1;
    }
    throw error;
  } finally {
    await disconnectDatabase();
  }
}

process.exitCode = await main();
