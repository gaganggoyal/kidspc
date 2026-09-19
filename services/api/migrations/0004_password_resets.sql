-- Getting back in.
--
-- Until now the only way to recover a forgotten password was to ask us, and
-- the only thing we could do was tell the household to make a second account
-- -- which orphans their children's profiles, their limits and their progress.
-- For a product whose whole value is the settings a parent has already chosen,
-- that is not a gap in the sign-in screen; it is a way to lose the customer.
--
-- A separate table rather than two columns on `guardians`, for three reasons:
-- the rows are short-lived and want deleting in bulk; a request is an event
-- worth being able to count, not a property of a person; and a nullable
-- `reset_token` on the guardian row is the shape that invites somebody to
-- forget the expiry check.

CREATE TABLE password_resets (
  id text PRIMARY KEY,
  guardian_id text NOT NULL REFERENCES guardians (id) ON DELETE CASCADE,

  -- The digest, never the token. Same reasoning as refresh_tokens: this row is
  -- a working password reset, so a database dump must not be a set of them.
  -- SHA-256 rather than scrypt because the token is 32 random bytes and there
  -- is nothing to brute-force.
  token_hash text NOT NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,

  -- Single use. Set the moment the token is spent, so a link forwarded to
  -- somebody else, or replayed out of a mail provider's link scanner, is
  -- already dead.
  used_at timestamptz
);

-- The lookup the reset route does, and the guarantee that two rows can never
-- share a digest.
CREATE UNIQUE INDEX password_resets_token_key ON password_resets (token_hash);

-- Revoking a household's outstanding requests when a new one is made, and
-- when the password actually changes.
CREATE INDEX password_resets_guardian_idx ON password_resets (guardian_id);
