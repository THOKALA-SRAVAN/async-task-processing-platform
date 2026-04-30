import type { Task, TaskRun, TaskStatus, RunStatus } from '@prisma/client';

// Re-export Prisma types — application code imports from here, not @prisma/client directly
export type { Task, TaskRun, TaskStatus, RunStatus };

// ─── Payload ──────────────────────────────────────────────────────────────────

// Aligns with Prisma's Json? field — nullable because result is optional on Task
export type TaskPayload = Record<string, unknown> | null;

// ─── Queue ────────────────────────────────────────────────────────────────────

// Data serialized into the BullMQ job — taskId only.
// The worker fetches the full task from the DB to avoid stale payload issues.
export interface TaskJobData {
  taskId: string;
}

// ─── Service inputs ───────────────────────────────────────────────────────────

export interface CreateTaskInput {
  type: string;
  payload: NonNullable<TaskPayload>;  // payload is required on creation
  idempotencyKey?: string;
  scheduledAt?: Date;
}

// ─── API responses ────────────────────────────────────────────────────────────

export interface TaskResponse {
  id:             string;
  type:           string;
  status:         TaskStatus;
  payload:        TaskPayload;
  result:         TaskPayload | null;
  idempotencyKey: string | null;
  scheduledAt:    string | null;
  createdAt:      string;
  updatedAt:      string;
  runs?:          TaskRunResponse[];
}

export interface TaskRunResponse {
  id:            string;
  taskId:        string;
  status:        RunStatus;
  attemptNumber: number;
  startedAt:     string;
  completedAt:   string | null;
  errorMessage:  string | null;
}
