import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';
import type { Task, TaskRun } from '../../../types/task.types';

vi.mock('../../../repositories/task.repository', () => ({
  taskRepository: {
    findById:     vi.fn(),
    updateStatus: vi.fn(),
    complete:     vi.fn(),
    fail:         vi.fn(),
  },
}));

vi.mock('../../../repositories/taskRun.repository', () => ({
  taskRunRepository: {
    create:   vi.fn(),
    complete: vi.fn(),
    fail:     vi.fn(),
  },
}));

vi.mock('../../../lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import { taskRepository } from '../../../repositories/task.repository';
import { taskRunRepository } from '../../../repositories/taskRun.repository';
import { processTask } from '../../../worker/processors/task.processor';

const taskRepo = vi.mocked(taskRepository);
const runRepo  = vi.mocked(taskRunRepository);

function makeJob(overrides: Partial<{
  id: string;
  data: { taskId: string };
  attemptsMade: number;
  opts: { attempts: number };
}> = {}): Job {
  return {
    id:           'job-1',
    data:         { taskId: 'task-1' },
    attemptsMade: 0,
    opts:         { attempts: 3 },
    ...overrides,
  } as unknown as Job;
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id:             'task-1',
    type:           'example',
    status:         'QUEUED',
    payload:        { key: 'value' },
    result:         null,
    idempotencyKey: null,
    scheduledAt:    null,
    createdAt:      new Date(),
    updatedAt:      new Date(),
    ...overrides,
  } as Task;
}

function makeRun(): TaskRun {
  return {
    id:            'run-1',
    taskId:        'task-1',
    status:        'PROCESSING',
    attemptNumber: 1,
    startedAt:     new Date(),
    completedAt:   null,
    errorMessage:  null,
  } as TaskRun;
}

describe('processTask', () => {
  beforeEach(() => vi.clearAllMocks());

  it('processes an example task successfully', async () => {
    taskRepo.findById.mockResolvedValue(makeTask());
    taskRepo.updateStatus.mockResolvedValue(makeTask({ status: 'PROCESSING' }));
    runRepo.create.mockResolvedValue(makeRun());
    runRepo.complete.mockResolvedValue(makeRun());
    taskRepo.complete.mockResolvedValue(makeTask({ status: 'COMPLETED' }));

    await processTask(makeJob());

    expect(taskRepo.updateStatus).toHaveBeenCalledWith('task-1', 'PROCESSING');
    expect(runRepo.create).toHaveBeenCalledWith('task-1', 1);
    expect(runRepo.complete).toHaveBeenCalledWith('run-1');
    expect(taskRepo.complete).toHaveBeenCalledWith('task-1', expect.objectContaining({ processed: true }));
  });

  it('skips updateStatus when task is already PROCESSING', async () => {
    taskRepo.findById.mockResolvedValue(makeTask({ status: 'PROCESSING' }));
    runRepo.create.mockResolvedValue(makeRun());
    runRepo.complete.mockResolvedValue(makeRun());
    taskRepo.complete.mockResolvedValue(makeTask({ status: 'COMPLETED' }));

    await processTask(makeJob());

    expect(taskRepo.updateStatus).not.toHaveBeenCalled();
  });

  it('throws for an orphaned job (task row deleted)', async () => {
    taskRepo.findById.mockResolvedValue(null);

    await expect(processTask(makeJob())).rejects.toThrow('Task task-1 not found');
    expect(runRepo.create).not.toHaveBeenCalled();
  });

  it('returns early without creating a run for an already-finalized task', async () => {
    taskRepo.findById.mockResolvedValue(makeTask({ status: 'COMPLETED' }));

    await processTask(makeJob());

    expect(runRepo.create).not.toHaveBeenCalled();
    expect(taskRepo.complete).not.toHaveBeenCalled();
  });

  it('fails run and rethrows on handler error but does NOT fail task on non-last attempt', async () => {
    taskRepo.findById.mockResolvedValue(makeTask({ type: 'unregistered_type' }));
    taskRepo.updateStatus.mockResolvedValue(makeTask({ status: 'PROCESSING' }));
    runRepo.create.mockResolvedValue(makeRun());
    runRepo.fail.mockResolvedValue(makeRun());

    // attempt 1 of 3
    await expect(processTask(makeJob({ attemptsMade: 0, opts: { attempts: 3 } }))).rejects.toThrow();

    expect(runRepo.fail).toHaveBeenCalledWith('run-1', expect.any(String));
    expect(taskRepo.fail).not.toHaveBeenCalled();
  });

  it('fails task permanently on the last attempt', async () => {
    taskRepo.findById.mockResolvedValue(makeTask({ type: 'unregistered_type' }));
    taskRepo.updateStatus.mockResolvedValue(makeTask({ status: 'PROCESSING' }));
    runRepo.create.mockResolvedValue(makeRun());
    runRepo.fail.mockResolvedValue(makeRun());
    taskRepo.fail.mockResolvedValue(makeTask({ status: 'FAILED' }));

    // attempt 3 of 3 — last attempt
    await expect(processTask(makeJob({ attemptsMade: 2, opts: { attempts: 3 } }))).rejects.toThrow();

    expect(taskRepo.fail).toHaveBeenCalledWith('task-1');
  });
});
