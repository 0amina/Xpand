/**
 * JSON serialization safety net for BigInt.
 *
 * Why this exists: the `users` table keys on a Telegram id stored as `BIGINT`, which Prisma
 * maps to the JavaScript `BigInt` type. `JSON.stringify` (and therefore `res.json`) throws
 * "Do not know how to serialize a BigInt" on any BigInt value. Rather than remember to
 * convert every id at every boundary, we teach BigInt how to serialize itself — as a decimal
 * string, since Telegram ids can exceed `Number.MAX_SAFE_INTEGER` and must not lose precision.
 *
 * Importing this module for its side effect (once, early in app startup) installs the patch.
 * Controllers still map ids explicitly in their DTOs; this guarantees correctness even for
 * any BigInt that isn't mapped by hand (e.g. nested relations).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- augmenting a global prototype.
(BigInt.prototype as any).toJSON = function (this: bigint): string {
  return this.toString();
};

export {};
