/**
 * How long anything is kept, in one place.
 *
 * The rule behind every number: keep a thing only while it still does
 * something for the family it belongs to. A code that has expired, a letter
 * that has been delivered, a sign-up nobody confirmed -- each of those is data
 * with no remaining purpose, and data with no purpose is only a risk. The
 * privacy policy renders these numbers, and the API's forget() sweep enforces
 * them -- one table, so the two cannot disagree.
 */
export const RETENTION = {
  /** A sign-up whose address was never confirmed. Possibly not even theirs. */
  unconfirmedSignUpHours: 24,
  /** A sign-in code or link, once spent or expired. */
  spentChallengeHours: 24,
  /** A code letter that never went out. The code in it died in 30 minutes. */
  undeliveredCodeHours: 24,
  /** The receipt left behind when a letter is delivered (its body is gone already). */
  sentLetterDays: 30,
  /** Any other letter that could not be delivered. */
  undeliveredLetterDays: 90,
  /** One session's start and end. The daily totals below outlive it. */
  sessionDays: 90,
  /** Minutes used per day -- what the parent dashboard's history reads. */
  usageDays: 400,
  /** Who changed what. The DPDP Rules 2025 ask for a year of these. */
  auditDays: 400,
} as const;
