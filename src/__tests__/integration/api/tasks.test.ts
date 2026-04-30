import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import app from '../../../app';
import { prisma } from '../../../lib/prisma';

// Mock the queue so integration tests don't need Redis
vi.mock('../../../queue/task.queue', () => ({
  enqueueTask:    vi.fn().mockResolvedValue({ id: 'job-mock' }),
  closeQueue:     vi.fn(),
  taskQueue:      {},
  TASK_JOB_NAME:  'process',
}));

async function clearDatabase(): Promise<void> {
  await prisma.taskRun.deleteMany();
  await prisma.task.deleteMany();
}

beforeEach(async () => {
  await clearDatabase();
  vi.clearAllMocks();
});

afterAll(async () => {
  await clearDatabase();
  await prisma.$disconnect();
});

// ── POST /api/tasks ───────────────────────────────────────────────────────────

describe('POST /api/tasks', () => {
  it('creates a task and returns 201 with QUEUED status', async () => {
    const res = await request(app)
      .post('/api/tasks')
      .send({ type: 'example', payload: { foo: 'bar' } });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      type:    'example',
      status:  'QUEUED',
      payload: { foo: 'bar' },
    });
    expect(res.body.id).toBeDefined();
    expect(res.body.createdAt).toBeDefined();
  });

  it('returns 400 when type is missing', async () => {
    const res = await request(app)
      .post('/api/tasks')
      .send({ payload: { foo: 'bar' } });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/type/i);
  });

  it('returns 400 when payload is missing', async () => {
    const res = await request(app)
      .post('/api/tasks')
      .send({ type: 'example' });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/payload/i);
  });

  it('returns 400 when payload is an array', async () => {
    const res = await request(app)
      .post('/api/tasks')
      .send({ type: 'example', payload: [1, 2, 3] });

    expect(res.status).toBe(400);
  });

  it('returns 400 for an invalid scheduledAt string', async () => {
    const res = await request(app)
      .post('/api/tasks')
      .send({ type: 'example', payload: {}, scheduledAt: 'not-a-date' });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/scheduledAt/i);
  });

  it('accepts a valid ISO scheduledAt', async () => {
    const res = await request(app)
      .post('/api/tasks')
      .send({ type: 'example', payload: {}, scheduledAt: '2099-01-01T00:00:00.000Z' });

    expect(res.status).toBe(201);
    expect(res.body.scheduledAt).toBe('2099-01-01T00:00:00.000Z');
  });

  it('deduplicates requests sharing an idempotency-key header', async () => {
    const key = `idem-${Date.now()}`;

    const first = await request(app)
      .post('/api/tasks')
      .set('idempotency-key', key)
      .send({ type: 'example', payload: {} });

    const second = await request(app)
      .post('/api/tasks')
      .set('idempotency-key', key)
      .send({ type: 'example', payload: {} });

    expect(first.status).toBe(201);
    expect(second.body.id).toBe(first.body.id);
  });
});

// ── GET /api/tasks/:id ────────────────────────────────────────────────────────

describe('GET /api/tasks/:id', () => {
  it('returns 200 with full task including runs array', async () => {
    const created = await request(app)
      .post('/api/tasks')
      .send({ type: 'example', payload: { x: 1 } });

    const res = await request(app).get(`/api/tasks/${created.body.id}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(created.body.id);
    expect(Array.isArray(res.body.runs)).toBe(true);
  });

  it('returns 404 for a non-existent id', async () => {
    const res = await request(app).get('/api/tasks/00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(404);
  });
});

// ── GET /api/tasks ────────────────────────────────────────────────────────────

describe('GET /api/tasks', () => {
  it('returns 200 with an array of tasks', async () => {
    await request(app).post('/api/tasks').send({ type: 'example', payload: {} });
    await request(app).post('/api/tasks').send({ type: 'example', payload: {} });

    const res = await request(app).get('/api/tasks');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(2);
  });

  it('filters by status', async () => {
    const res = await request(app).get('/api/tasks?status=QUEUED');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    res.body.forEach((t: { status: string }) => expect(t.status).toBe('QUEUED'));
  });

  it('returns 400 for an unrecognised status value', async () => {
    const res = await request(app).get('/api/tasks?status=BOGUS');
    expect(res.status).toBe(400);
  });

  it('respects the limit query param', async () => {
    for (let i = 0; i < 3; i++) {
      await request(app).post('/api/tasks').send({ type: 'example', payload: {} });
    }

    const res = await request(app).get('/api/tasks?limit=2');
    expect(res.status).toBe(200);
    expect(res.body.length).toBeLessThanOrEqual(2);
  });
});

// ── GET /health ───────────────────────────────────────────────────────────────

describe('GET /health', () => {
  it('returns status ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(typeof res.body.uptime).toBe('number');
  });
});

// ── 404 fallback ──────────────────────────────────────────────────────────────

describe('unknown routes', () => {
  it('returns 404 for an unregistered path', async () => {
    const res = await request(app).get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error.message).toBe('Route not found');
  });
});
