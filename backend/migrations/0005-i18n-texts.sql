-- System texts in every language. The English text stays in `reason` (exports, older clients);
-- the API answers in the reader's language from here. GM-typed reasons are stored as written.
ALTER TABLE ledger_entries ADD COLUMN IF NOT EXISTS reason_i18n jsonb;
