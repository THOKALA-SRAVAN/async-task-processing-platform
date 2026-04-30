import type { RedisOptions } from 'ioredis';
import { config } from '../config';

function parseRedisUrl(url: string): RedisOptions {
  const { hostname, port, password, pathname } = new URL(url);
  return {
    host:     hostname,
    port:     port ? parseInt(port, 10) : 6379,
    password: password || undefined,
    db:       pathname.length > 1 ? parseInt(pathname.slice(1), 10) : 0,
    // Required by BullMQ — disables ioredis retry so BullMQ controls retry logic
    maxRetriesPerRequest: null,
  };
}

// Export connection options, not a shared instance.
// BullMQ creates its own internal connections per Queue/Worker —
// sharing a single IORedis client causes issues with blocking commands.
export const redisConnection: RedisOptions = parseRedisUrl(config.redis.url);
