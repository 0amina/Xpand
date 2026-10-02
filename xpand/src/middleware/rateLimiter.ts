import { rateLimit } from 'express-rate-limit';

/**
 * Global rate limiter — deliberately permissive for now.
 *
 * The app is high-frequency by design (employees log transactions dozens of times per day),
 * so the default cap is generous and exists mainly as a safety net against runaway clients
 * or abuse. Per-route limiters (e.g. tighter caps on OCR upload) can be added later.
 */
export const rateLimiter = rateLimit({
  windowMs: 60_000, // 1 minute window.
  limit: 300, // Up to 300 requests/minute per IP — loose on purpose.
  standardHeaders: 'draft-7', // Send RateLimit-* headers so clients can self-throttle.
  legacyHeaders: false, // Drop the deprecated X-RateLimit-* headers.
  message: { error: { message: 'Too many requests, please slow down.', statusCode: 429 } },
});
