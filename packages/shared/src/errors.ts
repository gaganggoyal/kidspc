/**
 * Typed application errors.
 *
 * Every error carries a stable machine `code` so the TV client can react
 * without string-matching, and a `userMessage` written to be readable by a
 * child or a non-technical parent. The `message` stays developer-facing and is
 * never sent to a client.
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly userMessage: string;
  readonly details: Record<string, unknown>;

  constructor(opts: {
    status: number;
    code: string;
    message: string;
    userMessage: string;
    details?: Record<string, unknown>;
    cause?: unknown;
  }) {
    super(opts.message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = 'AppError';
    this.status = opts.status;
    this.code = opts.code;
    this.userMessage = opts.userMessage;
    this.details = opts.details ?? {};
  }

  toJSON() {
    return { error: { code: this.code, message: this.userMessage, details: this.details } };
  }
}

export const errors = {
  unauthorized: (message = 'Missing or invalid credentials') =>
    new AppError({
      status: 401,
      code: 'unauthorized',
      message,
      userMessage: 'Please sign in again.',
    }),
  forbidden: (message: string) =>
    new AppError({
      status: 403,
      code: 'forbidden',
      message,
      userMessage: "You don't have access to that.",
    }),
  notFound: (what: string) =>
    new AppError({
      status: 404,
      code: 'not_found',
      message: `${what} not found`,
      userMessage: "We couldn't find that.",
    }),
  conflict: (code: string, message: string, userMessage: string) =>
    new AppError({ status: 409, code, message, userMessage }),
  validation: (message: string, details: Record<string, unknown> = {}) =>
    new AppError({
      status: 400,
      code: 'validation_failed',
      message,
      userMessage: 'Some details need fixing.',
      details,
    }),
  rateLimited: (retryAfterSeconds: number) =>
    new AppError({
      status: 429,
      code: 'rate_limited',
      message: 'Rate limit exceeded',
      userMessage: 'Too many tries. Please wait a moment.',
      details: { retryAfterSeconds },
    }),
  consentRequired: () =>
    new AppError({
      status: 403,
      code: 'consent_required',
      message: 'No valid parental consent on record for this child',
      userMessage: 'A parent needs to approve this account before it can be used.',
    }),
  capacity: () =>
    new AppError({
      status: 503,
      code: 'no_capacity',
      message: 'No desktop capacity available',
      userMessage: 'All the computers are busy right now. Please try again in a few minutes.',
    }),
  internal: (message: string, cause?: unknown) =>
    new AppError({
      status: 500,
      code: 'internal_error',
      message,
      userMessage: 'Something went wrong on our side.',
      cause,
    }),
};

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}
