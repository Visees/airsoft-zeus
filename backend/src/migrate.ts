import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { PoolClient } from 'pg';
import { pool } from './db.js';
import { logger } from './logger.js';

async function inTransaction(sql: string, after?: (client: PoolClient) => Promise<unknown>): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    if (after) await after(client);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * On an empty database the base schema (backend/schema.sql) is applied first.
 * Later changes go in backend/migrations/NNNN-name.sql and are applied here, once, in order.
 */
export async function migrate(
  dir = resolve(import.meta.dirname, '../migrations'),
  schemaFile = resolve(import.meta.dirname, '../schema.sql'),
): Promise<void> {
  const exists = await pool.query(`SELECT to_regclass('public.schema_migrations') AS t`);
  if (!exists.rows[0]?.t) {
    await inTransaction(await readFile(schemaFile, 'utf8'));
    logger.info('base schema applied');
  }
  let files: string[] = [];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  } catch {
    return;
  }
  for (const file of files) {
    const done = await pool.query('SELECT 1 FROM schema_migrations WHERE name = $1', [file]);
    if (done.rowCount) continue;
    await inTransaction(await readFile(resolve(dir, file), 'utf8'), (client) =>
      client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]),
    );
    logger.info({ file }, 'migration applied');
  }
}
