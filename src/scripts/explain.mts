/**
 * Prints explain("executionStats") summaries for every query shape the API
 * issues, so the index design in docs/INDEXING.md can be checked against the
 * real planner. Run against seeded data:
 *
 *   npm run db:seed -- --reset && npm run db:explain
 */
import { Types } from "mongoose";
import { connectDatabase, disconnectDatabase } from "../config/database.js";
import { Note } from "../models/note.model.js";
import { Post } from "../models/post.model.js";
import { User } from "../models/user.model.js";
import { userPostsPipeline } from "../services/post.service.js";
import { interestGroupsPipeline } from "../services/user.service.js";
import { summarizeExplain } from "../utils/explain.js";

function print(label: string, explain: unknown): void {
  console.log(`\n### ${label}`);
  console.log(JSON.stringify(summarizeExplain(explain), null, 2));
}

await connectDatabase();
try {
  const alice = await User.findOne({ email: "alice@example.com" }).lean();
  if (!alice) throw new Error("Seed data missing: run `npm run db:seed -- --reset` first.");
  const note = await Note.findOne({ ownerId: alice._id }).lean();
  const post = await Post.findOne({ authorId: alice._id }).lean();
  const page = { skip: 0, limit: 10 };

  print("Login: users.findOne({ email })", await User.findOne({ email: alice.email }).explain("executionStats"));
  print("Auth / profile / admin get user: users.findById", await User.findById(alice._id).explain("executionStats"));
  print(
    "Admin list users: users.find({}).sort({ _id: -1 }).skip.limit",
    await User.find({}).sort({ _id: -1 }).skip(page.skip).limit(page.limit).explain("executionStats"),
  );
  print(
    "My notes: notes.find({ ownerId }).sort({ _id: -1 }).skip.limit",
    await Note.find({ ownerId: alice._id }).sort({ _id: -1 }).skip(page.skip).limit(page.limit).explain("executionStats"),
  );
  print(
    "My notes total: notes.countDocuments({ ownerId })",
    await Note.aggregate([{ $match: { ownerId: alice._id } }, { $group: { _id: 1, n: { $sum: 1 } } }]).explain(
      "executionStats",
    ),
  );
  print(
    "Own note read/update/delete filter: notes.findOne({ _id, ownerId })",
    await Note.findOne({ _id: note?._id, ownerId: alice._id }).explain("executionStats"),
  );
  print(
    "Admin list notes: notes.find({}).sort({ _id: -1 }).skip.limit",
    await Note.find({}).sort({ _id: -1 }).skip(page.skip).limit(page.limit).explain("executionStats"),
  );
  print("Admin get note: notes.findById", await Note.findById(note?._id).explain("executionStats"));
  print(
    "Public posts: posts.find({}).sort({ _id: -1 }).skip.limit",
    await Post.find({}).sort({ _id: -1 }).skip(page.skip).limit(page.limit).explain("executionStats"),
  );
  print("Public get post: posts.findById", await Post.findById(post?._id).explain("executionStats"));

  // The two aggregation scenarios, using the exact pipelines from the services.
  print(
    "Scenario 1: users grouped by interests (User.aggregate)",
    await User.aggregate(interestGroupsPipeline(page)).explain("executionStats"),
  );

  print(
    "Scenario 2: user posts via $lookup, page 2 (User.aggregate)",
    await User.aggregate(userPostsPipeline(alice._id, { skip: 10, limit: 10 })).explain("executionStats"),
  );

  print(
    "Scenario 2 with a non-existent user id",
    await User.aggregate(userPostsPipeline(new Types.ObjectId(), page)).explain("executionStats"),
  );
} finally {
  await disconnectDatabase();
}
