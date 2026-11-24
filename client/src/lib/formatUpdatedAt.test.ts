import { describe, expect, it } from "vitest";
import {
  formatAbsoluteTime,
  formatRelativeTime,
  parseTimestamp,
} from "./formatUpdatedAt";

const NOW = Date.parse("2026-11-24T12:00:00.000Z");
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function iso(msAgo: number): string {
  return new Date(NOW - msAgo).toISOString();
}

describe("parseTimestamp", () => {
  it("parses valid timestamps", () => {
    expect(parseTimestamp("2026-11-24T12:00:00.000Z")).toBe(NOW);
  });

  it("returns null for missing or invalid input", () => {
    expect(parseTimestamp(undefined)).toBeNull();
    expect(parseTimestamp(null)).toBeNull();
    expect(parseTimestamp("")).toBeNull();
    expect(parseTimestamp("not-a-date")).toBeNull();
  });
});

describe("formatRelativeTime", () => {
  it("returns null for missing/invalid timestamps", () => {
    expect(formatRelativeTime(undefined, NOW, "en")).toBeNull();
    expect(formatRelativeTime("garbage", NOW, "en")).toBeNull();
  });

  it("describes very recent timestamps as now", () => {
    expect(formatRelativeTime(iso(10_000), NOW, "en")).toBe("now");
  });

  it("formats minutes, hours and days", () => {
    expect(formatRelativeTime(iso(5 * MINUTE), NOW, "en")).toBe(
      "5 minutes ago",
    );
    expect(formatRelativeTime(iso(3 * HOUR), NOW, "en")).toBe("3 hours ago");
    expect(formatRelativeTime(iso(2 * DAY), NOW, "en")).toBe("2 days ago");
  });

  it("falls back to an absolute date for old timestamps", () => {
    const result = formatRelativeTime(iso(60 * DAY), NOW, "en");
    expect(result).toMatch(/2026/);
  });

  it("is localized", () => {
    // German relative time for 5 minutes differs from English.
    const de = formatRelativeTime(iso(5 * MINUTE), NOW, "de");
    expect(de).not.toBe("5 minutes ago");
    expect(de).toBeTruthy();
  });
});

describe("formatAbsoluteTime", () => {
  it("returns null for missing/invalid timestamps", () => {
    expect(formatAbsoluteTime(undefined, "en")).toBeNull();
    expect(formatAbsoluteTime("nope", "en")).toBeNull();
  });

  it("includes the date", () => {
    expect(formatAbsoluteTime(iso(0), "en")).toMatch(/2026/);
  });
});