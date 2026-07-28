import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSocket } from "./useSocket";
import { setAccessToken } from "@/lib/authToken";

type MockSocket = {
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  readyState: number;
  onopen: ((event: Event) => void) | null;
  onclose: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent<string>) => void) | null;
};

describe("useSocket Hook", () => {
  let mockWs: MockSocket;
  let webSocketCtor: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();

    // Mock global WebSocket
    mockWs = {
      send: vi.fn(),
      close: vi.fn(),
      readyState: 1, // WebSocket.OPEN
      onopen: null,
      onclose: null,
      onmessage: null,
    };

    webSocketCtor = vi.fn(() => mockWs as unknown as WebSocket);
    global.WebSocket = webSocketCtor as unknown as typeof WebSocket;
  });

  afterEach(() => {
    setAccessToken(null);
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("should initialize websocket connection on mount", () => {
    const { result } = renderHook(() => useSocket());
    
    expect(global.WebSocket).toHaveBeenCalled();
    expect(result.current.isConnected).toBe(false);
  });

  it("should establish connection status when open callback fires", () => {
    const { result } = renderHook(() => useSocket());
    
    act(() => {
      const socket = webSocketCtor.mock.results[0]?.value as MockSocket;
      socket.onopen?.(new Event("open"));
    });

    expect(result.current.isConnected).toBe(true);
  });

  it("authenticates with the REST access token on every connection", () => {
    setAccessToken("jwt-access-token");
    renderHook(() => useSocket());

    act(() => {
      const socket = webSocketCtor.mock.results[0]?.value as MockSocket;
      socket.onopen?.(new Event("open"));
    });

    expect(mockWs.send).toHaveBeenNthCalledWith(
      1,
      JSON.stringify({ type: "auth", token: "jwt-access-token" }),
    );

    act(() => {
      const socket = webSocketCtor.mock.results[0]?.value as MockSocket;
      socket.onclose?.(new Event("close"));
      vi.advanceTimersByTime(1_000);
    });

    const reconnectedSocket = webSocketCtor.mock.results[1]?.value as MockSocket;
    act(() => reconnectedSocket.onopen?.(new Event("open")));
    expect(reconnectedSocket.send).toHaveBeenCalledWith(
      JSON.stringify({ type: "auth", token: "jwt-access-token" }),
    );
  });

  it("should send subscription signals when registering order listeners", () => {
    const { result } = renderHook(() => useSocket());
    
    act(() => {
      const socket = webSocketCtor.mock.results[0]?.value as MockSocket;
      socket.onopen?.(new Event("open"));
    });

    act(() => {
      result.current.on("order:order_abc", vi.fn());
    });

    expect(mockWs.send).toHaveBeenCalledWith(
      JSON.stringify({ type: "subscribe", orderId: "order_abc" })
    );
  });

  it("should send unsubscribe signals when listener is cleaned up", () => {
    const { result } = renderHook(() => useSocket());
    
    act(() => {
      const socket = webSocketCtor.mock.results[0]?.value as MockSocket;
      socket.onopen?.(new Event("open"));
    });

    let unsub: () => void = () => {};
    act(() => {
      unsub = result.current.on("order:order_xyz", vi.fn());
    });

    act(() => {
      unsub();
    });

    expect(mockWs.send).toHaveBeenCalledWith(
      JSON.stringify({ type: "unsubscribe", orderId: "order_xyz" })
    );
  });
});
