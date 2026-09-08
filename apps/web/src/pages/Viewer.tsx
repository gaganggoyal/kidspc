import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ApiError, type SessionDto, api } from '../api';
import { useSessionClock } from '../session';

type Status =
  | { kind: 'connecting' }
  | { kind: 'streaming' }
  | { kind: 'unavailable'; message: string; detail?: string }
  | { kind: 'ended'; message: string };

/** Close codes the gateway defines. Mirrors `services/api/src/routes/stream.ts`. */
const CLOSE_REASON: Record<number, string> = {
  4401: 'That link expired. Go back and open your computer again.',
  4404: 'This session has finished.',
  4502: 'Your computer is not responding. Try starting it again.',
  4503: 'development-driver',
};

const HEARTBEAT_MS = 30_000;

export function Viewer() {
  const { sessionId = '' } = useParams();
  const navigate = useNavigate();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const socketRef = useRef<WebSocket | null>(null);

  const [status, setStatus] = useState<Status>({ kind: 'connecting' });
  const { remaining, sync } = useSessionClock();

  const leave = useCallback(
    (message?: string) => {
      socketRef.current?.close();
      navigate('/kid', message ? { state: { message } } : undefined);
    },
    [navigate],
  );

  /**
   * Heartbeat.
   *
   * This is both "the child is still here" and the billing tick, which is why
   * it keeps running even while the stream is unavailable: a desktop that is up
   * but unreachable is still costing us a container, and the session should
   * still run down its lease rather than hang forever.
   */
  useEffect(() => {
    let stopped = false;

    const beat = async () => {
      if (stopped) return;
      try {
        const view = await api<SessionDto>(`/sessions/${sessionId}/heartbeat`, {
          method: 'POST',
          as: 'child',
        });
        sync(view.remainingMinutes);
        if (view.state === 'terminated') {
          stopped = true;
          setStatus({ kind: 'ended', message: "That's all your time for now." });
        }
      } catch (cause) {
        if (cause instanceof ApiError && cause.status === 404) {
          stopped = true;
          setStatus({ kind: 'ended', message: 'This session has finished.' });
        }
        // Anything else is probably a blip in the connection; the next tick
        // will retry rather than throwing the child off their work.
      }
    };

    void beat();
    const timer = setInterval(() => void beat(), HEARTBEAT_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [sessionId, sync]);

  useEffect(() => {
    let cancelled = false;

    const connect = async () => {
      try {
        // Tickets live 30 seconds and are bound to this session, so one is
        // fetched per connection attempt rather than held.
        const { ticket, path } = await api<{ ticket: string; path: string }>(
          `/sessions/${sessionId}/ticket`,
          { method: 'POST', as: 'child' },
        );
        if (cancelled) return;

        const url = new URL(path, window.location.href);
        url.protocol = url.protocol.replace('http', 'ws');
        url.searchParams.set('ticket', ticket);

        const socket = new WebSocket(url, ['binary']);
        socket.binaryType = 'arraybuffer';
        socketRef.current = socket;

        socket.onopen = () => {
          if (!cancelled) setStatus({ kind: 'streaming' });
          /*
           * INTEGRATION POINT -- remote framebuffer decoding.
           *
           * The gateway is protocol-agnostic: it moves bytes between this
           * socket and the desktop's VNC listener without inspecting them.
           * Rendering them needs an RFB client (noVNC's `RFB` class) attached
           * to `canvasRef`, driven by this socket.
           *
           * It is not wired up here on purpose: the development driver has no
           * desktop behind it, so noVNC would be an untestable dependency
           * shipped on faith. Wire it when the container image below can
           * actually be built and connected to.
           */
        };
        socket.onclose = (event) => {
          if (cancelled) return;
          const reason = CLOSE_REASON[event.code];
          if (reason === 'development-driver') {
            setStatus({
              kind: 'unavailable',
              message: 'This is a simulated session.',
              detail:
                'The server is running the development desktop driver, which has no real computer behind it. Everything else — your time, your apps, your limits — is real.',
            });
          } else if (reason) {
            setStatus({ kind: 'unavailable', message: reason });
          } else if (event.code !== 1000) {
            setStatus({ kind: 'unavailable', message: 'The connection dropped.' });
          }
        };
        socket.onerror = () => {
          if (!cancelled) setStatus({ kind: 'unavailable', message: 'The connection dropped.' });
        };
      } catch (cause) {
        if (cancelled) return;
        setStatus({
          kind: 'unavailable',
          message: cause instanceof ApiError ? cause.userMessage : 'Could not connect.',
        });
      }
    };

    void connect();
    return () => {
      cancelled = true;
      socketRef.current?.close();
    };
  }, [sessionId]);

  const lowOnTime = remaining !== null && remaining <= 5;

  return (
    <div className="viewer">
      {status.kind === 'streaming' ? (
        <canvas ref={canvasRef} aria-label="Your computer" />
      ) : (
        <div className="placeholder stack">
          {status.kind === 'connecting' && <h2>Starting your computer…</h2>}
          {status.kind === 'unavailable' && (
            <>
              <h2>{status.message}</h2>
              {status.detail && <p className="small">{status.detail}</p>}
            </>
          )}
          {status.kind === 'ended' && <h2>{status.message}</h2>}
          {status.kind !== 'connecting' && (
            <button className="primary" onClick={() => leave()}>
              Back to my apps
            </button>
          )}
        </div>
      )}

      <div className="overlay">
        <span aria-live="polite">
          {remaining === null
            ? '…'
            : remaining === 0
              ? 'Time is up'
              : `${remaining} minute${remaining === 1 ? '' : 's'} left`}
          {lowOnTime && remaining! > 0 && ' — time to save your work!'}
        </span>
        <button onClick={() => void endSession(sessionId, leave)}>I'm done</button>
      </div>
    </div>
  );
}

async function endSession(sessionId: string, leave: (message?: string) => void) {
  try {
    await api(`/sessions/${sessionId}/end`, { method: 'POST', as: 'child' });
  } catch {
    // Ending is best-effort from the client's side; the reaper will collect
    // the desktop regardless, so never trap a child on this screen.
  }
  leave('See you next time!');
}
