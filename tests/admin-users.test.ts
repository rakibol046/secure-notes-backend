import { Types } from "mongoose";
import { describe, expect, it, vi } from "vitest";
import { Note } from "../src/models/note.model.js";
import { Post } from "../src/models/post.model.js";
import { User } from "../src/models/user.model.js";
import { verifyPassword } from "../src/services/password.service.js";
import { api, createUser } from "./helpers.js";

describe("admin endpoints require the admin role", () => {
  it("returns 401 without a token and 403 for a standard user", async () => {
    const { auth } = await createUser();
    const id = new Types.ObjectId().toString();
    const requests = [
      () => api().get("/api/admin/users"),
      () => api().post("/api/admin/users").send({}),
      () => api().get(`/api/admin/users/${id}`),
      () => api().patch(`/api/admin/users/${id}`).send({ name: "x" }),
      () => api().delete(`/api/admin/users/${id}`),
      () => api().get("/api/admin/users/by-interests"),
      () => api().get("/api/admin/notes"),
    ];
    for (const send of requests) {
      await send().expect(401);
      await send().set("Authorization", auth).expect(403);
    }
  });
});

describe("admin user management", () => {
  it("creates a user with a hashed password and the requested role", async () => {
    const admin = await createUser({ role: "admin" });
    const res = await api()
      .post("/api/admin/users")
      .set("Authorization", admin.auth)
      .send({ name: "New Admin", email: "NEW@example.com", password: "Passw0rd!", role: "admin", interests: ["Go"] })
      .expect(201);
    expect(res.body.data).toMatchObject({ email: "new@example.com", role: "admin", interests: ["go"] });
    expect(res.body.data).not.toHaveProperty("passwordHash");

    const stored = await User.findOne({ email: "new@example.com" }).select("+passwordHash").lean();
    expect(await verifyPassword("Passw0rd!", stored!.passwordHash)).toBe(true);

    await api()
      .post("/api/admin/users")
      .set("Authorization", admin.auth)
      .send({ name: "Dup", email: "new@example.com", password: "Passw0rd!" })
      .expect(409);
    await api()
      .post("/api/admin/users")
      .set("Authorization", admin.auth)
      .send({ name: "Bad", email: "bad@example.com", password: "Passw0rd!", role: "superuser" })
      .expect(400);
  });

  it("lists users newest first with pagination and without password hashes", async () => {
    const admin = await createUser({ role: "admin", name: "Admin" });
    for (const name of ["A", "B", "C", "D"]) await createUser({ name });

    const page1 = await api().get("/api/admin/users?page=1&limit=2").set("Authorization", admin.auth).expect(200);
    expect(page1.body.data.map((u: { name: string }) => u.name)).toEqual(["D", "C"]);
    expect(page1.body.meta).toEqual({ page: 1, limit: 2, total: 5, totalPages: 3, hasNext: true });

    const page3 = await api().get("/api/admin/users?page=3&limit=2").set("Authorization", admin.auth).expect(200);
    expect(page3.body.data.map((u: { name: string }) => u.name)).toEqual(["Admin"]);
    expect(JSON.stringify([page1.body, page3.body])).not.toMatch(/passwordHash|\$2[aby]\$/);

    await api().get("/api/admin/users?limit=500").set("Authorization", admin.auth).expect(400);
  });

  it("reads a single user", async () => {
    const admin = await createUser({ role: "admin" });
    const alice = await createUser({ name: "Alice", interests: ["chess"] });
    const res = await api().get(`/api/admin/users/${alice.id}`).set("Authorization", admin.auth).expect(200);
    expect(res.body.data).toMatchObject({ id: alice.id, name: "Alice", interests: ["chess"], role: "user" });
    expect(res.body.data).not.toHaveProperty("passwordHash");

    await api().get(`/api/admin/users/${new Types.ObjectId()}`).set("Authorization", admin.auth).expect(404);
    await api().get("/api/admin/users/123").set("Authorization", admin.auth).expect(400);
  });

  it("updates profile fields, role and re-hashes a new password", async () => {
    const admin = await createUser({ role: "admin" });
    const alice = await createUser({ name: "Alice", email: "alice@example.com" });
    const before = await User.findById(alice.user._id).select("+passwordHash").lean();

    const res = await api()
      .patch(`/api/admin/users/${alice.id}`)
      .set("Authorization", admin.auth)
      .send({ name: "Alice B", interests: ["Reading"], role: "admin", password: "N3wPassword" })
      .expect(200);
    expect(res.body.data).toMatchObject({ name: "Alice B", interests: ["reading"], role: "admin" });

    const after = await User.findById(alice.user._id).select("+passwordHash").lean();
    expect(after!.passwordHash).not.toBe(before!.passwordHash);
    expect(after!.passwordHash).not.toContain("N3wPassword");
    expect(await verifyPassword("N3wPassword", after!.passwordHash)).toBe(true);

    await api()
      .post("/api/auth/login")
      .send({ email: "alice@example.com", password: "N3wPassword" })
      .expect(200);
  });

  it("rejects invalid updates", async () => {
    const admin = await createUser({ role: "admin" });
    const alice = await createUser();
    const taken = await createUser({ email: "taken@example.com" });
    const url = `/api/admin/users/${alice.id}`;
    await api().patch(url).set("Authorization", admin.auth).send({}).expect(400);
    await api().patch(url).set("Authorization", admin.auth).send({ role: "root" }).expect(400);
    await api().patch(url).set("Authorization", admin.auth).send({ passwordHash: "x" }).expect(400);
    await api().patch(url).set("Authorization", admin.auth).send({ email: taken.user.email }).expect(409);
    await api()
      .patch(`/api/admin/users/${new Types.ObjectId()}`)
      .set("Authorization", admin.auth)
      .send({ name: "x" })
      .expect(404);
  });

  it("deletes a user together with their notes and posts", async () => {
    const admin = await createUser({ role: "admin" });
    const alice = await createUser();
    const bob = await createUser();
    await Note.create([
      { ownerId: alice.user._id, title: "a" },
      { ownerId: bob.user._id, title: "b" },
    ]);
    await Post.create([
      { authorId: alice.user._id, title: "a", content: "a" },
      { authorId: bob.user._id, title: "b", content: "b" },
    ]);

    await api().delete(`/api/admin/users/${alice.id}`).set("Authorization", admin.auth).expect(204);

    expect(await User.exists({ _id: alice.user._id })).toBeNull();
    expect(await Note.countDocuments({ ownerId: alice.user._id })).toBe(0);
    expect(await Post.countDocuments({ authorId: alice.user._id })).toBe(0);
    expect(await Note.countDocuments({ ownerId: bob.user._id })).toBe(1);
    expect(await Post.countDocuments({ authorId: bob.user._id })).toBe(1);

    await api().get("/api/notes").set("Authorization", alice.auth).expect(401);
    await api().delete(`/api/admin/users/${alice.id}`).set("Authorization", admin.auth).expect(404);
  });

  it("leaves a retryable state when user deletion fails part-way", async () => {
    const admin = await createUser({ role: "admin" });
    const alice = await createUser();
    await Note.create({ ownerId: alice.user._id, title: "a" });
    await Post.create({ authorId: alice.user._id, title: "a", content: "a" });

    const spy = vi.spyOn(Post, "deleteMany").mockRejectedValueOnce(new Error("simulated outage"));
    try {
      const failed = await api().delete(`/api/admin/users/${alice.id}`).set("Authorization", admin.auth).expect(500);
      expect(failed.body.error.message).toBe("Internal server error");
    } finally {
      spy.mockRestore();
    }
    // The user still exists, so the admin can retry and the cleanup completes.
    expect(await User.exists({ _id: alice.user._id })).not.toBeNull();
    await api().delete(`/api/admin/users/${alice.id}`).set("Authorization", admin.auth).expect(204);
    expect(await User.exists({ _id: alice.user._id })).toBeNull();
    expect(await Note.countDocuments({ ownerId: alice.user._id })).toBe(0);
    expect(await Post.countDocuments({ authorId: alice.user._id })).toBe(0);
  });

  it("never removes or demotes the last admin", async () => {
    const admin = await createUser({ role: "admin" });
    await api().delete(`/api/admin/users/${admin.id}`).set("Authorization", admin.auth).expect(409);
    await api()
      .patch(`/api/admin/users/${admin.id}`)
      .set("Authorization", admin.auth)
      .send({ role: "user" })
      .expect(409);
    expect((await User.findById(admin.user._id).lean())?.role).toBe("admin");

    // With a second admin present, demotion is allowed.
    await createUser({ role: "admin" });
    await api()
      .patch(`/api/admin/users/${admin.id}`)
      .set("Authorization", admin.auth)
      .send({ role: "user" })
      .expect(200);
  });
});
