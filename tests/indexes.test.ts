import type { Model } from "mongoose";
import { describe, expect, it } from "vitest";
import { Note } from "../src/models/note.model.js";
import { Post } from "../src/models/post.model.js";
import { User } from "../src/models/user.model.js";
import { userPostsPipeline } from "../src/services/post.service.js";
import { interestGroupsPipeline } from "../src/services/user.service.js";
import { summarizeExplain } from "../src/utils/explain.js";
import { createUser } from "./helpers.js";

// The complete, intended index set. Anything else is an unnecessary index.
const EXPECTED = {
  users: [
    { name: "_id_", key: { _id: 1 } },
    { name: "email_1", key: { email: 1 }, unique: true },
  ],
  notes: [
    { name: "_id_", key: { _id: 1 } },
    { name: "ownerId_1__id_-1", key: { ownerId: 1, _id: -1 } },
  ],
  posts: [
    { name: "_id_", key: { _id: 1 } },
    { name: "authorId_1__id_-1", key: { authorId: 1, _id: -1 } },
  ],
};

const models: [keyof typeof EXPECTED, Model<any>][] = [
  ["users", User],
  ["notes", Note],
  ["posts", Post],
];

describe("index definitions", () => {
  it.each(models)("%s has exactly the intended indexes in MongoDB", async (collection, model) => {
    const indexes = await model.collection.indexes();
    const actual = indexes
      .map(({ name, key, unique }) => ({ name, key, ...(unique ? { unique } : {}) }))
      .sort((a, b) => a.name!.localeCompare(b.name!));
    expect(actual).toEqual(EXPECTED[collection]);
  });

  it.each(models)("%s declares custom indexes only through schema.index()", (_collection, model) => {
    const forbidden = ["index", "unique", "sparse", "text", "expires", "2dsphere"];
    const fieldLevel: string[] = [];
    model.schema.eachPath((path, schemaType) => {
      const options = schemaType.options as Record<string, unknown>;
      const caster = (schemaType as unknown as { caster?: { options?: Record<string, unknown> } }).caster?.options ?? {};
      for (const key of forbidden) {
        if (options[key] !== undefined || caster[key] !== undefined) fieldLevel.push(`${path}.${key}`);
      }
    });
    expect(fieldLevel).toEqual([]);
    // schema.indexes() lists exactly what schema.index() declared (the _id index is implicit).
    expect(model.schema.indexes().length).toBe(1);
  });
});

describe("query plans use the intended indexes", () => {
  async function seed() {
    const alice = await createUser({ email: "alice@example.com", interests: ["chess"] });
    const bob = await createUser({ interests: ["reading"] });
    for (const owner of [alice.user, bob.user]) {
      await Note.insertMany(Array.from({ length: 15 }, (_, i) => ({ ownerId: owner._id, title: `n${i}` })));
      await Post.insertMany(Array.from({ length: 15 }, (_, i) => ({ authorId: owner._id, title: `p${i}`, content: "c" })));
    }
    return alice.user;
  }

  it("login uses email_1", async () => {
    await seed();
    const plan = summarizeExplain(await User.findOne({ email: "alice@example.com" }).explain("executionStats"));
    expect(plan.indexes).toEqual(["email_1"]);
    expect(plan.totalDocsExamined).toBe(1);
  });

  it("own-notes page uses { ownerId, _id } with no in-memory sort, and its count is a COUNT_SCAN", async () => {
    const alice = await seed();
    const plan = summarizeExplain(
      await Note.find({ ownerId: alice._id }).sort({ _id: -1 }).skip(10).limit(5).explain("executionStats"),
    );
    expect(plan.indexes).toEqual(["ownerId_1__id_-1"]);
    expect(plan.stages).not.toContain("SORT");
    expect(plan.stages).not.toContain("COLLSCAN");
    expect(plan.totalDocsExamined).toBe(5); // skipped entries are never fetched

    const count = summarizeExplain(
      await Note.aggregate([{ $match: { ownerId: alice._id } }, { $group: { _id: 1, n: { $sum: 1 } } }]).explain(
        "executionStats",
      ),
    );
    expect(count.indexes).toEqual(["ownerId_1__id_-1"]);
    expect(count.totalDocsExamined).toBe(0);
  });

  it.each(models)("unfiltered %s list sorted by _id desc walks the _id index", async (_name, model) => {
    await seed();
    const plan = summarizeExplain(await model.find({}).sort({ _id: -1 }).limit(10).explain("executionStats"));
    expect(plan.indexes).toEqual(["_id_"]);
    expect(plan.stages).not.toContain("SORT");
  });

  it("single-document reads by _id use the _id index", async () => {
    const alice = await seed();
    const note = await Note.findOne({ ownerId: alice._id }).lean();
    for (const explain of [
      await User.findById(alice._id).explain("executionStats"),
      await Note.findById(note!._id).explain("executionStats"),
      await Post.findById(new Post()._id).explain("executionStats"),
    ]) {
      expect(summarizeExplain(explain).indexes).toEqual(["_id_"]);
    }
    // Ownership-aware filter: either candidate index is fine, a COLLSCAN is not.
    const owned = summarizeExplain(await Note.findOne({ _id: note!._id, ownerId: alice._id }).explain("executionStats"));
    expect(owned.stages).not.toContain("COLLSCAN");
    expect(owned.totalDocsExamined).toBe(1);
  });

  it("user-posts $lookup matches the user by _id and joins posts through { authorId, _id }", async () => {
    const alice = await seed();
    const plan = summarizeExplain(
      await User.aggregate(userPostsPipeline(alice._id, { skip: 10, limit: 5 })).explain("executionStats"),
    );
    expect(plan.indexes).toEqual(["_id_"]);
    const lookups = plan.pipeline!.filter((stage) => stage.stage === "$lookup");
    expect(lookups).toHaveLength(2);
    for (const lookup of lookups) {
      expect(lookup.indexesUsed).toEqual(["authorId_1__id_-1"]);
      expect(lookup.collectionScans).toBe(0);
    }
    expect(lookups[0]!.totalDocsExamined).toBe(5); // only the requested page is fetched
    expect(lookups[1]!.totalDocsExamined).toBe(0); // the count is answered from index keys
  });

  it("interest grouping scans users once (documented: no filter/sort for an index to serve)", async () => {
    await seed();
    const plan = summarizeExplain(
      await User.aggregate(interestGroupsPipeline({ skip: 0, limit: 10 })).explain("executionStats"),
    );
    expect(plan.stages).toContain("COLLSCAN");
    expect(plan.totalDocsExamined).toBe(await User.estimatedDocumentCount());
  });
});
