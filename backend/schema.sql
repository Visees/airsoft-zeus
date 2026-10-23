-- AirsoftHub database schema.
-- Database names are snake_case; the API converts to camelCase at the boundary.
-- Applied by the api on start when the database is empty (src/migrate.ts). Later changes
-- go in backend/migrations/ and are applied after it, once each, in order.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Immutability guard used by ledgers, audit logs and consent logs
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Users, profiles, clubs
-- ---------------------------------------------------------------------------
CREATE TABLE clubs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  country       text,
  city          text,
  description   text,
  logo_url      text,
  website       text,
  owner_id      uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX clubs_name_lower ON clubs (lower(name));

CREATE TABLE users (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email                      text NOT NULL,
  password_hash              text NOT NULL,
  email_verified_at          timestamptz,
  nickname                   text NOT NULL,
  first_name                 text,
  last_name                  text,
  date_of_birth              date,
  country                    text,
  language                   text NOT NULL DEFAULT 'it',
  avatar_url                 text,
  club_id                    uuid REFERENCES clubs(id) ON DELETE SET NULL,
  club_name                  text,
  player_role                text NOT NULL DEFAULT 'rifleman',
  custom_role                text,
  bio                        text,
  emergency_contact          jsonb,
  emergency_contact_enabled  boolean NOT NULL DEFAULT false,
  privacy                    jsonb NOT NULL DEFAULT '{"showClub":true,"showStats":true,"showRole":true,"showCountry":true,"shareEmergencyWithGm":false}',
  location_retention_days    integer NOT NULL DEFAULT 30,
  onboarding_done            boolean NOT NULL DEFAULT false,
  terms_version              text,
  privacy_version            text,
  terms_accepted_at          timestamptz,
  stats                      jsonb NOT NULL DEFAULT '{"gamesPlayed":0,"objectivesCaptured":0,"totalPoints":0,"wins":0,"losses":0,"draws":0}',
  token_version              integer NOT NULL DEFAULT 0,
  is_test_data               boolean NOT NULL DEFAULT false,
  deleted_at                 timestamptz,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_nickname_format CHECK (nickname ~ '^[A-Za-z0-9_.-]{3,24}$' OR deleted_at IS NOT NULL),
  CONSTRAINT users_player_role CHECK (player_role IN ('rifleman','medic','support_gunner','sniper','scout','squad_leader','radio_operator','custom'))
);
CREATE UNIQUE INDEX users_email_lower ON users (lower(email));
CREATE UNIQUE INDEX users_nickname_lower ON users (lower(nickname));
ALTER TABLE clubs ADD CONSTRAINT clubs_owner_fk FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL;

CREATE TABLE auth_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('email_verify','password_reset','refresh')),
  token_hash   text NOT NULL,
  family       uuid,
  expires_at   timestamptz NOT NULL,
  used_at      timestamptz,
  user_agent   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX auth_tokens_hash ON auth_tokens (token_hash);
CREATE INDEX auth_tokens_user ON auth_tokens (user_id, kind);

CREATE TABLE consent_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  kind        text NOT NULL CHECK (kind IN ('terms','privacy','location','notifications','emergency_share','tracking')),
  version     text,
  granted     boolean NOT NULL,
  event_id    uuid,
  ip          text,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX consent_log_user ON consent_log (user_id, created_at DESC);
CREATE TRIGGER consent_log_immutable BEFORE UPDATE OR DELETE ON consent_log
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE user_badges (
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code        text NOT NULL,
  event_id    uuid,
  awarded_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, code)
);

