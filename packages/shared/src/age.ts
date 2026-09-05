/**
 * Age handling for KidPC.
 *
 * DATA MINIMISATION (DPDP Act 2023, s.6 + DPDP Rules 2025):
 * we deliberately store only birth *year and month*, never a full date of birth.
 * Month granularity keeps age accurate to within ~30 days, which is enough to
 * place a child in a four-year-wide learning band and to decide minor status,
 * without holding a field that is directly usable as an identity attribute.
 *
 * Where the two goals conflict we bias toward protection: a profile is treated
 * as a minor until we are certain it is not.
 */

export const AGE_BANDS = ['explorer', 'builder', 'coder'] as const;
export type AgeBand = (typeof AGE_BANDS)[number];

export interface AgeBandSpec {
  id: AgeBand;
  label: string;
  minAge: number;
  maxAge: number;
  /** Short description shown to parents when picking a track. */
  blurb: string;
}

export const AGE_BAND_SPECS: Record<AgeBand, AgeBandSpec> = {
  explorer: {
    id: 'explorer',
    label: 'Explorer',
    minAge: 5,
    maxAge: 8,
    blurb: 'Mouse and keyboard basics, drawing, and first visual blocks.',
  },
  builder: {
    id: 'builder',
    label: 'Builder',
    minAge: 9,
    maxAge: 12,
    blurb: 'Scratch projects, typing fluency, files, and safe web research.',
  },
  coder: {
    id: 'coder',
    label: 'Coder',
    minAge: 13,
    maxAge: 16,
    blurb: 'Python and JavaScript, a web sandbox, and an office suite for schoolwork.',
  },
};

/** Youngest age we will provision an account for. */
export const MIN_SUPPORTED_AGE = 5;
/** Age of digital consent under the DPDP Act 2023. */
export const AGE_OF_DIGITAL_CONSENT = 18;

export interface BirthDate {
  /** Four-digit year, e.g. 2015. */
  birthYear: number;
  /** 1-12. */
  birthMonth: number;
}

/**
 * Completed years of age, computed to month precision.
 *
 * With only year+month we cannot know whether the birthday has passed within
 * the birth month, so we treat the whole birth month as "not yet had the
 * birthday". That rounds age *down*, which is the safe direction: it keeps a
 * child in the younger band and inside minor protections for up to 31 extra days.
 */
export function ageInYears(birth: BirthDate, now: Date = new Date()): number {
  const years = now.getUTCFullYear() - birth.birthYear;
  const monthsElapsed = now.getUTCMonth() + 1 - birth.birthMonth;
  return monthsElapsed > 0 ? years : years - 1;
}

/** True when the profile is below India's age of digital consent. */
export function isMinor(birth: BirthDate, now: Date = new Date()): boolean {
  return ageInYears(birth, now) < AGE_OF_DIGITAL_CONSENT;
}

/**
 * Learning band for an age, or null when the child is too young to onboard.
 *
 * Teens above the Coder band keep the Coder experience rather than losing
 * access mid-subscription; they are still minors and keep every protection.
 */
export function ageBandForAge(age: number): AgeBand | null {
  if (age < MIN_SUPPORTED_AGE) return null;
  if (age <= AGE_BAND_SPECS.explorer.maxAge) return 'explorer';
  if (age <= AGE_BAND_SPECS.builder.maxAge) return 'builder';
  return 'coder';
}

export function ageBandForBirth(birth: BirthDate, now: Date = new Date()): AgeBand | null {
  return ageBandForAge(ageInYears(birth, now));
}

/** Ordering helper: is `band` at least as advanced as `min`? */
export function bandAtLeast(band: AgeBand, min: AgeBand): boolean {
  return AGE_BANDS.indexOf(band) >= AGE_BANDS.indexOf(min);
}
