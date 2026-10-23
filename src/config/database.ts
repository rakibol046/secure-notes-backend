import mongoose from "mongoose";
import { env } from "./env.js";

// Index builds are explicit in production (`npm run db:sync-indexes`) instead of
// being triggered on every application start.
mongoose.set("autoIndex", env.NODE_ENV !== "production");
mongoose.set("strictQuery", true);

export async function connectDatabase(uri: string = env.MONGODB_URI): Promise<typeof mongoose> {
  return mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
}
