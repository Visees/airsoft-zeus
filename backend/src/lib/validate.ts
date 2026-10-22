import type { Request } from 'express';
import { z, ZodType } from 'zod';
import { badRequest, zodFields } from '../errors.js';
import { tr, zodErrorMap } from '../i18n/index.js';

/** Parse with a zod schema; throws 400 with per-field messages. */
export function parse<T extends ZodType>(schema: T, data: unknown): z.infer<T> {
  const res = schema.safeParse(data, { error: zodErrorMap() });
  if (!res.success) throw badRequest(tr`Some fields are not valid.`, 'invalid_argument', zodFields(res.error));
  return res.data;
}

export const body = <T extends ZodType>(req: Request, schema: T): z.infer<T> => parse(schema, req.body ?? {});
export const queryOf = <T extends ZodType>(req: Request, schema: T): z.infer<T> => parse(schema, req.query ?? {});

export const uuid = z.string().uuid('Invalid id');
export const clientTxId = z.string().min(8).max(64).regex(/^[A-Za-z0-9-]+$/, 'Invalid transaction id');
export const isoDate = z.string().datetime({ offset: true, message: 'Invalid date' });
export const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #7C8A4A');
export const lat = z.number().min(-90).max(90);
export const lng = z.number().min(-180).max(180);
export const latLng = z.object({ lat, lng });
export const nickname = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_.-]{3,24}$/, '3–24 characters: letters, numbers, dot, dash, underscore');
export const password = z.string().min(10, 'At least 10 characters').max(200, 'At most 200 characters');
export const shortText = (max = 120) => z.string().trim().max(max);
export const longText = (max = 10_000) => z.string().max(max);
export const playerRole = z.enum(['rifleman', 'medic', 'support_gunner', 'sniper', 'scout', 'squad_leader', 'radio_operator', 'custom']);

/** Route param as uuid (404 rather than 400 for malformed ids). */
export function idParam(req: Request, name: string): string {
  const v = req.params[name];
  if (typeof v !== 'string' || !/^[0-9a-f-]{36}$/i.test(v)) throw badRequest(tr`Invalid id.`, 'invalid_id');
  return v;
}