CREATE TABLE push_subscriptions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint    text NOT NULL UNIQUE,
  p256dh      text NOT NULL,
  auth        text NOT NULL,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        text NOT NULL,
  title       text NOT NULL,
  body        text NOT NULL DEFAULT '',
  priority    text NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal','high','emergency')),
  event_id    uuid,
  data        jsonb NOT NULL DEFAULT '{}',
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user ON notifications (user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Events
-- ---------------------------------------------------------------------------
CREATE TABLE events (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id             uuid NOT NULL REFERENCES users(id),
  name                 text NOT NULL,
  cover_url            text,
  description          text NOT NULL DEFAULT '',
  game_mode            text NOT NULL DEFAULT 'sunday'
                         CHECK (game_mode IN ('sunday','milsim','scenario','championship','plr','pcr','custom')),
  custom_mode_name     text,
  custom_mode_rules    text,
  start_at             timestamptz NOT NULL,
  end_at               timestamptz NOT NULL,
  meeting_address      text,
  meeting_lat          double precision,
  meeting_lng          double precision,
  min_players          integer NOT NULL DEFAULT 2,
  max_players          integer NOT NULL DEFAULT 40,
  visibility           text NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','private')),
  join_code            text,
  requires_approval    boolean NOT NULL DEFAULT false,
  rules                text NOT NULL DEFAULT '',
  safety_rules         text NOT NULL DEFAULT '',
  required_equipment   text NOT NULL DEFAULT '',
  chrono_info          text NOT NULL DEFAULT '',
  status               text NOT NULL DEFAULT 'draft'
                         CHECK (status IN ('draft','published','registration_open','lobby','live','paused','completed','cancelled')),
  team_selection       text NOT NULL DEFAULT 'gm' CHECK (team_selection IN ('gm','auto','player')),
  teams_locked         boolean NOT NULL DEFAULT false,
  registration_locked  boolean NOT NULL DEFAULT false,
  area_lat             double precision,
  area_lng             double precision,
  area_zoom            double precision,
  tracking             jsonb NOT NULL DEFAULT '{}',
  visibility_rules     jsonb NOT NULL DEFAULT '{}',
  scoring              jsonb NOT NULL DEFAULT '{}',
  store_enabled        boolean NOT NULL DEFAULT true,
  phase                text,
  started_at           timestamptz,
  paused_at            timestamptz,
  paused_total_ms      bigint NOT NULL DEFAULT 0,
  ends_at              timestamptz,
  ended_at             timestamptz,
  auto_end             boolean NOT NULL DEFAULT true,
  starting_soon_notified_at timestamptz,
  winner_team_id       uuid,
  results_token        text UNIQUE,
  results_published_at timestamptz,
  is_test_data         boolean NOT NULL DEFAULT false,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT events_players CHECK (min_players >= 0 AND max_players >= min_players),
  CONSTRAINT events_time CHECK (end_at > start_at)
);
CREATE UNIQUE INDEX events_join_code ON events (join_code) WHERE join_code IS NOT NULL;
CREATE INDEX events_discover ON events (visibility, status, start_at);
CREATE INDEX events_live ON events (status) WHERE status IN ('live','paused');

CREATE TABLE teams (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id               uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name                   text NOT NULL,
  color                  text NOT NULL DEFAULT '#7C8A4A',
  icon                   text NOT NULL DEFAULT 'shield',
  pattern                text NOT NULL DEFAULT 'solid' CHECK (pattern IN ('solid','stripes','dots','chevron','cross','grid')),
  capacity               integer NOT NULL DEFAULT 0,
  sort_order             integer NOT NULL DEFAULT 0,
  alliance_id            text,
  base_lat               double precision,
  base_lng               double precision,
  points                 bigint NOT NULL DEFAULT 0,
  currency               bigint NOT NULL DEFAULT 0,
  theft_protected_until  timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX teams_event ON teams (event_id, sort_order);
ALTER TABLE events ADD CONSTRAINT events_winner_fk FOREIGN KEY (winner_team_id) REFERENCES teams(id) ON DELETE SET NULL;

CREATE TABLE squads (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  team_id     uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name        text NOT NULL,
  callsign    text,
  icon        text,
  leader_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX squads_team ON squads (team_id);

CREATE TABLE event_members (
  event_id                 uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id                  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role                     text NOT NULL DEFAULT 'player' CHECK (role IN ('gm','player')),
  status                   text NOT NULL DEFAULT 'pending' CHECK (status IN ('invited','pending','approved','rejected','removed','left')),
  team_id                  uuid REFERENCES teams(id) ON DELETE SET NULL,
  squad_id                 uuid REFERENCES squads(id) ON DELETE SET NULL,
  is_squad_leader          boolean NOT NULL DEFAULT false,
  player_role              text NOT NULL DEFAULT 'rifleman',
  ready                    boolean NOT NULL DEFAULT false,
  rules_accepted_at        timestamptz,
  location_permission      text NOT NULL DEFAULT 'unknown' CHECK (location_permission IN ('unknown','granted','denied','prompt')),
  notification_permission  text NOT NULL DEFAULT 'unknown' CHECK (notification_permission IN ('unknown','granted','denied','prompt')),
  tracking_consent_at      timestamptz,
  tracking_active          boolean NOT NULL DEFAULT false,
  last_seen_at             timestamptz,
  last_location_at         timestamptz,
  gps_accuracy             double precision,
  points                   bigint NOT NULL DEFAULT 0,
  captures                 integer NOT NULL DEFAULT 0,
  currency_earned          bigint NOT NULL DEFAULT 0,
  emergency_contact        jsonb,
  removal_reason           text,
  invited_by               uuid REFERENCES users(id) ON DELETE SET NULL,
  joined_at                timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, user_id)
);
CREATE INDEX event_members_user ON event_members (user_id, status);
CREATE INDEX event_members_team ON event_members (event_id, team_id);

-- ---------------------------------------------------------------------------
-- Map content
-- ---------------------------------------------------------------------------
CREATE TABLE objectives (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id              uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name                  text NOT NULL,
  description           text NOT NULL DEFAULT '',
  instructions          text NOT NULL DEFAULT '',
  sort_order            integer NOT NULL DEFAULT 0,
  lat                   double precision NOT NULL,
  lng                   double precision NOT NULL,
  icon                  text NOT NULL DEFAULT 'flag',
  color                 text NOT NULL DEFAULT '#E0A84A',
  type                  text NOT NULL DEFAULT 'domination'
                          CHECK (type IN ('domination','ctf','vip','search_destroy','bomb_defusal','attack_defense','recon','intel','custom')),
  image_url             text,
  document_url          text,
  methods               text[] NOT NULL DEFAULT ARRAY['code']::text[],
  require_geofence      boolean NOT NULL DEFAULT false,
  geofence              jsonb NOT NULL DEFAULT '{}',
  rewards               jsonb NOT NULL DEFAULT '{}',
  availability_start    timestamptz,
  availability_end      timestamptz,
  cooldown_sec          integer NOT NULL DEFAULT 0,
  max_captures          integer NOT NULL DEFAULT 0,
  allowed_team_ids      uuid[] NOT NULL DEFAULT '{}',
  visibility            jsonb NOT NULL DEFAULT '{"mode":"all","teamIds":[]}',
  prerequisite_ids      uuid[] NOT NULL DEFAULT '{}',
  next_objective_id     uuid REFERENCES objectives(id) ON DELETE SET NULL,
  enabled               boolean NOT NULL DEFAULT true,
  -- secrets: never serialized to players
  capture_code          text,
  qr_token              text NOT NULL DEFAULT encode(gen_random_bytes(18), 'hex'),
  qr_version            integer NOT NULL DEFAULT 1,
  -- runtime, server-managed
  disabled_by_gm        boolean NOT NULL DEFAULT false,
  owner_team_id         uuid REFERENCES teams(id) ON DELETE SET NULL,
  capture_count         integer NOT NULL DEFAULT 0,
  last_captured_at      timestamptz,
  last_captured_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  contested             boolean NOT NULL DEFAULT false,
  contested_by_gm       boolean NOT NULL DEFAULT false,
  jammed_for            jsonb NOT NULL DEFAULT '{}',
  shielded_until        timestamptz,
  shielded_team_id      uuid,
  recurring_last_at     timestamptz,
  completed_at          timestamptz,
  last_status           text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT objectives_methods CHECK (methods <@ ARRAY['code','qr','geofence']::text[] AND cardinality(methods) > 0)
);
CREATE INDEX objectives_event ON objectives (event_id, sort_order);
CREATE UNIQUE INDEX objectives_code_per_event ON objectives (event_id, lower(capture_code)) WHERE capture_code IS NOT NULL;

CREATE TABLE capture_states (
  objective_id  uuid PRIMARY KEY REFERENCES objectives(id) ON DELETE CASCADE,
  event_id      uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  progress      jsonb NOT NULL DEFAULT '{}',   -- { teamId: seconds }
  present       jsonb NOT NULL DEFAULT '{}',   -- { teamId: { userId: lastSeenEpochMs } }
  armed         jsonb NOT NULL DEFAULT '{}',   -- { teamId: true } when require_geofence dwell is done
  contested     boolean NOT NULL DEFAULT false,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE pois (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name         text NOT NULL,
  type         text NOT NULL DEFAULT 'custom'
                 CHECK (type IN ('ammo','medic','respawn','safe_zone','team_base','vehicle','supply','extraction','restricted','custom')),
  description  text NOT NULL DEFAULT '',
  lat          double precision NOT NULL,
  lng          double precision NOT NULL,
  icon         text NOT NULL DEFAULT 'map-pin',
  color        text NOT NULL DEFAULT '#C9CDBF',
  image_url    text,
  team_id      uuid REFERENCES teams(id) ON DELETE SET NULL,
  visibility   jsonb NOT NULL DEFAULT '{"mode":"all"}',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pois_event ON pois (event_id);

CREATE TABLE zones (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('playable','restricted','safe','spawn','respawn','base','extraction','route','line','sector','label')),
  geometry      text NOT NULL CHECK (geometry IN ('point','circle','polygon','polyline')),
  points        jsonb NOT NULL DEFAULT '[]',
  radius_m      double precision,
  label         text NOT NULL DEFAULT '',
  description   text NOT NULL DEFAULT '',
  color         text NOT NULL DEFAULT '#9DAE5C',
  fill_opacity  double precision NOT NULL DEFAULT 0.15,
  stroke_width  double precision NOT NULL DEFAULT 2,
  icon          text,
  team_id       uuid REFERENCES teams(id) ON DELETE SET NULL,
  visibility    jsonb NOT NULL DEFAULT '{"mode":"all"}',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX zones_event ON zones (event_id);

-- ---------------------------------------------------------------------------
-- Captures, ledgers
-- ---------------------------------------------------------------------------
CREATE TABLE objective_captures (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  objective_id  uuid NOT NULL REFERENCES objectives(id) ON DELETE CASCADE,
  team_id       uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id       uuid REFERENCES users(id) ON DELETE SET NULL,
  method        text NOT NULL CHECK (method IN ('code','qr','geofence','gm')),
  points        bigint NOT NULL DEFAULT 0,
  currency      bigint NOT NULL DEFAULT 0,
  previous_owner_team_id uuid,
  client_tx_id  text,
  revoked_at    timestamptz,
  revoked_by    uuid,
  revoke_reason text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX objective_captures_event ON objective_captures (event_id, created_at DESC);
CREATE INDEX objective_captures_objective ON objective_captures (objective_id, created_at DESC);

CREATE TABLE capture_attempts (
  id            bigserial PRIMARY KEY,
  event_id      uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  objective_id  uuid NOT NULL REFERENCES objectives(id) ON DELETE CASCADE,
  user_id       uuid REFERENCES users(id) ON DELETE SET NULL,
  method        text NOT NULL,
  success       boolean NOT NULL,
  reason        text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX capture_attempts_user ON capture_attempts (user_id, objective_id, created_at DESC);

-- One table for both ledgers: kind = 'points' (victory points) or 'currency' (team currency).
CREATE TABLE ledger_entries (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  team_id       uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('points','currency')),
  type          text NOT NULL CHECK (type IN ('starting_balance','capture','capture_bonus','recurring','defense_bonus',
                                              'completion_bonus','gm_adjustment','penalty','perk_purchase','perk_refund',
                                              'theft_in','theft_out','capture_revoked')),
  amount        bigint NOT NULL,
  requested     bigint NOT NULL,
  balance_after bigint NOT NULL,
  user_id       uuid REFERENCES users(id) ON DELETE SET NULL,
  objective_id  uuid REFERENCES objectives(id) ON DELETE SET NULL,
  perk_id       uuid,
  purchase_id   uuid,
  capture_id    uuid,
  reason        text NOT NULL DEFAULT '',
  actor_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  client_tx_id  text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ledger_event ON ledger_entries (event_id, created_at DESC);
CREATE INDEX ledger_team ON ledger_entries (team_id, kind, created_at DESC);
CREATE TRIGGER ledger_immutable BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ---------------------------------------------------------------------------
-- Perks
-- ---------------------------------------------------------------------------
CREATE TABLE perks (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id            uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name                text NOT NULL,
  description         text NOT NULL DEFAULT '',
  icon                text NOT NULL DEFAULT 'zap',
  type                text NOT NULL CHECK (type IN ('uav','jammer','theft','shield','double_points','recon','instant_respawn','supply_drop','comms_jammer','custom')),
  price               bigint NOT NULL CHECK (price >= 0),
  duration_sec        integer NOT NULL DEFAULT 0,
  cooldown_sec        integer NOT NULL DEFAULT 0,
  total_quantity      integer NOT NULL DEFAULT 0,
  remaining_quantity  integer,
  per_team_limit      integer NOT NULL DEFAULT 0,
  eligible            text NOT NULL DEFAULT 'any' CHECK (eligible IN ('any','squad_leaders','roles')),
  eligible_roles      text[] NOT NULL DEFAULT '{}',
  requires_approval   boolean NOT NULL DEFAULT false,
  activation          text NOT NULL DEFAULT 'immediate' CHECK (activation IN ('immediate','manual')),
  target              text NOT NULL DEFAULT 'none' CHECK (target IN ('none','enemy_team','objective')),
  config              jsonb NOT NULL DEFAULT '{}',
  enabled             boolean NOT NULL DEFAULT true,
  sort_order          integer NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX perks_event ON perks (event_id, sort_order);

CREATE TABLE perk_purchases (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id             uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  perk_id              uuid NOT NULL REFERENCES perks(id) ON DELETE CASCADE,
  team_id              uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  buyer_id             uuid REFERENCES users(id) ON DELETE SET NULL,
  price                bigint NOT NULL,
  target_team_id       uuid REFERENCES teams(id) ON DELETE SET NULL,
  target_objective_id  uuid REFERENCES objectives(id) ON DELETE SET NULL,
  client_tx_id         text NOT NULL,
  status               text NOT NULL CHECK (status IN ('pending_approval','ready','active','completed','expired','rejected','cancelled')),
  refunded             boolean NOT NULL DEFAULT false,
  activated_at         timestamptz,
  expires_at           timestamptz,
  resolved_by          uuid,
  reason               text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX perk_purchases_event ON perk_purchases (event_id, created_at DESC);
CREATE INDEX perk_purchases_team ON perk_purchases (team_id, perk_id, status);

CREATE TABLE effects (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id         uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  purchase_id      uuid REFERENCES perk_purchases(id) ON DELETE CASCADE,
  type             text NOT NULL,
  team_id          uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  target_team_id   uuid REFERENCES teams(id) ON DELETE CASCADE,
  objective_id     uuid REFERENCES objectives(id) ON DELETE CASCADE,
  starts_at        timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL,
  config           jsonb NOT NULL DEFAULT '{}',
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','cancelled')),
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX effects_active ON effects (event_id, status, expires_at);

-- UAV intel snapshots: what a team was allowed to see, captured while the effect was active.
CREATE TABLE intel_positions (
  effect_id     uuid NOT NULL REFERENCES effects(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id      uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  viewer_team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  lat           double precision NOT NULL,
  lng           double precision NOT NULL,
  radius_m      double precision,
  precision     text NOT NULL,
  sample_at     timestamptz NOT NULL,
  written_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (effect_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Locations
-- ---------------------------------------------------------------------------
CREATE TABLE player_locations (
  event_id          uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lat               double precision NOT NULL,
  lng               double precision NOT NULL,
  accuracy          double precision NOT NULL,
  speed             double precision,
  heading           double precision,
  altitude          double precision,
  sample_at         timestamptz NOT NULL,
  received_at       timestamptz NOT NULL DEFAULT now(),
  ring              jsonb NOT NULL DEFAULT '[]',   -- recent accepted samples, used for "delayed" precision
  suspicious_count  integer NOT NULL DEFAULT 0,
  last_flag_at      timestamptz,
  PRIMARY KEY (event_id, user_id)
);

CREATE TABLE location_history (
  id           bigserial PRIMARY KEY,
  event_id     uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  lat          double precision NOT NULL,
  lng          double precision NOT NULL,
  accuracy     double precision NOT NULL,
  sample_at    timestamptz NOT NULL,
  received_at  timestamptz NOT NULL DEFAULT now(),
  flags        text[] NOT NULL DEFAULT '{}'
);
CREATE INDEX location_history_event ON location_history (event_id, user_id, sample_at);
CREATE INDEX location_history_received ON location_history (received_at);

-- ---------------------------------------------------------------------------
-- Communication, logs
-- ---------------------------------------------------------------------------
CREATE TABLE announcements (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  scope           text NOT NULL CHECK (scope IN ('all','team','player')),
  team_id         uuid REFERENCES teams(id) ON DELETE CASCADE,
  target_user_id  uuid REFERENCES users(id) ON DELETE CASCADE,
  title           text NOT NULL,
  body            text NOT NULL DEFAULT '',
  priority        text NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal','high','emergency')),
  author_id       uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX announcements_event ON announcements (event_id, created_at DESC);

CREATE TABLE activity (
  id            bigserial PRIMARY KEY,
  event_id      uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  type          text NOT NULL,
  message       text NOT NULL,
  scope         text NOT NULL DEFAULT 'all' CHECK (scope IN ('all','team','gm')),
  team_id       uuid,
  user_id       uuid,
  objective_id  uuid,
  data          jsonb NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX activity_event ON activity (event_id, id DESC);

CREATE TABLE alerts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id         uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  type             text NOT NULL CHECK (type IN ('gps_suspicious','disconnected','capture','purchase_request','perk_fulfil','emergency','capture_failed')),
  severity         text NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','critical')),
  user_id          uuid REFERENCES users(id) ON DELETE SET NULL,
  message          text NOT NULL,
  data             jsonb NOT NULL DEFAULT '{}',
  dedupe_key       text,
  acknowledged_at  timestamptz,
  acknowledged_by  uuid,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX alerts_event ON alerts (event_id, created_at DESC);
CREATE UNIQUE INDEX alerts_dedupe ON alerts (event_id, dedupe_key) WHERE dedupe_key IS NOT NULL AND acknowledged_at IS NULL;

CREATE TABLE audit_logs (
  id           bigserial PRIMARY KEY,
  event_id     uuid REFERENCES events(id) ON DELETE CASCADE,
  actor_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  action       text NOT NULL,
  target_type  text,
  target_id    text,
  before       jsonb,
  after        jsonb,
  reason       text,
  ip           text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_event ON audit_logs (event_id, id DESC);
CREATE TRIGGER audit_logs_immutable BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE reports (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  event_id        uuid REFERENCES events(id) ON DELETE SET NULL,
  target_user_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  reason          text NOT NULL,
  details         text NOT NULL DEFAULT '',
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewed','closed')),
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Templates, bookkeeping
-- ---------------------------------------------------------------------------
CREATE TABLE map_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        text NOT NULL,
  data        jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE event_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        text NOT NULL,
  data        jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE idempotency_keys (
  user_id     uuid NOT NULL,
  key         text NOT NULL,
  action      text NOT NULL,
  response    jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

CREATE TABLE schema_migrations (
  name        text PRIMARY KEY,
  applied_at  timestamptz NOT NULL DEFAULT now()
);
INSERT INTO schema_migrations (name) VALUES ('01-schema.sql');
