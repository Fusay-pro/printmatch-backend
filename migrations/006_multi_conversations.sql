-- Allow multiple conversations between the same commissioner and partner.
-- Previously a unique constraint forced one conversation per pair forever,
-- which meant repeat requests landed in the old conversation where accepted
-- offers blocked the partner from sending new quotable offers.

ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_commissioner_id_partner_user_id_key;
