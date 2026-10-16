import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useAsyncResource } from "@/hooks/useAsyncResource";

/**
 * The keyed-request hook behind every page I rewrote for #1084: state must
 * only ever land in promise callbacks, loading is derived from the key, and a
 * response for a superseded key (or an unmounted owner) is dropped.
 */

interface Call {
  signal: AbortSignal;
  resolve: (value: string) => void;
  reject: (reason: unknown) => void;
}

function makeLoad() {
  const calls: Call[] = [];
  const load = (signal: AbortSignal): Promise<string> =>
    new Promise<string>((resolve, reject) => {
      calls.push({ signal, resolve, reject });
    });
  return { calls, load };
}

describe("useAsyncResource", () => {
  it("starts loading and commits the resolved data", async () => {
    const { calls, load } = makeLoad();
    const { result } = renderHook(() => useAsyncResource("key-a", load));

    expect(result.current.loading).toBe(true);
    expect(calls).toHaveLength(1);

    await act(async () => {
      calls[0].resolve("payload-a");
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBe("payload-a");
    expect(result.current.error).toBeNull();
  });

  it("surfaces a rejection as a message, not as data", async () => {
    const { calls, load } = makeLoad();
    const { result } = renderHook(() => useAsyncResource("key-a", load));

    await act(async () => {
      calls[0].reject(new Error("boom"));
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBe("boom");
  });

  it("re-runs the request on reload and clears the stale error", async () => {
    const { calls, load } = makeLoad();
    const { result } = renderHook(() => useAsyncResource("key-a", load));

    await act(async () => {
      calls[0].reject(new Error("boom"));
    });
    expect(result.current.error).toBe("boom");

    act(() => {
      result.current.reload();
    });
    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBeNull();
    expect(calls).toHaveLength(2);

    await act(async () => {
      calls[1].resolve("recovered");
    });
    expect(result.current.data).toBe("recovered");
    expect(result.current.error).toBeNull();
  });

  it("aborts the previous request and drops its response when the key changes", async () => {
    const { calls, load } = makeLoad();
    const { result, rerender } = renderHook(
      ({ key }: { key: string }) => useAsyncResource(key, load),
      { initialProps: { key: "key-a" } },
    );
    expect(calls).toHaveLength(1);

    rerender({ key: "key-b" });
    expect(calls).toHaveLength(2);
    expect(calls[0].signal.aborted).toBe(true);
    expect(calls[1].signal.aborted).toBe(false);
    expect(result.current.loading).toBe(true);

    // The new key resolves first…
    await act(async () => {
      calls[1].resolve("payload-b");
    });
    expect(result.current.data).toBe("payload-b");

    // …and the stale response arriving late must not overwrite it.
    await act(async () => {
      calls[0].resolve("payload-a");
    });
    expect(result.current.data).toBe("payload-b");
    expect(result.current.loading).toBe(false);
  });

  it("ignores a stale rejection after the key changed", async () => {
    const { calls, load } = makeLoad();
    const { result, rerender } = renderHook(
      ({ key }: { key: string }) => useAsyncResource(key, load),
      { initialProps: { key: "key-a" } },
    );
    rerender({ key: "key-b" });

    await act(async () => {
      calls[0].reject(new Error("stale failure"));
      calls[1].resolve("payload-b");
    });

    expect(result.current.error).toBeNull();
    expect(result.current.data).toBe("payload-b");
  });

  it("aborts the in-flight request on unmount", () => {
    const { calls, load } = makeLoad();
    const { unmount } = renderHook(() => useAsyncResource("key-a", load));
    expect(calls[0].signal.aborted).toBe(false);

    unmount();
    expect(calls[0].signal.aborted).toBe(true);
  });
});
