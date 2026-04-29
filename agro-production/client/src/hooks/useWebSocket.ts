"use client";

import { useEffect, useRef, useCallback } from "react";

const WS_URL =
  process.env.NEXT_PUBLIC_WS_URL ??
  (typeof window !== "undefined"
    ? `ws://${window.location.hostname}:3001/ws`
    : "ws://localhost:3001/ws");

export type WsMessage = {
  event: string;
  payload: unknown;
  timestamp: string;
};

type Handler = (msg: WsMessage) => void;

export function useWebSocket(onMessage: Handler) {
  const socketRef = useRef<WebSocket | null>(null);
  const handlerRef = useRef<Handler>(onMessage);
  handlerRef.current = onMessage;

  const connect = useCallback(() => {
    if (typeof window === "undefined") return;

    const ws = new WebSocket(WS_URL);
    socketRef.current = ws;

    ws.onmessage = (e) => {
      try {
        const msg: WsMessage = JSON.parse(e.data as string);
        handlerRef.current(msg);
      } catch {
        // ignore malformed messages
      }
    };

    ws.onclose = () => {
      // Reconnect after 3s
      setTimeout(connect, 3000);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      socketRef.current?.close();
    };
  }, [connect]);
}
