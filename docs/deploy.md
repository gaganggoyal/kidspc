# Deploying kidspc.online

Run `pnpm preflight .env.production` before every deploy. It fails on anything
below that is not actually done, and exits non-zero so it can gate CI.

## Read this first: what blocks launch

**There is no working parental-consent verifier, and that blocks serving real
children — not just this checklist.**

Under the DPDP Act 2023 a child's account cannot lawfully be used without
*verified* parental consent. The config loader refuses `CONSENT_VERIFIER=mock`
in production, and `digilocker` throws rather than pretending, so today there is
no value of that setting which both starts and works. That is deliberate: the
one failure in this system with a regulator attached to it should be loud.

`CONSENT_VERIFIER=unavailable` is how the service runs anyway, honestly. It
boots, guardians can register and sign in, and every attempt to consent for a
child is refused with an explanation. It is fail-closed by construction rather
than by care: `begin()` throws before a challenge row exists, and child login
requires an active consent — so a child never receives a token at all, and there
is no authorised surface left to get wrong. `/healthz` reports
`"consent":"unavailable"`, which is the difference between *deployed* and *open
for business*.

Two ways forward, both needing a decision you have to make:

| Path | What it needs | Effort |
|---|---|---|
| **DigiLocker** | Meripehchaan/DigiLocker partner registration, then implement the token exchange and assertion-signature validation sketched in `services/api/src/consent/verifier.ts` | Registration is weeks; the code is days |
| **Payment instrument** | A Razorpay account. A small refundable authorisation proves an adult cardholder — a recognised verifiable-consent method | Days, once you have keys |

The `ConsentVerifier` interface already accepts either. Everything else in this
document can be done in parallel, and the infrastructure can be live and tested
before consent lands — with no real children on it.

## DNS

`kidspc.online` was registered on 2026-09-05 through BigRock and is delegated to
`dns1-4.bigrock.in`. It currently answers `127.0.0.1`, which is BigRock's parking
record — it resolves perfectly and will never pass certificate validation.

In the BigRock DNS panel, replace the parking records with:

| Type | Host | Value | TTL |
|---|---|---|---|
| A | `@` | *your server's public IPv4* | 300 |
| A | `apps` | *same IP* | 300 |
| A | `www` | *same IP* | 300 |
| AAAA | `@`, `apps`, `www` | *server IPv6, if it has one* | 300 |
| CAA | `@` | `0 issue "letsencrypt.org"` | 3600 |

Keep TTL low until the deploy is stable, then raise it. The CAA record is not
required but stops any other CA issuing for your domain.

`apps.kidspc.online` is a separate origin on purpose: the egress allow-list the
proxy enforces is a whole hostname, so a desktop granted the apps host cannot
thereby reach the parent dashboard.

Verify before deploying — `pnpm preflight` checks exactly this:

```bash
dig +short kidspc.online A @1.1.1.1        # must be your server, not 127.0.0.1
dig +short apps.kidspc.online A @1.1.1.1
```

## Start in lite mode

`DEPLOYMENT_MODE=lite` serves the six local activities — Paint, Typing Garden,
Block Puzzles, Number Ninja, Story Writer, Code Playground — which run in the
child's own browser. The server holds a session row and answers a heartbeat, so
**one small VPS carries thousands of subscribers at about Rs 0.24 each**, against
Rs 66 each on bare metal for streamed desktops.

It needs no container runtime, no desktop image, and no large host. Everything
else is identical: consent, budgets, curfews, billing, reaping, the parent
dashboard. The launcher simply does not offer what the deployment cannot serve.

Move to `full` when you have hardware and a reason — Scratch, Python,
LibreOffice, GCompris and the research browser are the things it buys.

```bash
# A lite deployment needs only these three services.
docker compose -f infra/docker-compose.yml --env-file .env.production \
  up -d caddy api postgres
```

## Server (full mode)

