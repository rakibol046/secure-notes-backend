import { randomBytes } from "node:crypto";
import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach } from "vitest";
import "../src/config/database.js";
import { Note } from "../src/models/note.model.js";
import { Post } from "../src/models/post.model.js";
import { User } from "../src/models/user.model.js";

// Every test file gets its own real MongoDB database, so files can run in
// parallel and aggregation/index behaviour is tested against the real server.
const baseUri = (process.env.TEST_MONGODB_URI ?? "mongodb://127.0.0.1:27017").replace(/\/+$/, "");
const dbName = `secure_notes_test_${randomBytes(6).toString("hex")}`;

beforeAll(async () => {
  // monitorCommands lets tests assert exactly which database commands a request issues.
  await mongoose.connect(`${baseUri}/${dbName}`, { serverSelectionTimeoutMS: 5000, monitorCommands: true });
  await Promise.all([User.syncIndexes(), Note.syncIndexes(), Post.syncIndexes()]);
});

beforeEach(async () => {
  await Promise.all([User.deleteMany({}), Note.deleteMany({}), Post.deleteMany({})]);
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});
