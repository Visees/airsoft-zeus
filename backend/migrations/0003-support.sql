-- Support messages: players write to the platform admins (bugs, reports, general messages)
-- and the admins answer in the same thread.

CREATE TABLE IF NOT EXISTS support_tickets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid REFERENCES users(id) ON DELETE SET NULL,
  category        text NOT NULL CHECK (category IN ('bug','report','general')),
  subject         text NOT NULL,
  -- open = waiting for the admins, answered = waiting for the player, closed = done.
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open','answered','closed')),
  -- Device details attached to bug reports (app page, browser, screen), only when the player agrees.
  context         jsonb NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS support_tickets_user ON support_tickets (user_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS support_tickets_status ON support_tickets (status, last_message_at DESC);

CREATE TABLE IF NOT EXISTS support_messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id   uuid NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  author_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  from_admin  boolean NOT NULL DEFAULT false,
  body        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS support_messages_ticket ON support_messages (ticket_id, created_at);
