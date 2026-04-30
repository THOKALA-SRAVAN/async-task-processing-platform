import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import type { Task, TaskStatus, CreateTaskInput, TaskPayload } from '../types/task.types';

export const taskRepository = {

  // For atomic multi-step operations (create task + update status after enqueue),
  // callers should use prisma.$transaction([...]) at the service layer rather than
  // calling individual repository methods in sequence.
  async create(input: CreateTaskInput): Promise<Task> {
    return prisma.task.create({
      data: {
        type:           input.type,
        payload:        input.payload as Prisma.InputJsonValue,
        idempotencyKey: input.idempotencyKey ?? null,
        scheduledAt:    input.scheduledAt    ?? null,
        status:         'PENDING',
      },
    });
  },

  async findById(id: string): Promise<Task | null> {
    return prisma.task.findUnique({ where: { id } });
  },

  async findByIdempotencyKey(key: string): Promise<Task | null> {
    return prisma.task.findUnique({ where: { idempotencyKey: key } });
  },

  async findByIdWithRuns(id: string) {
    return prisma.task.findUnique({
      where:   { id },
      include: { runs: { orderBy: { startedAt: 'desc' } } },
    });
  },

  async updateStatus(id: string, status: TaskStatus): Promise<Task> {
    return prisma.task.update({
      where: { id },
      data:  { status, updatedAt: new Date() },
    });
  },

  async complete(id: string, result: TaskPayload): Promise<Task> {
    return prisma.task.update({
      where: { id },
      data: {
        status:    'COMPLETED',
        result:    result !== null ? result as Prisma.InputJsonValue : Prisma.JsonNull,
        updatedAt: new Date(),
      },
    });
  },

  async fail(id: string): Promise<Task> {
    return prisma.task.update({
      where: { id },
      data:  { status: 'FAILED', updatedAt: new Date() },
    });
  },

  async findMany(options?: {
    status?: TaskStatus;
    limit?:  number;
    offset?: number;
  }): Promise<Task[]> {
    return prisma.task.findMany({
      where:   options?.status ? { status: options.status } : undefined,
      orderBy: { createdAt: 'desc' },
      take:    options?.limit  ?? 20,
      skip:    options?.offset ?? 0,
    });
  },

};
