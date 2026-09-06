/**
 * The "how do I actually use this" walkthrough.
 *
 * Held as data so one list drives three things that otherwise drift apart: the
 * section on the home page, the shot list for whoever records the videos, and
 * the order the steps are demonstrated in.
 *
 * `video` is optional and absent to begin with. A step with no video renders as
 * its written steps, which is the accessible version anyway -- so the page is
 * complete before a camera is involved, and dropping an MP4 into
 * apps/web/public/guide/ plus one filename here upgrades it in place.
 *
 * Self-hosted files rather than a YouTube embed, for three reasons that all
 * point the same way: the site's Content-Security-Policy allows no third-party
 * frames, an embed would carry tracking into a page that promises none, and a
 * service for children should not put a recommendation feed one click from a
 * parent's setup screen.
 */
export interface GuideStep {
  id: string;
  title: string;
  /** One sentence for the card. */
  summary: string;
  /** The written walkthrough. Always present; the video never replaces it. */
  steps: readonly string[];
  /** Roughly how long this takes a parent, in seconds. Used in the shot list. */
  seconds: number;
  /** Filename under /guide/, once recorded. */
  video?: string;
  /** Poster frame, shown before playback and if the video fails to load. */
  poster?: string;
  /** WebVTT captions. A video without them is unusable with the sound off. */
  captions?: string;
}

export const GUIDE_STEPS: readonly GuideStep[] = [
  {
    id: 'register',
    title: 'Create your parent account',
    summary: 'One email address and a password. Two minutes, on any device.',
    seconds: 60,
    steps: [
      'Open kidspc.online and choose "Start 7 days free".',
      'Enter your name, your email address and a password.',
      'Pick a password you can type on a TV remote — length beats punctuation.',
      'You land on your household screen, and a welcome email arrives.',
    ],
  },
  {
    id: 'child',
    title: 'Add your child',
    summary: 'A first name, their birth month and year, and a four-digit code.',
    seconds: 75,
    steps: [
      'On the household screen, choose "Add a child".',
      'Enter the name they should see, and pick an avatar together.',
      'Give their birth month and year — not the full date. It is only used to pick activities that suit their age.',
      'Set a four-digit code they can remember. They will type it on the remote.',
    ],
  },
  {
    id: 'limits',
    title: 'Set the limits',
    summary: 'Minutes a day, hours of the day, and which activities they can open.',
    seconds: 90,
    steps: [
      'Open the parent dashboard and choose the child.',
      'Set minutes per day, and a weekly cap if you want one.',
      'Add a time window — an after-school hour on weekdays, longer at the weekend.',
      'Tick the activities they may open. The defaults already suit their age.',
    ],
  },
  {
    id: 'tv',
    title: 'Open it on the TV',
    summary: 'Sign in once on the television. After that they only type four digits.',
    seconds: 90,
    steps: [
      'Open the browser on your TV — Silk on Fire TV, Internet on Samsung, Web Browser on LG.',
      'Go to kidspc.online and sign in with your parent account.',
      'Add it to the home screen so it opens like an app.',
      'Hand over the remote. Your child picks their face, types their code, and chooses an activity.',
    ],
  },
  {
    id: 'fix',
    title: 'Put things right',
    summary: 'Forgotten code, wrong limits, or a session that needs to end now.',
    seconds: 60,
    steps: [
      'Open the parent dashboard and choose the child.',
      'Reset the limits, set a new code, clear the scores, or stop the session — each on its own.',
      'Resetting a forgotten code does not touch anything else they have done.',
    ],
  },
];

/** Steps that have a recorded video. Empty until the files exist. */
export function recordedGuides(): GuideStep[] {
  return GUIDE_STEPS.filter((step) => Boolean(step.video));
}
