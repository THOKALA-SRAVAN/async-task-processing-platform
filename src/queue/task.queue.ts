import { Queue } from 'bullmq';
import type { Job } from 'bullmq';
import { config } from '../config';
import { redisConnection } from '../lib/redis';
import type { TaskJobData } from '../types/task.types';

export const TASK_JOB_NAME = 'process' as const;

export const taskQueue = new Queue<TaskJobData, void, typeof TASK_JOB_NAME>(config.queue.name, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: config.queue.jobAttempts,
    backoff: {
      type:  'exponential',
      delay: config.queue.jobBackoff,
    },
    removeOnComplete: { count: 1000 },
    removeOnFail:     { count: 5000 },
  },
});

export async function enqueueTask(taskId: string): Promise<Job<TaskJobData, void, typeof TASK_JOB_NAME>> {
  return taskQueue.add(TASK_JOB_NAME, { taskId }, { jobId: taskId });
}

export async function closeQueue(): Promise<void> {
  await taskQueue.close();
}
