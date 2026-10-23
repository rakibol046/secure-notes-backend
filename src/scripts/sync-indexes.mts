/**
 * Makes the database indexes match the schema.index() declarations exactly:
 * builds missing ones and DROPS any index that is not declared in a schema.
 * Run once per deployment (autoIndex is disabled in production).
 *
 *   npm run db:sync-indexes
 */
import { connectDatabase, disconnectDatabase } from "../config/database.js";
import { Note } from "../models/note.model.js";
import { Post } from "../models/post.model.js";
import { User } from "../models/user.model.js";

await connectDatabase();
try {
  for (const model of [User, Note, Post]) {
    const dropped = await model.syncIndexes();
    const indexes = await model.collection.indexes();
    console.log(
      `${model.collection.name}: ${indexes.map((index) => index.name).join(", ")}` +
        (dropped.length ? ` (dropped: ${dropped.join(", ")})` : ""),
    );
  }
} finally {
  await disconnectDatabase();
}
