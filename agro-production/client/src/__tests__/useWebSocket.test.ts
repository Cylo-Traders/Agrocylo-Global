import { renderHook, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { useWebSocket } from "@/hooks/useWebSocket";

describe("useWebSocket", () => {
  let mockWebSocket: any;
  let webSocketInstances: any[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    webSocketInstances = [];

    // Mock WebSocket
    mockWebSocket = vi.fn(function (this: any, url: string) {
      this.url = url;
      this.readyState = 0; // CONNECTING
      this.send = vi.fn();
      this.close = vi.fn();
      this.onopen = null;
      this.onmessage = null;
      this.onclose = null;
      this.onerror = null;
      webSocketInstances.push(this);
    });

    mockWebSocket.OPEN = 1;
    mockWebSocket.CLOSING = 2;
    mockWebSocket.CLOSED = 3;

    global.WebSocket = mockWebSocket;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reconnect fires after disconnect", async () => {
    const onMessage = vi.fn();
    const { result } = renderHook(() => useWebSocket(onMessage));

    const ws = webSocketInstances[0];
    expect(ws).toBeDefined();

    // Simulate connection opening
    act(() => {
      ws.readyState = mockWebSocket.OPEN;
      ws.onopen?.();
    });

    expect(result.current.status).toBe("open");

    // Simulate disconnection
    act(() => {
      ws.readyState = mockWebSocket.CLOSED;
      ws.onclose?.();
    });

    expect(result.current.status).toBe("closed");

    // Wait for reconnect timer to fire
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1100));
    });

    // Second WebSocket should be created
    expect(webSocketInstances.length).toBeGreaterThan(1);
  });

  it("reconnect is cancelled on unmount", async () => {
    const onMessage = vi.fn();
    const { unmount } = renderHook(() => useWebSocket(onMessage));

    const ws = webSocketInstances[0];

    // Simulate connection and then close
    act(() => {
      ws.readyState = mockWebSocket.OPEN;
      ws.onopen?.();
    });

    act(() => {
      ws.readyState = mockWebSocket.CLOSED;
      ws.onclose?.();
    });

    // Unmount before reconnect fires
    act(() => {
      unmount();
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1100));
    });

    // No new WebSocket should be created after unmount
    expect(webSocketInstances.length).toBe(1);
  });

  it("malformed JSON message is handled without throwing", () => {
    const onMessage = vi.fn();
    const { result } = renderHook(() => useWebSocket(onMessage));

    const ws = webSocketInstances[0];

    act(() => {
      ws.readyState = mockWebSocket.OPEN;
      ws.onopen?.();
    });

    // Send malformed JSON
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    act(() => {
      ws.onmessage?.({ data: "{ invalid json" });
    });

    expect(onMessage).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(
      "[useWebSocket] Malformed message received:",
      "{ invalid json"
    );

    consoleSpy.mockRestore();
  });

  it("wss:// URL is derived correctly when page is served over https", () => {
    // Mock window.location.protocol as https
    const originalLocation = window.location;
    delete (window as any).location;
    window.location = { ...originalLocation, protocol: "https:" } as any;

    const onMessage = vi.fn();
    renderHook(() => useWebSocket(onMessage));

    const ws = webSocketInstances[0];
    expect(ws.url).toContain("wss://");

    // Restore location
    window.location = originalLocation;
  });

  it("initial status is connecting", () => {
    const onMessage = vi.fn();
    const { result } = renderHook(() => useWebSocket(onMessage));

    expect(result.current.status).toBe("connecting");
  });

  it("status transitions to open on connection", () => {
    const onMessage = vi.fn();
    const { result } = renderHook(() => useWebSocket(onMessage));

    const ws = webSocketInstances[0];

    act(() => {
      ws.readyState = mockWebSocket.OPEN;
      ws.onopen?.();
    });

    expect(result.current.status).toBe("open");
  });

  it("status transitions to error on error event", () => {
    const onMessage = vi.fn();
    const { result } = renderHook(() => useWebSocket(onMessage));

    const ws = webSocketInstances[0];

    act(() => {
      ws.onerror?.();
    });

    expect(result.current.status).toBe("error");
  });

  it("queues messages when socket is not open", () => {
    const onMessage = vi.fn();
    const { result } = renderHook(() => useWebSocket(onMessage));

    const ws = webSocketInstances[0];

    act(() => {
      result.current.send("test message");
    });

    expect(ws.send).not.toHaveBeenCalled();

    // Socket now opens and message should be flushed
    act(() => {
      ws.readyState = mockWebSocket.OPEN;
      ws.onopen?.();
    });

    expect(ws.send).toHaveBeenCalledWith("test message");
  });

  it("calls onMessage handler for valid JSON messages", () => {
    const onMessage = vi.fn();
    const { result } = renderHook(() => useWebSocket(onMessage));

    const ws = webSocketInstances[0];

    act(() => {
      ws.readyState = mockWebSocket.OPEN;
      ws.onopen?.();
    });

    const testMessage = {
      event: "test_event",
      payload: { foo: "bar" },
      timestamp: new Date().toISOString(),
    };

    act(() => {
      ws.onmessage?.({ data: JSON.stringify(testMessage) });
    });

    expect(onMessage).toHaveBeenCalledWith(testMessage);
  });
});
