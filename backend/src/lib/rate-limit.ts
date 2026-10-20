import { RateLimiterMemory, RateLimiterRes } from 'rate-limiter-flexible';
import { tooMany } from '../errors.js';

/**
 * In-process rate limits. The API runs as a single instance (see docs/ARCHITECTURE.md);
 * moving to several instances means switching these to RateLimiterPostgres/Redis.
 */
const limiters = new Map<string, RateLimiterMemory>();

function limiter(name: string, points: number, durationSec: number): RateLimiterMemory {
  const key = `${name}:${points}:${durationSec}`;
  let l = limiters.get(key);
  if (!l) {
    l = new RateLimiterMemory({ keyPrefix: name, points, duration: durationSec });
    limiters.set(key, l);
  }
  return l;
}

/** Consume one point or throw 429 with a "retry in N s" message. */
export async function consume(name: string, key: string, points: number, durationSec: number, message?: string): Promise<void> {
  try {
    await limiter(name, points, durationSec).consume(key);
  } catch (e) {
    if (e instanceof RateLimiterRes) {
      const wait = Math.ceil(e.msBeforeNext / 1000);
      throw tooMany(message ?? `Too many attempts. Try again in ${wait} s.`);
    }
    throw e;
  }
}

/** Remaining points without consuming. */
export async function remaining(name: string, key: string, points: number, durationSec: number): Promise<number> {
  const res = await limiter(name, points, durationSec).get(key);
  return res ? Math.max(0, points - res.consumedPoints) : points;
}

export async function reset(name: string, key: string, points: number, durationSec: number): Promise<void> {
  await limiter(name, points, durationSec).delete(key);
}
