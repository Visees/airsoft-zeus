import { Router, type RequestHandler } from 'express';
import multer from 'multer';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { currentUser } from '../auth/middleware.js';
import { config } from '../config.js';
import { many, one, tx } from '../db.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { randomToken } from '../lib/ids.js';
import { consume } from '../lib/rate-limit.js';
import { idParam } from '../lib/validate.js';
import { hub } from '../realtime/hub.js';
import { FINISHED, requireGm, requireMember } from '../domain/context.js';
import { audit } from '../domain/journal.js';
import * as dto from '../domain/serialize.js';
import { sniff, uploadDir } from './common.js';
import { tr } from '../i18n/index.js';

/**
 * Documents the Game Masters share with the players of an event (game book, briefing, maps).
 * Stored outside the public /api/files route: only GMs and approved members can download them.
 */
export const attachmentsRouter = Router();

const attachmentDir = resolve(uploadDir, 'attachments');
const MAX_PER_EVENT = 20;

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.MAX_ATTACHMENT_BYTES, files: 1 } });

/** Office files are ZIP containers: accepted by their extension once the ZIP signature matches. */
const ZIP_TYPES: Record<string, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
};

function detect(buf: Buffer, name: string): { ext: string; mime: string } | null {
  const known = sniff(buf);
  if (known) return known;
  const ext = extname(name).slice(1).toLowerCase();
  const isZip = buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
  return isZip && ZIP_TYPES[ext] ? { ext, mime: ZIP_TYPES[ext] } : null;
}

/** Display name: last path segment, no control characters, extension matching the real type. */
function cleanName(raw: string, ext: string): string {
  const base = (raw.split(/[\\/]/).pop() ?? '').replace(/[\u0000-\u001f\u007f"]/g, '').trim();
  const stem = base.slice(0, base.length - extname(base).length).trim().slice(0, 100);
  return `${stem || 'attachment'}.${ext}`;
}

export async function removeAttachmentFiles(storedNames: string[]): Promise<void> {
  await Promise.all(storedNames.map((n) => unlink(resolve(attachmentDir, n)).catch(() => undefined)));
}

/** Checked before multer reads the body, so non-GMs never get a 25 MB upload buffered. */
const gmOnly: RequestHandler = async (req, _res, next) => {
  const ctx = await requireGm(idParam(req, 'eventId'), currentUser(req).id);
  if (FINISHED.includes(ctx.event.status)) throw conflict(tr`Finished events cannot be edited.`, 'event_finished');
  next();
};

attachmentsRouter.get('/:eventId/attachments', async (req, res) => {
  const ctx = await requireMember(idParam(req, 'eventId'), currentUser(req).id);
  const rows = await many('SELECT * FROM event_attachments WHERE event_id = $1 ORDER BY created_at', [ctx.event.id]);
  res.json(rows.map(dto.attachment));
});

attachmentsRouter.post('/:eventId/attachments', gmOnly, upload.single('file'), async (req, res) => {
  const me = currentUser(req);
  const eventId = idParam(req, 'eventId');
  await consume('upload', me.id, 60, 3600, tr`Too many uploads. Try again later.`);
  const file = req.file;
  if (!file) throw badRequest(tr`Choose a file to upload.`, 'no_file');
  // The browser sends the file name in the multipart header as latin1; the client repeats it as a UTF-8 field.
  const original = typeof req.body?.name === 'string' && req.body.name.trim() ? req.body.name : file.originalname;
  const kind = detect(file.buffer, original);
  if (!kind) throw badRequest(tr`Upload a PDF, an image (JPEG, PNG, WebP) or an Office document (Word, Excel, PowerPoint, OpenDocument).`, 'unsupported_type');
  await mkdir(attachmentDir, { recursive: true });
  const storedName = `${randomToken(18)}.${kind.ext}`;
  await writeFile(resolve(attachmentDir, storedName), file.buffer, { flag: 'wx' });
  try {
    const row = await tx(async (t) => {
      await t.query('SELECT 1 FROM events WHERE id = $1 FOR UPDATE', [eventId]);
      const n = await one<{ n: number }>('SELECT count(*)::int AS n FROM event_attachments WHERE event_id = $1', [eventId], t);
      if ((n?.n ?? 0) >= MAX_PER_EVENT) throw conflict(tr`An event can have at most ${MAX_PER_EVENT} attachments. Delete one first.`, 'too_many_attachments');
      const a = await one(
        `INSERT INTO event_attachments (event_id, stored_name, file_name, mime_type, size_bytes, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [eventId, storedName, cleanName(original, kind.ext), kind.mime, file.size, me.id],
        t,
      );
      await audit(t, eventId, me.id, 'attachment.create', { type: 'attachment', id: a!.id, after: { fileName: a!.file_name, sizeBytes: a!.size_bytes } });
      return a!;
    });
    hub.invalidate(eventId, ['event']);
    res.status(201).json(dto.attachment(row));
  } catch (err) {
    await removeAttachmentFiles([storedName]);
    throw err;
  }
});

attachmentsRouter.delete('/:eventId/attachments/:attachmentId', async (req, res) => {
  const me = currentUser(req);
  const eventId = idParam(req, 'eventId');
  const attachmentId = idParam(req, 'attachmentId');
  const row = await tx(async (t) => {
    await requireGm(eventId, me.id, t);
    const a = await one('DELETE FROM event_attachments WHERE id = $1 AND event_id = $2 RETURNING *', [attachmentId, eventId], t);
    if (!a) throw notFound(tr`Attachment not found.`);
    await audit(t, eventId, me.id, 'attachment.delete', { type: 'attachment', id: a.id, before: { fileName: a.file_name } });
    return a;
  });
  await removeAttachmentFiles([row.stored_name]);
  hub.invalidate(eventId, ['event']);
  res.json({ ok: true });
});

attachmentsRouter.get('/:eventId/attachments/:attachmentId/file', async (req, res) => {
  const ctx = await requireMember(idParam(req, 'eventId'), currentUser(req).id);
  const a = await one('SELECT * FROM event_attachments WHERE id = $1 AND event_id = $2', [idParam(req, 'attachmentId'), ctx.event.id]);
  if (!a) throw notFound(tr`Attachment not found.`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.download(a.stored_name, a.file_name, { root: attachmentDir, headers: { 'Content-Type': a.mime_type } }, (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: { code: 'not_found', message: tr`File not found.` } });
  });
});
