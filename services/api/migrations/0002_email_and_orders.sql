-- Outgoing email, and the plan requests that generate most of it.
--
-- Mail is queued rather than sent inline. An SMTP handshake takes seconds and
-- can hang; a parent registering an account should not wait on Zoho, and a
-- provider outage should not turn a working registration into a 500. So the
-- request writes a row and returns, and a sender drains the queue.
--
-- The second reason matters more here: kidspc.online is live before its mailbox
-- exists. Queued mail is mail that will arrive once credentials are configured,
-- rather than mail that was silently dropped because nothing was listening.

CREATE TABLE email_outbox (
  id           text PRIMARY KEY,
  created_at   timestamptz NOT NULL DEFAULT now(),
  -- Recipient is stored plainly: it is the address we must send to, and
  -- hashing it would make the queue unable to do its one job.
  to_address   text NOT NULL,
  subject      text NOT NULL,
  body_text    text NOT NULL,
  body_html    text,
  -- Which message this is, for support and for counting. Never free text.
  template     text NOT NULL,
  sent_at      timestamptz,
  attempts     integer NOT NULL DEFAULT 0,
  last_error   text,
  -- When to next try. Set forward on failure so a bad address does not spin.
  next_try_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT email_attempts_sane CHECK (attempts >= 0)
);

-- The sender's only query: unsent, due, oldest first. Partial, so the index
-- stays small as sent mail accumulates behind it.
CREATE INDEX email_outbox_pending_idx
  ON email_outbox (next_try_at)
  WHERE sent_at IS NULL;

-- A household asking to subscribe.
--
-- Not an order in the accounting sense: nothing is charged here and no payment
-- instrument is captured. It records who asked for what, so a payment link can
-- be sent to them by hand.
CREATE TABLE plan_orders (
  id            text PRIMARY KEY,
  created_at    timestamptz NOT NULL DEFAULT now(),
  email         text NOT NULL,
  contact_name  text,
  plan_id       text NOT NULL,
  children      integer NOT NULL,
  -- What we quoted, in whole rupees, captured at the moment of asking. A price
  -- list can change; what this household was shown cannot.
  quoted_inr    integer NOT NULL,
  -- Set when the request came from someone already signed in.
  guardian_id   text REFERENCES guardians(id) ON DELETE SET NULL,
  status        text NOT NULL DEFAULT 'requested',
  note          text,

  CONSTRAINT plan_orders_plan CHECK (plan_id IN ('lite', 'pro')),
  CONSTRAINT plan_orders_children CHECK (children BETWEEN 1 AND 8),
  CONSTRAINT plan_orders_quote CHECK (quoted_inr >= 0),
  CONSTRAINT plan_orders_status CHECK (status IN ('requested', 'link_sent', 'paid', 'cancelled'))
);
CREATE INDEX plan_orders_created_idx ON plan_orders (created_at);
CREATE INDEX plan_orders_email_idx ON plan_orders (lower(email));
