import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { AppError, errors, isAppError } from '@kidpc/shared';
import type { AppContext } from './context.js';
import { type Principal, verifyAccessToken } from './auth/tokens.js';
import { registerParentRoutes } from './routes/parent.js';
import { registerKidRoutes } from './routes/kid.js';
import { registerStreamRoutes } from './routes/stream.js';
import { registerInternalRoutes } from './routes/internal.js';

declare module 'fastify' {
  interface FastifyRequest {
    principal: Principal | null;
  }
}

export async function buildApp(ctx: AppContext): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: ctx.config.LOG_LEVEL,
      // Anything that could identify a child must not reach the log pipeline.
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'res.headers["set-cookie"]',
          'req.body.password',
          'req.body.pin',
          'req.body.proof',
        ],
        censor: '[redacted]',
      },
      transport: ctx.config.isProduction
        ? undefined
        : { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } },
    },
    trustProxy: ctx.config.isProduction,
    bodyLimit: 256 * 1024,
  });

  await app.register(cors, { origin: ctx.config.WEB_ORIGIN, credentials: true });
  await app.register(cookie);
  await app.register(rateLimit, {
    global: ctx.config.RATE_LIMITS === 'on',
    max: ctx.config.RATE_LIMITS === 'on' ? 300 : Number.MAX_SAFE_INTEGER,
    timeWindow: '1 minute',
    // Children on a shared home connection must not rate-limit each other out,
    // so the key prefers the authenticated principal over the source address.
    keyGenerator: (req) => {
      const p = (req as { principal?: Principal | null }).principal;
      if (p) return p.kind === 'guardian' ? p.guardianId : p.childId;
      return req.ip;
    },
  });
  await app.register(websocket);

  // ---- authentication ------------------------------------------------------
  app.decorateRequest('principal', null);
  app.addHook('onRequest', async (req) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) return;
    try {
      req.principal = await verifyAccessToken(ctx.config, header.slice(7));
    } catch {
      // A bad token is the same as no token; routes decide what they require.
      req.principal = null;
    }
  });

  // ---- error handling ------------------------------------------------------
  app.setErrorHandler((error, req, reply) => {
    if (error instanceof ZodError) {
      const fieldErrors = Object.fromEntries(
        error.issues.map((i) => [i.path.join('.') || '_', i.message]),
      );
      const appError = errors.validation('Request failed validation', fieldErrors);
      return reply.status(appError.status).send(appError.toJSON());
    }
    if (isAppError(error)) {
      // 5xx is our fault and deserves a stack; 4xx is the caller's and does not.
      if (error.status >= 500) req.log.error({ err: error }, error.message);
      else req.log.info({ code: error.code }, error.message);
      return reply.status(error.status).send(error.toJSON());
    }
    if ((error as { statusCode?: number }).statusCode === 429) {
      const limited = errors.rateLimited(60);
      return reply.status(429).send(limited.toJSON());
    }
    req.log.error({ err: error }, 'Unhandled error');
    const internal = errors.internal('Unhandled error');
    return reply.status(500).send(internal.toJSON());
  });

  app.setNotFoundHandler((_req, reply) => {
    const e = new AppError({
      status: 404,
      code: 'not_found',
      message: 'No such route',
      userMessage: "We couldn't find that.",
    });
    reply.status(404).send(e.toJSON());
  });

  // ---- routes --------------------------------------------------------------
  /**
   * Liveness plus the two settings most often wrong after a deploy. Both are
   * operational facts, not secrets, and having them here means an operator can
   * confirm what a running server actually believes rather than what the env
   * file says.
   */
  app.get('/healthz', async () => ({
    ok: true,
    mode: ctx.config.DEPLOYMENT_MODE,
    // The *effective* driver, not the configured one. A lite deployment
    // provisions nothing regardless of what SESSION_DRIVER says, and reporting
    // the setting rather than the reality is how an operator ends up debugging
    // a desktop that was never going to exist.
    driver: ctx.config.DEPLOYMENT_MODE === 'lite' ? 'none' : ctx.config.SESSION_DRIVER,
    // 'unavailable' means the service is running but cannot onboard a child.
    // It is the difference between "deployed" and "open for business", and it
    // belongs somewhere an operator can see without reading the env file.
    consent: ctx.consent.method,
    appsOrigin: ctx.config.APPS_ORIGIN,
  }));

  await app.register(async (instance) => registerParentRoutes(instance, ctx), { prefix: '/v1' });
  await app.register(async (instance) => registerKidRoutes(instance, ctx), { prefix: '/v1' });
  await app.register(async (instance) => registerStreamRoutes(instance, ctx));
  await app.register(async (instance) => registerInternalRoutes(instance, ctx));

  return app;
}

/** Route guards. Kept as functions rather than hooks so intent is visible inline. */
export function requireGuardian(req: { principal: Principal | null }): string {
  if (req.principal?.kind !== 'guardian') throw errors.unauthorized('Guardian token required');
  return req.principal.guardianId;
}

export function requireChild(req: { principal: Principal | null }): {
  childId: string;
  guardianId: string;
} {
  if (req.principal?.kind !== 'child') throw errors.unauthorized('Child token required');
  return { childId: req.principal.childId, guardianId: req.principal.guardianId };
}
