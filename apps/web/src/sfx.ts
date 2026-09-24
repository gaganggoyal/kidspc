import { useCallback, useSyncExternalStore } from 'react';

/**
 * Sound effects for the games.
 *
 * A game that is silent on a television reads as broken: the set is a sound
 * system as much as a screen, and a child three metres away hears that a move
 * landed before they see it. So every game here answers a press with a noise.
 *
 * Synthesised, like the piano, and for the same reason: a dozen oscillator
 * blips cost nothing, where a dozen samples would be the heaviest thing the
 * product ships on a connection that is paying by the megabyte.
 *
 * There is one switch, in the bar above every activity, and it is remembered on
 * the device. A parent on a call in the same room gets silence with one press
 * and keeps it tomorrow.
 */
const KEY = 'kidpc.sound';

let muted = readMuted();
let context: AudioContext | null = null;
const listeners = new Set<() => void>();

function readMuted(): boolean {
  try {
    return window.localStorage.getItem(KEY) === 'off';
  } catch {
    return false;
  }
}

function audio(): AudioContext | null {
  if (muted) return null;
  if (!context) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    context = new Ctor();
  }
  // Browsers start a context suspended until a gesture; every sound here is
  // the answer to one, so resuming on demand is always allowed.
  if (context.state === 'suspended') void context.resume();
  return context;
}

interface Tone {
  type?: OscillatorType;
  gain?: number;
  delay?: number;
  /** Glide to this frequency over the note, for a swoop rather than a beep. */
  to?: number;
}

function tone(
  hz: number,
  seconds: number,
  { type = 'sine', gain = 0.12, delay = 0, to }: Tone = {},
): void {
  const ctx = audio();
  if (!ctx) return;
  const start = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(hz, start);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, start + seconds);
  // A few milliseconds of attack and a decay to near silence: a square wave
  // switched on and off abruptly clicks, and the click is the loudest part.
  amp.gain.setValueAtTime(0.0001, start);
  amp.gain.exponentialRampToValueAtTime(gain, start + 0.012);
  amp.gain.exponentialRampToValueAtTime(0.0001, start + seconds);
  osc.connect(amp).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + seconds + 0.02);
}

export const sfx = {
  /** A step: a snake turning, a tile sliding, a cursor moving. */
  move: () => tone(420, 0.05, { type: 'triangle', gain: 0.05 }),
  /** Something placed: a counter dropped, a cross drawn. */
  place: () => tone(300, 0.12, { type: 'triangle', gain: 0.1, to: 180 }),
  /** Something collected or merged. */
  good: () => {
    tone(660, 0.08, { type: 'triangle' });
    tone(990, 0.12, { type: 'triangle', delay: 0.07 });
  },
  /** A bounce off a wall or a paddle. */
  bounce: () => tone(520, 0.06, { type: 'square', gain: 0.04 }),
  /** A brick breaking. */
  pop: () => tone(880, 0.07, { type: 'square', gain: 0.05, to: 1400 }),
  /** Wrong, gently. A child hears this a lot; it must not sound like a buzzer. */
  miss: () => tone(220, 0.25, { type: 'sine', gain: 0.1, to: 150 }),
  /** A round won: an arpeggio up. */
  win: () =>
    [523, 659, 784, 1047].forEach((hz, i) => tone(hz, 0.18, { type: 'triangle', delay: i * 0.09 })),
  /** A round lost: two notes down, soft. */
  over: () => [392, 294].forEach((hz, i) => tone(hz, 0.28, { type: 'sine', delay: i * 0.18 })),
  /** A named pitch, for the games whose sounds are the game. */
  note: (hz: number, seconds = 0.35) => tone(hz, seconds, { type: 'triangle', gain: 0.14 }),
};

export function setMuted(next: boolean): void {
  muted = next;
  try {
    window.localStorage.setItem(KEY, next ? 'off' : 'on');
  } catch {
    // Remembering is a courtesy; the switch still works for this visit.
  }
  listeners.forEach((notify) => notify());
}

/** The switch, as React state that every mounted toggle agrees on. */
export function useSound(): [on: boolean, toggle: () => void] {
  const on = !useSyncExternalStore(
    (notify) => {
      listeners.add(notify);
      return () => listeners.delete(notify);
    },
    () => muted,
    // Rendered ahead of time by the build: sound starts on, as it does for a
    // first-time visitor.
    () => false,
  );
  const toggle = useCallback(() => setMuted(!muted), []);
  return [on, toggle];
}
