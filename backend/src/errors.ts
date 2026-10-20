import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { logger } from './logger.js';

/**
 * Error with an HTTP status and a stable machine code. Serialized as
 * `{ error: { code, message, fields? } }`; `message` is safe to show to users.
 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, code = 'invalid_argument', fields?: Record<string, string>) =>
  new HttpError(400, code, message, fields);
export const unauthorized = (message = 'Sign in to continue.', code = 'unauthorized') => new HttpError(401, code, message);
export const forbidden = (message = 'You do not have permission to do that.', code = 'forbidden') => new HttpError(403, code, message);
export const notFound = (message = 'Not found.', code = 'not_found') => new HttpError(404, code, message);
export const conflict = (message: string, code = 'conflict', fields?: Record<string, string>) => new HttpError(409, code, message, fields);
export const precondition = (message: string, code = 'failed_precondition') => new HttpError(412, code, message);
export const tooMany = (message = 'Too many attempts. Wait a moment and try again.', code = 'rate_limited') =>
  new HttpError(429, code, message);

export function zodFields(err: ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.join('.') || '_';
    if (!fields[key]) fields[key] = issue.message;
  }
  return fields;
}

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof HttpError) {
    if (err.status >= 500) logger.error({ err, path: req.path }, 'request failed');
    res.status(err.status).json({ error: { code: err.code, message: err.message, fields: err.fields } });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({ error: { code: 'invalid_argument', message: 'Some fields are not valid.', fields: zodFields(err) } });
    return;
  }
  // body-parser / multer errors
  const e = err as { type?: string; status?: number; code?: string; message?: string };
  if (e?.type === 'entity.parse.failed') {
    res.status(400).json({ error: { code: 'invalid_json', message: 'The request body is not valid JSON.' } });
    return;
  }
  if (e?.type === 'entity.too.large' || e?.code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({ error: { code: 'too_large', message: 'The upload is too large.' } });
    return;
  }
  // Postgres unique violation that slipped through
  if ((err as { code?: string })?.code === '23505') {
    res.status(409).json({ error: { code: 'conflict', message: 'That value is already in use.' } });
    return;
  }
  logger.error({ err, path: req.path, method: req.method }, 'unhandled error');
  res.status(500).json({ error: { code: 'internal', message: 'The server had a problem. Try again in a moment.' } });
};
