/**
 * AppError — the single error type the application throws for expected, HTTP-mappable
 * failures (bad input, not found, forbidden, ...). The global error handler reads
 * `statusCode` and `isOperational` to decide how to respond and how loudly to log.
 *
 * "Operational" errors are anticipated conditions we handle deliberately. They're distinct
 * from programmer errors (bugs) and unexpected exceptions, which should surface as 500s and
 * be investigated. Constructing an AppError marks a failure as the former.
 */
export class AppError extends Error {
  /** HTTP status code to send to the client. */
  public readonly statusCode: number;

  /** Marks this as an expected, handled failure (vs. an unexpected bug). */
  public readonly isOperational: boolean;

  /**
   * @param statusCode HTTP status to return (e.g. 400, 404, 403).
   * @param message    Client-safe message.
   * @param options.cause The underlying error, preserved for logging (never sent to clients).
   */
  constructor(statusCode: number, message: string, options?: { cause?: unknown }) {
    // Pass `cause` to the native Error so stack traces chain correctly.
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);

    this.name = 'AppError';
    this.statusCode = statusCode;
    this.isOperational = true;

    // Restore the prototype chain (needed when targeting ES2022 with transpiled classes)
    // so `instanceof AppError` works reliably.
    Object.setPrototypeOf(this, AppError.prototype);

    // Omit this constructor from the captured stack for cleaner traces.
    Error.captureStackTrace?.(this, AppError.prototype.constructor);
  }

  // --- Convenience factories for the statuses we expect to use most often. ---

  static badRequest(message = 'Bad request', options?: { cause?: unknown }): AppError {
    return new AppError(400, message, options);
  }

  static unauthorized(message = 'Unauthorized', options?: { cause?: unknown }): AppError {
    return new AppError(401, message, options);
  }

  static forbidden(message = 'Forbidden', options?: { cause?: unknown }): AppError {
    return new AppError(403, message, options);
  }

  static notFound(message = 'Not found', options?: { cause?: unknown }): AppError {
    return new AppError(404, message, options);
  }

  static conflict(message = 'Conflict', options?: { cause?: unknown }): AppError {
    return new AppError(409, message, options);
  }

  static internal(message = 'Internal server error', options?: { cause?: unknown }): AppError {
    return new AppError(500, message, options);
  }
}
