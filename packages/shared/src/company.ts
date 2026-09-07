/**
 * Who we actually are.
 *
 * The About page, the Contact page, four policy documents and the footer all
 * need the same handful of facts, and a service asking Indian families for
 * money has to state them consistently -- the Consumer Protection
 * (E-Commerce) Rules 2020 require a seller to publish its legal name and
 * contact details, and DPDP 2023 s.13 requires a named person a parent can
 * complain to. Six copies of that in six pages is six chances to disagree.
 *
 * Fields that are genuinely not established yet are `null` rather than
 * plausible-looking text. A page omits what is null instead of printing a
 * placeholder, because an invented registered address on a policy page is a
 * lie a payment provider will check and a customer may rely on.
 */
export interface Person {
  name: string;
  role: string;
}

export const FOUNDERS: readonly Person[] = [
  { name: 'Gagandeep Goyal', role: 'Founder' },
  { name: 'Vansh Sharma', role: 'Co-founder' },
];

/** Where a parent writes. Created as part of the launch checklist. */
export const CONTACT_EMAIL = 'hello@kidspc.online';

/** Named under DPDP 2023 s.13, so a parent has a person and not a form. */
export const GRIEVANCE_OFFICER: Person = { name: 'Gagandeep Goyal', role: 'Grievance Officer' };

/**
 * The registered entity, once there is one.
 *
 * `null` today, deliberately. Until it is filled in, the policy pages say the
 * service is operated by its founders rather than naming a company that does
 * not exist -- and a payment provider's review will ask for exactly this, so
 * it is the first thing to fill.
 */
export const LEGAL_ENTITY: string | null = null;

/** Postal address. Required by a payment provider's merchant review. */
export const POSTAL_ADDRESS: string | null = null;

/** A number a customer can ring. Required by the same review. */
export const PHONE: string | null = null;

/** Courts and law that govern the terms. India is the only market. */
export const JURISDICTION = 'India';
export const GOVERNING_LAW = 'the laws of India';

/**
 * When the policies below were last changed.
 *
 * Written by hand, because "today" is not a useful answer on a legal page --
 * a parent needs to know whether the terms moved since they agreed to them.
 * Update it when the wording changes, not when the file is touched.
 */
export const POLICIES_UPDATED = '7 September 2026';

/** Everyone who should be reachable, for the About and Contact pages. */
export function whoWeAre(): string {
  return FOUNDERS.map((f) => `${f.name} (${f.role})`).join(' and ');
}
