-- Rename from Airsoft Zeus: the append-only guard reads airsofthub.* settings, and the demo
-- accounts move to @airsofthub.test (the seed looks for that domain to know it already ran).

CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger AS $$
BEGIN
  -- Account deletion is allowed to detach personal references (set user_id to NULL)
  -- but never to change amounts, types or timestamps.
  IF TG_OP = 'UPDATE' AND current_setting('airsofthub.allow_anonymize', true) = 'on' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' AND current_setting('airsofthub.allow_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION '% on % is not allowed: table is append-only', TG_OP, TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

UPDATE users SET email = replace(email, '@airsoftzeus.test', '@airsofthub.test') WHERE email LIKE '%@airsoftzeus.test';
