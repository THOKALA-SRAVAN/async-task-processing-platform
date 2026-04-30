import type { Request, Response, NextFunction } from 'express';
import { taskService } from '../../services/task.service';
import type { CreateTaskInput, TaskStatus } from '../../types/task.types';

const VALID_STATUSES: TaskStatus[] = ['PENDING', 'QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED'];

export const taskController = {

  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { type, payload, idempotencyKey, scheduledAt } = req.body;

      if (!type || typeof type !== 'string') {
        res.status(400).json({ error: { message: 'type is required and must be a string' } });
        return;
      }

      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        res.status(400).json({ error: { message: 'payload is required and must be a plain object' } });
        return;
      }

      let parsedScheduledAt: Date | undefined;
      if (scheduledAt !== undefined) {
        parsedScheduledAt = new Date(scheduledAt);
        if (isNaN(parsedScheduledAt.getTime())) {
          res.status(400).json({ error: { message: 'scheduledAt must be a valid ISO date string' } });
          return;
        }
      }

      // Header takes precedence over body field
      const headerKey = req.headers['idempotency-key'];
      const resolvedKey =
        (typeof headerKey === 'string' ? headerKey : undefined) ??
        (typeof idempotencyKey === 'string' ? idempotencyKey : undefined);

      const input: CreateTaskInput = {
        type,
        payload,
        idempotencyKey: resolvedKey,
        scheduledAt:    parsedScheduledAt,
      };

      const task = await taskService.createTask(input);
      res.status(201).json(task);
    } catch (err) {
      next(err);
    }
  },

  async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      if (!id || typeof id !== 'string') {
        res.status(400).json({ error: { message: 'id param is required and must be a string' } });
        return;
      }

      const task = await taskService.getTaskById(id);
      if (!task) {
        res.status(404).json({ error: { message: 'Task not found' } });
        return;
      }
      res.json(task);
    } catch (err) {
      next(err);
    }
  },

  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { status, limit, offset } = req.query;

      if (status !== undefined && !VALID_STATUSES.includes(status as TaskStatus)) {
        res.status(400).json({
          error: { message: `Invalid status. Allowed: ${VALID_STATUSES.join(', ')}` },
        });
        return;
      }

      const limitNum  = limit  ? Math.min(Math.max(1, Number(limit)),  100) : 20;
      const offsetNum = offset ? Math.max(0, Number(offset))                : 0;

      const tasks = await taskService.listTasks({
        status: status as TaskStatus | undefined,
        limit:  isNaN(limitNum)  ? 20 : limitNum,
        offset: isNaN(offsetNum) ? 0  : offsetNum,
      });

      res.json(tasks);
    } catch (err) {
      next(err);
    }
  },

};
