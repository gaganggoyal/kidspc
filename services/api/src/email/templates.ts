import {
  CONTACT_EMAIL,
  EMAIL_CODE_TTL_MINUTES,
  type EmailTemplate,
  PRODUCT_NAME,
  type Plan,
  formatInr,
} from '@kidpc/shared';

/**
 * Message bodies.
 *
 * A letter is a list of blocks -- a paragraph, a list item, a code, a button, a
 * note -- and both the plain text and the HTML are rendered from that one list.
 * A parent reading this in a TV's mail client or a text-only one gets the
 * whole message, and the two versions cannot say different things, because
 * neither is written by hand.
 *
 * No tracking pixels, no open tracking, no click wrapping, and no remote images
 * at all -- not even a logo. This is a service for children's households and
 * the promise on the home page is that we do not build profiles; an image
 * fetched from our server when a letter is opened would be exactly that, and a
 * logo is not worth a quiet exception to the promise.
 */
export interface Composed {
  template: EmailTemplate;
  to: string;
  subject: string;
  text: string;
  html: string;
}

type Block =
  /** A paragraph. A leading "- " makes it a bullet, and consecutive bullets one list. */
  | string
  /** The six digits, large, in a box that reads as the thing to copy. */
  | { code: string }
  /** One button, with the address spelt out underneath for when buttons fail. */
  | { button: { url: string; label: string } }
  /** Small grey print: expiry, "if this was not you". */
  | { note: string }
  /** Somebody's own words, quoted back exactly. */
  | { quote: string };

interface Letter {
  /** The line at the top of the card. */
  heading: string;
  /**
   * The line a mail app shows beside the subject in the inbox. Never the code:
   * a preview is what appears on a locked phone's screen.
   */
  preheader: string;
  blocks: Block[];
}

const escape = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** Escaped, with any web address made clickable. */
const linkify = (s: string): string =>
  escape(s).replace(
    /https?:\/\/[^\s<]+[^\s<.,;:!?)]/g,
    (url) => `<a href="${url}" style="color:${C.accent};word-break:break-all">${url}</a>`,
  );

/** "123456" read as two groups, the way people read it aloud. */
const spaced = (code: string) => `${code.slice(0, 3)} ${code.slice(3)}`;

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";
const MONO = "'SF Mono',SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace";
/* The site's own palette, so a letter looks like it came from the page the
   parent was just on. Fixed values: mail clients do not read custom properties. */
const C = {
  accent: '#2f6f4f',
  wash: '#e9f1eb',
  ink: '#1d1b19',
  body: '#3a3631',
  muted: '#5f5850',
  line: '#e2d9cd',
  canvas: '#fbf7f2',
};

function blockHtml(block: Block): string {
  if (typeof block === 'string') {
    return block.startsWith('- ')
      ? `<li style="margin:0 0 6px">${linkify(block.slice(2))}</li>`
      : `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${C.body}">${linkify(block)}</p>`;
  }
  if ('code' in block) {
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 22px">
<tr><td align="center" style="background:${C.wash};border-radius:14px;padding:18px 12px 20px">
<div style="font-size:11px;letter-spacing:0.08em;text-transform:uppercase;font-weight:600;color:${C.muted};margin:0 0 8px">Your code</div>
<div class="k-code" style="font-family:${MONO};font-size:36px;line-height:1.1;font-weight:700;letter-spacing:8px;color:${C.accent}">${escape(spaced(block.code))}</div>
</td></tr></table>`;
  }
  if ('button' in block) {
    const { url, label } = block.button;
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 14px"><tr>
<td align="center" bgcolor="${C.accent}" style="border-radius:12px">
<a class="k-btn" href="${escape(url)}" target="_blank" style="display:inline-block;padding:14px 26px;font-size:15px;line-height:1;font-weight:600;color:#ffffff;text-decoration:none;border-radius:12px">${escape(label)}</a>
</td></tr></table>
<p style="margin:0 0 22px;font-size:12px;line-height:1.6;color:${C.muted}">Button not working? Copy this address into your browser:<br><a href="${escape(url)}" style="color:${C.accent};word-break:break-all">${escape(url)}</a></p>`;
  }
  if ('note' in block) {
    return `<p style="margin:0 0 12px;font-size:13px;line-height:1.6;color:${C.muted}">${linkify(block.note)}</p>`;
  }
  return `<div style="margin:0 0 16px;padding:12px 16px;border-left:3px solid ${C.line};background:${C.canvas};font-size:14px;line-height:1.6;color:${C.body};white-space:pre-wrap">${escape(block.quote)}</div>`;
}

