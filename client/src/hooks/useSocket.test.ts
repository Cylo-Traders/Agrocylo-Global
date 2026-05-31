import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSocket } from "./useSocket";

describe("useSocket Hook", () => {
  let mockWs: any;

  beforeEach(() => {
    vi.useFakeTimers();

    // Mock global WebSocket
    mockWs = {
      send: vi.fn(),
      close: vi.fn(),
      readyState: 1, // WebSocket.OPEN
    };

    global.WebSocket = vi.fn().mockImplementation(() => mockWs) as any;
  });

  afterEach(() => {
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
      (global.WebSocket as any).mock.results[0].value.onopen();
    });

    expect(result.current.isConnected).toBe(true);
  });

  it("should send subscription signals when registering order listeners", () => {
    const { result } = renderHook(() => useSocket());
    
    act(() => {
      (global.WebSocket as any).mock.results[0].value.onopen();
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
      (global.WebSocket as any).mock.results[0].value.onopen();
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
