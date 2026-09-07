import { type EmailTemplate, PRODUCT_NAME, type Plan, formatInr } from '@kidpc/shared';

/**
 * Message bodies.
 *
 * Every message is composed as plain text first and the HTML is generated from
 * the same content, rather than the other way round. Two reasons: a parent
 * reading this on a TV's mail client or a text-only client gets the whole
 * message, and it is much harder to let the two versions say different things
 * when one is derived from the other.
 *
 * No tracking pixels, no open tracking, no click wrapping. This is a service
 * for children's households and the promise on the home page is that we do not
 * build profiles; an invisible image in a welcome email would be exactly that.
 */
export interface Composed {
  template: EmailTemplate;
  to: string;
  subject: string;
  text: string;
  html: string;
}

const escape = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Wraps plain text in a readable HTML document.
 *
 * Table layouts and inlined CSS because that is what mail clients render.
 * Deliberately plain: a heavy template is more to go wrong in Outlook than it
 * is worth for four transactional messages.
 */
function wrap(subject: string, paragraphs: string[], publicUrl: string): string {
  const body = paragraphs
    .map((p) =>
      p.startsWith('- ')
        ? `<li style="margin:0 0 6px">${escape(p.slice(2))}</li>`
        : `<p style="margin:0 0 16px">${escape(p)}</p>`,
    )
    .join('\n');
  // Consecutive list items are wrapped once, so bullets do not each become
  // their own list.
  const withLists = body.replace(
    /(<li[\s\S]*?<\/li>\n?)+/g,
    (m) => `<ul style="margin:0 0 16px;padding-left:20px">${m}</ul>`,
  );
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${escape(subject)}</title></head>
<body style="margin:0;padding:24px;background:#fbf7f2;font:16px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1d1b19">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;margin:0 auto">
<tr><td style="padding:0 0 20px"><strong style="font-size:18px;color:#2f6f4f">${escape(PRODUCT_NAME)}</strong></td></tr>
<tr><td style="background:#ffffff;border:1px solid #e2d9cd;border-radius:14px;padding:28px">${withLists}</td></tr>
<tr><td style="padding:18px 0 0;font-size:13px;color:#5f5850">
${escape(PRODUCT_NAME)} · <a href="${escape(publicUrl)}" style="color:#5f5850">${escape(publicUrl.replace(/^https?:\/\//, ''))}</a><br>
You are receiving this because you used this address at ${escape(PRODUCT_NAME)}. We do not send marketing email.
</td></tr>
</table></body></html>`;
}

function compose(
  template: EmailTemplate,
  to: string,
  subject: string,
  paragraphs: string[],
  publicUrl: string,
): Composed {
  return {
    template,
    to,
    subject,
    text: `${paragraphs.join('\n\n')}\n\n--\n${PRODUCT_NAME}\n${publicUrl}`,
    html: wrap(subject, paragraphs, publicUrl),
  };
}

/** Sent when a guardian account is created. */
export function welcomeEmail(input: {
  to: string;
  displayName: string;
  publicUrl: string;
}): Composed {
  return compose(
    'welcome',
    input.to,
    `Welcome to ${PRODUCT_NAME}`,
    [
      `Hello ${input.displayName},`,
      `Your ${PRODUCT_NAME} parent account is ready. You can sign in at ${input.publicUrl}/signin and add your children from the household screen.`,
      'A few things worth knowing before you set up a child:',
      '- You choose the minutes per day and per week, and the hours of the day they apply.',
      '- You choose which activities each child can open.',
      '- Nothing your child writes, draws or codes is uploaded. It stays on their device.',
      // Said here as well as on the site, because this is the message a parent
      // still has in their inbox when they wonder why the profile will not open.
      'One honest note: before a child profile can be used, we have to verify that you are their parent or guardian. That check is required by the DPDP Act and we are still putting it in place, so child profiles are not usable just yet. Your account and settings are unaffected, and we will write to you when it is ready.',
      'If you did not create this account, you can ignore this message — nothing further will be sent.',
    ],
    input.publicUrl,
  );
}

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
    [
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
      'If you did not make this request, please ignore this message — no account or charge has been created.',
    ],
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
    [
      `Plan: ${input.plan.name}`,
      `Children: ${input.children}`,
      `Quoted: ${formatInr(input.quotedInr)} per month`,
      `Email: ${input.email}`,
      `Name: ${input.contactName ?? '(not given)'}`,
      `Existing account: ${input.guardianId ?? 'no'}`,
      `Referred by: ${input.referralCode ?? '(nobody)'}`,
      `Order id: ${input.orderId}`,
      'Send the payment link, then move the order to link_sent.',
      ...(input.referralCode
        ? [
            `This household came in on a code. Run "pnpm orders referrer ${input.referralCode}" to find out whose month to credit, and do it only after they pay.`,
          ]
        : []),
    ],
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
    [
      input.contactName ? `Hello ${input.contactName},` : 'Hello,',
      `Here is the link to start your ${PRODUCT_NAME} ${input.plan.name} subscription for ${input.children} ${input.children === 1 ? 'child' : 'children'}, at ${formatInr(input.quotedInr)} per month:`,
      input.paymentUrl,
      trialDays === 0
        ? `${input.plan.name} has no free trial, so following this link starts the subscription. You can cancel it at any time and you will not be charged again.`
        : `Your first ${trialDays} days are free. You can cancel before they are up and nothing will be taken.`,
      `If you have not created your account yet, you can do that at ${input.publicUrl}/signin — it takes about two minutes.`,
      'Reply to this email if anything looks wrong. A person reads it.',
    ],
    input.publicUrl,
  );
}

/**
 * Somebody wrote in from the contact page.
 *
 * Two messages, not one: this is the copy that reaches whoever answers, and
 * `contactAckEmail` is the one that reaches the person who wrote. Sending only
 * the first leaves them wondering whether the form worked, which is how a
 * question becomes a chargeback.
 *
 * The sender's own address goes in `replyTo`-shaped text rather than in the
 * From header, because forging a From is how mail ends up in spam -- so the
 * address is stated in the body and a human presses reply-all to it.
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
    [
      `From: ${input.name} <${input.from}>`,
      'Reply to that address, not to this one.',
      '---',
      input.message,
    ],
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
    [
      `Hello ${input.name},`,
      `Thank you for writing. A person reads every message sent to ${PRODUCT_NAME} and you will get a reply, usually within two working days.`,
      'This is what you sent, so you have a copy:',
      '---',
      input.message,
      '---',
      'If it was urgent — a child cannot get in, or something is wrong with a payment — reply to this email and say so, and it goes to the top.',
    ],
    input.publicUrl,
  );
}
