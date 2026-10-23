-- Native app push (Firebase Cloud Messaging). The Android and iOS apps' WebView has no Web Push,
-- so the app registers an FCM token instead. An 'fcm' row keeps the token in `endpoint` (unique,
-- so the same device re-registering moves to the new user) and has no Web Push keys.

ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'web' CHECK (kind IN ('web', 'fcm'));
ALTER TABLE push_subscriptions ALTER COLUMN p256dh DROP NOT NULL;
ALTER TABLE push_subscriptions ALTER COLUMN auth DROP NOT NULL;
