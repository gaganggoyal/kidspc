import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { emailOutbox, guardians, planOrders } from './db/schema.js';
import { sendPending } from './email/outbox.js';
import { forget, RETENTION } from './retention.js';
import { createHarness, type Harness, ist } from './testing/harness.js';

/**
 * The promises the privacy policy makes about what is kept, and for how long.
 * Each of these is a sentence a parent can read; the tests are the proof.
 */
let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

const db = () => h!.runtime.ctx.database.db;
const letters = (to: string) => db().select().from(emailOutbox).where(eq(emailOutbox.toAddress, to));
const guardianRow = (email: string) =>
  db().select().from(guardians).where(eq(guardians.email, email));

describe('what is forgotten, and when', () => {
  it('keeps no copy of a letter once it has been delivered', async () => {
    h = await createHarness(ist('2026-03-14T10:00:00'));
    await h.registerGuardian('kept@example.com');

    const sent = await sendPending(db(), { name: 'resend', send: async () => {} }, h.now);
    expect(sent.sent).toBeGreaterThan(0);

    const rows = await letters('kept@example.com');
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.sentAt).not.toBeNull();
      expect(row.bodyText).toBe('');
      expect(row.bodyHtml).toBeNull();
    }
  });

  it('forgets a sign-up nobody confirmed within a day', async () => {
    h = await createHarness(ist('2026-03-14T10:00:00'));
    const asked = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { email: 'never@example.com', displayName: 'Somebody' },
    });
    expect(asked.statusCode).toBe(202);
    await h.registerGuardian('confirmed@example.com');

    // Not yet: the code is only half an hour old, and they may be looking for it.
    await forget(db(), h.now());
    expect(await guardianRow('never@example.com')).toHaveLength(1);

    h.advanceMinutes(RETENTION.unconfirmedSignUpHours * 60 + 1);
    const result = await forget(db(), h.now());

    expect(result.unconfirmedSignUps).toBe(1);
    expect(await guardianRow('never@example.com')).toHaveLength(0);
    // The letter with the dead code in it goes as well.
    expect(await letters('never@example.com')).toHaveLength(0);
    // A confirmed parent is never touched by this.
    expect(await guardianRow('confirmed@example.com')).toHaveLength(1);
  });

  it('keeps a delivered letter as a receipt for a month, then drops that too', async () => {
    h = await createHarness(ist('2026-03-14T10:00:00'));
    await h.registerGuardian('receipt@example.com');
    await sendPending(db(), { name: 'resend', send: async () => {} }, h.now);

    h.advanceMinutes((RETENTION.sentLetterDays - 1) * 24 * 60);
    await forget(db(), h.now());
    expect((await letters('receipt@example.com')).length).toBeGreaterThan(0);

    h.advanceMinutes(2 * 24 * 60);
    await forget(db(), h.now());
    expect(await letters('receipt@example.com')).toHaveLength(0);
  });

  it('does nothing on a second run straight after the first', async () => {
    h = await createHarness(ist('2026-03-14T10:00:00'));
    await h.registerGuardian('twice@example.com');
    h.advanceMinutes(500 * 24 * 60);
    await forget(db(), h.now());
    const again = await forget(db(), h.now());
    expect(Object.values(again).every((n) => n === 0)).toBe(true);
  });
});

describe('erasing a household', () => {
  it('also takes the letters and plan requests that only know the address', async () => {
    h = await createHarness(ist('2026-03-14T10:00:00'));
    const token = await h.registerGuardian('leaving@example.com');
    const ordered = await h.app.inject({
      method: 'POST',
      url: '/v1/orders',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { email: 'leaving@example.com', planId: 'lite', children: 1 },
    });
    expect(ordered.statusCode).toBe(201);
    expect((await letters('leaving@example.com')).length).toBeGreaterThan(0);

    const erased = await h.app.inject({
      method: 'POST',
      url: '/v1/privacy/erase',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(erased.statusCode).toBe(200);

    expect(await guardianRow('leaving@example.com')).toHaveLength(0);
    expect(await letters('leaving@example.com')).toHaveLength(0);
    const orders = await db()
      .select()
      .from(planOrders)
      .where(eq(planOrders.email, 'leaving@example.com'));
    expect(orders).toHaveLength(0);
  });
});

describe('signing up from a confused television', () => {
  it('uses India time when the browser names a zone that does not exist', async () => {
    h = await createHarness(ist('2026-03-14T10:00:00'));
    const token = await h.registerGuardian('tv@example.com', 'Mars/Olympus_Mons');
    const me = await h.app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().guardian?.timezone ?? me.json().timezone).toBe('Asia/Kolkata');
  });
});
