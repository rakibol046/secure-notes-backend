import { Router, type RequestHandler } from "express";
import * as auth from "../controllers/auth.controller.js";
import * as notes from "../controllers/note.controller.js";
import * as posts from "../controllers/post.controller.js";
import * as users from "../controllers/user.controller.js";
import { authenticate, authorizeRoles } from "../middleware/auth.js";

export function buildApiRouter(authRateLimiter: RequestHandler): Router {
  const api = Router();

  // --- auth (public, rate limited) -------------------------------------------
  const authRouter = Router();
  authRouter.use(authRateLimiter);
  authRouter.post("/register", auth.register);
  authRouter.post("/login", auth.login);
  api.use("/auth", authRouter);

  // --- own profile + public user posts ($lookup) ------------------------------
  const userRouter = Router();
  userRouter.get("/me", authenticate, users.getMe);
  userRouter.patch("/me", authenticate, users.updateMe);
  userRouter.get("/:userId/posts", posts.listByUser);
  api.use("/users", userRouter);

  // --- own notes (any authenticated role; ownership enforced in queries) -----
  const noteRouter = Router();
  noteRouter.use(authenticate);
  noteRouter.post("/", notes.create);
  noteRouter.get("/", notes.listOwn);
  noteRouter.get("/:id", notes.getOwn);
  noteRouter.patch("/:id", notes.updateOwn);
  noteRouter.delete("/:id", notes.removeOwn);
  api.use("/notes", noteRouter);

  // --- posts (public reads, authenticated create) ------------------------------
  const postRouter = Router();
  postRouter.get("/", posts.list);
  postRouter.get("/:id", posts.getById);
  postRouter.post("/", authenticate, posts.create);
  api.use("/posts", postRouter);

  // --- admin -------------------------------------------------------------------
  const adminRouter = Router();
  adminRouter.use(authenticate, authorizeRoles("admin"));
  // Registered before "/users/:id" so "by-interests" is not parsed as an id.
  adminRouter.get("/users/by-interests", users.groupedByInterests);
  adminRouter.get("/users", users.list);
  adminRouter.post("/users", users.create);
  adminRouter.get("/users/:id", users.getById);
  adminRouter.patch("/users/:id", users.update);
  adminRouter.delete("/users/:id", users.remove);
  adminRouter.get("/notes", notes.listAll);
  adminRouter.get("/notes/:id", notes.getAny);
  api.use("/admin", adminRouter);

  return api;
}
