import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { connect as netConnect, type Socket } from 'node:net';
import { z } from 'zod';

/**
 * KidPC egress proxy.
 *
 * Desktop containers sit on an internal Docker network with no route off the
 * host. This process is their only way out, and it is default-deny: a request
 * is forwarded only if the requesting session's own allow-list -- derived from
 * the apps that child's parent has actually granted -- contains the target.
 *
 * The session authenticates with HTTP proxy credentials (`sessionId:secret`)
 * rather than being identified by source address. Container IPs are recycled
 * within seconds on a busy host, and inheriting the previous tenant's
 * permissions is precisely the failure this component exists to prevent.
 */

const config = z
  .object({
    PORT: z.coerce.number().int().default(3128),
    HOST: z.string().default('0.0.0.0'),
    /** Control-plane base URL, e.g. http://api:4000 */
    API_URL: z.string().url().default('http://127.0.0.1:4000'),
    /** How long a fetched allow-list may be reused. */
    POLICY_TTL_MS: z.coerce.number().int().default(60_000),
    /** Ports we will tunnel to at all, regardless of host. */
    ALLOWED_PORTS: z
      .string()
      .default('443,80')
      .transform((v) => new Set(v.split(',').map((p) => Number(p.trim())))),
  })
  .parse(process.env);

interface CachedPolicy {
  hosts: Set<string>;
  expiresAt: number;
}

const cache = new Map<string, CachedPolicy>();
const inFlight = new Map<string, Promise<CachedPolicy | null>>();

/** Parse `Basic base64(sessionId:secret)`. */
function credentialsFrom(header: string | undefined): { sessionId: string; secret: string } | null {
  if (!header?.startsWith('Basic ')) return null;
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const separator = decoded.indexOf(':');
  if (separator < 1) return null;
  return { sessionId: decoded.slice(0, separator), secret: decoded.slice(separator + 1) };
}

async function policyFor(sessionId: string, secret: string): Promise<CachedPolicy | null> {
  const key = `${sessionId}:${secret}`;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached;

  // Collapse concurrent misses: a desktop opening a page fires many requests at
  // once, and they should cost the control plane one call, not thirty.
  const existing = inFlight.get(key);
  if (existing) return existing;

  const request = (async () => {
    try {
      const res = await fetch(`${config.API_URL}/internal/egress/policy`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, secret }),
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) {
        // Cache the denial briefly too, so a revoked session cannot hammer the
        // API by retrying in a tight loop.
        const denial = { hosts: new Set<string>(), expiresAt: Date.now() + 10_000 };
        cache.set(key, denial);
        return denial;
      }
      const body = (await res.json()) as { origins: string[]; ttlSeconds: number };
      const entry: CachedPolicy = {
        hosts: new Set(body.origins.map((origin) => new URL(origin).hostname)),
        expiresAt: Date.now() + Math.min(body.ttlSeconds * 1000, config.POLICY_TTL_MS),
      };
      cache.set(key, entry);
      return entry;
    } catch {
      // If the control plane is unreachable we deny rather than fall open. A
      // child briefly unable to load a page is a far better failure than a
      // child briefly able to load anything.
      return null;
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, request);
  return request;
}

/**
 * Exact host match only.
 *
 * No suffix or wildcard matching: `evil-britannica.com` and
 * `kids.britannica.com.attacker.net` both end in strings that a naive check
 * would wave through. Subdomains a real app needs are declared explicitly in
 * the catalogue instead.
 */
function isAllowed(policy: CachedPolicy, hostname: string): boolean {
  return policy.hosts.has(hostname.toLowerCase());
}

function deny(res: ServerResponse, code: number, message: string): void {
  res.writeHead(code, { 'content-type': 'text/plain', connection: 'close' });
  res.end(`${message}\n`);
}

const server = createServer();

/** Plain HTTP through the proxy. */
server.on('request', async (req: IncomingMessage, res: ServerResponse) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, cached: cache.size }));
  }

  const creds = credentialsFrom(req.headers['proxy-authorization']);
  if (!creds) {
    res.writeHead(407, { 'proxy-authenticate': 'Basic realm="kidpc"' });
    return res.end();
  }

  let target: URL;
  try {
    target = new URL(req.url ?? '');
  } catch {
    return deny(res, 400, 'Absolute URL required');
  }

  const policy = await policyFor(creds.sessionId, creds.secret);
  if (!policy) return deny(res, 503, 'Cannot check permissions right now');
  if (!isAllowed(policy, target.hostname)) {
    console.log(JSON.stringify({ event: 'denied', session: creds.sessionId, host: target.hostname }));
    return deny(res, 403, 'This site is not on your allow-list');
  }

  const port = Number(target.port || (target.protocol === 'https:' ? 443 : 80));
  if (!config.ALLOWED_PORTS.has(port)) return deny(res, 403, 'Port not permitted');

  const upstream = netConnect({ host: target.hostname, port }, () => {
    const path = target.pathname + target.search;
    upstream.write(`${req.method} ${path} HTTP/1.1\r\n`);
    for (const [name, value] of Object.entries(req.headers)) {
      if (name.startsWith('proxy-')) continue;
      upstream.write(`${name}: ${Array.isArray(value) ? value.join(', ') : value}\r\n`);
    }
    upstream.write('\r\n');
    req.pipe(upstream);
  });
  upstream.on('data', (chunk) => res.socket?.write(chunk));
  upstream.on('error', () => deny(res, 502, 'Upstream failed'));
  upstream.on('close', () => res.end());
});

/** HTTPS through the proxy: open a tunnel, then stay out of the way. */
server.on('connect', async (req: IncomingMessage, clientSocket: Socket, head: Buffer) => {
  const refuse = (line: string) => {
    clientSocket.write(`HTTP/1.1 ${line}\r\n\r\n`);
    clientSocket.destroy();
  };

  const creds = credentialsFrom(req.headers['proxy-authorization']);
  if (!creds) return refuse('407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="kidpc"');

  const [hostname, portText] = (req.url ?? '').split(':');
  const port = Number(portText ?? 443);
  if (!hostname || !config.ALLOWED_PORTS.has(port)) return refuse('403 Forbidden');

  const policy = await policyFor(creds.sessionId, creds.secret);
  if (!policy) return refuse('503 Service Unavailable');
  if (!isAllowed(policy, hostname)) {
    console.log(JSON.stringify({ event: 'denied', session: creds.sessionId, host: hostname }));
    return refuse('403 Forbidden');
  }

  const upstream = netConnect({ host: hostname, port }, () => {
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head.length) upstream.write(head);
    // Once established this is an opaque TLS tunnel. We deliberately do not
    // intercept it: reading a child's traffic to inspect it would be a far
    // greater privacy cost than the filtering it would buy, and the allow-list
    // already decided who they may talk to.
    upstream.pipe(clientSocket);
    clientSocket.pipe(upstream);
  });

  upstream.on('error', () => refuse('502 Bad Gateway'));
  clientSocket.on('error', () => upstream.destroy());
});

server.listen(config.PORT, config.HOST, () => {
  console.log(
    JSON.stringify({ event: 'listening', port: config.PORT, api: config.API_URL, mode: 'default-deny' }),
  );
});
