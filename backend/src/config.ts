import { z } from 'zod';

const bool = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  /** Public URL of the frontend, used in emails and share links. */
  SITE_URL: z.string().url().default('http://localhost:8080'),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  ACCESS_TOKEN_TTL_SEC: z.coerce.number().int().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().default(30),
  /** Secure cookies require HTTPS; disable only for plain-http local testing. */
  COOKIE_SECURE: z
    .string()
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true' || v === '1')),

  SMTP_HOST: z.string().default(''),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_USER: z.string().default(''),
  SMTP_PASSWORD: z.string().default(''),
  SMTP_SECURE: bool,
  MAIL_FROM: z.string().default('AirsoftHub <no-reply@localhost>'),

  GOOGLE_MAPS_API_KEY: z.string().default(''),
  GOOGLE_MAPS_MAP_ID: z.string().default(''),
  VAPID_PUBLIC_KEY: z.string().default(''),
  VAPID_PRIVATE_KEY: z.string().default(''),
  VAPID_SUBJECT: z.string().default('mailto:admin@localhost'),

  UPLOAD_DIR: z.string().default('./uploads'),
  MAX_UPLOAD_BYTES: z.coerce.number().int().default(5 * 1024 * 1024),
  /** Event attachments (game books, briefings) are often larger than images. */
  MAX_ATTACHMENT_BYTES: z.coerce.number().int().default(25 * 1024 * 1024),

  TERMS_VERSION: z.string().default('2026-10'),
  PRIVACY_VERSION: z.string().default('2026-10'),

  /** Interval of the game engine tick (recurring rewards, expiries, alerts). */
  TICK_MS: z.coerce.number().int().default(5000),
  /** Positions broadcast interval while a game is live. */
  POSITIONS_BROADCAST_MS: z.coerce.number().int().default(2000),
  LOG_LEVEL: z.string().default('info'),
  /** Comma-separated emails of the platform admins (they write the News and answer support messages). */
  ADMIN_EMAILS: z
    .string()
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean),
    ),
  /** Seed demo data (flagged is_test_data) on start when the database is empty. */
  SEED_DEMO_DATA: bool,
});

export type Config = z.infer<typeof schema>;

function load(): Config {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

export const config = load();
export const isProd = config.NODE_ENV === 'production';
export const cookieSecure = config.COOKIE_SECURE ?? isProd;
