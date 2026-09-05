import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityShell, type ActivityApi } from './ActivityShell';

/**
 * Paint.
 *
 * The drawing itself never leaves the device. It is saved to this browser's
 * local storage and nowhere else -- a child's pictures are their own, and a
 * progress tracker has no business holding them. What we do record is that they
 * drew, not what they drew.
 */
const COLOURS = [
  '#1d1b19',
  '#e2413a',
  '#ef8a2b',
  '#f2c14e',
  '#4f9d5b',
  '#2f7fb8',
  '#6b4fa8',
  '#c65a9c',
  '#8a5a2b',
  '#ffffff',
];

const SIZES = [4, 10, 20, 36];
const STORAGE_KEY = 'kidpc.paint.v1';

function PaintCanvas({ activity }: { activity: ActivityApi }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const strokes = useRef(0);
  const [colour, setColour] = useState(COLOURS[0]!);
  const [size, setSize] = useState(SIZES[1]!);
  const [saved, setSaved] = useState(false);

  const context = () => canvasRef.current?.getContext('2d') ?? null;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = context();
    if (!canvas || !ctx) return;

    // Match the backing store to the displayed size so strokes are not blurry
    // on a high-density screen, and are the right thickness on a TV.
    const rect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    canvas.width = rect.width * ratio;
    canvas.height = rect.height * ratio;
    ctx.scale(ratio, ratio);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, rect.width, rect.height);

    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const image = new Image();
        image.onload = () => ctx.drawImage(image, 0, 0, rect.width, rect.height);
        image.src = stored;
      }
    } catch {
      // Private browsing, or storage turned off. An empty canvas is fine.
    }
  }, []);

  const positionOf = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const start = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const ctx = context();
    if (!ctx) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drawing.current = true;
    const { x, y } = positionOf(event);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const move = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const ctx = context();
    if (!drawing.current || !ctx) return;
    const { x, y } = positionOf(event);
    ctx.strokeStyle = colour;
    ctx.lineWidth = size;
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const stop = () => {
    if (!drawing.current) return;
    drawing.current = false;
    strokes.current += 1;
    // Report often enough to be meaningful, rarely enough not to chatter.
    if (strokes.current % 10 === 0) activity.report('score', strokes.current);
  };

  const save = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, canvasRef.current?.toDataURL('image/png') ?? '');
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // Storage full or unavailable. Not worth interrupting a child over.
    }
  }, []);

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = context();
    if (!canvas || !ctx) return;
    const rect = canvas.getBoundingClientRect();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, rect.width, rect.height);
  };

  return (
    <div className="paint-layout">
      <div className="paint-tools">
        <div className="swatches" role="group" aria-label="Colours">
          {COLOURS.map((c) => (
            <button
              key={c}
              className="swatch"
              style={{ background: c }}
              aria-label={`Colour ${c}`}
              aria-pressed={colour === c}
              onClick={() => setColour(c)}
            />
          ))}
        </div>
        <div className="chips" role="group" aria-label="Brush size">
          {SIZES.map((s) => (
            <button key={s} className="chip" aria-pressed={size === s} onClick={() => setSize(s)}>
              <span className="dot" style={{ width: s, height: s, background: 'currentColor' }} />
            </button>
          ))}
        </div>
        <div className="row">
          <button className="primary" onClick={save}>
            {saved ? 'Saved!' : 'Save'}
          </button>
          <button onClick={clear}>Start again</button>
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          Your picture is kept on this device only.
        </p>
      </div>

      <canvas
        ref={canvasRef}
        className="paint-canvas"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={stop}
        onPointerLeave={stop}
        aria-label="Drawing area"
      />
    </div>
  );
}

export function Paint() {
  return (
    <ActivityShell appId="paint" title="Paint">
      {(activity) => <PaintCanvas activity={activity} />}
    </ActivityShell>
  );
}
