/**
 * Vercel serverless entry point.
 *
 * `vercel.json` rewrites every path to this function, so the Express app sees the request on its
 * original URL and routes it exactly as it does behind `server.ts` locally. That is the whole
 * point of building the app in `createApp()` rather than in the entry file: the routing, the
 * middleware order and the error handling are the same on both hosts, and only the transport
 * differs.
 *
 * What is deliberately *not* here, compared with `server.ts`:
 *
 *  - **No `listen()`.** The platform owns the socket.
 *  - **No `startBot()`.** There is no process to own a poller, and webhook registration is a
 *    one-off deploy step (`npm run bot:register`). The webhook route initialises the bot on its
 *    own the first time an update reaches a given instance.
 *  - **No signal handlers or graceful shutdown.** Instances are frozen and discarded, not
 *    signalled; `SIGTERM` never arrives, and closing the Prisma pool between requests would mean
 *    reconnecting on every one of them.
 *
 * Plain JavaScript, importing the compiled output rather than `src/`. The build runs `tsc` first,
 * so `dist/` is real ESM with real `.js` paths — which sidesteps the usual bundler failure where
 * a TypeScript ESM import of `./app.js` cannot be resolved back to `app.ts`.
 */

import { createApp } from '../dist/app.js';

const app = createApp();

/**
 * Hand the request to Express, reconciling the platform's body parsing with the app's.
 *
 * Vercel's Node runtime parses JSON and urlencoded bodies itself and exposes the result as
 * `req.body` — consuming the request stream in the process. `express.json()` would then wait on a
 * stream that will never emit anything, and the request would hang until the function timed out.
 *
 * `body-parser` skips a request that is already marked with `req._body`, which is exactly the
 * signal we need. Setting it only when a body is actually present keeps the local path untouched:
 * running under `server.ts` nothing pre-parses, `req.body` is undefined, and Express parses as
 * usual. Multipart uploads are unaffected on both — the platform does not touch those, so multer
 * still gets an unread stream.
 */
export default function handler(req, res) {
  if (req.body !== undefined) {
    req._body = true;
  }
  return app(req, res);
}
