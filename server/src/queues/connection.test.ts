import { describe, it, expect, vi } from "vitest";

const { getRedisUrl, setRedisUrl } = vi.hoisted(() => {
  let current = "redis://127.0.0.1:6379";
  return {
    getRedisUrl: () => current,
    setRedisUrl: (url: string) => {
      current = url;
    },
  };
});

vi.mock("../config/index.js", () => ({
  config: {
    get redisUrl() {
      return getRedisUrl();
    },
  },
}));

import { createRedisConnection } from "./connection.js";

describe("createRedisConnection (Issue #955)", () => {
  it("parses a plain Redis URL without credentials or db", () => {
    setRedisUrl("redis://127.0.0.1:6379");
    const conn = createRedisConnection();
    expect(conn).toMatchObject({ host: "127.0.0.1", port: 6379, maxRetriesPerRequest: null });
    expect(conn.tls).toBeUndefined();
    expect(conn.username).toBeUndefined();
    expect(conn.password).toBeUndefined();
    expect(conn.db).toBeUndefined();
  });

  it("honours an explicit port and a nonzero database index", () => {
    setRedisUrl("redis://myhost:6380/4");
    const conn = createRedisConnection();
    expect(conn).toMatchObject({ host: "myhost", port: 6380, db: 4 });
  });

  it("decodes ACL username and percent-encoded password", () => {
    setRedisUrl("rediss://worker:p%40ss@localhost:6380/2");
    const conn = createRedisConnection();
    expect(conn).toMatchObject({ host: "localhost", port: 6380, username: "worker", password: "p@ss", db: 2 });
  });

  it("enables TLS for rediss URLs", () => {
    setRedisUrl("rediss://localhost:6380/0");
    const conn = createRedisConnection();
    expect(conn.tls).toEqual({});
  });

  it("enables TLS for tls: URLs", () => {
    setRedisUrl("tls://localhost:6380");
    const conn = createRedisConnection();
    expect(conn.tls).toEqual({});
  });

  it("parses a URL with username but no password", () => {
    setRedisUrl("redis://worker@localhost:6379/1");
    const conn = createRedisConnection();
    expect(conn).toMatchObject({ host: "localhost", port: 6379, username: "worker", db: 1 });
    expect(conn.password).toBeUndefined();
  });

  it("parses a trailing-slash database path", () => {
    setRedisUrl("redis://localhost:6379/3/");
    const conn = createRedisConnection();
    expect(conn.db).toBe(3);
  });

  it("rejects invalid database paths", () => {
    setRedisUrl("redis://localhost:6379/widgets");
    expect(() => createRedisConnection()).toThrow(/Invalid Redis database path/);
    setRedisUrl("redis://localhost:6379/-1");
    expect(() => createRedisConnection()).toThrow(/Invalid Redis database path/);
  });
});