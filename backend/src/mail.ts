import nodemailer from 'nodemailer';
import { config } from './config.js';
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
  <tr><td style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#a4b465;font-weight:bold">Airsoft Zeus</td></tr>
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
    await transport.sendMail({ from: config.MAIL_FROM, to, subject, html, text });
  } catch (err) {
    logger.error({ err, to, subject }, 'email send failed');
  }
}

export async function sendVerificationEmail(to: string, nickname: string, token: string): Promise<void> {
  const url = `${config.SITE_URL}/auth/verify-email?token=${encodeURIComponent(token)}`;
  await send(
    to,
    'Confirm your email address',
    layout('Confirm your email', [`Hi ${nickname}, confirm this address to join and run events on Airsoft Zeus.`, 'The link is valid for 24 hours.'], {
      label: 'Confirm email',
      url,
    }),
    `Hi ${nickname}, confirm your email address: ${url} (valid for 24 hours)`,
  );
}

export async function sendPasswordResetEmail(to: string, nickname: string, token: string): Promise<void> {
  const url = `${config.SITE_URL}/auth/reset-password?token=${encodeURIComponent(token)}`;
  await send(
    to,
    'Reset your password',
    layout('Reset your password', [`Hi ${nickname}, someone asked to reset the password of this account.`, 'If it was not you, ignore this email. The link is valid for 1 hour.'], {
      label: 'Choose a new password',
      url,
    }),
    `Reset your Airsoft Zeus password: ${url} (valid for 1 hour). If you did not ask for this, ignore this email.`,
  );
}

export async function sendAccountDeletedEmail(to: string): Promise<void> {
  await send(
    to,
    'Your account was deleted',
    layout('Account deleted', ['Your Airsoft Zeus account and personal data were deleted. Event results keep an anonymous "Deleted player" entry.']),
    'Your Airsoft Zeus account and personal data were deleted.',
  );
}
