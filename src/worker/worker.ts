import { Worker } from 'bullmq';
import { config } from '../config';
import { redisConnection } from '../lib/redis';
import { logger } from '../lib/logger';
import { disconnectPrisma } from '../lib/prisma';
import { processTask } from './processors/task.processor';

// ── Worker ────────────────────────────────────────────────────────────────────

const worker = new Worker(config.queue.name, processTask, {
  connection:  redisConnection,
  concurrency: config.queue.workerConcurrency,
});

logger.info(
  { queue: config.queue.name, concurrency: config.queue.workerConcurrency },
  'Worker started',
);

// ── Events ────────────────────────────────────────────────────────────────────

worker.on('completed', (job) => {
  logger.info({ taskId: job.data.taskId, jobId: job.id }, 'Job completed');
});

worker.on('failed', (job, err) => {
  if (!job) return;
  logger.error({
    taskId:       job.data.taskId,
    jobId:        job.id,
    attemptsMade: job.attemptsMade,
    error:        err.message,
  }, 'Job failed');
});

worker.on('error', (err) => {
  logger.error({ error: err.message, stack: err.stack }, 'Worker connection error');
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────

const SHUTDOWN_TIMEOUT_MS = 10_000;

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Worker shutdown signal received');

  const forceExit = setTimeout(() => {
    logger.error('Worker shutdown timed out — forcing exit');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  // worker.close() waits for the active job to finish before stopping
  await worker.close();
  await disconnectPrisma();
  clearTimeout(forceExit);
  logger.info('Worker shut down cleanly');
  process.exit(0);
}

process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
process.on('SIGINT',  () => { void shutdown('SIGINT'); });
