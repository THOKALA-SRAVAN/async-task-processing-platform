import { Prisma } from '@prisma/client';
import type { TaskStatus, TaskRun } from '../types/task.types';
import { taskRepository } from '../repositories/task.repository';
import { enqueueTask } from '../queue/task.queue';
import { logger } from '../lib/logger';
import type {
  Task,
  CreateTaskInput,
  TaskResponse,
  TaskRunResponse,
  TaskPayload,
} from '../types/task.types';

// ─── Mappers ──────────────────────────────────────────────────────────────────

function toRunResponse(run: TaskRun): TaskRunResponse {
  return {
    id:            run.id,
    taskId:        run.taskId,
    status:        run.status,
    attemptNumber: run.attemptNumber,
    startedAt:     run.startedAt.toISOString(),
    completedAt:   run.completedAt?.toISOString() ?? null,
    errorMessage:  run.errorMessage ?? null,
  };
}

function toTaskResponse(task: Task & { runs?: TaskRun[] }): TaskResponse {
  return {
    id:             task.id,
    type:           task.type,
    status:         task.status,
    payload:        task.payload as TaskPayload,
    result:         (task.result ?? null) as TaskPayload,
    idempotencyKey: task.idempotencyKey ?? null,
    scheduledAt:    task.scheduledAt?.toISOString() ?? null,
    createdAt:      task.createdAt.toISOString(),
    updatedAt:      task.updatedAt.toISOString(),
    ...(task.runs && { runs: task.runs.map(toRunResponse) }),
  };
}

// ─── Service ──────────────────────────────────────────────────────────────────

export const taskService = {

  async createTask(input: CreateTaskInput): Promise<TaskResponse> {
    // ── Idempotency check ──────────────────────────────────────────────────────
    if (input.idempotencyKey) {
      const existing = await taskRepository.findByIdempotencyKey(input.idempotencyKey);
      if (existing) {
        logger.info(
          { taskId: existing.id, idempotencyKey: input.idempotencyKey },
          'Idempotent request — returning existing task',
        );
        const withRuns = await taskRepository.findByIdWithRuns(existing.id);
        return toTaskResponse(withRuns ?? existing);
      }
    }

    // ── Create task (PENDING) ──────────────────────────────────────────────────
    let task: Task;
    try {
      task = await taskRepository.create(input);
    } catch (err) {
      // Race condition: two requests with the same idempotency key passed the
      // check above simultaneously — DB unique constraint caught the second one
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002' &&
        input.idempotencyKey
      ) {
        const existing = await taskRepository.findByIdempotencyKey(input.idempotencyKey);
        if (existing) {
          logger.info({ taskId: existing.id }, 'Race condition resolved — returning existing task');
          const withRuns = await taskRepository.findByIdWithRuns(existing.id);
          return toTaskResponse(withRuns ?? existing);
        }
      }
      throw err;
    }

    logger.info({ taskId: task.id, type: task.type }, 'Task created');

    // ── Enqueue → QUEUED ───────────────────────────────────────────────────────
    let jobId: string | undefined;

    try {
      const job = await enqueueTask(task.id);
      jobId = job.id;
      logger.info({ taskId: task.id, jobId }, 'Task enqueued');
    } catch (err) {
      // Task remains PENDING — a recovery sweep can re-enqueue PENDING tasks
      logger.error({
        taskId: task.id,
        error: err instanceof Error ? err.message : err,
        stack: err instanceof Error ? err.stack : undefined,
      }, 'Failed to enqueue task');
    }

    if (jobId) {
      try {
        await taskRepository.updateStatus(task.id, 'QUEUED');
      } catch (err) {
        // Job is live in Redis but DB still shows PENDING — worker will process
        // the task but status tracking will be wrong until a reconciliation runs
        logger.error({
          taskId: task.id,
          jobId,
          error: err instanceof Error ? err.message : err,
        }, 'Queue succeeded but status update failed — inconsistent state');
      }
    }

    const updated = await taskRepository.findById(task.id);
    return toTaskResponse(updated ?? task);
  },

  async getTaskById(id: string): Promise<TaskResponse | null> {
    const task = await taskRepository.findByIdWithRuns(id);
    if (!task) return null;
    return toTaskResponse(task);
  },

  async listTasks(options?: {
    status?: TaskStatus;
    limit?:  number;
    offset?: number;
  }): Promise<TaskResponse[]> {
    const tasks = await taskRepository.findMany(options);
    return tasks.map(toTaskResponse);
  },

};
