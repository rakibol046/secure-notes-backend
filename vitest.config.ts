import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    testTimeout: 20_000,
    hookTimeout: 30_000,
    env: {
      NODE_ENV: "test",
      // Placeholder only: tests/setup.ts connects each test file to its own throwaway database.
      MONGODB_URI: "mongodb://127.0.0.1:27017/unused",
      JWT_SECRET: "test-only-jwt-secret-that-is-long-enough-1234567890",
      // Low work factor keeps the suite fast; production enforces >= 10 (default 12).
      BCRYPT_ROUNDS: "4",
      AUTH_RATE_LIMIT_MAX: "10000",
      CORS_ORIGINS: "http://localhost:5173",
    },
  },
});
