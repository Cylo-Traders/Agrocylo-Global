import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNow } from "@/hooks/useNow";

/**
 * The render-safe clock (#1084): one reading through a lazy initializer,
 * refreshed from a timer — never from render — so deadline displays are
 * deterministic under fake timers.
 */

const BASE = new Date("2026-01-01T00:00:00.000Z").getTime();

describe("useNow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("takes one reading at mount through the lazy initializer", () => {
    const { result } = renderHook(() => useNow(60_000));
    expect(result.current).toBe(BASE);
  });

  it("does not tick before the interval has elapsed", () => {
    const { result } = renderHook(() => useNow(60_000));

    act(() => {
      vi.advanceTimersByTime(59_999);
    });
    expect(result.current).toBe(BASE);
  });

  it("refreshes from the timer, not from render", () => {
    const { result } = renderHook(() => useNow(60_000));

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current).toBe(BASE + 60_000);

    act(() => {
      vi.advanceTimersByTime(120_000);
    });
    expect(result.current).toBe(BASE + 180_000);
  });

  it("honours a custom interval", () => {
    const { result } = renderHook(() => useNow(1_000));

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(result.current).toBe(BASE + 1_000);
  });

  it("clears its interval on unmount", () => {
    const { unmount } = renderHook(() => useNow(60_000));
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    unmount();
    expect(vi.getTimerCount()).toBe(0);

    // Advancing time after unmount must not touch anything.
    act(() => {
      vi.advanceTimersByTime(600_000);
    });
    expect(vi.getTimerCount()).toBe(0);
  });
});
