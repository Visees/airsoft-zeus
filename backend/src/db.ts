import pg from 'pg';
import { config } from './config.js';
import { logger } from './logger.js';

// Return BIGINT/NUMERIC as numbers (balances and counts stay far below 2^53).
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1700, (v) => Number(v));
// DATE as plain YYYY-MM-DD string (no timezone shifting)
pg.types.setTypeParser(1082, (v) => v);

export const pool = new pg.Pool({
  connectionString: config.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});
pool.on('error', (err) => logger.error({ err }, 'idle database client error'));

export type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface Queryable {
  query<R extends Row = Row>(text: string, params?: unknown[]): Promise<pg.QueryResult<R>>;
}

/** A client inside a transaction; `afterCommit` callbacks run only if it commits. */
export interface Tx extends Queryable {
  afterCommit(fn: () => void | Promise<void>): void;
}

export async function query<R extends Row = Row>(text: string, params?: unknown[]): Promise<R[]> {
  const res = await pool.query<R>(text, params);
  return res.rows;
}

export async function one<R extends Row = Row>(text: string, params?: unknown[], q: Queryable = pool): Promise<R | null> {
  const res = await q.query<R>(text, params);
  return res.rows[0] ?? null;
}

export async function many<R extends Row = Row>(text: string, params?: unknown[], q: Queryable = pool): Promise<R[]> {
  const res = await q.query<R>(text, params);
  return res.rows;
}

const RETRYABLE = new Set(['40001', '40P01']); // serialization failure, deadlock

/**
 * Run `fn` in a transaction. Retries on serialization failures/deadlocks.
 * Side effects that must only happen after commit (socket emits, push) go in tx.afterCommit.
 */
export async function tx<T>(fn: (t: Tx) => Promise<T>, attempts = 3): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const client = await pool.connect();
    const after: (() => void | Promise<void>)[] = [];
    const t: Tx = {
      query: (text, params) => client.query(text, params as unknown[]),
      afterCommit: (cb) => after.push(cb),
    };
    try {
      await client.query('BEGIN');
      const result = await fn(t);
      await client.query('COMMIT');
      client.release();
      for (const cb of after) {
        try {
          await cb();
        } catch (err) {
          logger.error({ err }, 'afterCommit callback failed');
        }
      }
      return result;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* connection may be broken */
      }
      client.release();
      const code = (err as { code?: string }).code;
      if (code && RETRYABLE.has(code) && attempt < attempts) {
        await new Promise((r) => setTimeout(r, 20 * attempt + Math.random() * 30));
        continue;
      }
      throw err;
    }
  }
}

/** Run with a session-level advisory lock; returns null when another instance holds it. */
export async function withAdvisoryLock<T>(key: number, fn: () => Promise<T>): Promise<T | null> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ ok: boolean }>('SELECT pg_try_advisory_lock($1) AS ok', [key]);
    if (!rows[0]?.ok) return null;
    try {
      return await fn();
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [key]);
    }
  } finally {
    client.release();
  }
}
