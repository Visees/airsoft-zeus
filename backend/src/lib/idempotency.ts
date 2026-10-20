import type { Tx } from '../db.js';

/**
 * Idempotent action inside a transaction. The first call with (userId, clientTxId) runs
 * `fn` and stores its JSON result in the same transaction; any retry returns the stored
 * result without running `fn` again. Concurrent duplicates block on the row lock and then
 * see the stored result.
 */
export async function idempotent<T>(t: Tx, userId: string, clientTxId: string, action: string, fn: () => Promise<T>): Promise<{ result: T; replayed: boolean }> {
  // Take a transaction-scoped lock on the key so concurrent duplicates serialise.
  await t.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${userId}:${clientTxId}`]);
  const existing = await t.query<{ action: string; response: T }>('SELECT action, response FROM idempotency_keys WHERE user_id = $1 AND key = $2', [
    userId,
    clientTxId,
  ]);
  if (existing.rows[0]) {
    return { result: existing.rows[0].response, replayed: true };
  }
  const result = await fn();
  await t.query('INSERT INTO idempotency_keys (user_id, key, action, response) VALUES ($1, $2, $3, $4)', [
    userId,
    clientTxId,
    action,
    JSON.stringify(result ?? null),
  ]);
  return { result, replayed: false };
}
