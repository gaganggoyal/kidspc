import { describe, expect, it } from 'vitest';
import { ResendMailer, resendReason } from './mailer.js';
import { contactAckEmail, passwordResetEmail, signInCodeEmail, verifyEmail } from './templates.js';

/**
 * The last hop, and what arrives at the end of it.
 *
 * Resend is called with a stand-in `fetch`, so these check the exact request
 * that would leave this machine -- the part a provider's dashboard shows only
 * after it has gone wrong.
 */
function recordingFetch(status = 200, body = '{"id":"e_1"}') {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(body, { status });
  }) as unknown as typeof globalThis.fetch;
  return { calls, fetch };
}

describe('sending through Resend', () => {
  it('posts one message with the key, the From line, a reply-to and an idempotency key', async () => {
    const { calls, fetch } = recordingFetch();
    const mailer = new ResendMailer({
      apiKey: 're_test',
      from: 'Online Kids PC <hello@kidspc.online>',
      replyTo: 'hello@kidspc.online',
      fetch,
    });
    await mailer.send({
      to: 'parent@example.com',
      subject: 'Hello',
      text: 'Plain',
      html: '<p>Rich</p>',
      idempotencyKey: 'eml_123',
    });

    expect(calls).toHaveLength(1);
    const { url, init } = calls[0]!;
    expect(url).toBe('https://api.resend.com/emails');
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer re_test');
    // A retry of a message that did go out is recognised, not sent again.
    expect(headers['idempotency-key']).toBe('eml_123');
    expect(JSON.parse(String(init.body))).toEqual({
      from: 'Online Kids PC <hello@kidspc.online>',
      to: ['parent@example.com'],
      subject: 'Hello',
      text: 'Plain',
      html: '<p>Rich</p>',
      reply_to: 'hello@kidspc.online',
    });
  });

  it('fails with the sentence Resend gave, so the outbox row says what to fix', async () => {
    const { fetch } = recordingFetch(
      403,
      '{"statusCode":403,"message":"The kidspc.online domain is not verified.","name":"validation_error"}',
    );
    const mailer = new ResendMailer({ apiKey: 're_test', from: 'x <x@kidspc.online>', fetch });
    await expect(
      mailer.send({ to: 'parent@example.com', subject: 's', text: 't' }),
    ).rejects.toThrow('Resend 403: The kidspc.online domain is not verified. (validation_error)');
  });

  it('keeps the start of an error that is not JSON', () => {
    expect(resendReason('<html>Bad gateway</html>')).toBe('<html>Bad gateway</html>');
  });
});

describe('letters that carry a code', () => {
  const common = {
    to: 'parent@example.com',
    displayName: 'Priya',
    code: '042917',
    url: 'https://kidspc.online/verify?token=abc',
    publicUrl: 'https://kidspc.online',
  };

  it('prints the code in both versions, in two groups, with the button beside it', () => {
    const mail = verifyEmail(common);
    expect(mail.template).toBe('verify_email');
    expect(mail.text).toContain('Your code: 042 917');
    expect(mail.html).toContain('042 917');
    expect(mail.text).toContain('https://kidspc.online/verify?token=abc');
    expect(mail.html).toContain('href="https://kidspc.online/verify?token=abc"');
  });

  it('never puts the code where a locked phone would show it', () => {
    for (const mail of [
      verifyEmail(common),
      signInCodeEmail(common),
      passwordResetEmail({ ...common, ttlMinutes: 60 }),
    ]) {
      expect(mail.subject).not.toContain('042');
      const preheader = /<div style="display:none[^>]*>([^<&]*)/.exec(mail.html)?.[1] ?? '';
      expect(preheader).not.toContain('042');
    }
  });

  it('loads nothing from anywhere when it is opened', () => {
    // No logo, no pixel: an image fetched on open is a record of who opened
    // what, and the home page promises there is no such record.
    for (const mail of [verifyEmail(common), signInCodeEmail(common)]) {
      expect(mail.html).not.toMatch(/<img|background-image|url\(/i);
    }
  });

  it('treats a name and a message as text, never as markup', () => {
    const mail = contactAckEmail({
      to: 'x@example.com',
      name: '<b>Priya</b>',
      message: 'Hi <script>alert(1)</script>',
      publicUrl: 'https://kidspc.online',
    });
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&lt;b&gt;Priya&lt;/b&gt;');
    expect(mail.text).toContain('> Hi <script>alert(1)</script>');
  });
});
