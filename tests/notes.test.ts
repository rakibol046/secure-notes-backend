import { Types } from "mongoose";
import { describe, expect, it } from "vitest";
import { Note } from "../src/models/note.model.js";
import { api, createUser } from "./helpers.js";

async function createNotes(ownerId: Types.ObjectId, count: number) {
  // Sequential inserts => increasing _ids => deterministic newest-first order.
  const notes = [];
  for (let i = 1; i <= count; i += 1) {
    notes.push(await Note.create({ ownerId, title: `Note ${i}`, content: `Body ${i}` }));
  }
  return notes;
}

describe("own notes CRUD", () => {
  it("creates, reads, updates and deletes a note", async () => {
    const { auth, id } = await createUser();

    const created = await api()
      .post("/api/notes")
      .set("Authorization", auth)
      .send({ title: "  First  ", content: "Hello" })
      .expect(201);
    expect(created.body.data).toMatchObject({ title: "First", content: "Hello", ownerId: id });
    const noteId = created.body.data.id;

    const read = await api().get(`/api/notes/${noteId}`).set("Authorization", auth).expect(200);
    expect(read.body.data.title).toBe("First");

    const updated = await api()
      .patch(`/api/notes/${noteId}`)
      .set("Authorization", auth)
      .send({ content: "Updated" })
      .expect(200);
    expect(updated.body.data).toMatchObject({ title: "First", content: "Updated" });

    await api().delete(`/api/notes/${noteId}`).set("Authorization", auth).expect(204);
    await api().get(`/api/notes/${noteId}`).set("Authorization", auth).expect(404);
    await api().delete(`/api/notes/${noteId}`).set("Authorization", auth).expect(404);
  });

  it("takes the owner from the token, never from the body", async () => {
    const { auth } = await createUser();
    const other = await createUser();
    await api()
      .post("/api/notes")
      .set("Authorization", auth)
      .send({ title: "x", ownerId: other.id })
      .expect(400);
    expect(await Note.countDocuments({ ownerId: other.user._id })).toBe(0);
  });

  it("validates note input and ids", async () => {
    const { auth } = await createUser();
    await api().post("/api/notes").set("Authorization", auth).send({ content: "no title" }).expect(400);
    await api().post("/api/notes").set("Authorization", auth).send({ title: "" }).expect(400);
    await api().post("/api/notes").set("Authorization", auth).send({ title: "x".repeat(201) }).expect(400);
    await api().patch(`/api/notes/${new Types.ObjectId()}`).set("Authorization", auth).send({}).expect(400);
    await api().get("/api/notes/not-an-id").set("Authorization", auth).expect(400);
  });
});

describe("GET /api/notes pagination", () => {
  it("lists only the caller's notes, newest first, with page metadata", async () => {
    const { user, auth } = await createUser();
    const other = await createUser();
    await createNotes(user._id, 12);
    await createNotes(other.user._id, 3);

    const page1 = await api().get("/api/notes?page=1&limit=5").set("Authorization", auth).expect(200);
    expect(page1.body.data.map((n: { title: string }) => n.title)).toEqual([
      "Note 12",
      "Note 11",
      "Note 10",
      "Note 9",
      "Note 8",
    ]);
    expect(page1.body.meta).toEqual({ page: 1, limit: 5, total: 12, totalPages: 3, hasNext: true });

    const page3 = await api().get("/api/notes?page=3&limit=5").set("Authorization", auth).expect(200);
    expect(page3.body.data.map((n: { title: string }) => n.title)).toEqual(["Note 2", "Note 1"]);
    expect(page3.body.meta.hasNext).toBe(false);

    const beyond = await api().get("/api/notes?page=4&limit=5").set("Authorization", auth).expect(200);
    expect(beyond.body.data).toEqual([]);
    expect(beyond.body.meta.total).toBe(12);
  });

  it("returns an empty first page for a user without notes and defaults to page=1, limit=10", async () => {
    const { auth } = await createUser();
    const res = await api().get("/api/notes").set("Authorization", auth).expect(200);
    expect(res.body).toEqual({
      success: true,
      data: [],
      meta: { page: 1, limit: 10, total: 0, totalPages: 0, hasNext: false },
    });
  });

  it("rejects invalid pagination parameters", async () => {
    const { auth } = await createUser();
    for (const query of ["page=0", "page=-1", "page=abc", "limit=0", "limit=101", "limit=2.5"]) {
      await api().get(`/api/notes?${query}`).set("Authorization", auth).expect(400);
    }
    await api().get("/api/notes?limit=100").set("Authorization", auth).expect(200);
  });
});

