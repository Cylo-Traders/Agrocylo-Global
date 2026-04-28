import { Redis, type Redis as RedisClient } from "ioredis";
import { config } from "../config/index.js";

export function createRedisConnection(): RedisClient {
  // BullMQ expects an ioredis instance (or connection options).
  return new Redis(config.redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}

