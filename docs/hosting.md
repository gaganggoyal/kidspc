# Where to run this

Run `pnpm tsx tools/capacity.ts <subscribers>` to regenerate every number here.
The model reads the broker's real sizing functions, so it cannot drift from what
the code will actually ask a host for.

## What a session costs

| Band | vCPU ceiling | RAM | Apps |
|---|---|---|---|
| Explorer | 1.0 | 1.00 GiB | 4 |
| Builder | 1.5 | 1.50 GiB | 8 |
| Coder | 2.0 | 2.00 GiB | 11 |

Blended: **1.42 GiB per concurrent session.**

**RAM is the only constraint that matters.** The vCPU figure is a `--cpus`
ceiling, not a reservation — a child reading a Scratch tutorial uses almost no
CPU, so cores oversubscribe comfortably. Memory does not: exceed it and someone
gets OOM-killed mid-drawing. Size hosts on RAM and treat cores as free.

## Peak concurrency

Indian usage lands almost entirely between 16:00 and 21:00, so capacity is sized
for a five-hour window, not a day. At 55% daily actives, 38 minutes each, and
2× peak bunching, **peak concurrency is ~14% of subscribers**. 5,000 subscribers
means ~700 desktops at once, or ~1 TiB of session RAM.

That ratio is the single most valuable thing to measure in the pilot. Everything
below scales linearly with it.

## The two things that decide the answer

**Latency, which is not negotiable.** A remote desktop *is* its responsiveness.
Above roughly 80ms round-trip, drawing and typing feel broken. Budget European
bare metal is ~150ms from India — it models at Rs 21/subscriber, the best number
on the board, and the product does not work. The brief's suggestion of "Hetzner,
OVH, or Indian data-centre partners" hides this: Hetzner has no Indian region,
so for KidPC it is not a candidate at any price. **India region, or don't ship.**

**Egress, which quietly costs more than compute.** A session streams ~0.6 Mbps,
so a child costs ~3.7 GiB/month. At hyperscaler rates that is ~Rs 28/subscriber
in bandwidth alone — before a single core — on a Rs 199 plan. Providers with
generous included transfer are not a nice-to-have; metered egress is
disqualifying on its own.

## Cost per subscriber per month

At 5,000 subscribers, infrastructure only:

| Host | Sessions/host | Hosts | Per subscriber |
|---|---|---|---|
| Cloud VPS 8 vCPU / 16 GB | 7 | 100 | Rs 140 |
| Cloud VPS 16 vCPU / 32 GB | 15 | 47 | Rs 127 |
| **Bare metal 32c / 128 GB** | **61** | **12** | **Rs 77** |
| **Bare metal 64c / 256 GB** | **122** | **6** | **Rs 66** |
| Hyperscaler 16 vCPU / 64 GB | 30 | 24 | Rs 245 |
| EU budget bare metal | 61 | 12 | Rs 21 — *unusable, 150ms* |

Against a Rs 149-199 Starter plan, cloud VPS leaves almost nothing and
hyperscalers lose money on every subscriber. **Bare metal in an Indian metro is
the only shape where the pricing in the brief works.**

Note how badly small VPS instances fare: 16 GB fits only 7 sessions after
overhead and headroom, so the per-subscriber cost barely improves with scale.
Density is everything, and density needs large hosts.

## Staged recommendation

**Pilot, 0-500 subscribers.** One 64-core / 256 GB bare-metal box in Mumbai or
Delhi, plus a small VPS for the control plane and Postgres. ~Rs 60-70k/month
total, carries the whole pilot with room to spare. Take the month-to-month rate
and skip the annual commit — you are buying the measurement, not the capacity.
Candidates with Indian metros: **E2E Networks** (Indian company, strong
price/RAM, Delhi/Mumbai/Chennai — best fit for a bootstrapped start),
**Vultr** and **Linode/Akamai** (Mumbai, bare metal available, good included
transfer), **DigitalOcean** (Bangalore, easiest operationally, thinner on bare
metal).

**Growth, 500-5,000.** Three to twelve 128-256 GB boxes, same provider, plus a
second availability zone once a single-host failure would be visible. Move
Postgres to managed at this point — running it yourself stops being the cheap
option once it needs backups, failover and someone awake at 2am.

**Scale, 5,000+.** Colocation or a wholesale bare-metal contract. At ~30 boxes
the reserved/committed discount is worth the lock-in, and providers like
**Yotta**, **CtrlS** and **ESDS** exist for exactly this. Keep one cloud region
for burst so a viral week does not need a purchase order.

**Not candidates:** AWS/Azure/GCP (egress plus the per-seat VDI costs the brief
itself flags — Rs 245/subscriber against a Rs 199 plan), and anything outside
India (latency).

## DPDP posture

There is no hard localisation mandate for this data, but s.16 lets the
government restrict transfers to notified countries, and children's data is the
last category to be clever about. Indian hosting is required for latency anyway,
so take the compliance benefit for free and keep every byte in-country. A
**data-processing agreement with the hosting provider is required** — under DPDP
they are your processor and you remain the fiduciary.

## Levers, in order of impact

1. **Idle timeout.** Every minute a desktop outlives the child is pure loss.
   Currently 10-15 minutes by band; measure real abandonment and cut it.
2. **Peak concurrency ratio.** 14% is an assumption. If it is really 9%, the
   per-subscriber cost drops by a third.
3. **Band mix.** Coder sessions cost twice an Explorer's. A teen-heavy mix
   changes the arithmetic.
4. **Session RAM.** `memoryBudgetMib` budgets for the two heaviest apps plus the
   shell. If telemetry shows children run one thing at a time, that assumption
   is worth revisiting — it is the largest single term in the model.
