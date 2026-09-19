import { type KeyboardEvent as ReactKeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';
import { ActivityShell, type ActivityApi } from './ActivityShell';

/**
 * Piano.
 *
 * Every other activity here asks a child to get something right. This one does
 * not, and that is the point: a catalogue with no room in it for making a noise
 * is a catalogue of homework. A five-year-old who presses a key and hears a
 * note has understood the whole instrument, which is not true of anything else
 * on this list.
 *
 * The keys carry both names. Sa Re Ga Ma is what a child in India is taught
 * first and what a grandparent can sing back at them; C D E F is what the
 * notation in a school music book uses. Showing one and not the other picks a
 * side in a house where both are spoken.
 *
 * Sound is synthesised rather than sampled -- eight oscillators cost nothing,
 * where eight audio files would be the largest thing this product ships and
 * would need downloading on a connection that is paying by the megabyte.
 */
interface Key {
  /** Western note name. */
  note: string;
  /** Sargam syllable. Lowercase is the conventional way to write a komal swara. */
  sargam: string;
  hz: number;
  /** The keyboard key that plays it, for a child with a real keyboard. */
  press: string;
}

/**
 * The seven naturals and the octave above, in order across the keyboard.
 *
 * `press` follows the layout every piano app has used since the beginning --
 * the home row for the white keys, the row above for the black -- so a child
 * who learns it here is not learning something only we do.
 */
const WHITE: Key[] = [
  { note: 'C', sargam: 'Sa', hz: 261.63, press: 'a' },
  { note: 'D', sargam: 'Re', hz: 293.66, press: 's' },
  { note: 'E', sargam: 'Ga', hz: 329.63, press: 'd' },
  { note: 'F', sargam: 'Ma', hz: 349.23, press: 'f' },
  { note: 'G', sargam: 'Pa', hz: 392.0, press: 'g' },
  { note: 'A', sargam: 'Dha', hz: 440.0, press: 'h' },
  { note: 'B', sargam: 'Ni', hz: 493.88, press: 'j' },
  { note: "C'", sargam: "Sa'", hz: 523.25, press: 'k' },
];

/**
 * The five black keys, and where each one sits.
 *
 * `after` is the index of the white key it straddles the right-hand edge of,
 * which is what produces the two-then-three grouping everybody recognises as a
 * piano without being able to say why. Leaving them out, as the first version
 * did, is what made this read as a row of buttons: the pattern *is* the
 * instrument.
 *
 * They are also the reason this is worth more than a toy. The sargam names
 * here are the komal swaras and teevra Ma -- the notes that separate one raga
 * from another -- and a child who finds out that the black keys have names
 * their grandparent knows has learnt something a Western keyboard diagram does
 * not teach.
 */
const BLACK: Array<Key & { after: number }> = [
  { note: 'C#', sargam: 're', hz: 277.18, press: 'w', after: 0 },
  { note: 'D#', sargam: 'ga', hz: 311.13, press: 'e', after: 1 },
  { note: 'F#', sargam: "Ma'", hz: 369.99, press: 't', after: 3 },
  { note: 'G#', sargam: 'dha', hz: 415.3, press: 'y', after: 4 },
  { note: 'A#', sargam: 'ni', hz: 466.16, press: 'u', after: 5 },
];

const KEYS: Key[] = [...WHITE, ...BLACK];

/**
 * OK, on a remote, and Enter or Space on a keyboard.
 *
 * The keys respond to `pointerdown` rather than `click`, because an instrument
 * that waits for the release is an instrument that feels broken. But a button
 * whose only handler is `pointerdown` is a button no keyboard can press: a
 * D-pad's OK arrives as a click, and a click never came. So a child could
 * navigate to a key with the remote, press OK, and hear nothing at all -- on
 * the one activity here whose entire point is that pressing a key makes a
 * noise.
 */
function soundOnEnter(event: ReactKeyboardEvent, play: () => void): void {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  play();
}

/** Percentage widths, so the keyboard scales without a measurement. */
const WHITE_W = 100 / WHITE.length;
const BLACK_W = WHITE_W * 0.62;

/** Traditional tunes only, so nothing here is anybody’s copyright. */
const TUNES: Array<{ id: string; name: string; notes: string[] }> = [
  { id: 'sargam', name: 'Sa Re Ga Ma', notes: ['C', 'D', 'E', 'F', 'G', 'A', 'B', "C'"] },
  {
    id: 'twinkle',
    name: 'Twinkle Twinkle',
    notes: ['C', 'C', 'G', 'G', 'A', 'A', 'G', 'F', 'F', 'E', 'E', 'D', 'D', 'C'],
  },
  {
    id: 'lamb',
    name: 'Mary Had a Little Lamb',
    notes: ['E', 'D', 'C', 'D', 'E', 'E', 'E', 'D', 'D', 'D', 'E', 'G', 'G'],
  },
  {
    id: 'row',
    name: 'Row Your Boat',
    notes: ['C', 'C', 'C', 'D', 'E', 'E', 'D', 'E', 'F', 'G'],
  },
];

export function PianoKeyboard({ activity }: { activity: ActivityApi }) {
  const audio = useRef<AudioContext | null>(null);
  const keys = useRef<HTMLDivElement>(null);
  const startedAt = useRef<number | null>(null);
  const reported = useRef(0);
  const [lit, setLit] = useState<string | null>(null);
  const [tuneId, setTuneId] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [played, setPlayed] = useState(0);

  const tune = TUNES.find((t) => t.id === tuneId) ?? null;

  /**
   * One note. The envelope matters more than the waveform: a bare oscillator
   * switched on and off clicks, and a child playing fast hears the clicks
   * rather than the tune.
   */
  const sound = useCallback((hz: number) => {
    try {
      audio.current ??= new (window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      const ctx = audio.current;
      if (ctx.state === 'suspended') void ctx.resume();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = hz;
      const t = ctx.currentTime;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.3, t + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.85);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.9);
    } catch {
      // No audio on this device, or a policy we cannot satisfy. The lights and
      // the tune still work; a silent piano is better than a broken screen.
    }
  }, []);

  const play = useCallback(
    (key: Key) => {
      sound(key.hz);
      setLit(key.note);
      setTimeout(() => setLit((n) => (n === key.note ? null : n)), 180);
      startedAt.current ??= Date.now();

      if (!tune) return;
      if (key.note !== tune.notes[step]) return;
      const at = step + 1;
      if (at < tune.notes.length) {
        setStep(at);
        return;
      }
      const playedNow = played + 1;
      setPlayed(playedNow);
      activity.report('score', playedNow);
      setStep(0);
    },
    [sound, tune, step, played, activity],
  );

  // A real keyboard, for the households that have one.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.metaKey || event.ctrlKey) return;
      const key = KEYS.find((k) => k.press === event.key.toLowerCase());
      if (!key) return;
      event.preventDefault();
      play(key);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [play]);

  /** Time at the instrument, which is the honest measure of practice. */
  useEffect(() => {
    const timer = setInterval(() => {
      if (startedAt.current === null) return;
      const minutes = Math.floor((Date.now() - startedAt.current) / 60_000);
      if (minutes > reported.current) {
        reported.current = minutes;
        activity.report('minutes_practised', minutes);
      }
    }, 20_000);
    return () => clearInterval(timer);
  }, [activity]);

  // Release the audio hardware when the activity closes. Fire-and-forget: the
  // cleanup has to return void, and a context that fails to close is already
  // gone as far as this screen is concerned.
  useEffect(() => {
    return () => {
      void audio.current?.close().catch(() => {});
    };
  }, []);

  const nextNote = tune?.notes[step] ?? null;

  /*
   * Bring the next key into view on a narrow screen.
   *
   * Thirteen keys will not fit a phone at a size a small finger can hit, so the
   * keyboard scrolls inside its case. That is fine until a tune asks for Dha,
   * which is off the right-hand edge -- a child following the lights would be
   * waiting for a key they cannot see and has no reason to go looking for.
   */
  useEffect(() => {
    if (!nextNote) return;
    const key = keys.current?.querySelector('.piano-key.next');
    key?.scrollIntoView({
      inline: 'center',
      block: 'nearest',
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'auto'
        : 'smooth',
    });
  }, [nextNote]);

  return (
    <div className="play-stage">
      <div className="chips" role="group" aria-label="Play along">
        <button className="chip" aria-pressed={tune === null} onClick={() => setTuneId(null)}>
          Just play
        </button>
        {TUNES.map((t) => (
          <button
            key={t.id}
            className="chip"
            aria-pressed={tuneId === t.id}
            onClick={() => {
              setTuneId(t.id);
              setStep(0);
            }}
          >
            {t.name}
          </button>
        ))}
      </div>

      <p className="muted" style={{ margin: 0 }} aria-live="polite">
        {tune
          ? `Follow the glowing key — note ${step + 1} of ${tune.notes.length}`
          : 'Press any key. On a keyboard, A to K are the white notes and W to U the black.'}
        {played > 0 ? ` · ${played} played through` : ''}
      </p>

      <div className="piano-case">
        <div className="piano-keys" ref={keys} role="group" aria-label="Piano keys">
          {WHITE.map((key) => (
            <button
              key={key.note}
              className={`piano-key white ${lit === key.note ? 'lit' : ''} ${
                nextNote === key.note ? 'next' : ''
              }`}
              style={{ width: `${WHITE_W}%` }}
              onPointerDown={() => play(key)}
              onKeyDown={(event) => soundOnEnter(event, () => play(key))}
              aria-label={`${key.sargam}, ${key.note}`}
            >
              <span className="sargam">{key.sargam}</span>
              <span className="note">{key.note}</span>
              <kbd className="key-hint">{key.press.toUpperCase()}</kbd>
            </button>
          ))}

          {BLACK.map((key) => (
            <button
              key={key.note}
              className={`piano-key black ${lit === key.note ? 'lit' : ''} ${
                nextNote === key.note ? 'next' : ''
              }`}
              style={{
                width: `${BLACK_W}%`,
                left: `${(key.after + 1) * WHITE_W - BLACK_W / 2}%`,
              }}
              onPointerDown={() => play(key)}
              onKeyDown={(event) => soundOnEnter(event, () => play(key))}
              aria-label={`${key.sargam}, ${key.note}`}
              title={`${key.sargam} — ${key.note}`}
            >
              <span className="sargam">{key.sargam}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function Piano() {
  return (
    <ActivityShell appId="piano" title="Piano">
      {(activity) => <PianoKeyboard activity={activity} />}
    </ActivityShell>
  );
}