function blockText(block: Block): string {
  if (typeof block === 'string') return block;
  if ('code' in block) return `Your code: ${spaced(block.code)}`;
  if ('button' in block) return `${block.button.label}: ${block.button.url}`;
  if ('note' in block) return block.note;
  return block.quote
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
}

/**
 * The frame around every letter.
 *
 * Tables and inlined styles because that is what Gmail, Outlook and phone mail
 * apps agree on. The preheader is padded with invisible characters so the
 * inbox preview stops at it instead of running on into the body.
 */
function render(subject: string, letter: Letter, publicUrl: string): string {
  const body = letter.blocks
    .map(blockHtml)
    .join('\n')
    // Consecutive bullets become one list rather than a list each.
    .replace(
      /(<li[\s\S]*?<\/li>\n?)+/g,
      (m) =>
        `<ul style="margin:0 0 16px;padding-left:20px;font-size:15px;line-height:1.6;color:${C.body}">${m}</ul>`,
    );
  const site = publicUrl.replace(/^https?:\/\//, '');
  const pad = '&#847;&zwnj;&nbsp;'.repeat(40);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escape(subject)}</title>
<style>
@media (max-width:600px) { .k-card { padding:26px 20px !important; } .k-code { font-size:30px !important; letter-spacing:6px !important; } }
</style>
</head>
<body style="margin:0;padding:0;background:${C.canvas}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.canvas};font-size:1px;line-height:1px">${escape(letter.preheader)}${pad}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.canvas}">
<tr><td align="center" style="padding:32px 12px 40px;font-family:${FONT}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px">
<tr><td style="padding:0 6px 18px">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="width:34px;height:34px;background:${C.accent};border-radius:10px;text-align:center;vertical-align:middle;font-size:18px;line-height:34px;color:#ffffff;font-weight:700">K</td>
<td style="padding-left:10px;font-size:17px;font-weight:700;color:${C.ink}">${escape(PRODUCT_NAME)}</td>
</tr></table>
</td></tr>
<tr><td class="k-card" style="background:#ffffff;border:1px solid ${C.line};border-radius:20px;padding:34px 34px 28px">
<h1 style="margin:0 0 14px;font-size:22px;line-height:1.3;font-weight:700;color:${C.ink}">${escape(letter.heading)}</h1>
${body}
</td></tr>
<tr><td style="padding:18px 6px 0;font-size:12px;line-height:1.6;color:${C.muted}">
You are receiving this because this address was used at ${escape(PRODUCT_NAME)}. We do not send marketing email.<br>
${escape(PRODUCT_NAME)} · <a href="${escape(publicUrl)}" style="color:${C.muted}">${escape(site)}</a> · <a href="mailto:${CONTACT_EMAIL}" style="color:${C.muted}">${CONTACT_EMAIL}</a>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function compose(
  template: EmailTemplate,
  to: string,
  subject: string,
  letter: Letter,
  publicUrl: string,
): Composed {
  return {
    template,
    to,
    subject,
    text: `${letter.blocks.map(blockText).join('\n\n')}\n\n--\n${PRODUCT_NAME}\n${publicUrl}`,
    html: render(subject, letter, publicUrl),
  };
}

// ---------------------------------------------------------------------------
// Letters that carry a code
// ---------------------------------------------------------------------------

/**
 * Confirming the address, at sign-up.
 *
 * Nothing else is ever sent to an address before this has been answered, so
 * this is the letter that decides whether an account exists at all. It says so
 * for the person who never signed up: ignoring it is enough.
 *
 * The code comes first because it is what the parent standing at a television
 * needs; the button is for somebody who signed up on the device they read mail
 * on. Either works, once.
 */
export function verifyEmail(input: {
  to: string;
  displayName: string;
  code: string;
  url: string;
  publicUrl: string;
}): Composed {
  return compose(
    'verify_email',
    input.to,
    `Confirm your email for ${PRODUCT_NAME}`,
    {
      heading: 'Confirm your email',
      preheader: 'One code, and your household account is ready.',
      blocks: [
        `Hello ${input.displayName}, enter this code on the screen where you signed up:`,
        { code: input.code },
        'Or, if you signed up on this device, press the button:',
        { button: { url: input.url, label: 'Confirm my email' } },
        {
          note: `The code and the button work once, for ${EMAIL_CODE_TTL_MINUTES} minutes. If they have expired, choose "Email me a code" on the sign-in page and we will send a new one.`,
        },
        {
          note: `If you did not sign up for ${PRODUCT_NAME}, ignore this message. No account is used until the address is confirmed, and nothing more will be sent.`,
        },
      ],
    },
    input.publicUrl,
  );
}

