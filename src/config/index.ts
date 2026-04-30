import dotenv from 'dotenv';
dotenv.config();

function required(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}

function optional(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

function toNumber(key: string, fallback: string): number {
  const raw = process.env[key] ?? fallback;
  const num = Number(raw);
  if (isNaN(num)) throw new Error(`Invalid number for ${key}: "${raw}"`);
  return num;
}

function validateEnum<T extends readonly string[]>(
  value: string,
  allowed: T,
  key: string,
): T[number] {
  if (!allowed.includes(value)) {
    throw new Error(`Invalid value for ${key}: "${value}". Allowed: ${allowed.join(', ')}`);
  }
  return value as T[number];
}

export const config = {
  env:      validateEnum(optional('NODE_ENV', 'development'), ['development', 'production', 'test'] as const, 'NODE_ENV'),
  port:     toNumber('PORT', '3000'),
  logLevel: optional('LOG_LEVEL', 'info'),

  database: {
    url: required('DATABASE_URL'),
  },

  redis: {
    url: required('REDIS_URL'),
  },

  queue: {
    name:              optional('QUEUE_NAME', 'tasks'),
    workerConcurrency: toNumber('WORKER_CONCURRENCY', '5'),
    jobAttempts:       toNumber('JOB_ATTEMPTS',       '3'),
    jobBackoff:        toNumber('JOB_BACKOFF',         '2000'),
  },

  rateLimit: {
    windowMs: toNumber('RATE_LIMIT_WINDOW_MS', '60000'),
    max:      toNumber('RATE_LIMIT_MAX',        '60'),
  },
} as const;
