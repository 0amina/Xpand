/**
 * Shared, app-wide TypeScript types. Module-specific types belong in their own module
 * folder; only cross-cutting shapes live here.
 */

/**
 * The authenticated principal attached to `req.user` by the auth middleware.
 *
 * `id` is the Telegram user id — a `BigInt` because it can exceed 2^53 (the column is
 * BIGINT). Keeping it as BigInt means it compares like-for-like against `transactions.user_id`
 * without lossy conversions.
 *
 * There is no role. Every authenticated user has full access to every record, so authentication
 * establishes identity and nothing else. `id` survives only as authorship — the user a
 * transaction is recorded against — never as a permission.
 */
export interface AuthenticatedUser {
  id: bigint;
}

/** Consistent JSON error envelope returned by the global error handler. */
export interface ErrorResponse {
  error: {
    message: string;
    statusCode: number;
    /** Optional machine-readable code or validation detail, filled in as needed. */
    details?: unknown;
  };
}
