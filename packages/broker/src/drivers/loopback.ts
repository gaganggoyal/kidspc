import { randomBytes } from 'node:crypto';
import type {
  DesktopHandle,
  DesktopSpec,
  DesktopStatus,
  SessionDriver,
} from '../driver.js';

/**
 * A driver that pretends.
 *
 * It exists so the entire product -- signup, consent, policy, launcher,
 * countdown, reaping -- can be run and tested on a laptop with no container
 * runtime, and so the lifecycle tests do not need Docker to be meaningful.
 * It is wired in by config, never by fallback: a production process that
 * cannot reach its real driver must fail loudly rather than quietly hand a
 * child a desktop that is not there.
 */
export class LoopbackDriver implements SessionDriver {
  readonly name = 'loopback';

  private readonly desktops = new Map<string, { spec: DesktopSpec; readyAt: number; running: boolean }>();

  /** Test seam: every spec this driver was asked to provision, in order. */
  readonly provisioned: DesktopSpec[] = [];

  constructor(private readonly readyAfterMs = 300) {}

  async provision(spec: DesktopSpec): Promise<DesktopHandle> {
    const ref = `loopback-${spec.sessionId}`;
    this.provisioned.push(spec);
    this.desktops.set(ref, {
      spec,
      readyAt: Date.now() + this.readyAfterMs,
      running: true,
    });
    return {
      ref,
      driver: this.name,
      endpoint: {
        host: '127.0.0.1',
        // Deterministic pseudo-port so logs are stable across a run.
        port: 40000 + (hashCode(ref) % 10000),
        secret: randomBytes(16).toString('hex'),
      },
    };
  }

  async waitUntilReady(handle: DesktopHandle, timeoutMs: number): Promise<void> {
    const entry = this.desktops.get(handle.ref);
    if (!entry) throw new Error(`Unknown desktop ${handle.ref}`);
    const wait = Math.max(0, entry.readyAt - Date.now());
    if (wait > timeoutMs) throw new Error(`Desktop ${handle.ref} not ready within ${timeoutMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, wait));
  }

  async inspect(handle: DesktopHandle): Promise<DesktopStatus> {
    const entry = this.desktops.get(handle.ref);
    return entry?.running ? { running: true } : { running: false, detail: 'not found' };
  }

  async terminate(handle: DesktopHandle): Promise<void> {
    this.desktops.delete(handle.ref);
  }

  async list(): Promise<DesktopHandle[]> {
    return [...this.desktops.keys()].map((ref) => ({
      ref,
      driver: this.name,
      endpoint: { host: '127.0.0.1', port: 40000 + (hashCode(ref) % 10000), secret: '' },
    }));
  }

  /** Test seam: simulate a desktop dying underneath us. */
  killUnderlying(ref: string): void {
    const entry = this.desktops.get(ref);
    if (entry) entry.running = false;
  }
}

function hashCode(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i++) h = (Math.imul(31, h) + value.charCodeAt(i)) | 0;
  return Math.abs(h);
}
