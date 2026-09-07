# How this product is supposed to spread

Written down because the obvious answer is illegal here, and someone will
eventually propose it again.

## The constraint first

Online Kids PC processes children's data in India, so the Digital Personal Data
Protection Act 2023 applies, and s.9 is unusually blunt. A data fiduciary
**shall not** undertake tracking or behavioural monitoring of children, and
**shall not** direct advertising at them.

That deletes most of the growth playbook for a children's app:

| The usual mechanic | Why not |
|---|---|
| Invite your friends | A child sending anything to another child. Safeguarding, before the law gets involved. |
| Public profiles, galleries, feeds | Same. Also nothing a child makes here is uploaded at all. |
| Leaderboards against other children | Requires comparing children, which requires monitoring them. |
| Push notifications to the child | Behavioural nudging of a minor. |
| Streaks that break | Loss aversion, aimed at someone with no defence against it. Bad even where it is legal. |
| Personalised recommendations | Behavioural monitoring, in the plainest sense of the phrase. |

What is left is the thing that was true all along: **the parent is the buyer,
and the parent is the only person who may do any sharing.** The child creates
the demand. The parent carries it out of the house.

## The loop

```
  A child plays the free preview            /try — no account, no data, no cost to serve
            ↓  asks for more of it
  A parent starts a trial                   the household is what they are buying
            ↓  Monday
  The weekly challenge gives a reason to return
            ↓  the child finishes it
  "Show a grown-up" makes a card             built in the browser, nothing uploaded
            ↓  the parent shares it
  A family WhatsApp group sees it            with a referral link on it
            ↓  a cousin's parent taps it
  Their child plays the free preview         and the loop closes
            ↓
  They subscribe on the code                 14 days free instead of 7
            ↓
  The referring household gets a free month
```

Every arrow is a person choosing to act. Nothing in that diagram happens
automatically, and nothing in it is a child contacting anyone.

## The four pieces, and what each is for

### 1. The free preview — `/try`

All six browser activities, playable by anyone, no account, nothing stored
anywhere but their own browser.

This looks like giving the product away. It is not. What a household pays for is
the household: a profile per child, a PIN, limits that end the session on their
own, curfews, an allow-list, and progress that survives a cleared browser and
follows a child from the tablet to the television. None of that can be shown on
a page, and all of it is what a parent is actually buying.

Meanwhile the activities run entirely in the visitor's browser and cost a static
file to serve. Keeping them behind the sign-up wall bought nothing and cost the
only moment that matters — the one where a child looks up and asks for more.

Deliberately absent from the preview: any clock, any cut-off, any modal. Timing
a child out of a free sample to pressure their parent is using a child as a
lever, and the home page promises we do not do that. There is one dismissible
bar, after three minutes, addressed to the adult.

### 2. The weekly challenge

One prompt, chosen by the calendar, identical for every household in the
country, computed on the client from the date. `packages/shared/src/challenges.ts`.

- **The same for everyone**, so nothing has to be tracked to personalise it —
  and so two cousins can compare Wednesday's drawings, which is the point.
- **It expires quietly.** No streak, no counter of weeks missed, nothing that
  goes red. A child who skips three weeks comes back to a fresh prompt.
- **No server.** A pure function. It works in the preview, on a TV with a bad
  connection, and if the API is down.

Twenty prompts, so nothing repeats for about five months. Every one is
answerable in one sitting and has no wrong answer. A test asserts each names an
activity that actually runs in the browser — a challenge requiring the streamed
desktop would be unattemptable for most households.

### 3. "Show a grown-up"

The only thing in the product designed to leave the house.

The child's half is a button that opens a card on their own screen and calls an
adult over. The adult's half is their own phone's share sheet, with text they
can read before they send it, going to people they chose. Nothing is uploaded at
any point; if nobody presses anything, we never learn the card was opened.

It prints, because Indian households put certificates on walls.

### 4. Referrals — give a month, get a month

`packages/shared/src/referral.ts`. Six Crockford characters, derived from the
guardian id rather than stored, so issuing one needs no column and no migration.
The referred household gets 14 free days instead of 7; the referrer gets a month
once the household they sent actually pays.

Three details that matter:

- **A mistyped code never blocks a sale.** It is normalised (O→0, I/L→1, case,
  punctuation) and, if it still makes no sense, dropped. The order goes through.
- **First code wins.** Someone who arrives on their sister's link and later
  clicks a stranger's stays attributed to their sister. This is also what stops
  anyone appending their own code to a link they post publicly.
- **Nothing is credited automatically.** `pnpm orders referrer <code>` prints
  every guardian the code resolves to and every household that arrived on it.
  Every match is printed, not the first — an ambiguous free month is a question
  for a person, not a coin toss.

## What this deliberately does not do

- **No digest email yet.** A weekly "what your child made" email to the parent
  is the obvious next piece, and it is worth building — but it depends on
  children actually using the service, which is blocked on parental consent
  (`docs/setup.md`, step 5). Shipping it now would ship dead code.
- **No analytics.** There is no event pipeline, no funnel instrumentation and no
  attribution beyond a code somebody typed. We find out a parent shared
  something when a household arrives with their code, and not before. If that
  measurement gap becomes a real problem, the answer is counting orders by code,
  which the order desk already does.
- **No urgency theatre.** No countdown on the launch price, no "3 people are
  viewing this", no fake scarcity. A service asking parents to trust it with
  their children does not get to use the tricks.

## The one number to watch

Orders per week, split by whether they carry a referral code. If the referred
share climbs past about a third, the loop is running and the thing to do is make
the card better. If it stays near zero after the preview has traffic, the share
step is where it is breaking — and that is a copy problem in
`referralInviteText`, not a reason to add a mechanic aimed at children.
