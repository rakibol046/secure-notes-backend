import type { Types } from "mongoose";
import type { Role } from "../models/user.model.js";

export interface AuthUser {
  id: Types.ObjectId;
  role: Role;
}

declare global {
  namespace Express {
    interface Request {
      /** Set by the `authenticate` middleware from the database, never from client input. */
      auth?: AuthUser;
    }
  }
}
