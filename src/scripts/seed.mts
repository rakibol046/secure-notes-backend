/**
 * Development-only demo data for exercising both aggregation scenarios.
 *
 *   npm run db:seed            # refuses if users already exist
 *   npm run db:seed -- --reset # wipes users/notes/posts first
 *
 * All demo accounts share SEED_PASSWORD (default "Password123"). Refuses to run
 * when NODE_ENV=production.
 */
import { connectDatabase, disconnectDatabase } from "../config/database.js";
import { env } from "../config/env.js";
import { Note } from "../models/note.model.js";
import { Post } from "../models/post.model.js";
import { User } from "../models/user.model.js";
import { hashPassword } from "../services/password.service.js";

if (env.NODE_ENV === "production") {
  console.error("Refusing to seed demo data with NODE_ENV=production.");
  process.exit(1);
}

const reset = process.argv.includes("--reset");
const password = process.env.SEED_PASSWORD ?? "Password123";

const people = [
  { name: "Admin", email: "admin@example.com", role: "admin", interests: ["chess", "coding"] },
  { name: "Alice", email: "alice@example.com", role: "user", interests: ["chess", "reading"] },
  { name: "Bob", email: "bob@example.com", role: "user", interests: ["chess", "coding"] },
  { name: "Charlie", email: "charlie@example.com", role: "user", interests: ["reading"] },
  { name: "Dana", email: "dana@example.com", role: "user", interests: ["hiking", "reading", "coding"] },
  { name: "Eve", email: "eve@example.com", role: "user", interests: [] },
] as const;

await connectDatabase();
try {
  // Ensure declared indexes exist (and nothing else) before inserting.
  await Promise.all([User.syncIndexes(), Note.syncIndexes(), Post.syncIndexes()]);

  if (reset) {
    await Promise.all([User.deleteMany({}), Note.deleteMany({}), Post.deleteMany({})]);
  } else if (await User.exists({})) {
    console.error("Users already exist. Re-run with `npm run db:seed -- --reset` to wipe and reseed.");
    process.exitCode = 1;
  }

  if (process.exitCode !== 1) {
    const passwordHash = await hashPassword(password);
    const users = await User.insertMany(people.map((person) => ({ ...person, passwordHash })));
    const byName = Object.fromEntries(users.map((user) => [user.name, user._id]));

    const notes = users.flatMap((user) =>
      Array.from({ length: 12 }, (_, i) => ({
        ownerId: user._id,
        title: `${user.name}'s note #${i + 1}`,
        content: `Private note ${i + 1} written by ${user.name}.`,
      })),
    );
    await Note.insertMany(notes);

    // Eve deliberately has no posts.
    const postCounts: Record<string, number> = { Admin: 2, Alice: 15, Bob: 6, Charlie: 1, Dana: 3 };
    const posts = Object.entries(postCounts).flatMap(([name, count]) =>
      Array.from({ length: count }, (_, i) => ({
        authorId: byName[name],
        title: `${name} post #${i + 1}`,
        content: `Public post ${i + 1} by ${name}.`,
      })),
    );
    await Post.insertMany(posts);

    console.log(`Seeded ${users.length} users, ${notes.length} notes, ${posts.length} posts.`);
    console.log(`Log in as admin@example.com / alice@example.com / ... with password "${password}".`);
  }
} finally {
  await disconnectDatabase();
}
