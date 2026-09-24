# What you need to do

Everything that can be built without you has been. This is the list of things
that need a person with an account somewhere — a registrar, Resend, a bank.

They are in order of what unblocks the most. Step 1 takes twenty minutes and
turns email on. Step 5 is the one that lets real children use the service, and
it is the only one with a legal deadline attached.

Current state of https://kidspc.online:

| | |
|---|---|
| Site | live, TLS valid, renews itself |
| Free preview | working — anyone can play all nineteen games and activities at /try, no account |
| Weekly challenge | working — a new prompt every Monday, no server involved |
| Parent accounts | **paused until step 1** — every sign-up is confirmed with an emailed code |
| Child profiles | **blocked** — no way to verify a parent (step 5) |
| Plan requests | working — orders recorded, emails queued |
| Referrals | working — codes captured, longer trial honoured, rewards paid by hand (step 2) |
| Company & policy pages | live — about, contact, terms, privacy, refunds, delivery (three facts still blank, step 4a) |
| Contact form | working — messages queued to your desk, with a copy to the sender |
| Email | **ready, not live** — domain verified in Resend, `hello@` forwarding; turns on with the next deploy (step 1d) |
| Pro plan | priced and listed, no free trial, streamed desktop not built (step 6) |

How all of that is meant to bring people in is written up separately, in
[growth.md](growth.md).

---

## Step 1 — Turn email on

About twenty minutes, most of it waiting for DNS. This is the step everything
else waits on: an account now starts with a 6-digit code sent to the parent's
inbox, so **until mail goes out, nobody can sign up** — the site says so plainly
rather than taking a sign-up whose code never arrives.

Nothing queued has been lost. Every letter is sitting on the server and goes
out on the first sweep after you finish this.

Sending is Resend, the same account meravansh.lol uses. Receiving (replies to
`hello@kidspc.online`, plan requests) is separate, in 1c.

### 1a. The domain, in Resend — done

`kidspc.online` is added to the meravansh.lol Resend account, in the same
region (`ap-northeast-1`, Tokyo — nearer Indian inboxes than Resend's default
US region), with open and click tracking off. Resend is now waiting for the
DNS records below.

The server will hold its own **sending-only** key, limited to this domain,
created when the API is next deployed — so a key that can read or delete
domains never sits on the server.

### 1b. The DNS records, at BigRock — done

Added 2026-09-24; Resend verified the domain the same day.

`kidspc.online` is at BigRock. Sign in, open **Manage DNS** for the domain,
and add these five. In the host field type only what is in the second column —
BigRock adds `.kidspc.online` itself. Leave the existing A records alone.

| Type | Host | Value | Priority |
|---|---|---|---|
| TXT | `resend._domainkey` | *the long key below* | — |
| MX | `send` | `feedback-smtp.ap-northeast-1.amazonses.com` | 10 |
| TXT | `send` | `v=spf1 include:amazonses.com ~all` | — |
| CNAME | `rsend` | `send.forge.rmta.net` | — |
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:hello@kidspc.online` | — |

The DKIM key, all on one line, no quotes:

```text
p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDg0091k7b4zFZ4jwhfvSJxGv8aDOYMFqoCtynwzbR4niQmODTROmkesAzJ3vhIDIQwymtm2X0TWZ/s5LV4aGKs80K+DroQI7H0jhUrlkwHjjBgwXji7HNP2IaEo2DjI1s0/5gxxZ+4p/Z9nTGpDbWWQoZmEvcdaGXhoEOeyBGtHQIDAQAB
```

**Do not skip any of them.** The first four are what Resend checks before it
will send at all (`pnpm mail check` lists them with their status). Without
DMARC, Gmail treats a letter saying "here is your code" as the phishing mail it
resembles.

Wait for DNS — usually minutes at BigRock, occasionally an hour. Resend checks
on its own; `pnpm mail check` shows which records it has seen. From your own
machine:

```bash
dig +short TXT resend._domainkey.kidspc.online
dig +short MX send.kidspc.online
dig +short TXT send.kidspc.online
dig +short CNAME rsend.kidspc.online
dig +short TXT _dmarc.kidspc.online
```

### 1c. Somewhere for replies to land — done

Resend only sends. Parents reply to letters, and plan requests go to
`hello@kidspc.online`, so that address forwards through **ImprovMX** (free
plan, the gagan2735@gmail.com account):

| Address | Forwards to |
|---|---|
| `hello@kidspc.online` | goyalgagan82@gmail.com |
| anything else `@kidspc.online` | gagan2735@gmail.com *(ImprovMX's default catch-all)* |

Its two MX records are at `@` (`mx1.improvmx.com` 10, `mx2.improvmx.com` 20).
ImprovMX's dashboard asks for a root SPF record too; that is only for sending
*through* ImprovMX, which the free plan does not do, so it is not needed.

A Zoho mailbox can replace this later, if more than one person answers — its
MX records go at `@` the same way, and Resend's `send` records never collide
with them.

### 1d. Put the key on the server

```bash
ssh root@161.97.97.34
nano /root/kidspc/.env.production
```

Add, or fill in:

```ini
RESEND_API_KEY=re_...
MAIL_FROM=Online Kids PC <hello@kidspc.online>
MAIL_REPLY_TO=hello@kidspc.online
ORDERS_EMAIL=goyalgagan82@gmail.com
```

The `SMTP_*` lines can stay or go — Resend wins when both are set.

Then restart the API:

```bash
cd /root/kidspc/infra
docker compose --env-file /root/kidspc/.env.production \
  -f docker-compose.shared-edge.yml up -d --force-recreate api
