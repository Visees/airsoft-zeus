import nodemailer from 'nodemailer';
import { config } from './config.js';
import { type Lang, type Translate, trIn } from './i18n/index.js';
import { logger } from './logger.js';

const transport = config.SMTP_HOST
  ? nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_SECURE || config.SMTP_PORT === 465,
      auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASSWORD } : undefined,
    })
  : null;

function layout(title: string, paragraphs: string[], action?: { label: string; url: string }): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  return `<!doctype html><html><body style="margin:0;background:#0e100f;font-family:Arial,Helvetica,sans-serif;color:#e9ece6">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px"><tr><td align="center">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#161917;border:1px solid #2c322d;border-radius:6px;padding:28px">
  <tr><td style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#a4b465;font-weight:bold">AirsoftHub</td></tr>
  <tr><td style="padding-top:12px;font-size:22px;font-weight:bold;text-transform:uppercase">${esc(title)}</td></tr>
  ${paragraphs.map((p) => `<tr><td style="padding-top:12px;font-size:15px;line-height:1.5;color:#c9cfc6">${esc(p)}</td></tr>`).join('')}
  ${action ? `<tr><td style="padding-top:24px"><a href="${esc(action.url)}" style="display:inline-block;background:#a4b465;color:#121509;font-weight:bold;text-decoration:none;padding:12px 20px;border-radius:4px">${esc(action.label)}</a></td></tr>
  <tr><td style="padding-top:16px;font-size:12px;color:#8b9388;word-break:break-all">${esc(action.url)}</td></tr>` : ''}
  </table></td></tr></table></body></html>`;
}

async function send(to: string, subject: string, html: string, text: string): Promise<void> {
  if (!transport) {
    logger.warn({ to, subject, text }, 'SMTP not configured; email not sent (content logged for development)');
    return;
  }
  try {
    const info = await transport.sendMail({ from: config.MAIL_FROM, to, subject, html, text });
    logger.info({ subject, messageId: info.messageId }, 'email sent');
  } catch (err) {
    logger.error({ err, to, subject }, 'email send failed');
  }
}

export async function sendVerificationEmail(to: string, nickname: string, token: string, lang: Lang): Promise<void> {
  const tr = trIn(lang);
  const url = `${config.SITE_URL}/auth/verify-email?token=${encodeURIComponent(token)}`;
  await send(
    to,
    tr`Confirm your email address`,
    layout(tr`Confirm your email`, [tr`Hi ${nickname}, confirm this address to join and run events on AirsoftHub.`, tr`The link is valid for 24 hours.`], {
      label: tr`Confirm email`,
      url,
    }),
    tr`Hi ${nickname}, confirm your email address: ${url} (valid for 24 hours)`,
  );
}

export async function sendPasswordResetEmail(to: string, nickname: string, token: string, lang: Lang): Promise<void> {
  const tr = trIn(lang);
  const url = `${config.SITE_URL}/auth/reset-password?token=${encodeURIComponent(token)}`;
  await send(
    to,
    tr`Reset your password`,
    layout(tr`Reset your password`, [tr`Hi ${nickname}, someone asked to reset the password of this account.`, tr`If it was not you, ignore this email. The link is valid for 1 hour.`], {
      label: tr`Choose a new password`,
      url,
    }),
    tr`Reset your AirsoftHub password: ${url} (valid for 1 hour). If you did not ask for this, ignore this email.`,
  );
}

export async function sendAccountDeletedEmail(to: string, lang: Lang): Promise<void> {
  const tr = trIn(lang);
  await send(
    to,
    tr`Your account was deleted`,
    layout(tr`Account deleted`, [tr`Your AirsoftHub account and personal data were deleted. Event results keep an anonymous "Deleted player" entry.`]),
    tr`Your AirsoftHub account and personal data were deleted.`,
  );
}

/** New support message (or a reply from the player): tell the platform admins, each in their language. */
export async function sendSupportEmail(
  to: { email: string; lang: Lang }[],
  ticket: { id: string; subject: string; category: string },
  from: string,
  text: string,
): Promise<void> {
  const url = `${config.SITE_URL}/support/${ticket.id}`;
  const excerpt = text.length > 600 ? `${text.slice(0, 600)}…` : text;
  for (const r of to) {
    const tr = trIn(r.lang);
    const category = supportCategoryLabel(tr, ticket.category);
    await send(
      r.email,
      tr`[Support · ${category}] ${ticket.subject}`,
      layout(ticket.subject, [tr`${from} wrote:`, excerpt], { label: tr`Open the conversation`, url }),
      `${tr`${from} wrote (${category}): ${ticket.subject}`}\n\n${excerpt}\n\n${url}`,
    );
  }
}

function supportCategoryLabel(tr: Translate, category: string): string {
  const labels: Record<string, string> = { bug: tr`Bug`, report: tr`Report`, general: tr`General` };
  return labels[category] ?? category;
}
