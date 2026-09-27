"use client";

import { useEffect, useRef, useState, useCallback } from "react";

/**
 * WebSocket hook for real-time client-server communication.
 *
 * ## Local Setup
 * During development, the WebSocket server runs on localhost:5001.
 * To test locally:
 *   1. Ensure the backend is running on ws://localhost:5001/ws
 *   2. The hook auto-derives this URL if NEXT_PUBLIC_WS_URL is not set
 *
 * ## Production Setup
 * In production, set the environment variable:
 *   NEXT_PUBLIC_WS_URL=wss://your-domain/ws
 *
 * The hook automatically detects https connections and uses wss:// (secure WebSocket).
 *
 * ## Session lifecycle (issue #1043)
 * The transport is set up once and kept in sync with the current session:
 *   - `onMessage` is read through a ref, so a new handler never reconnects.
 *   - `options` is destructured to primitives, so the inline object literal
 *     callers normally pass never reconnects either.
 *   - A new `token` re-authenticates the live socket in place (the server
 *     re-verifies it) and re-asserts the wallet-scoped subscription.
 *   - A new `portfolioId` unsubscribes the old portfolio and subscribes the
 *     new one on the same socket.
 * Only the URL-backed transport and genuine network failures cause a
 * reconnect, so session changes cannot produce a reconnect storm.
 */

