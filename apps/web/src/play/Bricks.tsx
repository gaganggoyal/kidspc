import { useCallback, useEffect, useRef, useState } from 'react';
import type { ActivityApi } from './ActivityShell';
import { sfx } from '../sfx';
import { Confetti, Hud, Result } from './kit';

/**
 * Brick Breaker.
 *
 * Left and right move the paddle, OK launches the ball -- the one game here
 * built for exactly the buttons a remote has, and the one that asks for
 * something none of the others do: reading where a moving thing will be, and
 * getting there first. The angle the ball leaves the paddle depends on where
 * it hits, so a child who has played for ten minutes starts aiming.
 *
 * Unlike the other arrow games, this one needs to know that a key is *held*,
 * not only that it was pressed, so it listens for key-up as well and does not
 * go through `useArrowKeys`. On a phone the paddle follows a finger dragged
 * across the court.
 */
const W = 800;
const H = 560;
const PADDLE_W = 130;
const PADDLE_H = 14;
const PADDLE_Y = H - 40;
const PADDLE_SPEED = 760;
const R = 9;
const COLS = 10;
const TOP = 64;
const GAP = 6;
const BRICK_H = 24;
const ROW_COLOURS = ['#f43f5e', '#f97316', '#facc15', '#22c55e', '#38bdf8', '#818cf8', '#e879f9'];

interface Brick {
  x: number;
  y: number;
  w: number;
  hp: number;
  colour: string;
}

interface World {
  paddle: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  stuck: boolean;
  speed: number;
  bricks: Brick[];
}

type Phase = 'ready' | 'playing' | 'paused' | 'over';

function lay(level: number): Brick[] {
  const rows = Math.min(3 + level, 7);
  const w = (W - GAP * (COLS + 1)) / COLS;
  const bricks: Brick[] = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < COLS; c++)
      bricks.push({
        x: GAP + c * (w + GAP),
        y: TOP + r * (BRICK_H + GAP),
        w,
        // From level three the top row takes two hits, so a level is never
        // quite the same as the last.
        hp: level >= 3 && r === 0 ? 2 : 1,
        colour: ROW_COLOURS[r % ROW_COLOURS.length]!,
      });
  return bricks;
}

const speedFor = (level: number) => Math.min(360 * 1.1 ** (level - 1), 680);

function freshWorld(level: number, bricks = lay(level)): World {
  return {
    paddle: W / 2,
    x: W / 2,
    y: PADDLE_Y - R - 1,
    vx: 0,
    vy: 0,
    stuck: true,
    speed: speedFor(level),
    bricks,
  };
}

function rounded(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function draw(canvas: HTMLCanvasElement | null, world: World) {
  const ctx = canvas?.getContext('2d');
  if (!ctx) return;
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#111a3a');
  sky.addColorStop(1, '#0a0f24');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  for (const b of world.bricks) {
    if (b.hp <= 0) continue;
    ctx.fillStyle = b.colour;
    rounded(ctx, b.x, b.y, b.w, BRICK_H, 6);
    ctx.fill();
    if (b.hp > 1) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(b.x + 6, b.y + 4, b.w - 12, 4);
  }

  const paddle = ctx.createLinearGradient(0, PADDLE_Y, 0, PADDLE_Y + PADDLE_H);
  paddle.addColorStop(0, '#ffffff');
  paddle.addColorStop(1, '#a5b4fc');
  ctx.fillStyle = paddle;
  rounded(ctx, world.paddle - PADDLE_W / 2, PADDLE_Y, PADDLE_W, PADDLE_H, PADDLE_H / 2);
  ctx.fill();

  ctx.fillStyle = '#ffd23f';
  ctx.beginPath();
  ctx.arc(world.x, world.y, R, 0, Math.PI * 2);
  ctx.fill();

  if (world.stuck) {
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = '600 22px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Press OK to launch', W / 2, H / 2 + 60);
  }
}

