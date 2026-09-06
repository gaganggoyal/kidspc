import type { Config } from '../config.js';

/**
 * Delivery of one already-composed message.
 *
 * Composition, queueing and retry live elsewhere; this is only the last hop.
 * Keeping it this narrow is what lets the whole email path be exercised in
 * tests without a mail server, and what will let a transactional API replace
 * SMTP later without touching a single template.
 */
export interface Mailer {
  readonly name: 'smtp' | 'log';
  send(message: OutgoingMessage): Promise<void>;
}

export interface OutgoingMessage {
  to: string;
  subject: string;
  text: string;
  html?: string | null;
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
 * Whether this configuration can actually reach a mail server.
 *
 * Exported because two very different places need the same answer: the config
 * loader, deciding whether to build an SmtpMailer, and /healthz, reporting
 * whether mail is going anywhere.
 */
export function smtpConfigured(config: Config): boolean {
  return Boolean(config.SMTP_HOST && config.SMTP_USER && config.SMTP_PASS && config.SMTP_FROM);
}

export function createMailer(config: Config): Mailer {
  if (!smtpConfigured(config)) return new LogMailer();
  return new SmtpMailer({
    host: config.SMTP_HOST!,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE,
    user: config.SMTP_USER!,
    pass: config.SMTP_PASS!,
    from: config.SMTP_FROM!,
  });
}
