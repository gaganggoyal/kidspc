import type { AgeBand, ResolvedLaunch } from '@kidpc/shared';

/**
 * What a desktop backend has to be able to do.
 *
 * Everything above this line is business logic; everything below it is a way of
 * getting a Linux desktop onto a screen. Keeping the seam here is what lets us
 * start on containers on one box and move to a pool of pre-warmed VMs, or to a
 * managed VDI, without the session lifecycle or the policy engine noticing.
 */
export interface SessionDriver {
  readonly name: string;

  /** Create the desktop. Returns as soon as it is scheduled, not when it is usable. */
  provision(spec: DesktopSpec): Promise<DesktopHandle>;

  /** Resolve once the desktop is accepting connections, or reject on timeout. */
  waitUntilReady(handle: DesktopHandle, timeoutMs: number): Promise<void>;

  /** Best-effort liveness check; used by the reaper to spot orphans. */
  inspect(handle: DesktopHandle): Promise<DesktopStatus>;

  /** Tear down and release all resources. Must be idempotent. */
  terminate(handle: DesktopHandle, reason: string): Promise<void>;

  /** Desktops this driver believes it owns, for reconciliation after a restart. */
  list(): Promise<DesktopHandle[]>;
}

export interface DesktopSpec {
  sessionId: string;
  childId: string;
  band: AgeBand;
  /** Hundredths of a CPU, e.g. 150 = 1.5 vCPU. */
  cpuCentis: number;
  memoryMib: number;
  /**
   * The only origins the desktop's egress proxy will pass. Derived from the
   * apps this child is allowed to launch -- see `originsForApps`.
   */
  allowedOrigins: string[];
  /** Started automatically once the desktop is up, with its origin resolved. */
  autoLaunch: ResolvedLaunch | null;
  /** Per-child persistent home. Children keep their projects between sessions. */
  homeVolume: string;
  /** Hard deadline from the policy engine; drivers may use it as a backstop TTL. */
  deadline: Date;
}

export interface DesktopHandle {
  /** Driver-owned opaque reference (container id, VM id, pod name). */
  ref: string;
  driver: string;
  /** Where the streaming gateway should connect. Never exposed to clients. */
  endpoint: DesktopEndpoint;
}

export interface DesktopEndpoint {
  host: string;
  port: number;
  /** One-time secret for the desktop's VNC/RDP listener. */
  secret: string;
}

export interface DesktopStatus {
  running: boolean;
  /** Present when the desktop exited on its own. */
  exitCode?: number;
  detail?: string;
}

export class DriverError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'DriverError';
  }
}

/**
 * Resource sizing.
 *
 * The whole cost argument for KidPC rests on children needing far less than a
 * general-purpose cloud desktop: Scratch and a typing game are not a 4 vCPU /
 * 8 GB workload. We size per band and let the catalogue's memory hints set the
 * ceiling, because over-provisioning here is what turns a Rs 199 plan upside
 * down.
 */
export function sizeForBand(band: AgeBand, catalogueMemoryMib: number): {
  cpuCentis: number;
  memoryMib: number;
} {
  const floors: Record<AgeBand, { cpuCentis: number; memoryMib: number }> = {
    explorer: { cpuCentis: 100, memoryMib: 1024 },
    builder: { cpuCentis: 150, memoryMib: 1536 },
    coder: { cpuCentis: 200, memoryMib: 2048 },
  };
  const floor = floors[band];
  return {
    cpuCentis: floor.cpuCentis,
    // Round up to the next 256 MiB so container limits stay tidy.
    memoryMib: Math.max(floor.memoryMib, Math.ceil(catalogueMemoryMib / 256) * 256),
  };
}