function getWebSocketUrl(): string {
  if (process.env.NEXT_PUBLIC_WS_URL) return process.env.NEXT_PUBLIC_WS_URL;
  if (typeof window === "undefined") return "ws://localhost:5001/ws";
  const scheme = window.location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${window.location.hostname}:5001/ws`;
}

const BACKOFF_BASE_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;
const MAX_QUEUE_SIZE = 100;

export type WsMessage = {
  version: "1";
  type: string;
  payload: unknown;
  timestamp: string;
};

export type WsStatus = "connecting" | "open" | "closed" | "error";

type Handler = (msg: WsMessage) => void;

export interface UseWebSocketOptions {
  token?: string;
  portfolioId?: string;
}

export interface UseWebSocketReturn {
  send: (data: string) => void;
  status: WsStatus;
}

function portfolioChannelMessage(type: "subscribe" | "unsubscribe", portfolioId: string): string {
  return JSON.stringify({ type, channel: "portfolio", id: portfolioId });
}

export function useWebSocket(onMessage: Handler, options?: UseWebSocketOptions): UseWebSocketReturn {
  // Destructure the primitive session values. Depending on `options` itself
  // would tear the socket down on every render, because callers routinely pass
  // a fresh object literal such as `{ token: sessionToken }` (issue #1043).
  const { token, portfolioId } = options ?? {};

  const socketRef = useRef<WebSocket | null>(null);
  const handlerRef = useRef<Handler>(onMessage);
  const attemptRef = useRef(0);
  const messageQueueRef = useRef<string[]>([]);
  const unmountedRef = useRef(false);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [status, setStatus] = useState<WsStatus>("connecting");

  // Latest render values, read from the socket callbacks so a re-render never
  // has to rebuild the transport.
  const tokenRef = useRef<string | undefined>(token);
  const portfolioIdRef = useRef<string | undefined>(portfolioId);

  // What the live socket has actually been told. These are the source of truth
  // for deciding whether a re-auth or a re-subscribe is still owed.
  const authedTokenRef = useRef<string | undefined>(undefined);
  const subscribedPortfolioRef = useRef<string | undefined>(undefined);

  // Effects run before any socket event can be delivered, so the callbacks
  // below always observe the values from the latest committed render.
  useEffect(() => {
    handlerRef.current = onMessage;
    tokenRef.current = token;
    portfolioIdRef.current = portfolioId;
  });

  // Lets the reconnect timer reach `connect` without a stale closure and
  // without referencing it before its declaration.
  const connectRef = useRef<() => void>(() => {});

  const flushQueue = useCallback((ws: WebSocket) => {
    const queued = messageQueueRef.current.splice(0);
    for (const msg of queued) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(msg);
      }
    }
  }, []);

  /** Authenticate the socket with `value` and remember the credential in use. */
  const applyAuth = useCallback((ws: WebSocket, value: string | undefined) => {
    authedTokenRef.current = value;
    if (value) {
      ws.send(JSON.stringify({ type: "auth", token: value }));
    }
  }, []);

  /**
   * Move the portfolio subscription from `previous` to `next`, remembering the
   * new binding. Passing `undefined` for `previous` re-asserts the current
   * subscription without unsubscribing first.
   */
  const applySubscription = useCallback(
    (ws: WebSocket, previous: string | undefined, next: string | undefined) => {
      subscribedPortfolioRef.current = next;
      if (previous) {
        ws.send(portfolioChannelMessage("unsubscribe", previous));
      }
      if (next) {
        ws.send(portfolioChannelMessage("subscribe", next));
      }
    },
    [],
  );

  const connect = useCallback(() => {
    if (typeof window === "undefined" || unmountedRef.current) return;

    // A brand new transport has neither authenticated nor subscribed yet.
    authedTokenRef.current = undefined;
    subscribedPortfolioRef.current = undefined;

    const ws = new WebSocket(getWebSocketUrl());
    socketRef.current = ws;

    ws.onopen = () => {
      attemptRef.current = 0;
      if (!unmountedRef.current) setStatus("open");

      applyAuth(ws, tokenRef.current);

      flushQueue(ws);

      // Issue #1017: Send subscribe message for portfolio if portfolioId is provided.
      applySubscription(ws, undefined, portfolioIdRef.current);
    };

    ws.onmessage = (e) => {
      try {
        const msg: WsMessage = JSON.parse(e.data as string);
        handlerRef.current(msg);
      } catch {
        console.warn("[useWebSocket] Malformed message received:", e.data);
      }
    };

    ws.onclose = () => {
      if (unmountedRef.current) return;
      setStatus("closed");
      const attempt = attemptRef.current;
      const delay = Math.min(BACKOFF_BASE_MS * 2 ** attempt, BACKOFF_MAX_MS);
      attemptRef.current = attempt + 1;
      reconnectTimerRef.current = setTimeout(() => {
        if (unmountedRef.current) return;
        setStatus("connecting");
        connectRef.current();
      }, delay);
    };

    ws.onerror = () => {
      if (!unmountedRef.current) setStatus("error");
      ws.close();
    };
  }, [applyAuth, applySubscription, flushQueue]);

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  /** Queue a raw JSON string to be sent once the socket is open. */
  const send = useCallback((data: string) => {
    const ws = socketRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(data);
    } else {
      if (messageQueueRef.current.length < MAX_QUEUE_SIZE) {
        messageQueueRef.current.push(data);
      }
    }
  }, []);

  useEffect(() => {
    unmountedRef.current = false;
    connect();
    return () => {
      unmountedRef.current = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      socketRef.current?.close();
    };
  }, [connect]);

  // Issue #1043: a wallet switch or a session refresh must not leave the live
  // socket bound to the previous credential or the previous portfolio.
  useEffect(() => {
    const ws = socketRef.current;
    // While the transport is still being established, `onopen` authenticates
    // and subscribes with the latest values, so there is nothing owed here.
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    const tokenChanged = token !== authedTokenRef.current;
    if (tokenChanged) {
      applyAuth(ws, token);
    }

    if (portfolioId !== subscribedPortfolioRef.current) {
      applySubscription(ws, subscribedPortfolioRef.current, portfolioId);
    } else if (tokenChanged && portfolioId) {
      // Subscriptions are scoped to the authenticated wallet, so a token
      // rotation has to re-assert the current one for the new identity.
      applySubscription(ws, undefined, portfolioId);
    }
  }, [token, portfolioId, applyAuth, applySubscription]);

  return { send, status };
}
