import mongoose, { Types, type mongo } from "mongoose";
import request from "supertest";
import { createApp } from "../src/create-app.js";
import { User, type Role } from "../src/models/user.model.js";
import { hashPassword } from "../src/services/password.service.js";
import { signAccessToken } from "../src/services/token.service.js";

export const app = createApp();
export const api = () => request(app);

export const PASSWORD = "Password123";

let counter = 0;

export async function createUser(overrides: { name?: string; email?: string; role?: Role; interests?: string[] } = {}) {
  counter += 1;
  const user = await User.create({
    name: overrides.name ?? `User ${counter}`,
    email: overrides.email ?? `user${counter}-${new Types.ObjectId().toString()}@example.com`,
    role: overrides.role ?? "user",
    interests: overrides.interests ?? [],
    passwordHash: await hashPassword(PASSWORD),
  });
  const { token } = signAccessToken(user._id.toString());
  return { user, token, id: user._id.toString(), auth: `Bearer ${token}` };
}

const DATA_COMMANDS = new Set(["find", "aggregate", "count", "distinct", "insert", "update", "delete", "findAndModify"]);

/** Records every data command sent to MongoDB while `fn` runs. */
export async function captureCommands<T>(fn: () => Promise<T>) {
  const commands: { name: string; collection: string; command: Record<string, unknown> }[] = [];
  const client = mongoose.connection.getClient();
  const listener = (event: mongo.CommandStartedEvent) => {
    if (!DATA_COMMANDS.has(event.commandName)) return;
    commands.push({
      name: event.commandName,
      collection: String(event.command[event.commandName]),
      command: event.command,
    });
  };
  client.on("commandStarted", listener);
  try {
    const result = await fn();
    return { result, commands };
  } finally {
    client.off("commandStarted", listener);
  }
}
