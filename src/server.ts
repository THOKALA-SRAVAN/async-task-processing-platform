import { config } from './config';
import { logger } from './lib/logger';
import { disconnectPrisma } from './lib/prisma';
import { closeQueue } from './queue/task.queue';
import app from './app';

// ── Start ─────────────────────────────────────────────────────────────────────
const server = app.listen(config.port, () => {
  logger.info(
    { env: config.env, port: config.port, queue: config.queue.name },
    'Server started',
  );
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────
const SHUTDOWN_TIMEOUT_MS = 10_000;

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Shutdown signal received');

  const forceExit = setTimeout(() => {
    logger.error('Shutdown timed out — forcing exit');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  server.close(async () => {
    await Promise.all([disconnectPrisma(), closeQueue()]);
    clearTimeout(forceExit);
    logger.info('Server shut down cleanly');
    process.exit(0);
  });
}

process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
process.on('SIGINT',  () => { void shutdown('SIGINT'); });
