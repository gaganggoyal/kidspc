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
| Email | **queued, not sending** — Resend not set up yet (step 1) |
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

### 1a. A key, and the domain, in Resend

1. Sign in at https://resend.com with the meravansh.lol account.
2. **API Keys → Create API key** → name it `kidspc`, permission **Sending
   access**. Copy it — it starts `re_` and is shown once.
3. **Domains → Add domain** → `kidspc.online`. Resend shows the DNS records
   for 1b. Leave the page open.

### 1b. The DNS records, at BigRock

`kidspc.online` is at BigRock — sign in, open DNS management for the domain,
and add exactly what Resend shows. It will be these four, with Resend's values:

| Type | Host / Name | Value | Priority |
|---|---|---|---|
| TXT | `resend._domainkey` | `p=MIGfMA0GCSq…` *(Resend's DKIM key)* | — |
| MX | `send` | `feedback-smtp.<region>.amazonses.com` | 10 |
| TXT | `send` | `v=spf1 include:amazonses.com ~all` | — |
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:hello@kidspc.online` | — |

**Do not skip any of them.** Without them Resend refuses to send at all, and
without DMARC Gmail treats a letter saying "here is your code" as the phishing
mail it resembles.

Wait for DNS — usually minutes at BigRock, occasionally an hour — then press
**Verify** in Resend. Check from your own machine:

```bash
dig +short resend._domainkey.kidspc.online TXT
dig +short send.kidspc.online MX
dig +short _dmarc.kidspc.online TXT
```

### 1c. Somewhere for replies to land

Resend only sends. Parents reply to letters, and plan requests go to
`hello@kidspc.online`, so that address has to arrive somewhere. The quickest:
**ImprovMX** (free) — add the domain, forward `hello@kidspc.online` to
goyalgagan82@gmail.com, and add its two MX records at BigRock:

| Type | Host / Name | Value | Priority |
|---|---|---|---|
| MX | `@` | `mx1.improvmx.com` | 10 |
| MX | `@` | `mx2.improvmx.com` | 20 |

A Zoho mailbox works instead, if more than one person will answer — its MX
records go at `@` the same way. Either way these are on the root domain, and
Resend's `send` records never collide with them.

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

## Step 3 — Record the five videos

The site already has a **How it works** section with the written steps. It is
complete and usable as it stands; the videos slot in above each step.

Record them on a phone, screen-record the TV or a laptop. Nobody needs to be on
camera and nobody should be — no children in the footage, including your own.

| # | Video | Length | What to show |
|---|---|---|---|
| 1 | Create your parent account | ~60s | The home page, the free-trial button, filling the form, landing on the household screen |
| 2 | Add your child | ~75s | "Add a child", name and avatar, birth month and year, setting the four-digit code |
| 3 | Set the limits | ~90s | Parent dashboard, minutes per day, a weekday window, ticking activities |
| 4 | Open it on the TV | ~90s | The TV browser, typing the address, signing in, adding to home screen, a child picking their face and typing the code |
| 5 | Put things right | ~60s | The reset panel — new code, limits back to sensible, stopping a session |

Then:

1. Export each as **MP4 (H.264 + AAC)**, 1280×720 is plenty.
2. Write **captions** for each as a `.vtt` file. Not optional — a parent
   watching on a phone with the sound off is the common case, and it is the
   only version that works for a deaf parent.
3. Put the files in `apps/web/public/guide/`, named `register.mp4`,
   `register.vtt`, `child.mp4`, and so on.
4. In `packages/shared/src/guides.ts`, add the filenames to each step:

```ts
{
  id: 'register',
  …
  video: 'register.mp4',
  captions: 'register.vtt',
  poster: 'register.jpg',
}
```

Deploy, and the section shows a play button above each step.

They are served from our own domain rather than embedded from YouTube. That is
deliberate: the site's security policy allows no third-party frames, an embed
would carry tracking onto a page that promises none, and a service for children
should not put a recommendation feed one click away from a parent's setup
screen. Keep each file under about 20 MB.

---

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
operated by Gagandeep Goyal and Vansh Sharma").

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

---

## What I would do, in order

1. **Step 1 today.** Twenty minutes, and email starts working.
2. **Step 4 this week** — start Razorpay KYC, because it takes days and it
   blocks both payment and step 5.
3. **Step 5 as soon as the Razorpay account exists.** Until then you have a
   working product that cannot legally serve its users.
4. **Step 3 whenever you have an hour.** The written steps already work.
5. **Step 6 when someone asks for it.**
