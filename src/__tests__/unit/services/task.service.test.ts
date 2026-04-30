import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';
import type { Task, TaskRun } from '../../../types/task.types';

vi.mock('../../../repositories/task.repository', () => ({
  taskRepository: {
    findByIdempotencyKey: vi.fn(),
    findByIdWithRuns:     vi.fn(),
    create:              vi.fn(),
    findById:            vi.fn(),
    updateStatus:        vi.fn(),
    complete:            vi.fn(),
    fail:                vi.fn(),
    findMany:            vi.fn(),
  },
}));

vi.mock('../../../queue/task.queue', () => ({
  enqueueTask: vi.fn(),
}));

vi.mock('../../../lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { taskRepository } from '../../../repositories/task.repository';
import { enqueueTask } from '../../../queue/task.queue';
import { taskService } from '../../../services/task.service';

const repo    = vi.mocked(taskRepository);
const enqueue = vi.mocked(enqueueTask);

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id:             'task-1',
    type:           'example',
    status:         'PENDING',
    payload:        { key: 'value' },
    result:         null,
    idempotencyKey: null,
    scheduledAt:    null,
    createdAt:      new Date('2024-01-01T00:00:00Z'),
    updatedAt:      new Date('2024-01-01T00:00:00Z'),
    ...overrides,
  } as Task;
}

function makeRun(overrides: Partial<TaskRun> = {}): TaskRun {
  return {
    id:            'run-1',
    taskId:        'task-1',
    status:        'COMPLETED',
    attemptNumber: 1,
    startedAt:     new Date('2024-01-01T00:00:00Z'),
    completedAt:   new Date('2024-01-01T00:00:01Z'),
    errorMessage:  null,
    ...overrides,
  } as TaskRun;
}

describe('taskService', () => {
  beforeEach(() => vi.clearAllMocks());

  // ── createTask ───────────────────────────────────────────────────────────────

  describe('createTask', () => {
    it('creates, enqueues, and returns a QUEUED task', async () => {
      const pending = makeTask();
      const queued  = makeTask({ status: 'QUEUED' });

      repo.create.mockResolvedValue(pending);
      enqueue.mockResolvedValue({ id: 'job-1' } as any);
      repo.updateStatus.mockResolvedValue(queued);
      repo.findById.mockResolvedValue(queued);

      const result = await taskService.createTask({ type: 'example', payload: { key: 'value' } });

      expect(repo.create).toHaveBeenCalledOnce();
      expect(enqueue).toHaveBeenCalledWith('task-1');
      expect(repo.updateStatus).toHaveBeenCalledWith('task-1', 'QUEUED');
      expect(result.status).toBe('QUEUED');
    });

    it('returns existing task on idempotency key hit', async () => {
      const existing         = makeTask({ status: 'QUEUED', idempotencyKey: 'key-abc' });
      const existingWithRuns = { ...existing, runs: [makeRun()] };

      repo.findByIdempotencyKey.mockResolvedValue(existing);
      repo.findByIdWithRuns.mockResolvedValue(existingWithRuns);

      const result = await taskService.createTask({
        type:           'example',
        payload:        {},
        idempotencyKey: 'key-abc',
      });

      expect(repo.create).not.toHaveBeenCalled();
      expect(enqueue).not.toHaveBeenCalled();
      expect(result.id).toBe('task-1');
      expect(result.runs).toHaveLength(1);
    });

    it('resolves idempotency race condition on P2002 error', async () => {
      const existing         = makeTask({ status: 'QUEUED', idempotencyKey: 'key-abc' });
      const existingWithRuns = { ...existing, runs: [] };
      const p2002 = new Prisma.PrismaClientKnownRequestError('Unique constraint', {
        code:          'P2002',
        clientVersion: '5.0.0',
        meta:          {},
      });

      repo.findByIdempotencyKey
        .mockResolvedValueOnce(null)     // first check: no duplicate
        .mockResolvedValueOnce(existing); // race resolution
      repo.create.mockRejectedValue(p2002);
      repo.findByIdWithRuns.mockResolvedValue(existingWithRuns);

      const result = await taskService.createTask({
        type:           'example',
        payload:        {},
        idempotencyKey: 'key-abc',
      });

      expect(result.id).toBe('task-1');
    });

    it('returns PENDING task and does not throw when enqueue fails', async () => {
      const pending = makeTask();
      repo.create.mockResolvedValue(pending);
      enqueue.mockRejectedValue(new Error('Redis connection refused'));
      repo.findById.mockResolvedValue(pending);

      const result = await taskService.createTask({ type: 'example', payload: {} });

      expect(repo.updateStatus).not.toHaveBeenCalled();
      expect(result.status).toBe('PENDING');
    });

    it('logs inconsistent state when updateStatus fails after successful enqueue', async () => {
      const { logger } = await import('../../../lib/logger');
      const pending = makeTask();

      repo.create.mockResolvedValue(pending);
      enqueue.mockResolvedValue({ id: 'job-1' } as any);
      repo.updateStatus.mockRejectedValue(new Error('DB gone'));
      repo.findById.mockResolvedValue(pending);

      await taskService.createTask({ type: 'example', payload: {} });

      expect(vi.mocked(logger).error).toHaveBeenCalledWith(
        expect.objectContaining({ jobId: 'job-1' }),
        expect.stringContaining('inconsistent'),
      );
    });
  });

  // ── getTaskById ──────────────────────────────────────────────────────────────

  describe('getTaskById', () => {
    it('returns task response with runs when found', async () => {
      const task = makeTask({ status: 'COMPLETED' });
      repo.findByIdWithRuns.mockResolvedValue({ ...task, runs: [makeRun()] });

      const result = await taskService.getTaskById('task-1');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('task-1');
      expect(result!.runs).toHaveLength(1);
    });

    it('returns null when task is not found', async () => {
      repo.findByIdWithRuns.mockResolvedValue(null);
      const result = await taskService.getTaskById('nonexistent');
      expect(result).toBeNull();
    });
  });

  // ── listTasks ────────────────────────────────────────────────────────────────

  describe('listTasks', () => {
    it('returns array of task responses', async () => {
      repo.findMany.mockResolvedValue([makeTask(), makeTask({ id: 'task-2' })]);
      const result = await taskService.listTasks();
      expect(result).toHaveLength(2);
    });

    it('passes filter options to repository', async () => {
      repo.findMany.mockResolvedValue([]);
      await taskService.listTasks({ status: 'COMPLETED', limit: 10, offset: 5 });
      expect(repo.findMany).toHaveBeenCalledWith({ status: 'COMPLETED', limit: 10, offset: 5 });
    });
  });
});
