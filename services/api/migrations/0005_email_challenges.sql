-- Proving an address, not taking it on trust.
--
-- Until now an account was created with whatever address was typed, and the
-- first time anybody found out it was wrong was the day they needed a password
-- reset sent to it. For a household whose only way back in is that inbox, an
-- unchecked address is an account waiting to be lost.
--
-- So an address is confirmed before the account is used: a letter carrying a
-- six-digit code and a button, either of which proves the inbox. The same
-- letter shape signs a parent in without a password, and resets one.
--
-- One table for all three rather than three tables, because they are the same
-- object -- a secret that leaves this service by email and comes back once --
-- and the reset table already had exactly that shape. It is renamed and
-- widened rather than replaced, so its history is kept.

ALTER TABLE password_resets RENAME TO email_challenges;

-- Existing rows were all resets.
ALTER TABLE email_challenges ADD COLUMN purpose text NOT NULL DEFAULT 'password_reset';
ALTER TABLE email_challenges ALTER COLUMN purpose DROP DEFAULT;
ALTER TABLE email_challenges
  ADD CONSTRAINT email_challenges_purpose
  CHECK (purpose IN ('verify_email', 'sign_in', 'password_reset'));

-- The typed half of the letter. An HMAC of the code, keyed with a server
-- secret and the row's own id: six digits are a million possibilities, which
-- a plain hash would give up to anybody holding a database dump in seconds.
-- Null on the reset rows written before codes existed.
ALTER TABLE email_challenges ADD COLUMN code_hash text;

-- Wrong codes typed against this row. At five the row is spent, so the million
-- possibilities cannot be walked through five at a time per request.
ALTER TABLE email_challenges ADD COLUMN attempts integer NOT NULL DEFAULT 0;
ALTER TABLE email_challenges
  ADD CONSTRAINT email_challenges_attempts CHECK (attempts >= 0);

ALTER INDEX password_resets_token_key RENAME TO email_challenges_token_key;
DROP INDEX password_resets_guardian_idx;
CREATE INDEX email_challenges_guardian_idx ON email_challenges (guardian_id, purpose);

-- When the address was proved. Null until then.
ALTER TABLE guardians ADD COLUMN email_verified_at timestamptz;

-- Every account that exists today was made before confirmation did, and was
-- used by the people who made it. They are treated as confirmed rather than
-- asked for a code on their next sign-in -- which, until mail is delivering,
-- would be a code that never arrives.
UPDATE guardians SET email_verified_at = created_at WHERE email_verified_at IS NULL;
