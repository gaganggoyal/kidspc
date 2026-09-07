# KidPC

A cloud desktop for children, delivered to a screen the household already owns —
an Android TV box, a smart TV, or an ageing laptop — plus a Bluetooth keyboard
and mouse.

This repository is a working vertical slice: a parent can register, pass a
verifiable-consent check, create a child profile, set limits, and hand the child
a session that starts, bills its time correctly, and stops when it should.

## Run it

Needs Node 20+ and pnpm. **No database, no Docker.** The API falls back to
PGlite — real Postgres compiled to WebAssembly, running in-process — and to a
simulated desktop driver, so a clone is runnable immediately.

```bash
pnpm install
pnpm --filter @kidpc/api seed        # a demo family, one child per age band
pnpm dev                             # API on :4000, client on :5173
```

Open http://localhost:5173 and sign in as `demo@kidpc.test` /
`demo-password-1234`. Child PINs are printed by the seed.

```bash
pnpm test          # 97 tests
pnpm typecheck
pnpm lint
```

## Seeing it work

**The guided tour.** With `pnpm dev` running in one terminal, `pnpm demo` in
another walks the whole system through the live API and narrates each step —
three children with three different catalogues, a seven-year-old refused the
Python IDE, a session granted and leased, a sibling refused access to it, and
time running out. It leaves the demo household as it found it.

**The UI.** http://localhost:5173 is the public home page — what a parent
who has never heard of this sees. Sign-in is at `/signin`. Sign in as the demo
parent, pick a child.
The launcher is built for a TV, so arrow keys navigate it and Enter selects —
try it with the keyboard alone. Opening a session shows *"This is a simulated
session"*: with the loopback driver there is no desktop behind it. Everything
around it — the grant, the countdown, the billing, the limits — is real.

**On an actual TV.** `pnpm dev:tv` binds the client to every interface and
prints a `Network:` address to type into the TV's browser — the whole app, over
your own Wi-Fi, no certificates and no deploy. Which TVs have a browser, and
which need an APK, is in [docs/tv.md](docs/tv.md).

**Making slow things fast.** Most of the interesting behaviour is on a clock.
In the parent dashboard:

| To see | Set |
|---|---|
| Out of time today | Minutes per day → `0` |
| A curfew refusing entry | A time window that excludes now |
| A session actually expiring | Minutes per day → `1`, start a session, wait a minute |
| Apps disappearing from the launcher | Untick apps and reload the child's home |
| The consent gate | Add a new child — they cannot sign in until approved |

**The parts that need a clock you can move** — midnight rollovers, weekly caps,
birthdays, a child wandering off — are covered in
[`scenarios.test.ts`](services/api/src/scenarios.test.ts), which drives the real
HTTP surface with a clock the test controls. `npx vitest run services/api/src/scenarios.test.ts`
prints them as the stories they are.

**The unit economics.** `pnpm capacity 5000` models sessions per host and cost
per subscriber from the broker's real sizing functions. See
[docs/hosting.md](docs/hosting.md).

## How it fits together

```
apps/web            React client. Three surfaces from one build:
                      · TV launcher + profile picker (D-pad navigable)
                      · six local activities (apps/web/src/play)
                      · parent dashboard (limits, consent, usage, resets)

services/api        Fastify control plane. Auth, consent, policy, sessions,
                    the WebSocket streaming gateway, and the reaper.
services/egress     Default-deny HTTP/CONNECT proxy. A desktop's only route out.

packages/shared     Domain core, isomorphic: age bands, the app catalogue,
                    schemas, timezone-aware clock helpers.
packages/policy     Pure decision engine: may this child start now, for how
                    long, and which apps can they open?
packages/broker     Session lifecycle + the SessionDriver seam.
                      · LoopbackDriver — simulated, for development
                      · DockerDriver   — one locked-down container per session

docker/kid-desktop  The desktop image: Xvfb, openbox, x11vnc, curated apps.
infra/              Compose topology, Dockerfiles, nginx.
```

### Two ways to serve a child