export function BricksGame({ activity }: { activity: ActivityApi }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const world = useRef<World>(freshWorld(1));
  const held = useRef({ left: false, right: false });
  const aim = useRef<number | null>(null);
  const [phase, setPhase] = useState<Phase>('ready');
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(3);
  const [level, setLevel] = useState(1);
  const [banner, setBanner] = useState<string | null>(null);
  const [burst, setBurst] = useState(0);
  const tally = useRef({ score: 0, lives: 3, level: 1 });
  const best = activity.best('score');
  // The best as it stood when this round began. Reporting the final score
  // updates `best` on the spot, so comparing against it afterwards would never
  // call anything a record.
  const bestBefore = useRef(best);

  const launch = useCallback(() => {
    const w = world.current;
    if (!w.stuck) return false;
    // Never straight up: a vertical ball bounces between paddle and ceiling
    // for ever and nobody learns to aim.
    const angle = (Math.random() * 0.6 + 0.2) * (Math.random() < 0.5 ? -1 : 1);
    w.vx = w.speed * Math.sin(angle);
    w.vy = -w.speed * Math.cos(angle);
    w.stuck = false;
    sfx.bounce();
    return true;
  }, []);

  const begin = () => {
    bestBefore.current = activity.best('score');
    tally.current = { score: 0, lives: 3, level: 1 };
    world.current = freshWorld(1);
    setScore(0);
    setLives(3);
    setLevel(1);
    setPhase('playing');
  };

  useEffect(() => draw(canvas.current, world.current), [phase]);

  useEffect(() => {
    if (!banner) return;
    const timer = setTimeout(() => setBanner(null), 1400);
    return () => clearTimeout(timer);
  }, [banner]);

  // ---- the keys, held ------------------------------------------------------
  useEffect(() => {
    if (phase !== 'playing') return;
    const set = (event: KeyboardEvent, down: boolean) => {
      const side =
        event.key === 'ArrowLeft' || event.key === 'a' || event.key === 'A'
          ? 'left'
          : event.key === 'ArrowRight' || event.key === 'd' || event.key === 'D'
            ? 'right'
            : null;
      if (side) {
        event.preventDefault();
        held.current[side] = down;
        aim.current = null;
        return;
      }
      // Up and down do nothing here, but they must not wander off and move
      // focus to the Back button either.
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') event.preventDefault();
      if (down && !event.repeat && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        if (!launch()) setPhase('paused');
      }
    };
    const down = (event: KeyboardEvent) => set(event, true);
    const up = (event: KeyboardEvent) => set(event, false);
    // A key released while the window was not looking would otherwise stay
    // held, and the paddle would drift off to one side on its own.
    const release = () => (held.current = { left: false, right: false });
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    window.addEventListener('blur', release);
    return () => {
      window.removeEventListener('keydown', down, true);
      window.removeEventListener('keyup', up, true);
      window.removeEventListener('blur', release);
      release();
    };
  }, [phase, launch]);

  // ---- the loop ------------------------------------------------------------
  useEffect(() => {
    if (phase !== 'playing') return;
    let frame = 0;
    let last = performance.now();

    const loseLife = () => {
      sfx.miss();
      const lives = tally.current.lives - 1;
      tally.current.lives = lives;
      setLives(lives);
      if (lives <= 0) {
        sfx.over();
        activity.report('score', tally.current.score);
        setPhase('over');
        return true;
      }
      const w = world.current;
      world.current = { ...freshWorld(tally.current.level, w.bricks), paddle: w.paddle };
      return false;
    };

    const tick = (now: number) => {
      // Capped, so a frame that arrives late -- a television busy elsewhere --
      // is a short stutter rather than a ball that jumps through a wall. The
      // cap is loose enough that a set managing 20 frames a second still
      // plays at full speed.
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const w = world.current;

      // Paddle: held keys first, then a finger or a mouse if there is one.
      const move = (held.current.right ? 1 : 0) - (held.current.left ? 1 : 0);
      if (move) w.paddle += move * PADDLE_SPEED * dt;
      else if (aim.current !== null) w.paddle += (aim.current - w.paddle) * Math.min(1, dt * 18);
      w.paddle = Math.max(PADDLE_W / 2, Math.min(W - PADDLE_W / 2, w.paddle));

      if (w.stuck) {
        w.x = w.paddle;
        w.y = PADDLE_Y - R - 1;
      } else {
        // Small steps, so a fast ball cannot pass clean through a brick
        // between one frame and the next.
        const steps = Math.ceil((w.speed * dt) / (R * 0.75));
        for (let s = 0; s < steps; s++) {
          const h = dt / steps;
          w.x += w.vx * h;
          w.y += w.vy * h;
          if (w.x < R) [w.x, w.vx] = [R, Math.abs(w.vx)];
          if (w.x > W - R) [w.x, w.vx] = [W - R, -Math.abs(w.vx)];
          if (w.y < R) [w.y, w.vy] = [R, Math.abs(w.vy)];

          if (
            w.vy > 0 &&
            w.y + R >= PADDLE_Y &&
            w.y + R <= PADDLE_Y + PADDLE_H + 8 &&
            Math.abs(w.x - w.paddle) <= PADDLE_W / 2 + R
          ) {
            const hit = Math.max(-1, Math.min(1, (w.x - w.paddle) / (PADDLE_W / 2)));
            const angle = hit * 1.05;
            w.vx = w.speed * Math.sin(angle);
            w.vy = -w.speed * Math.cos(angle);
            w.y = PADDLE_Y - R;
            sfx.bounce();
          }

          if (w.y - R > H) {
            if (loseLife()) return;
            break;
          }

          for (const b of w.bricks) {
            if (b.hp <= 0) continue;
            const cx = Math.max(b.x, Math.min(w.x, b.x + b.w));
            const cy = Math.max(b.y, Math.min(w.y, b.y + BRICK_H));
            if ((w.x - cx) ** 2 + (w.y - cy) ** 2 > R * R) continue;
            const overlapX = Math.min(w.x + R - b.x, b.x + b.w - (w.x - R));
            const overlapY = Math.min(w.y + R - b.y, b.y + BRICK_H - (w.y - R));
            if (overlapX < overlapY) w.vx = -w.vx;
            else w.vy = -w.vy;
            b.hp -= 1;
            sfx.pop();
            if (b.hp === 0) {
              tally.current.score += 10 * tally.current.level;
              setScore(tally.current.score);
            }
            break;
          }
        }

        if (w.bricks.every((b) => b.hp <= 0)) {
          const next = tally.current.level + 1;
          tally.current.level = next;
          tally.current.score += 50 * (next - 1);
          setScore(tally.current.score);
          setLevel(next);
          setBanner(`Level ${next}!`);
          setBurst((n) => n + 1);
          sfx.win();
          activity.report('level', next);
          world.current = { ...freshWorld(next), paddle: w.paddle };
        }
      }

      draw(canvas.current, world.current);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [phase, activity]);

  const pointAt = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    aim.current = ((event.clientX - rect.left) / rect.width) * W;
  };

  const record = score > 0 && score > (bestBefore.current ?? 0);

  return (
    <div className="arcade wide">
      <Hud
        items={[
          ['score', score],
          ['lives', '♥'.repeat(Math.max(0, lives)) || '–'],
          ['level', level],
          best !== null ? ['best', Math.max(best, score)] : null,
        ]}
      />

      <div className="board-wrap">
        <canvas
          ref={canvas}
          width={W}
          height={H}
          className="game-canvas bricks-canvas"
          aria-label="Brick Breaker court"
          onPointerMove={(event) => phase === 'playing' && pointAt(event)}
          onPointerDown={(event) => {
            if (phase !== 'playing') return;
            pointAt(event);
            launch();
          }}
        />
        {banner && <div className="board-banner">{banner}</div>}

        {phase !== 'playing' && (
          <div className="board-overlay">
            {phase === 'ready' && (
              <Result
                glyph="💥"
                title="Brick Breaker"
                detail="Move with ◀ ▶. Press OK to launch the ball."
              >
                <button className="primary" autoFocus onClick={begin}>
                  Start
                </button>
              </Result>
            )}
            {phase === 'paused' && (
              <Result glyph="⏸️" title="Paused">
                <button className="primary" autoFocus onClick={() => setPhase('playing')}>
                  Carry on
                </button>
                <button onClick={begin}>Start again</button>
              </Result>
            )}
            {phase === 'over' && (
              <Result
                glyph={record ? '🌟' : '💥'}
                title={record ? 'Your best score!' : 'Game over'}
                detail={`${score} points, reaching level ${level}.`}
              >
                <button className="primary" autoFocus onClick={begin}>
                  Play again
                </button>
              </Result>
            )}
          </div>
        )}
      </div>

      <button
        type="button"
        tabIndex={-1}
        className="pointer-only"
        onClick={() => phase === 'playing' && setPhase('paused')}
      >
        ⏸ Pause
      </button>
      <p className="play-hint">
        <span className="hint-remote">◀ ▶ to move · OK to launch or pause</span>
        <span className="hint-touch">Drag along the court to move · tap to launch</span>
      </p>
      <Confetti burst={burst} />
    </div>
  );
}
