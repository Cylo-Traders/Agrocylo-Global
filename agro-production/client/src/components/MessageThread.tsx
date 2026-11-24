"use client";

/**
 * Issue #1256: the thread renders the conversation the page loaded and
 * accepts initial messages as a prop. The old thread read
 * `conversation.messages` and sent each message through a
 * sessionToken-arg API that no longer exists; that field is gone from
 * the service type and the thread pulls history via the page instead.
 *
 * Live updates still go through the shared WebSocket. The page now
 * owns the full message list, so an incoming WS message is routed up
 * through `onNewMessage` instead of being stashed on the thread's
 * local state (which is kept for scroll + input handling only).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWebSocket, type WsMessage } from "@/hooks/useWebSocket";
import { getAccessToken } from "@/lib/authToken";
import {
  sendMessage as sendMessageApi,
  type Conversation,
  type Message,
} from "@/services/conversationService";

// Must mirror SendMessageSchema and EditMessageSchema in
// agro-production/server/src/routes/conversations.ts, which in turn mirror
// the Prisma `@db.VarChar(4000)` column on Message.content. Keeping the UI
// cap equal to the server's prevents the user from typing input that will
// pass the client but fail server validation.
const MESSAGE_CONTENT_MAX_LENGTH = 4000;

interface MessageThreadProps {
  conversation: Conversation;
  currentWallet: string;
  /** History + optimistic messages already loaded by the page. */
  initialMessages: Message[];
  /**
   * Called once per message the thread learns about, whether via
   * WebSocket or a successful send. The page owns the full list so a
   * "load older" button on top can prepend history.
   */
  onNewMessage: (message: Message) => void;
}

export default function MessageThread({
  conversation,
  currentWallet,
  initialMessages,
  onNewMessage,
}: MessageThreadProps) {
  const [pendingMessage, setPendingMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [initialMessages.length, scrollToBottom]);

  const handleWebSocketMessage = useCallback(
    (msg: WsMessage) => {
      if (msg.type !== "message.received") return;
      const payload = msg.payload as Message;
      if (
        payload &&
        typeof payload === "object" &&
        "conversationId" in payload &&
        payload.conversationId === conversation.id
      ) {
        onNewMessage(payload);
      }
    },
    [conversation.id, onNewMessage],
  );

  // Issue #1043: keep the options identity tied to the session token so a
  // re-auth is driven by the token itself and not by a fresh object literal.
  // #1256: read the token at mount from the same source the apiClient reads
  // (`authToken`), so there is no second channel for session state.
  const socketOptions = useMemo(() => {
    const token = getAccessToken();
    return token ? { token } : {};
  }, []);

  useWebSocket(handleWebSocketMessage, socketOptions);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!pendingMessage.trim()) return;

    const messageContent = pendingMessage;
    setPendingMessage("");
    setSending(true);
    setError(null);

    try {
      const newMessage = await sendMessageApi(conversation.id, messageContent);
      onNewMessage(newMessage);
      scrollToBottom();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send message");
      setPendingMessage(messageContent);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col flex-1 bg-background">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {initialMessages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted">
            <p className="text-center">No messages yet. Start the conversation!</p>
          </div>
        ) : (
          initialMessages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${
                msg.senderAddress.toLowerCase() === currentWallet.toLowerCase()
                  ? "justify-end"
                  : "justify-start"
              }`}
            >
              <div
                className={`max-w-xs px-3 py-2 rounded-lg ${
                  msg.senderAddress.toLowerCase() === currentWallet.toLowerCase()
                    ? "bg-primary text-primary-foreground"
                    : "bg-surface border border-border"
                }`}
              >
                <p className="text-sm break-words">{msg.content}</p>
                <p className="text-xs opacity-70 mt-1">
                  {new Date(msg.createdAt).toLocaleTimeString()}
                </p>
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form
        onSubmit={handleSendMessage}
        className="border-t border-border p-4 bg-surface space-y-2"
      >
        {error && <p className="text-sm text-error">{error}</p>}
        <div className="flex gap-2">
          <input
            type="text"
            value={pendingMessage}
            onChange={(e) => setPendingMessage(e.target.value)}
            placeholder="Type a message..."
            disabled={sending}
            maxLength={MESSAGE_CONTENT_MAX_LENGTH}
            className="flex-1 px-3 py-2 border border-border rounded-lg bg-background text-foreground placeholder-muted disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={sending || !pendingMessage.trim()}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {sending ? "Sending..." : "Send"}
          </button>
        </div>
        <p className="text-xs text-muted text-right">
          {pendingMessage.length}/{MESSAGE_CONTENT_MAX_LENGTH}
        </p>
      </form>
    </div>
  );
}
