import { createServer } from 'node:http';
import { createApp } from './app.js';
import { config } from './config.js';
import { pool } from './db.js';
import { startEngine, stopEngine } from './domain/tick.js';
import { logger } from './logger.js';
import { migrate } from './migrate.js';
import { closeRealtime, initRealtime } from './realtime/hub.js';

async function waitForDatabase(attempts = 30): Promise<void> {
  for (let i = 1; ; i++) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (err) {
      if (i >= attempts) throw err;
      logger.warn({ attempt: i }, 'database not ready, retrying');
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

async function main(): Promise<void> {
  await waitForDatabase();
  await migrate();
  if (config.SEED_DEMO_DATA) {
    const { seedIfEmpty } = await import('./seed/seed.js');
    await seedIfEmpty();
  }
  const server = createServer(createApp());
  initRealtime(server);
  startEngine();
  server.listen(config.PORT, () => logger.info({ port: config.PORT }, 'AirsoftHub API listening'));

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down');
    stopEngine();
    server.close();
    await closeRealtime();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  logger.fatal({ err }, 'failed to start');
  process.exit(1);
});
