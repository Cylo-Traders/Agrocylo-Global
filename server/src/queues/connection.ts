import { config } from "../config/index.js";

export interface ConnectionOptions {
  host?: string;
  port?: number;
  password?: string;
  maxRetriesPerRequest?: number | null;
  enableReadyCheck?: boolean;
}

/**
 * Returns BullMQ connection options parsed from the configured Redis URL.
 * We return plain options (not a Redis instance) to avoid ioredis version
 * conflicts between the top-level package and BullMQ's bundled copy.
 */
export function createRedisConnection(): ConnectionOptions {
  const url = new URL(config.redisUrl);
  return {
    host: url.hostname,
    port: Number(url.port) || 6379,
    password: url.password || undefined,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  };
}
