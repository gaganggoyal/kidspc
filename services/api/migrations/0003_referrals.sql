-- Who sent this household to us.
--
-- Recorded on the order rather than on the guardian, because the referral is a
-- property of one purchase and not of a person: the same household can arrive
-- twice, and crediting the second arrival to whoever sent the first would be
-- wrong. It also means an order placed by someone with no account -- which is
-- most of them, since asking to buy does not require registering -- can still
-- carry attribution.
--
-- Nullable and unvalidated on purpose. The code is derived from a guardian id
-- rather than stored, so there is no table to reference, and a code that
-- resolves to nobody must not be able to reject a paying customer. Resolving it
-- to a person is a deliberate, human step: `pnpm orders referrer <code>`.

ALTER TABLE plan_orders ADD COLUMN referral_code text;

-- Only the referred orders, which are the minority and the only ones anyone
-- ever queries by code.
CREATE INDEX plan_orders_referral_idx ON plan_orders (referral_code)
  WHERE referral_code IS NOT NULL;

-- Whether the referrer has actually been given their free month. Left alone by
-- the application: nothing here can pay anybody, so this column exists to stop
-- the same reward being granted twice by two different people looking at the
-- same list on two different evenings.
ALTER TABLE plan_orders ADD COLUMN referral_rewarded_at timestamptz;
