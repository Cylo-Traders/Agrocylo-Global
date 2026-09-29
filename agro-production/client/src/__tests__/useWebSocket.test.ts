import { renderHook, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { useWebSocket, type UseWebSocketOptions, type WsMessage } from "@/hooks/useWebSocket";

type MockSocket = {
  url: string;
  readyState: number;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  onopen: (() => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
};

type MockWebSocket = {
  new (url: string): MockSocket;
  OPEN: number;
  CLOSING: number;
  CLOSED: number;
};

type SentMessage = { type: string; channel?: string; id?: string; token?: string };

describe("useWebSocket", () => {
  let mockWebSocket: MockWebSocket;
  let webSocketInstances: MockSocket[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    webSocketInstances = [];

    // Mock WebSocket
    mockWebSocket = vi.fn(function (this: MockSocket, url: string) {
      this.url = url;
      this.readyState = 0; // CONNECTING
      this.send = vi.fn();
      this.close = vi.fn();
      this.onopen = null;
      this.onmessage = null;
      this.onclose = null;
      this.onerror = null;
      webSocketInstances.push(this);
    }) as unknown as MockWebSocket;

    mockWebSocket.OPEN = 1;
    mockWebSocket.CLOSING = 2;
    mockWebSocket.CLOSED = 3;

    global.WebSocket = mockWebSocket as unknown as typeof WebSocket;
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
    expect(result.current.reconnectAttempt).toBe(1);

    // Wait for reconnect timer to fire (base delay is 1000ms; jitter only ever
    // shortens it, so 1100ms comfortably covers the full range).
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1100));
    });

    // Second WebSocket should be created, and the status reflects a retry
    // rather than the initial connect.
    expect(webSocketInstances.length).toBeGreaterThan(1);
    expect(result.current.status).toBe("reconnecting");
  });

  it("reconnect backoff delay includes jitter within [delay/2, delay]", () => {
    vi.useFakeTimers();
    try {
      const randomSpy = vi.spyOn(Math, "random");
      const setTimeoutSpy = vi.spyOn(global, "setTimeout");

      const onMessage = vi.fn();
      renderHook(() => useWebSocket(onMessage));
      const ws = webSocketInstances[0];

      act(() => {
        ws.readyState = mockWebSocket.OPEN;
        ws.onopen?.();
      });

      randomSpy.mockReturnValue(0);
      act(() => {
        ws.readyState = mockWebSocket.CLOSED;
        ws.onclose?.();
      });
      const minDelay = setTimeoutSpy.mock.calls.at(-1)?.[1];
      expect(minDelay).toBe(500); // 1000 / 2 + 0 * (1000 / 2)

      randomSpy.mockReturnValue(1);
      act(() => {
        vi.advanceTimersByTime(minDelay as number);
      });
      const secondWs = webSocketInstances[1];
      act(() => {
        secondWs.readyState = mockWebSocket.CLOSED;
        secondWs.onclose?.();
      });
      const maxDelay = setTimeoutSpy.mock.calls.at(-1)?.[1];
      expect(maxDelay).toBe(2000); // 2000 / 2 + 1 * (2000 / 2)

      randomSpy.mockRestore();
      setTimeoutSpy.mockRestore();
    } finally {
      vi.useRealTimers();
    }
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
    window.location = { ...originalLocation, protocol: "https:", hostname: "myapp.example.com" } as any;

    const onMessage = vi.fn();
    renderHook(() => useWebSocket(onMessage));

    const ws = webSocketInstances[0];
    // Should be same-origin, no port 5001 (issue #1044)
    expect(ws.url).toBe("wss://myapp.example.com/ws");

    // Restore location
    window.location = originalLocation;
  });

  it("ws://localhost:5001/ws is used when running locally on http", () => {
    const originalLocation = window.location;
    delete (window as any).location;
    window.location = { ...originalLocation, protocol: "http:", hostname: "localhost" } as any;

    const onMessage = vi.fn();
    renderHook(() => useWebSocket(onMessage));

    const ws = webSocketInstances[0];
    expect(ws.url).toBe("ws://localhost:5001/ws");

    window.location = originalLocation;
  });

  it("uses an explicit NEXT_PUBLIC_WS_URL override when set", () => {
    const original = process.env.NEXT_PUBLIC_WS_URL;
    process.env.NEXT_PUBLIC_WS_URL = "wss://custom.example.com/ws";

    const onMessage = vi.fn();
    renderHook(() => useWebSocket(onMessage));

    const ws = webSocketInstances[0];
    expect(ws.url).toBe("wss://custom.example.com/ws");

    process.env.NEXT_PUBLIC_WS_URL = original;
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

  it("warns and drops messages once the queue is full", () => {
    const onMessage = vi.fn();
    const { result } = renderHook(() => useWebSocket(onMessage));
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    act(() => {
      for (let i = 0; i < 101; i++) {
        result.current.send(`message-${i}`);
      }
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      "[useWebSocket] Message queue full; dropping message",
    );

    consoleSpy.mockRestore();
  });

  it("resets reconnectAttempt to 0 once the socket reopens", () => {
    vi.useFakeTimers();
    try {
      const onMessage = vi.fn();
      const { result } = renderHook(() => useWebSocket(onMessage));

      const first = webSocketInstances[0];
      act(() => {
        first.readyState = mockWebSocket.CLOSED;
        first.onclose?.();
      });
      expect(result.current.reconnectAttempt).toBe(1);

      act(() => {
        vi.advanceTimersByTime(1_000); // jitter never exceeds the 1000ms base delay
      });

      const second = webSocketInstances[1];
      act(() => {
        second.readyState = mockWebSocket.OPEN;
        second.onopen?.();
      });

      expect(result.current.reconnectAttempt).toBe(0);
      expect(result.current.status).toBe("open");
    } finally {
      vi.useRealTimers();
    }
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

  describe("session lifecycle (issue #1043)", () => {
    const open = (ws: MockSocket) => {
      act(() => {
        ws.readyState = mockWebSocket.OPEN;
        ws.onopen?.();
      });
    };

    const sent = (ws: MockSocket): SentMessage[] =>
      (ws.send.mock.calls as unknown[][]).map(([raw]) => JSON.parse(raw as string) as SentMessage);

    const ofType = (ws: MockSocket, type: string) => sent(ws).filter((msg) => msg.type === type);

    it("authenticates and subscribes when the socket opens", () => {
      const onMessage = vi.fn();
      renderHook(() =>
        useWebSocket(onMessage, { token: "token-a", portfolioId: "portfolio-a" }),
      );

      const ws = webSocketInstances[0];
      expect(sent(ws)).toEqual([]);

      open(ws);

      expect(sent(ws)).toEqual([
        { type: "auth", token: "token-a" },
        { type: "subscribe", channel: "portfolio", id: "portfolio-a" },
      ]);
    });

    it("re-authenticates the open socket exactly once when the token rotates", () => {
      const onMessage = vi.fn();
      const { rerender } = renderHook(
        ({ options }: { options: UseWebSocketOptions }) => useWebSocket(onMessage, options),
        { initialProps: { options: { token: "token-a" } as UseWebSocketOptions } },
      );

      const ws = webSocketInstances[0];
      open(ws);
      expect(ofType(ws, "auth")).toEqual([{ type: "auth", token: "token-a" }]);

      rerender({ options: { token: "token-b" } });

      // One re-auth with the new credential, and the transport is reused.
      expect(ofType(ws, "auth")).toEqual([
        { type: "auth", token: "token-a" },
        { type: "auth", token: "token-b" },
      ]);
      expect(webSocketInstances).toHaveLength(1);
    });

    it("re-authenticates once when the token changes more than once", () => {
      const onMessage = vi.fn();
      const { rerender } = renderHook(
        ({ token }: { token: string }) => useWebSocket(onMessage, { token }),
        { initialProps: { token: "token-a" } },
      );

      const ws = webSocketInstances[0];
      open(ws);

      rerender({ token: "token-b" });
      rerender({ token: "token-c" });

      expect(ofType(ws, "auth").map((msg) => msg.token)).toEqual([
        "token-a",
        "token-b",
        "token-c",
      ]);
      expect(webSocketInstances).toHaveLength(1);
    });

    it("authenticates exactly once with the latest token when it changes mid-handshake", () => {
      const onMessage = vi.fn();
      const { rerender } = renderHook(
        ({ token }: { token: string }) => useWebSocket(onMessage, { token }),
        { initialProps: { token: "token-a" } },
      );

      // Token rotates before the socket finished connecting.
      rerender({ token: "token-b" });

      const ws = webSocketInstances[0];
      open(ws);

      expect(ofType(ws, "auth")).toEqual([{ type: "auth", token: "token-b" }]);
      expect(webSocketInstances).toHaveLength(1);
    });

    it("re-asserts the wallet-scoped subscription after a token rotation", () => {
      const onMessage = vi.fn();
      const { rerender } = renderHook(
        ({ token }: { token: string }) =>
          useWebSocket(onMessage, { token, portfolioId: "portfolio-a" }),
        { initialProps: { token: "token-a" } },
      );

      const ws = webSocketInstances[0];
      open(ws);
      rerender({ token: "token-b" });

      expect(ofType(ws, "subscribe")).toEqual([
        { type: "subscribe", channel: "portfolio", id: "portfolio-a" },
        { type: "subscribe", channel: "portfolio", id: "portfolio-a" },
      ]);
      // The portfolio itself did not change, so it is never unsubscribed.
      expect(ofType(ws, "unsubscribe")).toEqual([]);
    });

    it("removes the old subscription and activates the new one when portfolioId changes", () => {
      const onMessage = vi.fn();
      const { rerender } = renderHook(
        ({ portfolioId }: { portfolioId: string }) =>
          useWebSocket(onMessage, { token: "token-a", portfolioId }),
        { initialProps: { portfolioId: "portfolio-a" } },
      );

      const ws = webSocketInstances[0];
      open(ws);

      rerender({ portfolioId: "portfolio-b" });

      expect(ofType(ws, "unsubscribe")).toEqual([
        { type: "unsubscribe", channel: "portfolio", id: "portfolio-a" },
      ]);
      expect(ofType(ws, "subscribe")).toEqual([
        { type: "subscribe", channel: "portfolio", id: "portfolio-a" },
        { type: "subscribe", channel: "portfolio", id: "portfolio-b" },
      ]);
      // Switching portfolios is not a transport-level event.
      expect(webSocketInstances).toHaveLength(1);
      // Re-subscribing must not duplicate the auth handshake.
      expect(ofType(ws, "auth")).toEqual([{ type: "auth", token: "token-a" }]);
    });

    it("unsubscribes when the portfolio is cleared", () => {
      const onMessage = vi.fn();
      const { rerender } = renderHook(
        ({ portfolioId }: { portfolioId?: string }) =>
          useWebSocket(onMessage, { token: "token-a", portfolioId }),
        { initialProps: { portfolioId: "portfolio-a" as string | undefined } },
      );

      const ws = webSocketInstances[0];
      open(ws);

      rerender({ portfolioId: undefined });

      expect(ofType(ws, "unsubscribe")).toEqual([
        { type: "unsubscribe", channel: "portfolio", id: "portfolio-a" },
      ]);
      expect(ofType(ws, "subscribe")).toHaveLength(1);
    });

    it("re-authenticates before switching portfolios when both change", () => {
      const onMessage = vi.fn();
      const { rerender } = renderHook(
        ({ options }: { options: UseWebSocketOptions }) => useWebSocket(onMessage, options),
        {
          initialProps: {
            options: { token: "token-a", portfolioId: "portfolio-a" } as UseWebSocketOptions,
          },
        },
      );

      const ws = webSocketInstances[0];
      open(ws);
      ws.send.mockClear();

      rerender({ options: { token: "token-b", portfolioId: "portfolio-b" } });

      expect(sent(ws)).toEqual([
        { type: "auth", token: "token-b" },
        { type: "unsubscribe", channel: "portfolio", id: "portfolio-a" },
        { type: "subscribe", channel: "portfolio", id: "portfolio-b" },
      ]);
      expect(webSocketInstances).toHaveLength(1);
    });

    it("does not reconnect when only the options object identity changes", () => {
      const onMessage = vi.fn();
      const { rerender } = renderHook(
        ({ options }: { options: UseWebSocketOptions }) => useWebSocket(onMessage, options),
        { initialProps: { options: { token: "token-a" } as UseWebSocketOptions } },
      );

      const ws = webSocketInstances[0];
      open(ws);
      ws.send.mockClear();

      // A fresh object literal with identical values, as callers pass inline.
      rerender({ options: { token: "token-a" } });

      expect(ws.send).not.toHaveBeenCalled();
      expect(webSocketInstances).toHaveLength(1);
    });

    it("does not reconnect when only onMessage changes", () => {
      const first = vi.fn();
      const second = vi.fn();
      const { rerender } = renderHook(
        ({ handler }: { handler: (msg: WsMessage) => void }) => useWebSocket(handler, { token: "token-a" }),
        { initialProps: { handler: first } },
      );

      const ws = webSocketInstances[0];
      open(ws);
      ws.send.mockClear();

      rerender({ handler: second });

      expect(ws.send).not.toHaveBeenCalled();
      expect(webSocketInstances).toHaveLength(1);

      const event = { type: "message.received", payload: { id: "m1" } };
      act(() => {
        ws.onmessage?.({ data: JSON.stringify(event) });
      });

      expect(first).not.toHaveBeenCalled();
      expect(second).toHaveBeenCalledWith(event);
    });

    it("re-authenticates the new socket after a reconnect", () => {
      vi.useFakeTimers();
      try {
        const onMessage = vi.fn();
        const { rerender } = renderHook(
          ({ token }: { token: string }) => useWebSocket(onMessage, { token }),
          { initialProps: { token: "token-a" } },
        );

        const first = webSocketInstances[0];
        open(first);

        rerender({ token: "token-b" });

        act(() => {
          first.readyState = mockWebSocket.CLOSED;
          first.onclose?.();
        });
        act(() => {
          vi.advanceTimersByTime(1_000);
        });

        expect(webSocketInstances).toHaveLength(2);
        const second = webSocketInstances[1];
        open(second);

        expect(ofType(second, "auth")).toEqual([{ type: "auth", token: "token-b" }]);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
