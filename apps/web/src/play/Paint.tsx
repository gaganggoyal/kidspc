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

export function PaintCanvas({ activity }: { activity: ActivityApi }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const strokes = useRef(0);
  const sized = useRef(false);
  const savedFor = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [colour, setColour] = useState(COLOURS[0]!);
  const [size, setSize] = useState(SIZES[1]!);
  const [saved, setSaved] = useState(false);

  const context = () => canvasRef.current?.getContext('2d') ?? null;

  /**
   * Fit the backing store to the box the canvas is currently drawn in.
   *
   * A canvas has two sizes, and only one of them is CSS. This element is laid
   * out fluidly -- `width: 100%` inside a grid that reflows at 760px and a type
   * scale that moves with the viewport -- so the box it occupies changes when a
   * tablet is turned, a window is dragged wider, or the browser goes full
   * screen. Sizing the backing store once on mount left every one of those
   * cases drawing through a stale scale: strokes landed a growing distance from
   * the finger, and the picture underneath was stretched to fit.
   *
   * Resizing a canvas also blanks it, which is why the old pixels are copied
   * out first and drawn back scaled. A child who turns their tablet keeps their
   * drawing; that is the whole reason this is worth doing properly.
   */
  const fit = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = context();
    if (!canvas || !ctx) return;

    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return; // laid out but not shown
    const ratio = window.devicePixelRatio || 1;
    const width = Math.round(rect.width * ratio);
    const height = Math.round(rect.height * ratio);
    if (sized.current && canvas.width === width && canvas.height === height) return;

    let previous: HTMLCanvasElement | null = null;
    if (sized.current) {
      previous = document.createElement('canvas');
      previous.width = canvas.width;
      previous.height = canvas.height;
      previous.getContext('2d')?.drawImage(canvas, 0, 0);
    }

    canvas.width = width;
    canvas.height = height;
    // Resizing resets the context completely, so every setting is applied here
    // rather than once at startup -- including the transform, which is set
    // outright instead of scaled, because scale() compounds.
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, rect.width, rect.height);
    if (previous) ctx.drawImage(previous, 0, 0, rect.width, rect.height);
    sized.current = true;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Fires once on observe, which is what does the initial sizing.
    const observer = new ResizeObserver(fit);
    observer.observe(canvas);
    // A window dragged to a monitor of a different density changes the ratio
    // without changing the CSS box, so ResizeObserver never hears about it.
    window.addEventListener('resize', fit);

    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const image = new Image();
        image.onload = () => {
          const ctx = context();
          const rect = canvas.getBoundingClientRect();
          if (ctx && rect.width > 0) ctx.drawImage(image, 0, 0, rect.width, rect.height);
        };
        image.src = stored;
      }
    } catch {
      // Private browsing, or storage turned off. An empty canvas is fine.
    }

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', fit);
      if (savedFor.current) clearTimeout(savedFor.current);
    };
  }, [fit]);

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
      if (savedFor.current) clearTimeout(savedFor.current);
      savedFor.current = setTimeout(() => setSaved(false), 2000);
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
    // Forget the saved copy too. "Start again" that comes back on the next
    // reload is not starting again, and a child cannot be expected to work out
    // that they also had to press Save on an empty canvas.
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Nothing to forget if storage was never available.
    }
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
        // A touch taken over by a system gesture ends here and nowhere else;
        // without it the stroke stays open and the next tap continues the line.
        onPointerCancel={stop}
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
