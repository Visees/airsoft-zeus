import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pool } from './db.js';
import { logger } from './logger.js';

/**
 * The base schema is created by docker/postgres/init/01-schema.sql on a fresh volume.
 * Later changes go in backend/migrations/NNNN-name.sql and are applied here, once, in order.
 */
export async function migrate(dir = resolve(import.meta.dirname, '../migrations')): Promise<void> {
  const exists = await pool.query(`SELECT to_regclass('public.schema_migrations') AS t`);
  if (!exists.rows[0]?.t) throw new Error('Database schema missing: run docker/postgres/init/01-schema.sql first.');
  let files: string[] = [];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  } catch {
    return;
  }
  for (const file of files) {
    const done = await pool.query('SELECT 1 FROM schema_migrations WHERE name = $1', [file]);
    if (done.rowCount) continue;
    const sql = await readFile(resolve(dir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      logger.info({ file }, 'migration applied');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}
