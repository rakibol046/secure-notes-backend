import express from "express";
import vercelHandler from "./vercel-handler.js";

// Vercel detects this entrypoint and packages its imported dependencies.
// The handler opens MongoDB lazily and reuses the connection across requests.
const app = express();
app.disable("x-powered-by");
app.use(vercelHandler);

export default app;
