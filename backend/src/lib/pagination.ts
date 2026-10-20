import type { Row } from '../db.js';
import { badRequest } from '../errors.js';

/** Keyset cursor over (created_at, id), encoded as base64url JSON. */
export interface Cursor {
  at: string;
  id: string;
}

export function encodeCursor(at: Date | string, id: string | number): string {
  const iso = at instanceof Date ? at.toISOString() : new Date(at).toISOString();
  return Buffer.from(JSON.stringify({ at: iso, id: String(id) })).toString('base64url');
}

export function decodeCursor(raw: unknown): Cursor | null {
  if (raw === undefined || raw === null || raw === '') return null;
  try {
    const c = JSON.parse(Buffer.from(String(raw), 'base64url').toString('utf8')) as Cursor;
    if (typeof c.at !== 'string' || typeof c.id !== 'string' || isNaN(Date.parse(c.at))) throw new Error();
    return c;
  } catch {
    throw badRequest('Invalid cursor.', 'invalid_cursor');
  }
}

/** Build a page from rows fetched with LIMIT pageSize + 1. */
export function page<R extends Row, T>(rows: R[], pageSize: number, map: (r: R) => T) {
  const hasMore = rows.length > pageSize;
  const slice = hasMore ? rows.slice(0, pageSize) : rows;
  const last = slice[slice.length - 1];
  return {
    items: slice.map(map),
    nextCursor: hasMore && last ? encodeCursor(last.created_at, last.id) : null,
  };
}