/** "Email me a code": signing in without the password. */
export function signInCodeEmail(input: {
  to: string;
  displayName: string;
  code: string;
  url: string;
  publicUrl: string;
}): Composed {
  return compose(
    'sign_in_code',
    input.to,
    `Your ${PRODUCT_NAME} sign-in code`,
    {
      heading: 'Your sign-in code',
      preheader: 'Type it on the TV or computer you are signing in on.',
      blocks: [
        `Hello ${input.displayName}, type this code on the TV or computer you are signing in on:`,
        { code: input.code },
        'Or press the button to sign in on this device instead:',
        { button: { url: input.url, label: 'Sign me in' } },
        {
          note: `It works once, for ${EMAIL_CODE_TTL_MINUTES} minutes.`,
        },
        {
          note: 'If you did not ask for this, you can ignore it. Nobody can sign in without the code, and your password has not changed.',
        },
      ],
    },
    input.publicUrl,
  );
}

/**
 * The letter that gets a household back into their account.
 *
 * Deliberately short. A parent reading this has already decided what they want
 * to do, and everything above the code is an obstacle to doing it -- so the
 * code and the button come first, and the caution goes underneath where it
 * belongs.
 *
 * The URL is built by the caller from PUBLIC_URL rather than from anything in
 * the request. A reset link assembled from a Host header is the classic way
 * this feature becomes an account-takeover: an attacker asks for a reset on
 * somebody else's address, poisons the host, and the mail that arrives points
 * at their server carrying a working token.
 */
export function passwordResetEmail(input: {
  to: string;
  displayName: string;
  code: string;
  url: string;
  ttlMinutes: number;
  publicUrl: string;
}): Composed {
  return compose(
    'password_reset',
    input.to,
    `Reset your ${PRODUCT_NAME} password`,
    {
      heading: 'Choose a new password',
      preheader: 'Your reset code, and a button to choose a new password.',
      blocks: [
        `Hello ${input.displayName}, enter this code on the screen where you asked for it:`,
        { code: input.code },
        'Or press the button to choose a new password here:',
        { button: { url: input.url, label: 'Choose a new password' } },
        {
          note: `The code and the button work once, and stop working in ${input.ttlMinutes} minutes. If they have expired, ask for another from the sign-in page.`,
        },
        {
          note: "If you did not ask for this, you can ignore this message. Your password has not changed, and your children's profiles, limits and progress are unaffected either way.",
        },
      ],
    },
    input.publicUrl,
  );
}

// ---------------------------------------------------------------------------
// Account letters
// ---------------------------------------------------------------------------

/** Sent once an address is confirmed: the first letter that is not a code. */
export function welcomeEmail(input: {
  to: string;
  displayName: string;
  publicUrl: string;
}): Composed {
  return compose(
    'welcome',
    input.to,
    `Welcome to ${PRODUCT_NAME}`,
    {
      heading: `Welcome, ${input.displayName}`,
      preheader: 'Your parent account is ready. Here is what happens next.',
      blocks: [
        `Your ${PRODUCT_NAME} parent account is ready. Add your children from the household screen, and set their limits from Parent settings.`,
        { button: { url: `${input.publicUrl}/household`, label: 'Open your household' } },
        'A few things worth knowing before you set up a child:',
        '- You choose the minutes per day and per week, and the hours of the day they apply.',
        '- You choose which activities and games each child can open.',
        '- Nothing your child writes, draws or codes is uploaded. It stays on their device.',
        // Said here as well as on the site, because this is the message a parent
        // still has in their inbox when they wonder why the profile will not open.
        'One honest note: before a child profile can be used, we have to verify that you are their parent or guardian. That check is required by the DPDP Act and we are still putting it in place, so child profiles are not usable just yet. Your account and settings are unaffected, and we will write to you when it is ready.',
        {
          note: `On the TV, sign in once at ${input.publicUrl}/signin. After that a child only ever types their four-digit code.`,
        },
      ],
    },
    input.publicUrl,
  );
}

/**
 * Sent after a password actually changes.
 *
 * This is the message that matters. A reset link arriving unexpectedly is a
 * nuisance; a password that changed without the owner asking is an account
 * they have lost, and the only way they find out in time is if we tell them.
 * It goes to the address on the account, which is still the old owner's until
 * they change it.
 */
