import { prisma } from '../lib/prisma';
import type { TaskRun } from '../types/task.types';

export const taskRunRepository = {

  async create(taskId: string, attemptNumber: number): Promise<TaskRun> {
    return prisma.taskRun.create({
      data: {
        taskId,
        status:        'PROCESSING',
        attemptNumber,
      },
    });
  },

  async complete(id: string): Promise<TaskRun> {
    return prisma.taskRun.update({
      where: { id },
      data: {
        status:      'COMPLETED',
        completedAt: new Date(),
      },
    });
  },

  async fail(id: string, errorMessage: string): Promise<TaskRun> {
    return prisma.taskRun.update({
      where: { id },
      data: {
        status:       'FAILED',
        completedAt:  new Date(),
        errorMessage,
      },
    });
  },

  async findByTaskId(taskId: string): Promise<TaskRun[]> {
    return prisma.taskRun.findMany({
      where:   { taskId },
      orderBy: { startedAt: 'desc' },
    });
  },

};
