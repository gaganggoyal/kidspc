import type { Config } from './config.js';

/**
 * Per-route rate limits.
 *
 * `@fastify/rate-limit` applies route-level configuration even when the plugin
 * is not global, so switching limits off has to happen where the routes declare
 * them rather than at registration. Returning the whole options fragment keeps
 * that decision in one place instead of spread across every handler.
 */
export function limit(
  config: Config,
  max: number,
  timeWindow: string,
): { config?: { rateLimit: { max: number; timeWindow: string } } } {
  return config.RATE_LIMITS === 'on' ? { config: { rateLimit: { max, timeWindow } } } : {};
}