export function passwordChangedEmail(input: {
  to: string;
  displayName: string;
  publicUrl: string;
}): Composed {
  return compose(
    'password_changed',
    input.to,
    `Your ${PRODUCT_NAME} password was changed`,
    {
      heading: 'Your password was changed',
      preheader: 'Every device that was signed in has been signed out.',
      blocks: [
        `Hello ${input.displayName},`,
        `The password on your ${PRODUCT_NAME} account has just been changed, and every device that was signed in has been signed out.`,
        'If that was you, there is nothing to do.',
        'If it was not, reset it again straight away and then write to us — that reset will sign out whoever did this.',
        { button: { url: `${input.publicUrl}/forgot`, label: 'Reset my password' } },
      ],
    },
    input.publicUrl,
  );
}

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

/** Sent to the household that asked for a plan. */
export function orderReceivedEmail(input: {
  to: string;
  contactName?: string | null;
  plan: Plan;
  children: number;
  quotedInr: number;
  publicUrl: string;
  /**
   * Total free days: longer when they arrived on someone's code, and zero on a
   * plan with no trial. Required rather than defaulted -- a default here is how
   * a Pro customer gets told about a free week that does not exist.
   */
  trialDays: number;
  referred?: boolean;
}): Composed {
  const greeting = input.contactName ? `Hello ${input.contactName},` : 'Hello,';
  const { trialDays } = input;
  return compose(
    'order_received',
    input.to,
    `Your ${PRODUCT_NAME} ${input.plan.name} request`,
    {
      heading: `We have your ${input.plan.name} request`,
      preheader: 'A payment link follows shortly. Nothing to do until then.',
      blocks: [
        greeting,
        `Thank you — we have your request for ${PRODUCT_NAME} ${input.plan.name}, for ${input.children} ${input.children === 1 ? 'child' : 'children'}, at ${formatInr(input.quotedInr)} per month.`,
        'We will email you a payment link shortly. There is nothing to do until then, and we have not asked for or stored any card details.',
        trialDays === 0
          ? `${input.plan.name} does not come with a free trial — the link starts the subscription, and the first month is charged when you use it.`
          : input.referred
            ? `Someone sent you here, so your first ${trialDays} days are free rather than the usual ${input.plan.trialDays}. The link will not charge you today.`
            : `Your first ${trialDays} days are free, so the link will not charge you today.`,
        input.plan.pending
          ? `About ${input.plan.name}: ${input.plan.pending} We will tell you the moment it opens, and you will not be billed for it before then.`
          : `You can already create your account and set up your household at ${input.publicUrl}/signin`,
        {
          note: 'If you did not make this request, please ignore this message — no account or charge has been created.',
        },
      ],
    },
    input.publicUrl,
  );
}

/** Sent to whoever runs the service, so a request is not just a database row. */
export function orderInternalEmail(input: {
  to: string;
  orderId: string;
  email: string;
  contactName?: string | null;
  plan: Plan;
  children: number;
  quotedInr: number;
  guardianId?: string | null;
  referralCode?: string | null;
  publicUrl: string;
}): Composed {
  return compose(
    'order_internal',
    input.to,
    `New ${input.plan.name} request — ${input.email}`,
    {
      heading: `New ${input.plan.name} request`,
      preheader: `${input.email}, ${input.children} ${input.children === 1 ? 'child' : 'children'}, ${formatInr(input.quotedInr)} a month.`,
      blocks: [
        `- Plan: ${input.plan.name}`,
        `- Children: ${input.children}`,
        `- Quoted: ${formatInr(input.quotedInr)} per month`,
        `- Email: ${input.email}`,
        `- Name: ${input.contactName ?? '(not given)'}`,
        `- Existing account: ${input.guardianId ?? 'no'}`,
        `- Referred by: ${input.referralCode ?? '(nobody)'}`,
        `- Order id: ${input.orderId}`,
        'Send the payment link, then move the order to link_sent.',
        ...(input.referralCode
          ? [
              `This household came in on a code. Run "pnpm orders referrer ${input.referralCode}" to find out whose month to credit, and do it only after they pay.`,
            ]
          : []),
      ],
    },
    input.publicUrl,
  );
}

/**
 * The message the whole order flow exists to produce.
 *
 * Sent by hand, from `pnpm orders send`, because the payment link is created by
 * hand -- there is no payment provider wired in. When one is, this template is
 * where the generated link goes and the rest of the flow does not change.
 */
