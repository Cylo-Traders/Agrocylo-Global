import { describe, it, expect } from "vitest";
import { DEFAULT_EXPIRY_HOURS, getOrderExpirySeconds } from "./order-expiry";

describe("getOrderExpirySeconds", () => {
  it("returns deliveryDeadline in seconds when given a unix timestamp in seconds", () => {
    const deadline = 1800000000;
    expect(getOrderExpirySeconds({ deliveryDeadline: deadline })).toBe(deadline);
  });

  it("converts a millisecond timestamp to seconds", () => {
    const deadlineSeconds = 1800000000;
    expect(
      getOrderExpirySeconds({ deliveryDeadline: deadlineSeconds * 1000 }),
    ).toBe(deadlineSeconds);
  });

  it("parses an ISO date string", () => {
    const date = new Date("2030-06-01T12:00:00Z");
    const expected = Math.floor(date.getTime() / 1000);
    expect(
      getOrderExpirySeconds({ deliveryDeadline: date.toISOString() }),
    ).toBe(expected);
  });

  it("parses a numeric string as a unix timestamp", () => {
    const deadline = 1800000000;
    expect(
      getOrderExpirySeconds({ deliveryDeadline: String(deadline) }),
    ).toBe(deadline);
  });

  it("falls back to 96h from timestamp when deliveryDeadline is absent", () => {
    const base = 1700000000;
    expect(getOrderExpirySeconds({ timestamp: base })).toBe(
      base + DEFAULT_EXPIRY_HOURS * 3600,
    );
  });

  it("falls back to 96h from createdAt when timestamp is absent", () => {
    const base = 1700000000;
    expect(getOrderExpirySeconds({ createdAt: base })).toBe(
      base + DEFAULT_EXPIRY_HOURS * 3600,
    );
  });

  it("falls back to 96h from zero base when neither timestamp nor createdAt exists", () => {
    expect(getOrderExpirySeconds({})).toBe(DEFAULT_EXPIRY_HOURS * 3600);
  });

  it("ignores an empty string deliveryDeadline and uses the fallback", () => {
    const base = 1700000000;
    expect(
      getOrderExpirySeconds({ timestamp: base, deliveryDeadline: "" }),
    ).toBe(base + DEFAULT_EXPIRY_HOURS * 3600);
  });
});