describe("note ownership and admin access", () => {
  it("never lets a user read, update or delete another user's note", async () => {
    const owner = await createUser();
    const intruder = await createUser();
    const [note] = await createNotes(owner.user._id, 1);
    const url = `/api/notes/${note!._id}`;

    await api().get(url).set("Authorization", intruder.auth).expect(404);
    await api().patch(url).set("Authorization", intruder.auth).send({ title: "hacked" }).expect(404);
    await api().delete(url).set("Authorization", intruder.auth).expect(404);

    const intruderList = await api().get("/api/notes").set("Authorization", intruder.auth).expect(200);
    expect(intruderList.body.data).toEqual([]);

    const stored = await Note.findById(note!._id).lean();
    expect(stored?.title).toBe("Note 1");
  });

  it("forbids non-admins from the admin note endpoints", async () => {
    const { auth } = await createUser();
    await api().get("/api/admin/notes").set("Authorization", auth).expect(403);
    await api().get(`/api/admin/notes/${new Types.ObjectId()}`).set("Authorization", auth).expect(403);
  });

  it("lets an admin view every user's notes (paginated) and any single note", async () => {
    const admin = await createUser({ role: "admin" });
    const alice = await createUser({ name: "Alice" });
    const bob = await createUser({ name: "Bob" });
    await createNotes(alice.user._id, 2);
    const [bobNote] = await createNotes(bob.user._id, 1);

    const list = await api().get("/api/admin/notes?limit=2").set("Authorization", admin.auth).expect(200);
    expect(list.body.meta).toEqual({ page: 1, limit: 2, total: 3, totalPages: 2, hasNext: true });
    expect(list.body.data[0]).toMatchObject({ title: "Note 1", owner: { id: bob.id, name: "Bob" } });

    const single = await api().get(`/api/admin/notes/${bobNote!._id}`).set("Authorization", admin.auth).expect(200);
    expect(single.body.data).toMatchObject({ ownerId: bob.id, title: "Note 1" });
    await api().get(`/api/admin/notes/${new Types.ObjectId()}`).set("Authorization", admin.auth).expect(404);
  });

  it("gives admins normal CRUD on their own notes but not owner-only access to others' notes", async () => {
    const admin = await createUser({ role: "admin" });
    const alice = await createUser();
    const [aliceNote] = await createNotes(alice.user._id, 1);

    const created = await api()
      .post("/api/notes")
      .set("Authorization", admin.auth)
      .send({ title: "Admin note" })
      .expect(201);
    const own = await api().get("/api/notes").set("Authorization", admin.auth).expect(200);
    expect(own.body.data.map((n: { id: string }) => n.id)).toEqual([created.body.data.id]);
    await api()
      .patch(`/api/notes/${created.body.data.id}`)
      .set("Authorization", admin.auth)
      .send({ title: "Edited" })
      .expect(200);
    await api().delete(`/api/notes/${created.body.data.id}`).set("Authorization", admin.auth).expect(204);

    // Admins can VIEW all notes, but the PDF grants no edit/delete rights on other users' notes.
    const url = `/api/notes/${aliceNote!._id}`;
    await api().patch(url).set("Authorization", admin.auth).send({ title: "x" }).expect(404);
    await api().delete(url).set("Authorization", admin.auth).expect(404);
    expect(await Note.exists({ _id: aliceNote!._id })).not.toBeNull();
  });
});
