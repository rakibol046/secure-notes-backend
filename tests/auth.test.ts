import jwt from "jsonwebtoken";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/create-app.js";
import { env } from "../src/config/env.js";
import { User } from "../src/models/user.model.js";
import { api, createUser, PASSWORD } from "./helpers.js";

const registration = {
  name: "Alice",
  email: "  Alice@Example.COM ",
  password: "Sup3rSecret",
  interests: ["Chess", " chess ", "Reading"],
};

describe("POST /api/auth/register", () => {
  it("creates a standard user with a bcrypt hash and normalized email/interests", async () => {
    const res = await api().post("/api/auth/register").send(registration).expect(201);

    expect(res.body.data).toMatchObject({
      name: "Alice",
      email: "alice@example.com",
      role: "user",
      interests: ["chess", "reading"],
    });
    expect(res.body.data).not.toHaveProperty("passwordHash");
    expect(JSON.stringify(res.body)).not.toContain(registration.password);

    const stored = await User.findOne({ email: "alice@example.com" }).select("+passwordHash").lean();
    expect(stored?.passwordHash).toMatch(/^\$2[aby]\$\d{2}\$/);
    expect(stored?.passwordHash).not.toContain(registration.password);
  });

  it("rejects a duplicate email (case-insensitive) with 409", async () => {
    await api().post("/api/auth/register").send(registration).expect(201);
    const res = await api()
      .post("/api/auth/register")
      .send({ ...registration, email: "ALICE@example.com" })
      .expect(409);
    expect(res.body.error.code).toBe("CONFLICT");
  });

  it("does not allow public registration as admin", async () => {
    const res = await api()
      .post("/api/auth/register")
      .send({ ...registration, role: "admin" })
      .expect(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(await User.countDocuments({})).toBe(0);
  });

  it("validates input (weak password, bad email, missing name)", async () => {
    await api().post("/api/auth/register").send({ ...registration, password: "short" }).expect(400);
    await api().post("/api/auth/register").send({ ...registration, password: "allletters" }).expect(400);
    await api().post("/api/auth/register").send({ ...registration, email: "not-an-email" }).expect(400);
    await api().post("/api/auth/register").send({ email: "x@example.com", password: "Sup3rSecret" }).expect(400);
  });

  it("returns 400 for malformed JSON", async () => {
    const res = await api()
      .post("/api/auth/register")
      .set("Content-Type", "application/json")
      .send('{"name":')
      .expect(400);
    expect(res.body.error.code).toBe("INVALID_JSON");
  });
});

describe("POST /api/auth/login", () => {
  it("returns a JWT whose subject is the user id", async () => {
    const { user } = await createUser({ email: "bob@example.com" });
    const res = await api()
      .post("/api/auth/login")
      .send({ email: "BOB@example.com", password: PASSWORD })
      .expect(200);

    expect(res.body.data.tokenType).toBe("Bearer");
    expect(res.body.data.user).toMatchObject({ email: "bob@example.com", role: "user" });
    expect(res.body.data.user).not.toHaveProperty("passwordHash");

    const decoded = jwt.verify(res.body.data.token, env.JWT_SECRET, {
      algorithms: ["HS256"],
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
    }) as jwt.JwtPayload;
    expect(decoded.sub).toBe(user._id.toString());
    expect(decoded.exp! - decoded.iat!).toBe(env.JWT_EXPIRES_IN_SECONDS);
    expect(decoded).not.toHaveProperty("role");

    await api().get("/api/users/me").set("Authorization", `Bearer ${res.body.data.token}`).expect(200);
  });

  it("gives the same 401 for a wrong password and an unknown email", async () => {
    await createUser({ email: "bob@example.com" });
    const wrongPassword = await api()
      .post("/api/auth/login")
      .send({ email: "bob@example.com", password: "Wrong12345" })
      .expect(401);
    const unknownEmail = await api()
      .post("/api/auth/login")
      .send({ email: "nobody@example.com", password: PASSWORD })
      .expect(401);
    expect(wrongPassword.body).toEqual(unknownEmail.body);
  });

  it("rate-limits repeated attempts with 429", async () => {
    const limited = createApp({ authRateLimitMax: 2 });
    const attempt = () => request(limited).post("/api/auth/login").send({ email: "x@example.com", password: "x" });
    await attempt().expect(401);
    await attempt().expect(401);
    const res = await attempt().expect(429);
    expect(res.body.error.code).toBe("TOO_MANY_REQUESTS");
  });
});

describe("authentication middleware", () => {
  const sign = (subject: string, options: jwt.SignOptions = {}, secret = env.JWT_SECRET) =>
    jwt.sign({}, secret, {
      algorithm: "HS256",
      subject,
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
      expiresIn: 60,
      ...options,
    });

  it("rejects a missing token", async () => {
    const res = await api().get("/api/notes").expect(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("rejects malformed, forged and wrong-audience tokens", async () => {
    const { id } = await createUser();
    await api().get("/api/notes").set("Authorization", "Bearer not.a.jwt").expect(401);
    await api().get("/api/notes").set("Authorization", sign(id)).expect(401); // missing "Bearer"
    await api()
      .get("/api/notes")
      .set("Authorization", `Bearer ${sign(id, {}, "another-secret-another-secret-another-secret")}`)
      .expect(401);
    await api()
      .get("/api/notes")
      .set("Authorization", `Bearer ${sign(id, { audience: "someone-else" })}`)
      .expect(401);
    const unsigned = jwt.sign({ sub: id }, "", { algorithm: "none" });
    await api().get("/api/notes").set("Authorization", `Bearer ${unsigned}`).expect(401);
  });

  it("rejects an expired token", async () => {
    const { id } = await createUser();
    const expired = jwt.sign({ sub: id, exp: Math.floor(Date.now() / 1000) - 10 }, env.JWT_SECRET, {
      algorithm: "HS256",
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
    });
    const res = await api().get("/api/notes").set("Authorization", `Bearer ${expired}`).expect(401);
    expect(res.body.error.message).toBe("Token expired");
  });

  it("rejects a valid token once the user has been deleted", async () => {
    const { user, auth } = await createUser();
    await api().get("/api/notes").set("Authorization", auth).expect(200);
    await User.deleteOne({ _id: user._id });
    await api().get("/api/notes").set("Authorization", auth).expect(401);
  });

  it("uses the role from the database, not from the token", async () => {
    const { user, auth } = await createUser({ role: "admin" });
    await createUser({ role: "admin" }); // keep another admin around
    await api().get("/api/admin/users").set("Authorization", auth).expect(200);
    await User.updateOne({ _id: user._id }, { role: "user" });
    await api().get("/api/admin/users").set("Authorization", auth).expect(403);
  });
});

describe("own profile /api/users/me", () => {
  it("returns and updates the caller's name and interests", async () => {
    const { auth } = await createUser({ name: "Before" });
    const res = await api()
      .patch("/api/users/me")
      .set("Authorization", auth)
      .send({ name: "After", interests: ["Go", "go", "Chess"] })
      .expect(200);
    expect(res.body.data).toMatchObject({ name: "After", interests: ["go", "chess"], role: "user" });

    const me = await api().get("/api/users/me").set("Authorization", auth).expect(200);
    expect(me.body.data.name).toBe("After");
    expect(me.body.data).not.toHaveProperty("passwordHash");
  });

  it("does not let a user elevate their own role", async () => {
    const { user, auth } = await createUser();
    await api().patch("/api/users/me").set("Authorization", auth).send({ role: "admin" }).expect(400);
    await api()
      .patch("/api/users/me")
      .set("Authorization", auth)
      .send({ name: "x", role: "admin" })
      .expect(400);
    await api().patch(`/api/admin/users/${user.id}`).set("Authorization", auth).send({ role: "admin" }).expect(403);
    expect((await User.findById(user._id).lean())?.role).toBe("user");
  });
});
