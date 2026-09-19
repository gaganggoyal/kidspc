import { useCallback, useEffect, useRef, useState } from 'react';
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
  /** Sargam syllable. */
  sargam: string;
  hz: number;
  /** The keyboard key that plays it, for a child with a real keyboard. */
  press: string;
}

const KEYS: Key[] = [
  { note: 'C', sargam: 'Sa', hz: 261.63, press: 'a' },
  { note: 'D', sargam: 'Re', hz: 293.66, press: 's' },
  { note: 'E', sargam: 'Ga', hz: 329.63, press: 'd' },
  { note: 'F', sargam: 'Ma', hz: 349.23, press: 'f' },
  { note: 'G', sargam: 'Pa', hz: 392.0, press: 'g' },
  { note: 'A', sargam: 'Dha', hz: 440.0, press: 'h' },
  { note: 'B', sargam: 'Ni', hz: 493.88, press: 'j' },
  { note: "C'", sargam: "Sa'", hz: 523.25, press: 'k' },
];

/** Traditional tunes only, so nothing here is anybody's copyright. */
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
          : 'Press any key. Use A to K on a keyboard.'}
        {played > 0 ? ` · ${played} played through` : ''}
      </p>

      <div className="piano" role="group" aria-label="Piano keys">
        {KEYS.map((key) => (
          <button
            key={key.note}
            className={`piano-key ${lit === key.note ? 'lit' : ''} ${
              nextNote === key.note ? 'next' : ''
            }`}
            onPointerDown={() => play(key)}
            aria-label={`${key.sargam}, ${key.note}`}
          >
            <span className="sargam">{key.sargam}</span>
            <span className="note">{key.note}</span>
          </button>
        ))}
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
