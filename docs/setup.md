# What you need to do

Everything that can be built without you has been. This is the list of things
that need a person with an account somewhere — a registrar, Zoho, a bank.

They are in order of what unblocks the most. Step 1 takes twenty minutes and
turns email on. Step 5 is the one that lets real children use the service, and
it is the only one with a legal deadline attached.

Current state of https://kidspc.online:

| | |
|---|---|
| Site | live, TLS valid, renews itself |
| Parent accounts | working — anyone can register today |
| Child profiles | **blocked** — no way to verify a parent (step 5) |
| Plan requests | working — orders recorded, emails queued |
| Email | **queued, not sending** — no mailbox (step 1) |
| Pro plan | priced and listed, streamed desktop not built (step 6) |

---

## Step 1 — Turn email on

About twenty minutes, most of it waiting for DNS.

Nothing is being delivered right now. Every welcome and every order
confirmation is sitting in a queue on the server, and will go out on the first
sweep after you finish this. Nothing has been lost.

### 1a. Add the domain to Zoho

You already have Zoho for indiaoffers.in, so this is the same flow again.

1. Sign in at https://mailadmin.zoho.com
2. **Domains → Add Domain** → `kidspc.online`
3. Zoho gives you a **TXT verification record**. Copy it.

### 1b. Add the DNS records at BigRock

`kidspc.online` is at BigRock — sign in, find the DNS / Manage DNS panel for the
domain, and add these. The values are exactly what indiaoffers.in already uses,
which is how I know they work with this Zoho account.

| Type | Host / Name | Value | Priority |
|---|---|---|---|
| TXT | `@` | *(the verification string Zoho gave you)* | — |
| MX | `@` | `mx.zoho.com` | 10 |
| MX | `@` | `mx2.zoho.com` | 20 |
| MX | `@` | `mx3.zoho.com` | 50 |
| TXT | `@` | `v=spf1 include:zohomail.com ~all` | — |

Then, back in Zoho: **Email Configuration → DKIM → Add selector**, use the
selector `zmail`, and Zoho gives you a long public key. Add it as:

| Type | Host / Name | Value |
|---|---|---|
| TXT | `zmail._domainkey` | `v=DKIM1; k=rsa; p=MIIBIjANBg…` *(Zoho's value)* |

**Do not skip SPF and DKIM.** Without them Zoho will still send, and Gmail will
still put it in spam. That is the whole difference between "email works" and
"email arrives".

Wait for DNS to propagate — usually minutes at BigRock, occasionally an hour.
Check from your own machine:

```bash
dig +short kidspc.online MX
dig +short kidspc.online TXT
dig +short zmail._domainkey.kidspc.online TXT
```

When all three return values, verify the domain in Zoho.

### 1c. Create the mailbox

In Zoho: **Users → Add User** → `hello@kidspc.online`.

Then **generate an app-specific password** — Zoho account settings → Security →
App Passwords. This is *not* your Zoho login password. SMTP with the account
password will fail if two-factor is on, and you should have two-factor on.

### 1d. Put the credentials on the server

```bash
ssh root@161.97.97.34
nano /root/kidspc/.env.production
```

Four blank lines near the bottom, already labelled. Fill them in:

```ini
SMTP_USER=hello@kidspc.online
SMTP_PASS=the-app-specific-password
SMTP_FROM=Online Kids PC <hello@kidspc.online>
ORDERS_EMAIL=goyalgagan82@gmail.com
```

`ORDERS_EMAIL` is where new plan requests are announced — your own inbox is
fine, and probably better than the shared one.

Then restart the API:

```bash
cd /root/kidspc
docker compose -f infra/docker-compose.shared-edge.yml --env-file .env.production up -d api
```

### 1e. Check it worked

`/healthz` is deliberately not exposed to the internet, so ask the container:

```bash
docker exec kidspc-api-1 node -e \
  "fetch('http://127.0.0.1:4000/healthz').then(r=>r.text()).then(console.log)"
```

You want `"mail":"smtp"` — not `"log"`. Then flush the backlog:

```bash
docker compose -f infra/docker-compose.shared-edge.yml exec api pnpm orders mail
```

Finally, register a test account at https://kidspc.online/signin?new=1 with an
address you can read, and confirm the welcome email arrives **in the inbox, not
in spam**. If it lands in spam, SPF or DKIM is wrong — recheck 1b.

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
```

`orders send` refuses a non-https link and refuses to send twice to the same
request, because both of those are mistakes you cannot take back once the mail
has gone.

You will need somewhere for that link to point — see step 4.

---

## Step 3 — Record the five videos

The site already has a **How it works** section with the written steps. It is
complete and usable as it stands; the videos slot in above each step.

Record them on a phone, screen-record the TV or a laptop. Nobody needs to be on
camera and nobody should be — no children in the footage, including your own.

| # | Video | Length | What to show |
|---|---|---|---|
| 1 | Create your parent account | ~60s | The home page, "Start 7 days free", filling the form, landing on the household screen |
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

The quickest route that changes nothing else:

1. Create a **Razorpay** account and complete KYC (needs PAN, bank account,
   business proof — allow a few days).
2. In the dashboard, create **Payment Links** or a Subscription plan for each
   price: ₹299, ₹449, ₹598 … and ₹999, ₹1,499, ₹1,998.
3. Paste the matching link into `orders send`.

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
