import { Types } from "mongoose";
import { describe, expect, it } from "vitest";
import { Post } from "../src/models/post.model.js";
import { User } from "../src/models/user.model.js";
import { api, captureCommands, createUser } from "./helpers.js";

async function createPosts(authorId: Types.ObjectId, count: number, prefix: string) {
  for (let i = 1; i <= count; i += 1) {
    await Post.create({ authorId, title: `${prefix} ${i}`, content: `content ${i}` });
  }
}

describe("posts collection", () => {
  it("stores posts in their own collection, not inside users", async () => {
    const { auth, user } = await createUser();
    await api().post("/api/posts").set("Authorization", auth).send({ title: "Hi", content: "There" }).expect(201);

    expect(Post.collection.name).toBe("posts");
    expect(await Post.countDocuments({ authorId: user._id })).toBe(1);
    const raw = await User.collection.findOne({ _id: user._id });
    expect(raw).not.toHaveProperty("posts");
  });

  it("requires authentication to create and takes the author from the token", async () => {
    const { auth, id } = await createUser();
    const other = await createUser();
    await api().post("/api/posts").send({ title: "x", content: "y" }).expect(401);
    await api()
      .post("/api/posts")
      .set("Authorization", auth)
      .send({ title: "x", content: "y", authorId: other.id })
      .expect(400);
    const res = await api().post("/api/posts").set("Authorization", auth).send({ title: "x", content: "y" }).expect(201);
    expect(res.body.data.authorId).toBe(id);
    await api().post("/api/posts").set("Authorization", auth).send({ title: "x" }).expect(400);
  });

  it("lets anonymous visitors list (paginated) and read posts with a public author summary", async () => {
    const alice = await createUser({ name: "Alice", email: "alice@example.com" });
    await createPosts(alice.user._id, 3, "P");

    const list = await api().get("/api/posts?limit=2").expect(200);
    expect(list.body.data.map((p: { title: string }) => p.title)).toEqual(["P 3", "P 2"]);
    expect(list.body.data[0].author).toEqual({ id: alice.id, name: "Alice" });
    expect(list.body.meta).toEqual({ page: 1, limit: 2, total: 3, totalPages: 2, hasNext: true });
    expect(JSON.stringify(list.body)).not.toContain("alice@example.com");

    const single = await api().get(`/api/posts/${list.body.data[0].id}`).expect(200);
    expect(single.body.data).toMatchObject({ title: "P 3", author: { id: alice.id, name: "Alice" } });
    await api().get(`/api/posts/${new Types.ObjectId()}`).expect(404);
    await api().get("/api/posts/xyz").expect(400);
  });
});

describe("Scenario 2: GET /api/users/:userId/posts ($lookup)", () => {
  it("returns only that user's posts, newest first, with counts and pagination", async () => {
    const alice = await createUser({ name: "Alice", email: "alice@example.com", interests: ["secret-hobby"] });
    const bob = await createUser({ name: "Bob" });
    await createPosts(alice.user._id, 7, "Alice");
    await createPosts(bob.user._id, 2, "Bob");

    const page1 = await api().get(`/api/users/${alice.id}/posts?page=1&limit=3`).expect(200);
    expect(page1.body.data.user).toEqual({ id: alice.id, name: "Alice" });
    expect(page1.body.data.posts.map((p: { title: string }) => p.title)).toEqual(["Alice 7", "Alice 6", "Alice 5"]);
    expect(page1.body.data.posts.every((p: { authorId: string }) => p.authorId === alice.id)).toBe(true);
    expect(page1.body.meta).toEqual({ page: 1, limit: 3, total: 7, totalPages: 3, hasNext: true });

    const page3 = await api().get(`/api/users/${alice.id}/posts?page=3&limit=3`).expect(200);
    expect(page3.body.data.posts.map((p: { title: string }) => p.title)).toEqual(["Alice 1"]);
    expect(page3.body.meta.hasNext).toBe(false);

    const bobs = await api().get(`/api/users/${bob.id}/posts`).expect(200);
    expect(bobs.body.data.posts.map((p: { title: string }) => p.title)).toEqual(["Bob 2", "Bob 1"]);
    expect(bobs.body.meta.total).toBe(2);

    // Public endpoint: no email, role, interests or password data.
    expect(JSON.stringify(page1.body)).not.toMatch(/alice@example\.com|secret-hobby|role|passwordHash/);
  });

  it("returns an empty list for a user without posts", async () => {
    const eve = await createUser({ name: "Eve" });
    const res = await api().get(`/api/users/${eve.id}/posts`).expect(200);
    expect(res.body).toEqual({
      success: true,
      data: { user: { id: eve.id, name: "Eve" }, posts: [] },
      meta: { page: 1, limit: 10, total: 0, totalPages: 0, hasNext: false },
    });
  });

  it("returns 404 for an unknown user and 400 for an invalid id", async () => {
    await api().get(`/api/users/${new Types.ObjectId()}/posts`).expect(404);
    await api().get("/api/users/not-an-object-id/posts").expect(400);
    await api().get(`/api/users/${new Types.ObjectId()}/posts?page=0`).expect(400);
  });

  it("is served by a single users.aggregate command containing $lookup into posts", async () => {
    const alice = await createUser();
    await createPosts(alice.user._id, 2, "A");

    const { commands } = await captureCommands(() => api().get(`/api/users/${alice.id}/posts`).expect(200));

    expect(commands.map(({ name, collection }) => ({ name, collection }))).toEqual([
      { name: "aggregate", collection: "users" },
    ]);
    const pipeline = commands[0]!.command.pipeline as Record<string, Record<string, unknown>>[];
    expect(pipeline[0]).toEqual({ $match: { _id: alice.user._id } });
    const lookups = pipeline.filter((stage) => "$lookup" in stage).map((stage) => stage.$lookup!);
    expect(lookups.length).toBeGreaterThan(0);
    for (const lookup of lookups) {
      expect(lookup).toMatchObject({ from: "posts", localField: "_id", foreignField: "authorId" });
    }
  });
});