Half the catalogue does not need a Linux desktop at all. Typing, drawing, block
puzzles, maths, writing and a code playground are **local activities**: they run
in the client's own browser, so the server holds a session row and answers a
heartbeat, and nothing else.

That distinction is a first-class part of the model, because it decides what
hardware this needs:

| | Local | Hosted |
|---|---|---|
| Runs on | the child's TV or laptop | a container on our server |
| Costs us | a row and a heartbeat | ~1.5 GiB of RAM |
| 5,000 subscribers | **one small VPS, Rs 0.24 each** | 6 bare-metal boxes, Rs 66 each |
| Gives you | Paint, Typing, Blocks, Numbers, Writer, Code | plus Scratch, Python, LibreOffice, the research browser, GCompris |

`DEPLOYMENT_MODE=lite` offers only the local half. It needs no container
runtime, no desktop image and no large host, and the launcher simply does not
show what it cannot serve. Everything else — consent, budgets, curfews,
billing, reaping, the parent dashboard — is identical, because a child's time
budget should not depend on how we happened to deliver the activity.

Run `pnpm capacity 5000` to see both.

### The two decisions everything else follows from

**Time is a lease, not a subscription.** When a session starts, the policy
engine returns a single number: how many minutes this child may have, being the
minimum of their remaining daily budget, their weekly budget, the end of the
current allowed window, and a hard cap. That number is frozen onto the session.
A parent editing limits mid-session cannot accidentally extend a child's
evening, and the broker needs to understand exactly one thing to enforce it.

**A desktop is disposable and reachable only through the control plane.** The
container has no capabilities, a read-only root, a PID ceiling, no internet
route, and no published port. The only things that survive it are the child's
home volume and the usage ledger. The only way in is the streaming gateway,
which checks a 30-second ticket bound to one session id.

### Where the money is

The brief's economics only work if children's sessions are cheap and short-lived,
so three things are load-bearing:

- **Sized per band, not per catalogue.** `memoryBudgetMib` budgets for the two
  heaviest apps a child can open plus the shell, not the sum of everything.
- **Billed on heartbeat.** A TV switched off stops consuming budget within one
  tick, and stops costing us a container within `idleTimeoutMinutes`.
- **Reaped and reconciled.** Every sweep ends expired and idle sessions, and
  kills containers the control plane has no record of — the ones a crash between
  `provision` and `insert` would otherwise leak forever.

## Compliance is a constraint, not a feature

The entire user base is minors, so DPDP Act 2023 obligations are in the type
system and the schema rather than in a checklist:

- **Verifiable parental consent** gates child sign-in, not just onboarding.
  Consent lives behind a `ConsentVerifier` interface; the proof is stored as a
  peppered digest and never in the clear.
- **No behavioural tracking, ever.** There is no analytics table and no
  `advertising` consent scope. DPDP bars profiling and targeted advertising to
  children *regardless of consent*, so the capability does not exist to enable.
- **Data minimisation.** Children are stored with birth **year and month** only.
  There is no date-of-birth column.
- **Age is rounded down.** With month precision we cannot know if a birthday has
  passed within its month, so we assume it has not — keeping a child in the
  younger band and inside minor protections for up to 31 extra days.
- **Data rights** are self-service: `/v1/privacy/export` and `/v1/privacy/erase`.
- **Surveillance is visible.** Per-session summaries are off by default, and the
  child's home screen says so whenever a parent turns them on.
- **Production refuses to lie.** The config loader will not start in production
  with a mock consent verifier, a simulated driver, rate limits off, or a
  generated signing key.

## What is real, and what is not

Working and tested end to end:

- Guardian auth (scrypt, rotating refresh tokens), child PIN sign-in
- Consent challenge/verify/revoke, single-use and replay-proof
- Policy engine: daily and weekly budgets, allowed windows including curfews
  that wrap past midnight, per-band app gating
- Session lifecycle: start, resume, heartbeat billing across local midnight,
  deadline enforcement, idle reaping, orphan reconciliation