From `docs/hosting.md`: one bare-metal box in an Indian metro. For a pilot,
**64 cores / 256 GB carries ~120 concurrent desktops**, which is roughly 500-800
subscribers. Do not start on a small VPS — 16 GB fits seven sessions after
overhead, and the per-subscriber cost barely improves with scale.

Requirements: Ubuntu 22.04+ or Debian 12, Docker Engine 24+ with the compose
plugin, ports 80/443 open, and **amd64** — the desktop image has never been
built for arm64 and the app packages differ.

## Deploy

```bash
git clone git@github.com:gaganggoyal/kidspc.git && cd kidspc
cp .env.production.example .env.production

# Generate each secret separately. Never reuse one for two settings.
openssl rand -base64 48   # JWT_SECRET
openssl rand -base64 48   # CONSENT_PEPPER
openssl rand -base64 36   # POSTGRES_PASSWORD

# The desktop image is large (LibreOffice, Chromium, GCompris) and this is the
# first time it has ever been built. Expect to fix package names.
docker compose -f infra/docker-compose.yml --profile build build desktop

pnpm install && pnpm preflight .env.production   # must pass

docker compose -f infra/docker-compose.yml --env-file .env.production up -d
```

Caddy requests certificates on first start. If DNS is not yet correct it will
retry and fail; Let's Encrypt rate-limits failures for a week, so uncomment the
staging ACME endpoint in `infra/Caddyfile` while sorting DNS out.

## After deploying

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://kidspc.online/v1/auth/refresh  # 401
curl -s -o /dev/null -w '%{http_code}\n' https://kidspc.online/internal/egress/policy   # 404
curl -sI https://kidspc.online | grep -i strict-transport
docker compose -f infra/docker-compose.yml logs -f api
```

The first check is a 401 rather than a 200 on purpose. The API is mounted under
`/v1` and nothing else of it is public, so a bare `/healthz` is answered by the
client's own catch-all with an HTML page and a cheerful 200 -- which looks like
a pass and proves nothing. A JSON 401 from a real endpoint is the smallest
request that can only have come from the API. On the shared-edge deployment the
health endpoint is reachable only from inside the network, which is where the
container's own healthcheck reads it:

```bash
docker inspect kidspc-api-1 --format '{{.State.Health.Status}}'   # healthy
```

The second check matters: `/internal/*` is control-plane only and is blocked at
the edge *and* inside the API, because one of those two will eventually be
misconfigured.

Then walk a real session through the UI. With the Docker driver the viewer
should show a desktop rather than "This is a simulated session" — that message
means `SESSION_DRIVER` is still `loopback`, and production config should have
refused to start at all.

## What to protect

- **`pgdata`** — every household, profile, consent record and usage ledger.
  Back it up (`pg_dump` on a schedule) and test a restore before launch.
- **`caddy-data`** — ACME account keys and certificates. Losing it means
  re-issuing, which brushes against rate limits.
- **`.env.production`** — never commit it. `CONSENT_PEPPER` in particular cannot
  be rotated without making every existing consent record unverifiable.
- **Per-child home volumes** (`kidpc-home-*`) — children's actual work. Losing
  one loses a child's projects, which is the failure they will care about most.

## Known gaps to close before real users

1. **Consent.** See the top of this document. Nothing else matters until this
   works.
2. **The Docker socket.** The API container mounts it, making it root on the
   host. Split the broker into its own minimal service; the `SessionDriver`
   seam exists for exactly that.
3. **The desktop image has never been built.** Budget real time for the first
   `docker build`.
4. **The reaper is in-process.** Fine on one host. A second API instance needs a
   Postgres advisory lock or both will race to reap the same desktops.
5. **No backups are configured** by this compose file. Add them.
6. **App bundles are not in this repo.** `apps.kidspc.online` will 404 until
   Scratch, Blockly and the research shell are built into the `app-bundles`
   volume. Every `web` catalogue entry depends on it.
