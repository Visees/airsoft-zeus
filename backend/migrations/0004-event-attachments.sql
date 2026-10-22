-- Event attachments: documents the Game Masters share with the players (game book, briefing,
-- maps, waivers). Only Game Masters and approved members can list and download them.

CREATE TABLE IF NOT EXISTS event_attachments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  -- Name on disk under <UPLOAD_DIR>/attachments; never served by the public /api/files route.
  stored_name   text NOT NULL UNIQUE,
  -- Name shown to players and used for the download.
  file_name     text NOT NULL,
  mime_type     text NOT NULL,
  size_bytes    integer NOT NULL CHECK (size_bytes > 0),
  uploaded_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS event_attachments_event ON event_attachments (event_id, created_at);
