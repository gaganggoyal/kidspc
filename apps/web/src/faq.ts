import {
  AGE_BANDS,
  AGE_BAND_SPECS,
  CATALOG,
  EMAIL_CODE_TTL_MINUTES,
  PLANS,
  PRODUCT_NAME,
  TRIAL_PLAN_ID,
  formatInr,
  localApps,
  planById,
} from '@kidpc/shared';

/**
 * The questions parents actually ask, answered once.
 *
 * Plain strings rather than JSX, because the same answers are published twice:
 * on the page, and as FAQPage structured data that search engines show as
 * expandable answers under the result. Two copies would drift, and the one a
 * search engine shows is the one nobody would notice going stale.
 *
 * Every number comes from the domain (plans, ages, catalogue), for the same
 * reason the home page's do.
 */
export interface Faq {
  q: string;
  a: string;
}

export function faqs(): Faq[] {
  const lite = planById(TRIAL_PLAN_ID);
  const pro = PLANS.find((plan) => plan.id !== lite.id);
  const activities = localApps(CATALOG);
  const bands = AGE_BANDS.map((id) => AGE_BAND_SPECS[id]);
  const youngest = bands[0]!.minAge;
  const oldest = bands[bands.length - 1]!.maxAge;

  return [
    {
      q: 'Which TVs does it work on?',
      a:
        'Any smart TV with a web browser: Fire TV (open Silk), Samsung (open Internet) and LG ' +
        '(open Web Browser). Android and Google TV sets need a browser app from the Play Store ' +
        'first. It also works on a laptop plugged into the TV with an HDMI cable, and on any ' +
        'tablet, phone or computer.',
    },
    {
      q: 'Do I need to buy or install anything?',
      a:
        `No. There is no box, stick or app to buy — ${PRODUCT_NAME} is a website, kidspc.online. ` +
        'The TV remote is enough for every game. A cheap Bluetooth keyboard makes the typing and ' +
        'coding activities easier, but it is optional.',
    },
    {
      q: 'How does my child use it with the TV remote?',
      a:
        'The arrow buttons move between activities and OK opens one. Your child picks their ' +
        'picture, types their four-digit code with the remote, and plays. Back returns to their ' +
        'home screen. Every game was designed to be played with arrows and OK alone.',
    },
    {
      q: 'How do I sign in on a TV without typing a long password?',
      a:
        'Choose "Email me a code instead". We email a 6-digit code to your phone, and you type ' +
        `those six digits on the TV. It works once, for ${EMAIL_CODE_TTL_MINUTES} minutes. You only ` +
        'sign in once per TV; after that your child only ever types their four-digit code.',
    },
    {
      q: 'What ages is it for?',
      a:
        `${youngest} to ${oldest}, in three stages: ` +
        bands.map((b) => `${b.label} (${b.minAge}–${b.maxAge})`).join(', ') +
        '. Each stage opens the activities that suit it, and a birthday unlocks the next set ' +
        'automatically.',
    },
    {
      q: 'Is it safe for my child?',
      a:
        'It is built so the unsafe things are impossible rather than switched off. There are no ' +
        'adverts, no chat, no way to contact or be contacted by anybody, no open web browsing, ' +
        'and no camera or microphone. Your child can only open the activities you tick, only for ' +
        'the minutes and at the hours you set — and when the time is up, the session ends on its own.',
    },
    {
      q: 'What do you store about my child?',
      a:
        'A first name, their birth month and year (not the full date), the avatar they picked, a ' +
        'scrambled copy of their four-digit code, minutes used per day, and personal bests. ' +
        'Nothing your child draws, writes or codes ever leaves your device. You can download ' +
        'everything we hold, or delete all of it, from the parent dashboard at any time.',
    },
    {
      q: 'Can I try it without signing up?',
      a:
        `Yes. All ${activities.length} activities are free to play at kidspc.online/try, with no ` +
        'account and nothing stored on our side.',
    },
    {
      q: 'How much does it cost?',
      a:
        `${lite.name} is ${formatInr(lite.offerPriceInr)} a month for up to ` +
        `${lite.includedChildren} children, after ${lite.trialDays} free days.` +
        (pro
          ? ` ${pro.name} is ${formatInr(pro.offerPriceInr)} a month and adds a real computer ` +
            'streamed to the TV, which is still being built.'
          : '') +
        ' Nothing is charged yet, and we never ask for a card to start.',
    },
    {
      q: 'Can my child use their own profile today?',
      a:
        'Parent accounts and the free preview are open now. A child profile opens once we can ' +
        'verify you are their parent or guardian — India’s Digital Personal Data Protection ' +
        'Act 2023 requires it, and we would rather say so up front. Until then, every activity ' +
        'is in the free preview.',
    },
  ];
}
