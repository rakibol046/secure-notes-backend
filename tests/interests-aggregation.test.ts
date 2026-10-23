import { describe, expect, it } from "vitest";
import { User } from "../src/models/user.model.js";
import { api, captureCommands, createUser } from "./helpers.js";

const URL = "/api/admin/users/by-interests";

describe("Scenario 1: GET /api/admin/users/by-interests", () => {
  it("groups users by interest with correct members and counts", async () => {
    const admin = await createUser({ role: "admin", name: "Zed", interests: [] });
    const alice = await createUser({ name: "Alice", interests: ["chess", "reading"] });
    const bob = await createUser({ name: "Bob", interests: ["chess", "coding"] });
    const charlie = await createUser({ name: "Charlie", interests: ["reading"] });

    const res = await api().get(URL).set("Authorization", admin.auth).expect(200);

    // Sorted by group size desc, then interest name asc; users sorted by name.
    expect(res.body.data).toEqual([
      {
        interest: "chess",
        totalUsers: 2,
        users: [
          { id: alice.id, name: "Alice" },
          { id: bob.id, name: "Bob" },
        ],
      },
      {
        interest: "reading",
        totalUsers: 2,
        users: [
          { id: alice.id, name: "Alice" },
          { id: charlie.id, name: "Charlie" },
        ],
      },
      { interest: "coding", totalUsers: 1, users: [{ id: bob.id, name: "Bob" }] },
    ]);
    expect(res.body.meta).toEqual({ page: 1, limit: 10, total: 3, totalPages: 1, hasNext: false });
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|email|\$2[aby]\$/);
  });

  it("puts a user with several interests in every group and excludes users with none", async () => {
    const admin = await createUser({ role: "admin", interests: [] });
    const multi = await createUser({ name: "Multi", interests: ["a", "b", "c"] });
    await createUser({ name: "Nobody", interests: [] });

    const res = await api().get(URL).set("Authorization", admin.auth).expect(200);
    expect(res.body.data.map((g: { interest: string }) => g.interest)).toEqual(["a", "b", "c"]);
    for (const group of res.body.data) expect(group.users).toEqual([{ id: multi.id, name: "Multi" }]);
    expect(JSON.stringify(res.body.data)).not.toContain("Nobody");
  });

  it("counts a user once per interest even if the stored array contains duplicates", async () => {
    const admin = await createUser({ role: "admin" });
    const dup = await createUser({ name: "Dup", interests: ["chess"] });
    // Bypass app validation to simulate legacy/dirty data.
    await User.collection.updateOne({ _id: dup.user._id }, { $set: { interests: ["chess", "chess"] } });

    const res = await api().get(URL).set("Authorization", admin.auth).expect(200);
    expect(res.body.data).toEqual([{ interest: "chess", totalUsers: 1, users: [{ id: dup.id, name: "Dup" }] }]);
  });

  it("normalizes interests on write so case/whitespace variants form one group", async () => {
    const admin = await createUser({ role: "admin" });
    await api()
      .post("/api/auth/register")
      .send({ name: "Ann", email: "ann@example.com", password: "Passw0rd1", interests: ["Chess", " chess", "CHESS"] })
      .expect(201);
    await api()
      .patch("/api/users/me")
      .set("Authorization", admin.auth)
      .send({ interests: ["chess "] })
      .expect(200);

    const res = await api().get(URL).set("Authorization", admin.auth).expect(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({ interest: "chess", totalUsers: 2 });
  });

  it("paginates interest groups (not users)", async () => {
    const admin = await createUser({ role: "admin" });
    await createUser({ name: "U1", interests: ["a", "b", "c", "d", "e"] });
    await createUser({ name: "U2", interests: ["a", "b"] });

    const page1 = await api().get(`${URL}?page=1&limit=2`).set("Authorization", admin.auth).expect(200);
    expect(page1.body.data.map((g: { interest: string }) => g.interest)).toEqual(["a", "b"]);
    expect(page1.body.meta).toEqual({ page: 1, limit: 2, total: 5, totalPages: 3, hasNext: true });

    const page3 = await api().get(`${URL}?page=3&limit=2`).set("Authorization", admin.auth).expect(200);
    expect(page3.body.data.map((g: { interest: string }) => g.interest)).toEqual(["e"]);
    expect(page3.body.meta.hasNext).toBe(false);

    const beyond = await api().get(`${URL}?page=9&limit=2`).set("Authorization", admin.auth).expect(200);
    expect(beyond.body.data).toEqual([]);
    expect(beyond.body.meta.total).toBe(5);

    await api().get(`${URL}?limit=1000`).set("Authorization", admin.auth).expect(400);
  });

  it("returns an empty result when nobody has interests", async () => {
    const admin = await createUser({ role: "admin" });
    const res = await api().get(URL).set("Authorization", admin.auth).expect(200);
    expect(res.body).toEqual({
      success: true,
      data: [],
      meta: { page: 1, limit: 10, total: 0, totalPages: 0, hasNext: false },
    });
  });

  it("builds the response with exactly one aggregate command and no other data reads", async () => {
    const admin = await createUser({ role: "admin" });
    await createUser({ interests: ["chess"] });

    const { commands } = await captureCommands(() => api().get(URL).set("Authorization", admin.auth).expect(200));

    // The only other command is the auth middleware loading the caller's role by _id.
    const [authLookup, ...rest] = commands;
    expect(authLookup).toMatchObject({ name: "find", collection: "users" });
    expect(authLookup!.command.filter).toEqual({ _id: admin.user._id });

    expect(rest.map(({ name, collection }) => ({ name, collection }))).toEqual([
      { name: "aggregate", collection: "users" },
    ]);
    const stages = (rest[0]!.command.pipeline as Record<string, unknown>[]).map((stage) => Object.keys(stage)[0]);
    expect(stages).toEqual(["$project", "$unwind", "$group", "$addFields", "$sort", "$facet"]);
  });
});
