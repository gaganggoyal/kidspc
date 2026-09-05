import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { connect } from 'node:net';
import { promisify } from 'node:util';
import {
  type DesktopHandle,
  type DesktopSpec,
  type DesktopStatus,
  DriverError,
  type SessionDriver,
} from '../driver.js';

const exec = promisify(execFile);

export interface DockerDriverOptions {
  image: string;
  /** User-defined bridge the desktops join. Egress leaves only via the proxy. */
  network: string;
  /** `host:port` of the egress proxy that enforces the origin allow-list. */
  egressProxy: string;
  /** Host interface published ports bind to. Loopback by default: the gateway is local. */
  bindAddress?: string;
  dockerBin?: string;
  /**
   * How the gateway reaches a desktop.
   *
   * `network` talks to the container's address on the session network and
   * publishes no host ports at all -- strictly better isolation, and the right
   * choice when the control plane is itself a container on that network.
   * `published` maps the desktop port onto host loopback, which is what a
   * developer running the API outside Docker needs.
   */
  connectVia?: 'network' | 'published';
}

const DESKTOP_PORT = 6901;
const LABEL_MANAGED = 'kidpc.managed';

/**
 * Container-backed desktops.
 *
 * The economics in the brief only work if one physical box carries many
 * sessions, so a session is a locked-down container rather than a VM. That
 * choice buys density and costs isolation strength, which is why the flags
 * below are not optional decoration: no capabilities, no privilege escalation,
 * a read-only root, a PID ceiling, and no route to the internet except through
 * a proxy that only knows the origins this child's apps declared.
 */
export class DockerDriver implements SessionDriver {
  readonly name = 'docker';
  private readonly bin: string;
  private readonly bindAddress: string;
  private readonly connectVia: 'network' | 'published';

  constructor(private readonly options: DockerDriverOptions) {
    this.bin = options.dockerBin ?? 'docker';
    this.bindAddress = options.bindAddress ?? '127.0.0.1';
    this.connectVia = options.connectVia ?? 'network';
  }

  private async docker(args: string[]): Promise<string> {
    try {
      const { stdout } = await exec(this.bin, args, { timeout: 30_000 });
      return stdout.trim();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      // A daemon that is down is worth retrying; a bad image name is not.
      const retryable = /daemon|connection refused|timeout|EAI_AGAIN/i.test(message);
      throw new DriverError(`docker ${args[0]} failed: ${message}`, retryable, { cause });
    }
  }

  async provision(spec: DesktopSpec): Promise<DesktopHandle> {
    const secret = randomBytes(24).toString('base64url');
    const name = `kidpc-${spec.sessionId}`;
    const ttlSeconds = Math.max(60, Math.ceil((spec.deadline.getTime() - Date.now()) / 1000));

    const args = [
      'run',
      '--detach',
      '--name', name,
      '--label', `${LABEL_MANAGED}=true`,
      '--label', `kidpc.session=${spec.sessionId}`,
      '--label', `kidpc.child=${spec.childId}`,

      // --- resource ceiling -------------------------------------------------
      '--cpus', (spec.cpuCentis / 100).toFixed(2),
      '--memory', `${spec.memoryMib}m`,
      // Equal memory and memory-swap disables swap: a session that overruns is
      // killed promptly instead of thrashing the box and degrading every other
      // child sharing it.
      '--memory-swap', `${spec.memoryMib}m`,
      '--pids-limit', '512',

      // --- containment ------------------------------------------------------
      '--cap-drop', 'ALL',
      '--security-opt', 'no-new-privileges',
      '--read-only',
      '--tmpfs', '/tmp:rw,nosuid,nodev,size=256m',
      '--tmpfs', '/run:rw,nosuid,nodev,size=64m',
      '--tmpfs', '/var/tmp:rw,nosuid,nodev,size=64m',

      // --- persistence ------------------------------------------------------
      // Only the child's home survives a session. Everything else is disposable,
      // which means a broken desktop is fixed by throwing it away.
      '--volume', `${spec.homeVolume}:/home/kid`,

      // --- networking -------------------------------------------------------
      '--network', this.options.network,
      // The desktop identifies itself to the egress proxy with its own session
      // credentials, so the proxy can fetch this child's allow-list rather than
      // guessing from a recycled container address.
      '--env', `HTTP_PROXY=http://${spec.sessionId}:${secret}@${this.options.egressProxy}`,
      '--env', `HTTPS_PROXY=http://${spec.sessionId}:${secret}@${this.options.egressProxy}`,
      '--env', 'NO_PROXY=localhost,127.0.0.1',

      // --- session config ---------------------------------------------------
      '--env', `KIDPC_SESSION_ID=${spec.sessionId}`,
      '--env', `KIDPC_BAND=${spec.band}`,
      '--env', `KIDPC_VNC_SECRET=${secret}`,
      '--env', `KIDPC_ALLOWED_ORIGINS=${spec.allowedOrigins.join(',')}`,
      '--env', `KIDPC_AUTOLAUNCH=${spec.autoLaunch ? JSON.stringify(spec.autoLaunch) : ''}`,
      // Backstop: if the control plane dies, the desktop still goes away.
      '--env', `KIDPC_TTL_SECONDS=${ttlSeconds}`,

      '--stop-timeout', '5',
    ];
    if (this.connectVia === 'published') {
      args.push('--publish', `${this.bindAddress}::${DESKTOP_PORT}`);
    }
    args.push(this.options.image);

    const ref = await this.docker(args);
    return { ref, driver: this.name, endpoint: { ...(await this.endpointFor(ref)), secret } };
  }

