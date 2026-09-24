import type { Config } from '../config.js';

/**
 * Delivery of one already-composed message.
 *
 * Composition, queueing and retry live elsewhere; this is only the last hop.
 * Keeping it this narrow is what lets the whole email path be exercised in
 * tests without a mail server, and what let Resend's API arrive beside SMTP
 * without touching a single template.
 */
export type Transport = 'resend' | 'smtp' | 'log';

export interface Mailer {
  readonly name: Transport;
  send(message: OutgoingMessage): Promise<void>;
}

export interface OutgoingMessage {
  to: string;
  subject: string;
  text: string;
  html?: string | null;
  /**
   * The outbox row's id. A provider that supports idempotency keys uses it so
   * that a message which went out -- but whose "sent" mark failed to save --
   * is not sent a second time when the queue retries it.
   */
  idempotencyKey?: string;
}

/**
 * Development and any deployment without credentials.
 *
 * It logs the whole message rather than a summary, so the templates can be read
 * while they are being written.
 *
 * A message it handles IS marked sent, which is correct in development and
 * wrong in production -- so the sender loop refuses to run this transport in
 * production at all, and holds the queue instead. See startMailSender.
 */
export class LogMailer implements Mailer {
  readonly name = 'log' as const;

  constructor(private readonly log: (line: string) => void = console.log) {}

  async send(message: OutgoingMessage): Promise<void> {
    this.log(
      `[mail:log] to=${message.to} subject=${JSON.stringify(message.subject)}\n${message.text}`,
    );
  }
}

/**
 * Real delivery, through Resend's HTTP API.
 *
 * The preferred transport, and the one meravansh.lol already sends through, so
 * the two sites share one provider, one dashboard and one way of checking a
 * domain. HTTPS rather than SMTP because a VPS's outbound mail ports are the
 * first thing a host blocks, and 443 is the one port that is never blocked.
 *
 * Plain `fetch`, no SDK: the whole API this needs is one POST, and a
 * dependency for it is a dependency to keep patched.
 */
export class ResendMailer implements Mailer {
  readonly name = 'resend' as const;

  constructor(
    private readonly options: {
      apiKey: string;
      from: string;
      replyTo?: string | null;
      /** Injected by tests; the real one otherwise. */
      fetch?: typeof fetch;
    },
  ) {}

  async send(message: OutgoingMessage): Promise<void> {
    const doFetch = this.options.fetch ?? fetch;
    const res = await doFetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.options.apiKey}`,
        'content-type': 'application/json',
        // Resend keeps an idempotency key for a day, which covers every retry
        // the outbox will make in the window where a duplicate is possible.
        ...(message.idempotencyKey ? { 'idempotency-key': message.idempotencyKey } : {}),
      },
      body: JSON.stringify({
        from: this.options.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
        ...(this.options.replyTo ? { reply_to: this.options.replyTo } : {}),
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      throw new Error(`Resend ${res.status}: ${resendReason(await res.text())}`);
    }
  }
}

/**
 * The sentence in a Resend error that says what to do.
 *
 * Its errors are JSON with a `message` -- "The kidspc.online domain is not
 * verified", "API key is invalid" -- and that line is what belongs in the
 * outbox row's `last_error`, not the whole body.
 */
export function resendReason(body: string): string {
  try {
    const parsed = JSON.parse(body) as { message?: unknown; name?: unknown };
    if (typeof parsed.message === 'string') {
      return typeof parsed.name === 'string'
        ? `${parsed.message} (${parsed.name})`
        : parsed.message;
    }
  } catch {
    // Not JSON: a proxy's HTML error page, most likely. The start of it will do.
  }
  return body.slice(0, 200);
}

/**
 * Real delivery, over SMTP.
 *
 * Configured the same way the other services on this host are -- Zoho on 465
 * with implicit TLS -- because one mail provider per server is one set of DNS
 * records, one reputation to keep, and one place to look when mail stops.
 */
export class SmtpMailer implements Mailer {
  readonly name = 'smtp' as const;
  private transport: import('nodemailer').Transporter | null = null;

  constructor(
    private readonly options: {
      host: string;
      port: number;
      secure: boolean;
      user: string;
      pass: string;
      from: string;
      replyTo?: string | null;
    },
  ) {}

  /**
   * Built on first use rather than in the constructor: nodemailer opens a
   * connection pool, and a process that never sends mail should not hold one
   * open to Zoho for its whole life.
   */
  private async transporter(): Promise<import('nodemailer').Transporter> {
    if (!this.transport) {
      const nodemailer = await import('nodemailer');
      this.transport = nodemailer.createTransport({
        host: this.options.host,
        port: this.options.port,
        secure: this.options.secure,
        auth: { user: this.options.user, pass: this.options.pass },
        pool: true,
        maxConnections: 2,
        // Zoho drops idle connections; failing fast lets the queue retry rather
        // than holding a worker on a socket that is never coming back.
        connectionTimeout: 15_000,
        greetingTimeout: 10_000,
        socketTimeout: 30_000,
      });
    }
    return this.transport;
  }

  async send(message: OutgoingMessage): Promise<void> {
    const transport = await this.transporter();
    await transport.sendMail({
      from: this.options.from,
      ...(this.options.replyTo ? { replyTo: this.options.replyTo } : {}),
      to: message.to,
      subject: message.subject,
      text: message.text,
      ...(message.html ? { html: message.html } : {}),
    });
  }

  async close(): Promise<void> {
    this.transport?.close();
    this.transport = null;
  }
}

/**
 * Whether this configuration can actually reach a mail server over SMTP.
 *
 * Exported because two very different places need the same answer: choosing a
 * transport, and `pnpm mail`, reporting which settings are missing.
 */
export function smtpConfigured(config: Config): boolean {
  return Boolean(config.SMTP_HOST && config.SMTP_USER && config.SMTP_PASS && config.mailFrom);
}

/**
 * Which transport this configuration uses.
 *
 * `EMAIL_DELIVERY` says so outright when it is set. When it is not, the first
 * one with credentials wins -- Resend, then SMTP -- and with neither, the log.
 * An explicit choice whose credentials are missing is refused at boot in
 * production rather than quietly falling back; see loadConfig.
 */
export function chooseTransport(config: Config): Transport {
  if (config.EMAIL_DELIVERY) {
    if (config.EMAIL_DELIVERY === 'resend' && !(config.RESEND_API_KEY && config.mailFrom))
      return 'log';
    if (config.EMAIL_DELIVERY === 'smtp' && !smtpConfigured(config)) return 'log';
    return config.EMAIL_DELIVERY;
  }
  if (config.RESEND_API_KEY && config.mailFrom) return 'resend';
  if (smtpConfigured(config)) return 'smtp';
  return 'log';
}

export function createMailer(config: Config): Mailer {
  switch (chooseTransport(config)) {
    case 'resend':
      return new ResendMailer({
        apiKey: config.RESEND_API_KEY!,
        from: config.mailFrom!,
        replyTo: config.MAIL_REPLY_TO,
      });
    case 'smtp':
      return new SmtpMailer({
        host: config.SMTP_HOST!,
        port: config.SMTP_PORT,
        secure: config.SMTP_SECURE,
        user: config.SMTP_USER!,
        pass: config.SMTP_PASS!,
        from: config.mailFrom!,
        replyTo: config.MAIL_REPLY_TO,
      });
    case 'log':
      return new LogMailer();
  }
}
