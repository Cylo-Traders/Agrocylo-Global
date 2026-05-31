"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { API_BASE_URL } from "@/lib/apiConfig";

const RECONNECT_BASE_DELAY_MS = 1_000;
const RECONNECT_MAX_DELAY_MS = 30_000;
const RECONNECT_MULTIPLIER = 2;
const HEARTBEAT_INTERVAL_MS = 30_000;

export function useSocket() {
  const [isConnected, setIsConnected] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const listenersRef = useRef<Map<string, Set<(data: unknown) => void>>>(new Map());
  const seenMessageIds = useRef<Set<string>>(new Set());
  const reconnectAttempt = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const unmounted = useRef(false);
  const connectRef = useRef<() => void>(() => {});
  const messageQueue = useRef<Record<string, unknown>[]>([]);

  const connect = useCallback(() => {
    if (unmounted.current) return;

    const wsUrl = API_BASE_URL.replace(/^http/, "ws") + "/ws";
    const socket = new WebSocket(wsUrl);
    socketRef.current = socket;

    socket.onopen = () => {
      setIsConnected(true);
      reconnectAttempt.current = 0;
      
      // Flush queue
      while (messageQueue.current.length > 0) {
        const msg = messageQueue.current.shift();
        if (msg) {
          socket.send(JSON.stringify(msg));
        }
      }

      // Re-subscribe to all active order subscriptions
      listenersRef.current.forEach((_, event) => {
        if (event.startsWith("order:")) {
          const orderId = event.split(":")[1];
          socket.send(JSON.stringify({ type: "subscribe", orderId }));
        }
      });

      // Start heartbeat
      heartbeatTimer.current = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'ping' }));
        }
      }, HEARTBEAT_INTERVAL_MS);
    };

    socket.onclose = () => {
      setIsConnected(false);
      if (heartbeatTimer.current) clearInterval(heartbeatTimer.current);
      if (unmounted.current) return;
      // Exponential backoff reconnect
      const delay = Math.min(
        RECONNECT_BASE_DELAY_MS * Math.pow(RECONNECT_MULTIPLIER, reconnectAttempt.current),
        RECONNECT_MAX_DELAY_MS,
      );
      reconnectAttempt.current += 1;
      reconnectTimer.current = setTimeout(() => connectRef.current(), delay);
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data as string) as {
          event?: string;
          id?: string;
          payload?: unknown;
        };

        if (data.event === 'pong') return;

        // Deduplicate by message id if present
        if (data.id) {
          if (seenMessageIds.current.has(data.id)) return;
          seenMessageIds.current.add(data.id);
          // Keep the dedup set bounded
          if (seenMessageIds.current.size > 500) {
            const first = seenMessageIds.current.values().next().value;
            if (first !== undefined) seenMessageIds.current.delete(first);
          }
        }

        if (data.event) {
          const eventListeners = listenersRef.current.get(data.event);
          if (eventListeners) {
            eventListeners.forEach((cb) => cb(data.payload));
          }
        }
      } catch (err) {
        console.error("[useSocket] Failed to parse message", err);
      }
    };
  }, []);

  useEffect(() => { connectRef.current = connect; }, [connect]);

  useEffect(() => {
    unmounted.current = false;
    connectRef.current = connect;
    connect();

    return () => {
      unmounted.current = true;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (heartbeatTimer.current) clearInterval(heartbeatTimer.current);
      socketRef.current?.close();
    };
  }, [connect]);

  const emit = useCallback((type: string, payload: Record<string, unknown>) => {
    const msg = { type, ...payload };
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(msg));
    } else {
      messageQueue.current.push(msg);
    }
  }, []);

  const on = useCallback((event: string, callback: (data: unknown) => void) => {
    const map = listenersRef.current;
    if (!map.has(event)) {
      map.set(event, new Set());
      if (event.startsWith("order:")) {
        const orderId = event.split(":")[1];
        emit("subscribe", { orderId });
      }
    }
    map.get(event)!.add(callback);

    return () => {
      const listeners = map.get(event);
      if (listeners) {
        listeners.delete(callback);
        if (listeners.size === 0) {
          map.delete(event);
          if (event.startsWith("order:")) {
            const orderId = event.split(":")[1];
            emit("unsubscribe", { orderId });
          }
        }
      }
    };
  }, [emit]);

  return { isConnected, on, emit };
}
