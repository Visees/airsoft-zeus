-- Objective timers. An objective can have a time limit (timer_sec, 0 = no timer); the GM or one of
-- the objective's referees (referee_ids: event members who may run only that objective) starts,
-- pauses, resumes and stops a countdown per team. Timers count game time: they stand still while
-- the game is paused (elapsed_ms + game clock now - run_game_ms, game clock = now - paused time).

ALTER TABLE objectives ADD COLUMN IF NOT EXISTS timer_sec integer NOT NULL DEFAULT 0 CHECK (timer_sec >= 0);
ALTER TABLE objectives ADD COLUMN IF NOT EXISTS referee_ids uuid[] NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS objective_timers (
  objective_id      uuid NOT NULL REFERENCES objectives(id) ON DELETE CASCADE,
  team_id           uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  event_id          uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  state             text NOT NULL CHECK (state IN ('running','paused','stopped')),
  elapsed_ms        bigint NOT NULL DEFAULT 0,   -- game time counted before the current run
  run_game_ms       bigint,                      -- game clock when the current run began (running only)
  started_at        timestamptz NOT NULL DEFAULT now(),
  overrun_notified  boolean NOT NULL DEFAULT false,
  updated_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (objective_id, team_id)
);
CREATE INDEX IF NOT EXISTS objective_timers_event ON objective_timers (event_id);

ALTER TABLE alerts DROP CONSTRAINT IF EXISTS alerts_type_check;
ALTER TABLE alerts ADD CONSTRAINT alerts_type_check
  CHECK (type IN ('gps_suspicious','disconnected','capture','purchase_request','perk_fulfil','emergency','capture_failed','objective_timer'));
