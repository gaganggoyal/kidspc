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
  /*
   * `userMessage` is optional because 401 usually means exactly one thing to
   * the person reading it -- sign in again -- and a caller should not have to
   * retype that. A spent password-reset link is the exception: "please sign in
   * again" is the one instruction that cannot help somebody who is here
   * precisely because they cannot.
   */
  unauthorized: (message = 'Missing or invalid credentials', userMessage = 'Please sign in again.') =>
    new AppError({
      status: 401,
      code: 'unauthorized',
      message,
      userMessage,
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
  /*
   * A wrong, spent or expired emailed code. One message for all three, because
   * the fix is the same and telling them apart helps somebody guessing more
   * than somebody locked out.
   */
  codeRejected: () =>
    new AppError({
      status: 401,
      code: 'code_rejected',
      message: 'Emailed code or link not accepted',
      userMessage:
        'That code has expired, has been used, or is not right. Check the newest email, or ask for a new code.',
    }),
  /*
   * Production with nowhere to send mail. Said plainly rather than accepting a
   * sign-up whose confirmation code can never arrive.
   */
  mailUnavailable: () =>
    new AppError({
      status: 503,
      code: 'mail_unavailable',
      message: 'No mail transport configured',
      userMessage:
        "We can't send email just now, so new sign-ups are paused. Please try again later, or write to us.",
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
