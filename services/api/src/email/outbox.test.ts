import { describe, expect, it } from 'vitest';
import { shouldHoldMail } from '../boot.js';
import { backoffMinutes } from './outbox.js';

/**
 * The rule that keeps a promise made in .env.production: fill in the SMTP
 * credentials, restart, and whatever queued up meanwhile is delivered.
 */
describe('holding mail when there is nowhere to send it', () => {
  it('holds in production when no mail server is configured', () => {
    // Draining here would mark real messages sent after writing them to a log
    // nobody reads, and the backlog would be gone.
    expect(shouldHoldMail(true, 'log')).toBe(true);
  });

  it('sends in production once a mail server is configured', () => {
    expect(shouldHoldMail(true, 'smtp')).toBe(false);
  });

  it('does not hold in development, where the log is the point', () => {
    expect(shouldHoldMail(false, 'log')).toBe(false);
    expect(shouldHoldMail(false, 'smtp')).toBe(false);
  });
});

describe('retry backoff', () => {
  it('starts quickly and settles at daily', () => {
    expect(backoffMinutes(0)).toBe(1);
    expect(backoffMinutes(1)).toBe(5);
    expect(backoffMinutes(2)).toBe(30);
    expect(backoffMinutes(3)).toBe(120);
    expect(backoffMinutes(4)).toBe(1440);
  });

  it('never grows without bound, and never returns to hammering', () => {
    // The common failure is a mailbox that does not exist. Retry it daily and
    // keep it -- the row is the evidence somebody asked us for something.
    for (const attempts of [5, 20, 500]) {
      expect(backoffMinutes(attempts)).toBe(1440);
    }
  });
})
