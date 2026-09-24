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

## Mail

Nothing is delivered until this is done, and since every account now starts
with an emailed code, **nobody can sign up until it is**. In production with no
transport the API says so ("new sign-ups are paused") rather than taking a
sign-up whose code can never arrive. It keeps every queued letter, and sends
them within a minute of mail starting to work.

Check where you stand:

```bash
curl -s https://kidspc.online/healthz | grep -o '"mail":"[a-z]*"'
# "mail":"log"     -> queued, nothing delivered, sign-ups paused
# "mail":"resend"  -> going out through Resend
```

What goes out: the sign-up code, sign-in codes, password resets (each a code
**and** a button — the code is for the TV, the button for the phone the letter
is read on), the welcome once an address is confirmed, "your password was
changed", plan requests and payment links, and contact-form replies.

### 1. Resend

The same provider meravansh.lol uses, over HTTPS — port 443 is the one port a
VPS host never blocks, where SMTP ports often are.

1. At `resend.com`, in the account meravansh.lol already uses, create an API key
   with **Sending access** only (API Keys → Create). A server should hold a key
   that can send and nothing else.
2. Put it in `/root/kidspc/.env.production`:

```bash
RESEND_API_KEY=re_...
MAIL_FROM=Online Kids PC <hello@kidspc.online>
MAIL_REPLY_TO=hello@kidspc.online     # replies to any letter land here
ORDERS_EMAIL=hello@kidspc.online      # plan requests and contact messages
```

### 2. Prove the domain, which is most of the work

Resend refuses to send as `kidspc.online` until DNS says it may. Add the domain
in the Resend dashboard (Domains → Add), or with a full-access key from the
API container:

```bash
docker compose exec api pnpm mail check --create --region ap-northeast-1
```

`kidspc.online` is in `ap-northeast-1`, beside meravansh.lol. Without
`--region`, Resend puts a domain in `us-east-1`.

Either way you get the exact records. They look like this at BigRock — copy the
values from Resend, not from here:

| Type | Host | Value | Why |
|---|---|---|---|
| TXT | `resend._domainkey` | *the key Resend generates* | DKIM: signs each letter. |
| MX | `send` | `feedback-smtp.<region>.amazonses.com` (priority 10) | Bounces come back here. |
| TXT | `send` | `v=spf1 include:amazonses.com ~all` | SPF for the return path. |
| CNAME | `rsend` | `send.forge.rmta.net` | Resend's own return path; it will not verify without it. |
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:hello@kidspc.online` | Tells receivers what to do when the others disagree. |

The `send` records sit on a subdomain on purpose, so they never collide with
whatever receives mail for the domain itself. Then press **Verify** in Resend.
`pnpm mail check` shows each record with whether Resend has seen it yet.

Start DMARC at `p=none` and read the reports for a fortnight before tightening
to `quarantine`. Going straight to `p=reject` with a misconfigured record means
your own sign-up codes are rejected and nobody can tell you.

### 3. Somewhere for replies to land

Resend sends; it does not give you an inbox. `hello@kidspc.online` is where a
parent's reply and every plan request arrive, so the domain needs MX records
for receiving as well. Either:

- **Forward to a mailbox you already read** — Cloudflare Email Routing or
  ImprovMX, both free: add their MX records at `@` and forward
  `hello@kidspc.online` to your Gmail. Enough for one person answering.
- **A real mailbox** — Zoho Mail or Google Workspace, when more than one person
  answers. Their MX records go at `@`; nothing above changes.

### 4. Restart and prove it

```bash
cd /root/kidspc/infra
docker compose --env-file /root/kidspc/.env.production \
  -f docker-compose.shared-edge.yml up -d --force-recreate api
```

Then each step separately, because "mail does not work" has several causes that
look identical in the logs:

```bash
pnpm preflight /root/kidspc/.env.production        # settings, Resend's verdict, DNS
docker compose exec api pnpm mail check            # key accepted? domain verified?
docker compose exec api pnpm mail send you@gmail.com
docker compose exec api pnpm orders queue          # anything stuck, and why
```

Use a Gmail address for the send test, not one at your own domain: mail from a
domain to itself often skips the checks you are trying to verify. **Open the
message and look at the headers** — `SPF: PASS`, `DKIM: PASS` and `DMARC: PASS`
are the point of step 2. Landing in spam means delivery worked and DNS did not.

Last, the real thing: sign up at `/signin?new=1` with a fresh address, type the
code, and choose a password.

SMTP still works for a host with a mailbox and no API key — set `SMTP_HOST`,
`SMTP_USER`, `SMTP_PASS` and `MAIL_FROM` instead, or force a choice with
`EMAIL_DELIVERY=resend|smtp`. Resend wins when both are configured.

### Until it works

A queued code or link exists in the outbox and nowhere else, so it can be read
out for a parent who is stuck:

```bash
docker compose exec api pnpm mail link parent@example.com
```

That is a support workaround, not a plan. It requires shell access on the
production host for every household.

## Start in lite mode

`DEPLOYMENT_MODE=lite` serves every local activity and game — Paint, Typing
Garden, Block Puzzles, Number Ninja, Story Writer, Code Playground, the quizzes
and the arcade games — all of which run in the child's own browser. The server
holds a session row and answers a heartbeat, so
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
7. **No email verification at registration.** An address is taken on trust, so
   a typo produces an account whose owner can never reset its password. The
   reset flow makes this worse rather than better: recovery now exists and
   still depends on an address nobody checked.
