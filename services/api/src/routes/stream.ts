import { connect } from 'node:net';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { verifyStreamTicket } from '../auth/tokens.js';

/** WebSocket close codes we define for the client to react to. */
const CLOSE = {
  badTicket: 4401,
  sessionGone: 4404,
  desktopUnreachable: 4502,
  driverIsFake: 4503,
} as const;

/**
 * The pixel path.
 *
 * A desktop's VNC listener is bound to loopback on the host and is never
 * published to the internet. The only way in is through this gateway, which
 * checks a ticket, confirms the session is live and belongs to the child who
 * asked, and then does nothing but move bytes. Putting the authorisation here
 * rather than in the desktop means a container can never be reached by anyone
 * who guesses a port.
 */
export async function registerStreamRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/stream/:id', { websocket: true }, async (socket, req) => {
    const { id } = req.params as { id: string };
    const ticket = (req.query as { ticket?: string }).ticket;

    if (!ticket) return socket.close(CLOSE.badTicket, 'Missing ticket');

    let claims;
    try {
      claims = await verifyStreamTicket(ctx.config, ticket);
    } catch {
      return socket.close(CLOSE.badTicket, 'Invalid ticket');
    }
    // The ticket names a session; the path must be the same one.
    if (claims.sessionId !== id) return socket.close(CLOSE.badTicket, 'Ticket/session mismatch');

    const session = await ctx.repos.sessions.byId(id);
    if (!session || session.childId !== claims.childId) {
      return socket.close(CLOSE.sessionGone, 'No such session');
    }
    if (session.state === 'terminated') {
      return socket.close(CLOSE.sessionGone, 'Session has ended');
    }
    if (!session.endpointHost || !session.endpointPort) {
      return socket.close(CLOSE.desktopUnreachable, 'Session has no endpoint');
    }
    if (session.driverName === 'loopback') {
      // The development driver has no desktop behind it. Say so plainly rather
      // than leaving the client staring at a socket that will never speak.
      return socket.close(
        CLOSE.driverIsFake,
        'This session is backed by the development driver and has no desktop to stream.',
      );
    }

    const upstream = connect(
      { host: session.endpointHost, port: session.endpointPort },
      () => {
        req.log.info({ sessionId: id }, 'stream attached');
      },
    );

    // Bidirectional byte pump. No framing, no inspection: whatever the desktop
    // speaks is the client's problem, which keeps this gateway protocol-
    // agnostic if we move from VNC to something else.
    upstream.on('data', (chunk) => {
      if (socket.readyState === socket.OPEN) socket.send(chunk);
    });
    socket.on('message', (chunk: Buffer) => {
      if (!upstream.destroyed) upstream.write(chunk);
    });

    const teardown = (why: string) => {
      if (!upstream.destroyed) upstream.destroy();
      if (socket.readyState === socket.OPEN) socket.close(1000, why);
    };
    upstream.on('error', (err) => {
      req.log.warn({ sessionId: id, err }, 'desktop connection failed');
      if (socket.readyState === socket.OPEN) {
        socket.close(CLOSE.desktopUnreachable, 'Desktop unreachable');
      }
    });
    upstream.on('close', () => teardown('desktop closed'));
    socket.on('close', () => {
      if (!upstream.destroyed) upstream.destroy();
    });

    // A stream outliving its lease would hand a child free time, so the socket
    // carries its own stop independent of the reaper.
    const msUntilDeadline = session.deadline.getTime() - ctx.now().getTime();
    const deadlineTimer = setTimeout(() => teardown('time is up'), Math.max(0, msUntilDeadline));
    socket.on('close', () => clearTimeout(deadlineTimer));
  });
}
