-- Per-user feature switches set by the platform admins (Admin → Users). Only values that differ
-- from the default in backend/src/auth/features.ts are stored: { "create_events": false, … }.

ALTER TABLE users ADD COLUMN IF NOT EXISTS features jsonb NOT NULL DEFAULT '{}';
