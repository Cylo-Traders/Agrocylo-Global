import { config } from "../config/index.js";

export interface ConnectionOptions {
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  db?: number;
  tls?: Record<string, unknown>;
  maxRetriesPerRequest?: number | null;
  enableReadyCheck?: boolean;
}

/**
 * Parses the Redis database index from a URL pathname such as "/4", "/4/" or "".
 * Any other non-empty path (e.g. "/prod/cache", "/-1") is rejected so that a
 * broken URL fails fast instead of silently reaching the default database.
 */
function parseDatabasePath(pathname: string): number | undefined {
  const trimmed = pathname.replace(/\/+$/, "");
  if (!trimmed || trimmed === "/") return undefined;
  if (!/^\/\d+$/.test(trimmed)) {
    throw new Error(`Invalid Redis database path in REDIS_URL: "${pathname}"`);
  }
  return Number(trimmed.slice(1));
}

/**
 * Returns BullMQ connection options parsed from the configured Redis URL.
 * We return plain options (not a Redis instance) to avoid ioredis version
 * conflicts between the top-level package and BullMQ's bundled copy.
 *
 * Unlike a naive host/port extract, this preserves TLS (rediss), ACL
 * credentials and the database index so queue clients and the API rate
 * limiter all address the same configured Redis database.
 */
export function createRedisConnection(): ConnectionOptions {
  const url = new URL(config.redisUrl);
  const connection: ConnectionOptions = {
    host: url.hostname,
    port: Number(url.port) || 6379,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  };
  if (url.password) {
    connection.username = decodeURIComponent(url.username) || undefined;
    connection.password = decodeURIComponent(url.password);
  }
  if (url.protocol === "rediss:" || url.protocol === "tls:") {
    connection.tls = {};
  }
  const db = parseDatabasePath(url.pathname);
  if (db !== undefined) connection.db = db;
  return connection;
}