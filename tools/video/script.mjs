/**
 * What the explainer says, scene by scene.
 *
 * `say` is written for the voice (so "P C" rather than "PC", which a speech
 * engine reads as one word); `text` is what appears on screen as captions and
 * in the WebVTT file, spelled properly. `min` is the shortest the scene may
 * be, for the visuals to finish -- a scene lasts as long as its narration
 * needs, or this, whichever is longer.
 *
 * To record the narration in a real voice instead: put one file per scene in
 * tools/video/voice/<id>.m4a (or .wav) and build.mjs uses those, timed the
 * same way.
 */
export const SCENES = [
  {
    id: 'intro',
    min: 5.5,
    say: 'Meet Online Kids P C. A safe computer for your child, on the TV you already own.',
    text: 'Meet Online Kids PC. A safe computer for your child, on the TV you already own.',
  },
  {
    id: 'promise',
    min: 7,
    say: 'No adverts. No chat with strangers. No tracking. And nothing to buy, or install.',
    text: 'No adverts. No chat with strangers. No tracking. And nothing to buy or install.',
  },
  {
    id: 'open',
    min: 10.5,
    say:
      'Step one. Open the web browser on your smart TV: Silk on Fire TV, Internet on Samsung, ' +
      'or Web Browser on L G. Then go to kids P C dot online.',
    text:
      'Step one. Open the web browser on your smart TV — Silk on Fire TV, Internet on Samsung, ' +
      'or Web Browser on LG. Then go to kidspc.online.',
  },
  {
    id: 'code',
    min: 10,
    say:
      "Step two. Sign in with a code, instead of a password. Six digits arrive on your phone. " +
      "Type them on the TV, and you're in. You only do this once.",
    text:
      "Step two. Sign in with a code instead of a password. Six digits arrive on your phone. " +
      "Type them on the TV, and you're in. You only do this once.",
  },
  {
    id: 'limits',
    min: 9,
    say:
      'Step three. On your phone, add your child. Then choose their minutes a day, the hours ' +
      'they can play, and exactly which games they may open.',
    text:
      'Step three. On your phone, add your child. Then choose their minutes a day, the hours ' +
      'they can play, and exactly which games they may open.',
  },
  {
    id: 'handover',
    min: 7.5,
    say: 'Step four. Hand over the remote. Your child picks their picture, and types their own four digit code.',
    text: 'Step four. Hand over the remote. Your child picks their picture and types their own four-digit code.',
  },
  {
    id: 'play',
    min: 10.5,
    say:
      'Arrows to move. O K to play. Every game works with just the remote: maths, typing, ' +
      'spelling, drawing, music, and puzzles.',
    text:
      'Arrows to move, OK to play. Every game works with just the remote — maths, typing, ' +
      'spelling, drawing, music and puzzles.',
  },
  {
    id: 'timeup',
    min: 7,
    say: "When today's minutes are used up, the session ends on its own. The computer says no. Not you.",
    text: "When today's minutes are used up, the session ends on its own. The computer says no — not you.",
  },
  {
    id: 'privacy',
    min: 6.5,
    say: 'Nothing your child draws, writes or codes is ever uploaded. And you can delete everything, in one tap.',
    text: 'Nothing your child draws, writes or codes is ever uploaded. And you can delete everything in one tap.',
  },
  {
    id: 'end',
    min: 7.5,
    say: 'Try every game free, at kids P C dot online. No sign-up needed. Made in India, by Gagan and Vansh.',
    text: 'Try every game free at kidspc.online. No sign-up needed. Made in India by Gagan and Vansh.',
  },
];

/** Seconds of quiet before a scene's narration starts, and after it ends. */
export const LEAD = 0.45;
export const TAIL = 0.75;
