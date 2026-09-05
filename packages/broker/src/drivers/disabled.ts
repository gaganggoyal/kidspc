import { type DesktopHandle, DriverError, type SessionDriver } from '../driver.js';

/**
 * The driver for a deployment that does not offer streamed desktops.
 *
 * Every method throws. That is the point: on a lite deployment the session
 * manager refuses hosted sessions long before a driver is consulted, so if
 * anything here is ever reached it means that gate has a hole in it, and a
 * loud failure is far better than quietly provisioning a container on a host
 * that cannot afford one.
 */
export class DisabledDriver implements SessionDriver {
  readonly name = 'disabled';

  private refuse(): never {
    throw new DriverError(
      'This deployment does not provision desktops (DEPLOYMENT_MODE=lite). ' +
        'Reaching the driver means the hosted-session gate was bypassed.',
      false,
    );
  }

  async provision(): Promise<DesktopHandle> {
    this.refuse();
  }
  async waitUntilReady(): Promise<void> {
    this.refuse();
  }
  async inspect(): Promise<never> {
    this.refuse();
  }
  async terminate(): Promise<void> {
    // Terminating nothing is not an error: the reaper sweeps every live
    // session, and a local session legitimately has no desktop behind it.
  }
  async list(): Promise<DesktopHandle[]> {
    // Nothing is ours, so reconciliation has nothing to reclaim.
    return [];
  }
}
