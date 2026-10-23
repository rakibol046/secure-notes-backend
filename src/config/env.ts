import { existsSync } from "node:fs";
import { z } from "zod";

// Load backend/.env when present (Node >= 20.12 built-in, no dotenv dependency).
// Variables already set in the real environment take precedence.
if (process.env.NODE_ENV !== "test" && existsSync(".env")) {
  process.loadEnvFile(".env");
}

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    MONGODB_URI: z.string().min(1, "MONGODB_URI is required"),
    JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
    JWT_EXPIRES_IN_SECONDS: z.coerce.number().int().min(60).max(86_400).default(3600),
    JWT_ISSUER: z.string().min(1).default("secure-notes-api"),
    JWT_AUDIENCE: z.string().min(1).default("secure-notes-client"),
    BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),
    CORS_ORIGINS: z
      .string()
      .default("http://localhost:5173")
      .transform((value) =>
        value
          .split(",")
          .map((origin) => origin.trim())
          .filter(Boolean),
      ),
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(20),
    AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(15 * 60 * 1000),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== "production") return;
    if (env.BCRYPT_ROUNDS < 10) {
      ctx.addIssue({ code: "custom", path: ["BCRYPT_ROUNDS"], message: "must be >= 10 in production" });
    }
    if (/change[-_ ]?me|replace[-_ ]?me|example/i.test(env.JWT_SECRET)) {
      ctx.addIssue({ code: "custom", path: ["JWT_SECRET"], message: "looks like a placeholder value" });
    }
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const problems = parsed.error.issues.map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`);
  // Fail fast at startup; never print the actual values (they may be secrets).
  throw new Error(`Invalid environment configuration:\n${problems.join("\n")}`);
}

export const env = parsed.data;
export type Env = typeof env;
