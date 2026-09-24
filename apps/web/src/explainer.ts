/**
 * The explainer video: one place for the files and the facts about them.
 *
 * Read by the home page (to play it) and by the SEO layer (VideoObject data
 * and the video sitemap), so a re-render changes both at once. Self-hosted for
 * the reasons in packages/shared/src/guides.ts -- no third-party frames, no
 * tracking, and no recommendation feed one click from a parent's setup.
 *
 * The source that renders it lives in tools/video/; `pnpm video` rebuilds it.
 */
export const EXPLAINER = {
  title: 'How Online Kids PC works on your TV',
  description:
    'An 80-second tour: open kidspc.online in your TV browser, sign in with a code from your ' +
    'phone, set your child’s minutes, and hand over the remote. No ads, no chat, nothing to install.',
  src: '/media/how-it-works.mp4',
  poster: '/media/how-it-works.jpg',
  captions: '/media/how-it-works.en.vtt',
  /** Filled in by the renderer; used for the label and for search engines. */
  seconds: 82,
  uploadDate: '2026-09-24',
} as const;

export const durationLabel = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;