```

### 1e. Check it worked

```bash
cd /root/kidspc/infra
docker compose -f docker-compose.shared-edge.yml exec api pnpm mail check
docker compose -f docker-compose.shared-edge.yml exec api pnpm mail send goyalgagan82@gmail.com
```

`check` says `VERIFIED` next to the domain; `send` delivers a test letter. Then
the real thing: sign up at https://kidspc.online/signin?new=1 with an address
you can read, type the code, choose a password — and confirm both the code and
the welcome that follows land **in the inbox, not in spam**. Spam means a DNS
record in 1b is wrong; `pnpm mail check` lists which.

---

## Step 2 — Decide who answers plan requests

Requests are already arriving into the database. Once step 1 is done you will
also get an email for each one.

To work through them, on the server:

```bash
cd /root/kidspc
C="docker compose -f infra/docker-compose.shared-edge.yml"

$C exec api pnpm orders list                              # what is waiting
$C exec api pnpm orders send ord_xxx https://rzp.io/l/yy  # queue the link
$C exec api pnpm orders mail                              # send it now
$C exec api pnpm orders queue                             # what is unsent
$C exec api pnpm orders referrer KPC-4G7QMX               # whose month to credit
```

`orders send` refuses a non-https link and refuses to send twice to the same
request, because both of those are mistakes you cannot take back once the mail
has gone.

You will need somewhere for that link to point — see step 4.

### Referrals

Every parent account has a share link, shown in their parent dashboard. A
household arriving on one gets 14 free days of Lite instead of 7 automatically,
and the `orders list` line for them ends `via KPC-XXXXXX`.

A code on a **Pro** order changes nothing about the trial, because Pro has none
— it streams a desktop on hardware we pay for from the first day. The referrer
still earns their free month if that household stays.

The reward is not automatic and cannot be, because nothing here can pay anybody.
When a referred household actually pays:

```bash
$C exec api pnpm orders referrer KPC-4G7QMX
```

That prints the guardian the code belongs to, every household that arrived on
it, and which of those have paid without the referrer having been credited. Give
that referrer their free month — in practice, one month later on the next
payment link you send them — and note it. If the code resolves to more than one
guardian, it says so; ask rather than guess.

**Do not credit a referral before the household has paid.** A trial that is
cancelled on day thirteen is not a referral, and a month given away for one is
not recoverable.

---

## Step 3 — The explainer video — done

An 80-second video, **How Online Kids PC works on your TV**, sits near the top of
the home page: opening kidspc.online in the TV's browser, signing in with a
code from your phone, setting limits, and a child playing with the remote. The
screens in it are the real app, recorded automatically; the voice is an Indian
English voice from macOS.

Files: `apps/web/public/media/how-it-works.mp4` (with `.jpg` poster and `.en.vtt`
captions). It is served from our own domain — no YouTube, no tracking.

**To redo it** after the app's screens change, with the dev servers running:

```bash
node tools/video/capture.mjs   # records the real screens
node tools/video/build.mjs     # narration, frames, MP4 -- about ten minutes
```

**To use your own voice instead of the synthetic one:** record each scene's
line (the script is in `tools/video/script.mjs`), save them as
`tools/video/voice/intro.m4a`, `promise.m4a`, … and run `build.mjs` again. The
video re-times itself to your recordings.

The five per-step slots in **How it works** (`packages/shared/src/guides.ts`)
still exist for shorter clips if you ever want them; the written steps are
complete without them.

## Step 4 — Payments

Nothing can be charged today. There is no payment code in the service at all,
which is why the plan buttons ask for an email and promise a link.

### 4a. Fill in three facts first

Razorpay's merchant review reads the website. Five of the six pages it looks for
are already live — [terms](https://kidspc.online/terms),
[privacy](https://kidspc.online/privacy),
[refunds](https://kidspc.online/refunds),
[delivery](https://kidspc.online/delivery) and
[contact](https://kidspc.online/contact) — and prices are on the home page.

Three facts are deliberately blank, because inventing them would have put a
false registered address on a policy page. They are all in one file,
`packages/shared/src/company.ts`:

```ts
export const LEGAL_ENTITY: string | null = null;    // the registered name, if there is one
export const POSTAL_ADDRESS: string | null = null;  // required by the review
export const PHONE: string | null = null;           // required by the review
```

Fill those in and redeploy. Until you do, the contact page simply omits the
address and phone rows rather than showing a placeholder — which is honest, but
it is also the thing a reviewer will reject you for.

If there is no registered company yet, a sole proprietorship in your own name is
enough for Razorpay and is what `LEGAL_ENTITY = null` currently describes ("
operated by Gagan (Founder) and Vansh (Co-founder)"). Razorpay will want
the full legal name in `LEGAL_ENTITY` itself.

### 4b. Then the account

1. Create a **Razorpay** account and complete KYC (needs PAN, bank account,
   business proof — allow a few days).
2. In the dashboard, create **Payment Links** or a Subscription plan for each
   price: ₹299, ₹449, ₹598 … and ₹999, ₹1,499, ₹1,998.
3. Paste the matching link into `orders send`.

Note that only Lite carries a free trial. Pro is billed from the first month,
because a Pro session runs a streamed Linux desktop on hardware billed by the
hour — so a Pro payment link should charge immediately, and a Lite one should
not charge for the first 7 days (14 for a referred household). The refund
promise that covers Pro instead is on the
[refunds page](https://kidspc.online/refunds): a full refund within
7 days of the first charge, no questions.

That gets you paid without writing any integration. When the volume makes that
tedious, the same Razorpay account also solves step 5 — which is the real
reason to open it now.

---

## Step 5 — Verified parental consent · **this is the blocker**

**No child can use the service until this is done.** Not a policy choice — the
DPDP Act 2023 requires a child's data to be processed only with verifiable
parental consent, and the service refuses rather than pretending. A parent can
register today and will be told, honestly, that child profiles are not open yet.

Two routes:

**Razorpay payment-instrument verification — days, once you have the account.**
A small charge on a card or UPI ID proves an adult account holder. It is a
recognised verification method, and since a subscriber pays anyway, the payment
*is* the consent signal — no extra friction for the parent. If you do step 4,
this is mostly wiring.

**DigiLocker — weeks, and stronger.** Register as a Meripehchaan/DigiLocker
partner at https://partners.digitallocker.gov.in, get client credentials, and
the parent authenticates with their Aadhaar-linked identity. Registration is the
slow part; the code is a few days once credentials exist.

The interface for both already exists (`services/api/src/consent/verifier.ts`)
and everything downstream — challenges, expiry, the audit trail, the gate on
child login — is written and tested. Tell me which route and I will implement it.

**My recommendation: Razorpay.** You need the account for step 4 regardless, it
unblocks children in days rather than weeks, and DigiLocker can be added later
as a second option without changing anything around it.

---

## Step 6 — Pro, later

Pro is priced, listed and marked "still being built", because it is. The
streamed Linux desktop has never run: the container image has never been built,
and the code that draws the remote screen in the browser is not wired up.

It also cannot run on the current server. That box has 11 GB of RAM shared with
eleven other sites, and each desktop needs about 1.5 GB — three or four children
at once before Pro starts competing with cricketverse for memory. Pro needs its
own machine.

Nothing about Lite depends on this. Sell Lite, and open Pro when there is demand
that justifies a second server.

## Step 7 — Tell Google the site exists

The site is built for search now: every public page is real HTML with its own
title and description, each free game has its own page, and there is a sitemap
(with the video in it) at https://kidspc.online/sitemap.xml. Google finds all of
that faster once you tell it the site is yours:

1. Open https://search.google.com/search-console and sign in with your Google
   account.
2. **Add property → Domain** → `kidspc.online`.
3. Google shows a TXT record starting `google-site-verification=`. Add it at
   BigRock: **TXT**, host `@` (leave blank), value exactly as shown. It sits
   beside the mail records without touching them.
4. Back in Search Console, press **Verify** (DNS can take a few minutes).
5. **Sitemaps** (left menu) → enter `sitemap.xml` → **Submit**.
6. **URL inspection** → paste `https://kidspc.online/` → **Request indexing**.
   Do the same for `https://kidspc.online/try`.

Then do the same once at **Bing Webmaster Tools**
(https://www.bing.com/webmasters) — it can import the site straight from Search
Console in one click, and Bing also feeds DuckDuckGo and many smart TVs' search.

Search Console shows, within a few days, which searches the site appears for.
The first weeks are slow for every new domain; the sitemap makes sure nothing is
missed while it builds up.

---

## What I would do, in order

1. **Step 1 today.** Twenty minutes, and email starts working.
2. **Step 4 this week** — start Razorpay KYC, because it takes days and it
   blocks both payment and step 5.
3. **Step 5 as soon as the Razorpay account exists.** Until then you have a
   working product that cannot legally serve its users.
4. **Step 7 the day the new version is deployed** — ten minutes, and it
   decides how soon Google lists the site.
5. **Step 6 when someone asks for it.**
