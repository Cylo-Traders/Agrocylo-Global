"use client";

import { useEffect, useRef, useState, useCallback } from "react";

export function useSocket() {
  const [isConnected, setIsConnected] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const [listeners, setListeners] = useState<Map<string, Set<(data: any) => void>>>(new Map());

  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    // Fallback to localhost:3001 if backend URL is not set
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";
    const wsUrl = backendUrl.replace(/^http/, "ws") + "/ws";
    
    const socket = new WebSocket(wsUrl);
    socketRef.current = socket;

    socket.onopen = () => {
      setIsConnected(true);
      console.log("[useSocket] Connected to WebSocket");
    };

    socket.onclose = () => {
      setIsConnected(false);
      console.log("[useSocket] Disconnected from WebSocket");
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.event) {
          const eventListeners = listeners.get(data.event);
          if (eventListeners) {
            eventListeners.forEach((callback) => callback(data.payload));
          }
        }
      } catch (err) {
        console.error("[useSocket] Failed to parse message", err);
      }
    };

    return () => {
      socket.close();
    };
  }, [listeners]);

  const on = useCallback((event: string, callback: (data: any) => void) => {
    setListeners((prev) => {
      const next = new Map(prev);
      const eventListeners = next.get(event) || new Set();
      eventListeners.add(callback);
      next.set(event, eventListeners);
      return next;
    });

    return () => {
      setListeners((prev) => {
        const next = new Map(prev);
        const eventListeners = next.get(event);
        if (eventListeners) {
          eventListeners.delete(callback);
          if (eventListeners.size === 0) {
            next.delete(event);
          }
        }
        return next;
      });
    };
  }, []);

  const emit = useCallback((type: string, payload: any) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type, ...payload }));
    }
  }, []);

  return { isConnected, on, emit };
}
