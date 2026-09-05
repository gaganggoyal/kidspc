-- KidPC initial schema.
--
-- Notes for whoever reads this next:
--  * Children are stored with birth year+month only. There is no date-of-birth
--    column and adding one needs a very good reason (DPDP data minimisation).
--  * There is no analytics or ad-targeting table, by design.

CREATE TABLE guardians (
  id                    text PRIMARY KEY,
  email                 text NOT NULL,
  password_hash         text NOT NULL,
  display_name          text NOT NULL,
  timezone              text NOT NULL DEFAULT 'Asia/Kolkata',
  created_at            timestamptz NOT NULL DEFAULT now(),
  last_login_at         timestamptz,
  deletion_requested_at timestamptz
);
CREATE UNIQUE INDEX guardians_email_key ON guardians (lower(email));

CREATE TABLE children (
  id           text PRIMARY KEY,
  guardian_id  text NOT NULL REFERENCES guardians(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  birth_year   integer NOT NULL CHECK (birth_year BETWEEN 1990 AND 2100),
  birth_month  integer NOT NULL CHECK (birth_month BETWEEN 1 AND 12),
  avatar_id    text NOT NULL DEFAULT 'fox',
  pin_hash     text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  archived_at  timestamptz
);
CREATE INDEX children_guardian_idx ON children (guardian_id);

CREATE TABLE consents (
  id           text PRIMARY KEY,
  guardian_id  text NOT NULL REFERENCES guardians(id) ON DELETE CASCADE,
  child_id     text NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  method       text NOT NULL,
  scopes       jsonb NOT NULL,
  proof_digest text NOT NULL,
  granted_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz,
  revoked_at   timestamptz
);
CREATE INDEX consents_child_idx ON consents (child_id);

CREATE TABLE consent_challenges (
  id          text PRIMARY KEY,
  guardian_id text NOT NULL REFERENCES guardians(id) ON DELETE CASCADE,
  child_id    text NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  method      text NOT NULL,
  scopes      jsonb NOT NULL,
  nonce       text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz
);

CREATE TABLE policies (
  child_id             text PRIMARY KEY REFERENCES children(id) ON DELETE CASCADE,
  daily_minutes        integer NOT NULL CHECK (daily_minutes BETWEEN 0 AND 1440),
  weekly_minutes       integer CHECK (weekly_minutes IS NULL OR weekly_minutes BETWEEN 0 AND 10080),
  allowed_windows      jsonb NOT NULL DEFAULT '[]'::jsonb,
  allowed_app_ids      jsonb NOT NULL DEFAULT '[]'::jsonb,
  session_summaries    boolean NOT NULL DEFAULT false,
  -- The band this allow-list was written for. When a child grows past it, the
  -- apps that band never offered are granted automatically; see
  -- PolicyRepo.forChildInBand.
  granted_for_band     text NOT NULL DEFAULT 'explorer',
  idle_timeout_minutes integer NOT NULL DEFAULT 12 CHECK (idle_timeout_minutes BETWEEN 2 AND 60),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id                   text PRIMARY KEY,
  child_id             text NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  guardian_id          text NOT NULL,
  state                text NOT NULL CHECK (state IN ('provisioning','ready','active','suspended','terminated')),
  driver_ref           text,
  driver_name          text NOT NULL,
  device_kind          text NOT NULL CHECK (device_kind IN ('tv','browser')),
  auto_launch_app_id   text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  ready_at             timestamptz,
  last_heartbeat_at    timestamptz,
  ended_at             timestamptz,
  end_reason           text,
  deadline             timestamptz NOT NULL,
  limited_by           text NOT NULL,
  idle_timeout_minutes integer NOT NULL,
  timezone             text NOT NULL,
  billed_minutes       integer NOT NULL DEFAULT 0,
  last_billed_at       timestamptz NOT NULL,
  endpoint_host        text,
  endpoint_port        integer,
  endpoint_secret      text
);

-- A child may hold at most one desktop at a time. This is the invariant that
-- stops a flaky TV app from quietly costing us N containers per child.
CREATE UNIQUE INDEX sessions_one_live_per_child
  ON sessions (child_id) WHERE state <> 'terminated';
CREATE INDEX sessions_live_idx ON sessions (state);

CREATE TABLE usage_days (
  child_id text NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  day_key  text NOT NULL,
  minutes  integer NOT NULL DEFAULT 0,
  PRIMARY KEY (child_id, day_key)
);

CREATE TABLE refresh_tokens (
  id          text PRIMARY KEY,
  guardian_id text NOT NULL REFERENCES guardians(id) ON DELETE CASCADE,
  token_hash  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz
);
CREATE INDEX refresh_guardian_idx ON refresh_tokens (guardian_id);

CREATE TABLE audit_events (
  id           text PRIMARY KEY,
  at           timestamptz NOT NULL DEFAULT now(),
  actor_type   text NOT NULL,
  actor_id     text,
  action       text NOT NULL,
  subject_type text,
  subject_id   text,
  meta         jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX audit_subject_idx ON audit_events (subject_type, subject_id);
CREATE INDEX audit_at_idx ON audit_events (at);
