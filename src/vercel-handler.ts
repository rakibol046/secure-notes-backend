import type { IncomingMessage, ServerResponse } from "node:http";
import type { Express } from "express";
import { connectDatabase } from "./config/database.js";
import { createApp } from "./create-app.js";

// Vercel entrypoint: serverless has no long-running process, so the app is built
// once per instance and the MongoDB connection is opened lazily and reused.
let handler: Express | undefined;
let connecting: Promise<unknown> | undefined;

export default async function vercelHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    connecting ??= connectDatabase().catch((error: unknown) => {
      connecting = undefined; // retry on the next request
      throw error;
    });
    await connecting;
    handler ??= createApp();
    handler(req, res);
  } catch (error) {
    console.error("Failed to handle request:", error instanceof Error ? error.message : error);
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ success: false, error: { code: "INTERNAL_ERROR", message: "Service unavailable" } }));
  }
}
