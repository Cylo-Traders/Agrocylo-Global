import type Redis from 'ioredis';
import logger from '../config/logger.js';

export interface RateLimitOptions {
  windowMs: number;
  max?: number;
}

export interface RateLimitStoreValue {
  totalHits: number;
  resetTime?: Date;
}

/**
 * Creates a Redis-backed rate-limit store for express-rate-limit.
 * Uses atomic Lua script to ensure concurrent increments are counted correctly
 * across multiple server instances.
 *
 * Degradation policy: FAIL CLOSED
 * If Redis is unavailable at request time, requests are rejected to prevent
 * rate limit bypass. This prioritizes safety (ensuring limits are enforced)
 * over availability (allowing requests through when enforcement cannot be guaranteed).
 */
export function createRateLimitStore(redisClient: Redis) {
  // Lua script for atomic increment + expire in a single operation
  // Returns [current_count, expires_at_ms]
  const incrWithExpireScript = `
    local key = KEYS[1]
    local window_ms = tonumber(ARGV[1])

    local current = redis.call('INCR', key)
    if current == 1 then
      redis.call('PEXPIRE', key, window_ms)
    end

    local pttl = redis.call('PTTL', key)
    if pttl == -1 then
      redis.call('PEXPIRE', key, window_ms)
      pttl = window_ms
    end

    return {current, pttl}
  `;

  return {
    /**
     * Increment the counter for the given key and return the new count.
     * With fail-closed degradation: throws on Redis error.
     */
    async increment(key: string): Promise<RateLimitStoreValue> {
      try {
        const [count, pttl] = (await redisClient.eval(
          incrWithExpireScript,
          1,
          key,
          '60000', // Default 1-minute window; caller overrides via middleware config
        )) as [number, number];

        const resetTime = pttl > 0
          ? new Date(Date.now() + pttl)
          : new Date(Date.now() + 60000);

        return {
          totalHits: count,
          resetTime,
        };
      } catch (error) {
        logger.error('[RateLimit] Redis increment failed', { key, error });
        // Fail closed: reject the request if we can't verify the rate limit
        throw error;
      }
    },

    /**
     * Retrieve the current count for the given key without incrementing.
     */
    async get(key: string): Promise<RateLimitStoreValue> {
      try {
        const [count, pttl] = (await redisClient.eval(
          `
          local key = KEYS[1]
          local current = redis.call('GET', key)
          if not current then
            return {0, -1}
          end
          local pttl = redis.call('PTTL', key)
          return {tonumber(current), pttl}
          `,
          1,
          key,
        )) as [number, number];

        const resetTime = pttl > 0
          ? new Date(Date.now() + pttl)
          : undefined;

        return {
          totalHits: count,
          resetTime,
        };
      } catch (error) {
        logger.error('[RateLimit] Redis get failed', { key, error });
        throw error;
      }
    },

    /**
     * Reset the counter for the given key.
     */
    async reset(key: string): Promise<void> {
      try {
        await redisClient.del(key);
      } catch (error) {
        logger.error('[RateLimit] Redis reset failed', { key, error });
        throw error;
      }
    },
  };
}


