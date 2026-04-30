import type { Job } from 'bullmq';
import { taskRepository } from '../../repositories/task.repository';
import { taskRunRepository } from '../../repositories/taskRun.repository';
import { logger } from '../../lib/logger';
import type { TaskJobData, TaskPayload } from '../../types/task.types';

// ─── Handler registry ─────────────────────────────────────────────────────────

type TaskHandler = (payload: Record<string, unknown>) => Promise<Record<string, unknown>>;

const handlers: Record<string, TaskHandler> = {
  example: async (payload) => {
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    return { processed: true, receivedKeys: Object.keys(payload) };
  },
};

// ─── Processor ────────────────────────────────────────────────────────────────

export async function processTask(job: Job<TaskJobData>): Promise<void> {
  const { taskId }     = job.data;
  const attemptNumber  = job.attemptsMade + 1;               // 1-indexed for task_runs
  const isLastAttempt  = attemptNumber >= (job.opts.attempts ?? 1);

  logger.info({ taskId, jobId: job.id, attemptNumber }, 'Processing task');

  // ── Fetch task ───────────────────────────────────────────────────────────────
  const task = await taskRepository.findById(taskId);
  if (!task) {
    // Job outlived its task row — no run record needed
    logger.error({ taskId, jobId: job.id }, 'Task not found — orphaned job');
    throw new Error(`Task ${taskId} not found`);
  }

  // Protect against rare double-execution (e.g. Redis re-delivery after a crash)
  if (task.status === 'COMPLETED' || task.status === 'FAILED') {
    logger.warn({ taskId, jobId: job.id, status: task.status }, 'Skipping already finalized task');
    return;
  }

  // ── Open a task_run for this attempt ─────────────────────────────────────────
  if (task.status !== 'PROCESSING') {
    await taskRepository.updateStatus(taskId, 'PROCESSING');
  }
  const run = await taskRunRepository.create(taskId, attemptNumber);

  // ── Execute ───────────────────────────────────────────────────────────────────
  try {
    const handler = handlers[task.type];
    if (!handler) {
      throw new Error(`No handler registered for task type: "${task.type}"`);
    }

    const result = await handler(task.payload as Record<string, unknown>);

    // ── Success ───────────────────────────────────────────────────────────────
    await taskRunRepository.complete(run.id);
    await taskRepository.complete(taskId, result as TaskPayload);

    logger.info({ taskId, jobId: job.id, attemptNumber }, 'Task completed');

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);

    // ── Failure ───────────────────────────────────────────────────────────────
    await taskRunRepository.fail(run.id, errorMessage);

    logger.error({
      taskId,
      jobId:         job.id,
      attemptNumber,
      error:         errorMessage,
      stack:         err instanceof Error ? err.stack : undefined,
    }, 'Task execution failed');

    if (isLastAttempt) {
      await taskRepository.fail(taskId);
      logger.error({ taskId, jobId: job.id, attemptNumber }, 'Task failed permanently');
    } else {
      const retriesLeft = (job.opts.attempts ?? 1) - attemptNumber;
      logger.warn({ taskId, jobId: job.id, attemptNumber, retriesLeft }, 'Task attempt failed — will retry');
    }

    throw err; // re-throw so BullMQ triggers backoff and retry
  }
}