- Egress policy endpoint the proxy authorises desktops against
- Six local activities, each usable with a D-pad and a keyboard
- Progress tracking on a closed set of numeric metrics
- A first-run welcome that puts a child into an activity in one press
- Per-scope parent resets (limits, PIN, scores, session)
- All client surfaces, building at 84 KB gzipped

Written but **not yet exercised**, because this environment had no container
runtime — treat each as a real task, not a formality:

- `docker/kid-desktop` has never been built. Expect Debian package names and
  the read-only-rootfs assumptions to need a pass.
- `DockerDriver` and `services/egress` are untested against a live daemon.
- The viewer opens the WebSocket and handles every close code, but does not
  decode the framebuffer. Attaching noVNC's `RFB` to the canvas is the last
  step, marked `INTEGRATION POINT` in `apps/web/src/pages/Viewer.tsx`.

Deliberately not built:

- **DigiLocker verification.** The flow's shape is fixed and the boundary it
  must not cross is documented, but `verify()` throws rather than pretending.
  It needs partner credentials and signature validation.
- **Self-hosted app bundles.** The catalogue points at `apps.kidpc.internal`;
  serving Scratch and friends ourselves is what keeps children off social and
  ad surfaces, and it is not in this repo yet.
- Subscriptions and billing.

Known limitations to fix before this carries real children:

- The API container mounts the Docker socket, making it root on the host. Split
  the broker into its own minimal service; the `SessionDriver` seam exists for
  exactly that.
- The reaper runs in-process. With more than one API instance it needs a leader
  (a Postgres advisory lock is enough) or instances will race.
- A 4-digit PIN is a "which child is this" control, not authentication — it is
  only accepted on a device where a guardian is already signed in. Do not
  promote it to a security boundary.
- Starting a session with an `appId` while one is already running resumes the
  existing desktop **without** launching the requested app. The gate still runs
  and still refuses apps the child may not have, but launching into a live
  session needs a driver capability that does not exist yet.

- Time is banked in whole minutes, so the remainder when a session ends is
  discarded. A child who repeatedly starts and stops inside a minute is never
  billed for it — worth at most ~20 minutes a month, and the session rate limit
  bounds the provisioning churn, which is the more expensive half. Billing the
  ledger in seconds would close it.

Development caveats:

- PGlite is in-process and single-writer. Two API instances pointed at the same
  `PGLITE_DIR` will diverge silently — if the dev database looks stale, check
  for a stray `tsx` process before debugging anything else. Postgres does not
  have this problem, which is the other reason production requires it.
- Vite binds `localhost`, which may resolve to IPv6 first; use
  `http://localhost:5173`, not `127.0.0.1`.

## Deploying

Full runbook in [docs/deploy.md](docs/deploy.md), including the DNS records for
kidspc.online and an honest list of what still blocks launch. Getting it onto
the screen it is built for is [docs/tv.md](docs/tv.md).

**[docs/setup.md](docs/setup.md) is the operator's list**: the things that need
a person with an account somewhere — Zoho, BigRock, Razorpay — in the order that
unblocks the most.

[docs/growth.md](docs/growth.md) is why the free preview, the weekly challenge
and the referral code exist, and why every ordinary viral mechanic for a
children's app is off the table here.

The public company and policy pages — about, contact, terms, privacy, refunds
and delivery — are React pages like any other, in `apps/web/src/pages`. Every
figure in them (prices, trial lengths, the refund window, household size) is
read from the domain rather than typed in, so a policy page cannot come to
contradict the pricing page. The handful of facts that are not established yet
live in `packages/shared/src/company.ts` as `null`, and the pages omit them
rather than printing a placeholder.

```bash
cp .env.production.example .env.production   # fill in
pnpm preflight .env.production               # gates the deploy, exits non-zero
docker compose -f infra/docker-compose.yml --env-file .env.production up -d
```

`pnpm preflight` checks the things that are easy to believe are done: that
secrets are not the examples from this repo, that DNS points at a routable host
rather than a registrar parking record, and that the consent verifier can
actually reject a bad proof.

The network shape is the security story; `infra/docker-compose.yml` opens with
it. Caddy terminates TLS and obtains certificates automatically.