export function paymentLinkEmail(input: {
  to: string;
  contactName?: string | null;
  plan: Plan;
  children: number;
  quotedInr: number;
  paymentUrl: string;
  publicUrl: string;
  /** Zero on a plan with no trial. See orderReceivedEmail for why it is required. */
  trialDays: number;
}): Composed {
  const { trialDays } = input;
  return compose(
    'payment_link',
    input.to,
    `Your ${PRODUCT_NAME} ${input.plan.name} payment link`,
    {
      heading: `Your ${input.plan.name} payment link`,
      preheader:
        trialDays === 0
          ? 'Start your subscription whenever you are ready.'
          : `Your first ${trialDays} days are free.`,
      blocks: [
        input.contactName ? `Hello ${input.contactName},` : 'Hello,',
        `Here is the link to start your ${PRODUCT_NAME} ${input.plan.name} subscription for ${input.children} ${input.children === 1 ? 'child' : 'children'}, at ${formatInr(input.quotedInr)} per month:`,
        { button: { url: input.paymentUrl, label: 'Start my subscription' } },
        trialDays === 0
          ? `${input.plan.name} has no free trial, so following this link starts the subscription. You can cancel it at any time and you will not be charged again.`
          : `Your first ${trialDays} days are free. You can cancel before they are up and nothing will be taken.`,
        `If you have not created your account yet, you can do that at ${input.publicUrl}/signin — it takes about two minutes.`,
        { note: 'Reply to this email if anything looks wrong. A person reads it.' },
      ],
    },
    input.publicUrl,
  );
}

// ---------------------------------------------------------------------------
// Contact
// ---------------------------------------------------------------------------

/**
 * Somebody wrote in from the contact page.
 *
 * Two messages, not one: this is the copy that reaches whoever answers, and
 * `contactAckEmail` is the one that reaches the person who wrote. Sending only
 * the first leaves them wondering whether the form worked, which is how a
 * question becomes a chargeback.
 *
 * The sender's own address goes in the body rather than in the From header,
 * because forging a From is how mail ends up in spam -- so the address is
 * stated here and a human replies to it.
 */
export function contactMessageEmail(input: {
  to: string;
  from: string;
  name: string;
  message: string;
  publicUrl: string;
}): Composed {
  return compose(
    'contact_message',
    input.to,
    `Message from ${input.name} <${input.from}>`,
    {
      heading: `Message from ${input.name}`,
      preheader: input.message.slice(0, 90),
      blocks: [
        `From: ${input.name} <${input.from}>`,
        'Reply to that address, not to this one.',
        { quote: input.message },
      ],
    },
    input.publicUrl,
  );
}

/** Sent back to whoever wrote, so they know it arrived. */
export function contactAckEmail(input: {
  to: string;
  name: string;
  message: string;
  publicUrl: string;
}): Composed {
  return compose(
    'contact_message',
    input.to,
    `We have your message — ${PRODUCT_NAME}`,
    {
      heading: 'We have your message',
      preheader: 'A person reads every message. You will get a reply.',
      blocks: [
        `Hello ${input.name},`,
        `Thank you for writing. A person reads every message sent to ${PRODUCT_NAME} and you will get a reply, usually within two working days.`,
        'This is what you sent, so you have a copy:',
        { quote: input.message },
        {
          note: 'If it was urgent — a child cannot get in, or something is wrong with a payment — reply to this email and say so, and it goes to the top.',
        },
      ],
    },
    input.publicUrl,
  );
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

/** `pnpm mail send`: one real letter, through the service's own path. */
export function mailTestEmail(input: {
  to: string;
  transport: string;
  from: string;
  publicUrl: string;
  at: Date;
}): Composed {
  return compose(
    'mail_test',
    input.to,
    `${PRODUCT_NAME} test message`,
    {
      heading: 'Mail is working',
      preheader: `Sent through ${input.transport}.`,
      blocks: [
        `This is a test from the ${PRODUCT_NAME} deployment at ${input.publicUrl}. If you are reading it, sign-up codes, sign-in codes and password resets will be delivered.`,
        `- Transport: ${input.transport}`,
        `- From: ${input.from}`,
        `- Sent: ${input.at.toISOString()}`,
        {
          note: 'Found it in spam? Then it was delivered, and the domain’s SPF, DKIM or DMARC records are not right yet. See docs/deploy.md, "Mail".',
        },
      ],
    },
    input.publicUrl,
  );
}
