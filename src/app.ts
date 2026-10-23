// Vercel's Express runtime picks src/app.ts as the entrypoint but does not ship
// node_modules with the function. `npm run build` therefore bundles the handler and
// all of its dependencies into src/vercel-handler.bundle.cjs, and this file just loads it.
// Local development and the tests use create-app.ts / server.ts instead.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const bundle = require("./vercel-handler.bundle.cjs");
module.exports = bundle.default ?? bundle;
