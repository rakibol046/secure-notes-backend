import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { unauthorized } from "../utils/errors.js";

const ALGORITHM = "HS256" as const;

/**
 * Issues a short-lived access token. Only the user id is embedded (as `sub`);
 * the role is deliberately NOT trusted from the token and is re-read from the
 * database on every request, so demotions/deletions take effect immediately.
 */
export function signAccessToken(userId: string): { token: string; expiresIn: number } {
  const token = jwt.sign({}, env.JWT_SECRET, {
    algorithm: ALGORITHM,
    subject: userId,
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
    expiresIn: env.JWT_EXPIRES_IN_SECONDS,
  });
  return { token, expiresIn: env.JWT_EXPIRES_IN_SECONDS };
}

/** Verifies signature, algorithm, issuer, audience and expiry; returns the user id. */
export function verifyAccessToken(token: string): string {
  try {
    const payload = jwt.verify(token, env.JWT_SECRET, {
      algorithms: [ALGORITHM],
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
    });
    if (typeof payload === "string" || typeof payload.sub !== "string") {
      throw unauthorized("Invalid token");
    }
    return payload.sub;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) throw unauthorized("Token expired");
    throw unauthorized("Invalid token");
  }
}
