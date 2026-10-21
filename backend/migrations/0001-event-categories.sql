-- Game modes become event categories; objective types become the airsoft objective formats.
-- Old values are mapped to the closest new one. Also runs after schema.sql on a fresh database,
-- where it is a no-op apart from re-creating the same constraints.

ALTER TABLE events DROP CONSTRAINT IF EXISTS events_game_mode_check;
UPDATE events SET game_mode = 'scenario'
  WHERE game_mode NOT IN ('sunday','milsim','scenario','championship','plr','pcr','custom');
ALTER TABLE events ALTER COLUMN game_mode SET DEFAULT 'sunday';
ALTER TABLE events ADD CONSTRAINT events_game_mode_check
  CHECK (game_mode IN ('sunday','milsim','scenario','championship','plr','pcr','custom'));

ALTER TABLE objectives DROP CONSTRAINT IF EXISTS objectives_type_check;
UPDATE objectives SET type = CASE type
    WHEN 'control_point' THEN 'domination'
    WHEN 'flag' THEN 'ctf'
    WHEN 'sabotage' THEN 'search_destroy'
    ELSE 'custom'
  END
  WHERE type NOT IN ('domination','ctf','vip','search_destroy','bomb_defusal','attack_defense','recon','intel','custom');
ALTER TABLE objectives ALTER COLUMN type SET DEFAULT 'domination';
ALTER TABLE objectives ADD CONSTRAINT objectives_type_check
  CHECK (type IN ('domination','ctf','vip','search_destroy','bomb_defusal','attack_defense','recon','intel','custom'));

-- Saved templates keep a JSON snapshot of the event and its objectives.
UPDATE event_templates SET data = jsonb_set(data, '{event,game_mode}', '"scenario"')
  WHERE data->'event'->>'game_mode' NOT IN ('sunday','milsim','scenario','championship','plr','pcr','custom');

UPDATE event_templates SET data = jsonb_set(data, '{objectives}', (
    SELECT coalesce(jsonb_agg(
             CASE
               WHEN o->>'type' IN ('domination','ctf','vip','search_destroy','bomb_defusal','attack_defense','recon','intel','custom') THEN o
               ELSE o || jsonb_build_object('type', CASE o->>'type'
                 WHEN 'control_point' THEN 'domination'
                 WHEN 'flag' THEN 'ctf'
                 WHEN 'sabotage' THEN 'search_destroy'
                 ELSE 'custom'
               END)
             END ORDER BY i), '[]'::jsonb)
    FROM jsonb_array_elements(data->'objectives') WITH ORDINALITY AS t(o, i)
  ))
  WHERE jsonb_typeof(data->'objectives') = 'array';
