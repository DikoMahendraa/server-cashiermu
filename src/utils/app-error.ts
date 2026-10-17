/**
 * An expected failure with an HTTP status and a stable machine-readable `code`.
 * Throw it anywhere; `errorHandler` turns it into `{ code, message, details? }`.
 * (Never put internals — SQL, stack traces, other stores' ids — in `message` or `details`.)
 */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
