-- Removing a player and banning them are now two actions. 'removed' players can join again;
-- 'banned' players cannot (until a Game Master invites them again). Every removal before this
-- change blocked the player, so those rows become bans.

ALTER TABLE event_members DROP CONSTRAINT IF EXISTS event_members_status_check;
ALTER TABLE event_members ADD CONSTRAINT event_members_status_check
  CHECK (status IN ('invited','pending','approved','rejected','removed','banned','left'));

UPDATE event_members SET status = 'banned' WHERE status = 'removed';