  private async endpointFor(ref: string): Promise<{ host: string; port: number }> {
    if (this.connectVia === 'published') {
      return { host: this.bindAddress, port: await this.publishedPort(ref) };
    }
    const address = await this.docker([
      'inspect',
      '--format',
      `{{ (index .NetworkSettings.Networks "${this.options.network}").IPAddress }}`,
      ref,
    ]);
    if (!address) {
      throw new DriverError(`Container ${ref} has no address on ${this.options.network}`, false);
    }
    return { host: address, port: DESKTOP_PORT };
  }

  private async publishedPort(ref: string): Promise<number> {
    const out = await this.docker(['port', ref, String(DESKTOP_PORT)]);
    // `docker port` prints e.g. "127.0.0.1:49154", possibly one line per family.
    const line = out.split('\n').find((l) => l.includes(':'));
    const port = Number(line?.slice(line.lastIndexOf(':') + 1));
    if (!Number.isInteger(port) || port <= 0) {
      throw new DriverError(`Could not read published port for ${ref}: ${out}`, false);
    }
    return port;
  }

  async waitUntilReady(handle: DesktopHandle, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let lastError = 'timed out';
    while (Date.now() < deadline) {
      const status = await this.inspect(handle);
      if (!status.running) {
        throw new DriverError(
          `Desktop ${handle.ref} exited before becoming ready (${status.detail ?? 'no detail'})`,
          true,
        );
      }
      if (await canConnect(handle.endpoint.host, handle.endpoint.port, 1_000)) return;
      lastError = 'listener not up yet';
      await sleep(250);
    }
    throw new DriverError(`Desktop ${handle.ref} not ready within ${timeoutMs}ms: ${lastError}`, true);
  }

  async inspect(handle: DesktopHandle): Promise<DesktopStatus> {
    try {
      const out = await this.docker([
        'inspect',
        '--format',
        '{{.State.Running}} {{.State.ExitCode}} {{.State.Error}}',
        handle.ref,
      ]);
      const [running, exitCode, ...rest] = out.split(' ');
      return {
        running: running === 'true',
        exitCode: Number(exitCode),
        detail: rest.join(' ') || undefined,
      };
    } catch {
      // Inspect fails for a container that no longer exists, which is a
      // perfectly ordinary answer to "is this still running".
      return { running: false, detail: 'not found' };
    }
  }

  async terminate(handle: DesktopHandle, reason: string): Promise<void> {
    // Stop first so the desktop can flush the child's work to the home volume,
    // then remove. Both are tolerated failing: the container may already be gone.
    await this.docker(['stop', '--timeout', '5', handle.ref]).catch(() => undefined);
    await this.docker(['rm', '--force', '--volumes=false', handle.ref]).catch(() => undefined);
    void reason;
  }

  async list(): Promise<DesktopHandle[]> {
    const out = await this.docker([
      'ps',
      '--filter', `label=${LABEL_MANAGED}=true`,
      '--format', '{{.ID}}',
    ]);
    if (!out) return [];
    return Promise.all(
      out.split('\n').map(async (ref) => ({
        ref,
        driver: this.name,
        // Reconciliation only needs the reference to terminate by; an endpoint
        // we cannot resolve must not stop us from reclaiming the container.
        endpoint: {
          ...(await this.endpointFor(ref).catch(() => ({ host: '', port: 0 }))),
          secret: '',
        },
      })),
    );
  }

  /** Fail fast at boot rather than on a child's first session. */
  async preflight(): Promise<void> {
    await this.docker(['version', '--format', '{{.Server.Version}}']);
    const images = await this.docker(['images', '--quiet', this.options.image]);
    if (!images) {
      throw new DriverError(`Desktop image ${this.options.image} is not present locally`, false);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function canConnect(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}
