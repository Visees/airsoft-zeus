-- News written by the platform admins (updates, sponsorships, announcements), shown on the home page.
-- published_at NULL = draft; a future published_at = scheduled.

CREATE TABLE IF NOT EXISTS news (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title        text NOT NULL,
  summary      text NOT NULL DEFAULT '',
  body         text NOT NULL DEFAULT '',
  category     text NOT NULL DEFAULT 'update' CHECK (category IN ('update','sponsor','announcement','event')),
  image_url    text,
  link_url     text,
  link_label   text,
  pinned       boolean NOT NULL DEFAULT false,
  published_at timestamptz,
  author_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS news_published ON news (published_at DESC) WHERE published_at IS NOT NULL;
