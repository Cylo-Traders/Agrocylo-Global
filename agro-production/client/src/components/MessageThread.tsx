"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useWebSocket, type WsMessage } from "@/hooks/useWebSocket";
import {
  getConversationMessages,
  sendMessage as sendMessageApi,
  type Conversation,
  type Message,
} from "@/services/conversationService";

interface MessageThreadProps {
  conversation: Conversation;
  currentWallet: string;
  sessionToken: string;
}

export default function MessageThread({
  conversation,
  currentWallet,
  sessionToken,
}: MessageThreadProps) {
  const [messages, setMessages] = useState<Message[]>(conversation.messages || []);
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);
  const [loadingHistory, setLoadingHistory] = useState<boolean>(true);
  const [loadingOlder, setLoadingOlder] = useState<boolean>(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [pendingMessage, setPendingMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView?.({ behavior: "smooth" });
  }, []);

  const loadInitialHistory = useCallback(async () => {
    setLoadingHistory(true);
    setHistoryError(null);
    try {
      const page = await getConversationMessages(
        conversation.id,
        { limit: 20 },
        sessionToken,
      );
      setMessages(page.messages);
      setNextCursor(page.nextCursor);
    } catch (err) {
      setHistoryError(
        err instanceof Error ? err.message : "Failed to load message history",
      );
    } finally {
      setLoadingHistory(false);
    }
  }, [conversation.id, sessionToken]);

  useEffect(() => {
    void loadInitialHistory();
  }, [loadInitialHistory]);

  useEffect(() => {
    scrollToBottom();
  }, [messages.length, scrollToBottom]);

  const handleLoadOlder = async () => {
    if (!nextCursor || loadingOlder) return;
    setLoadingOlder(true);
    setHistoryError(null);
    try {
      const older = await getConversationMessages(
        conversation.id,
        { cursor: nextCursor, limit: 20 },
        sessionToken,
      );
      setMessages((prev) => {
        const existingIds = new Set(prev.map((m) => m.id));
        const uniqueOlder = older.messages.filter((m) => !existingIds.has(m.id));
        return [...uniqueOlder, ...prev];
      });
      setNextCursor(older.nextCursor);
    } catch (err) {
      setHistoryError(
        err instanceof Error ? err.message : "Failed to load older messages",
      );
    } finally {
      setLoadingOlder(false);
    }
  };

  const handleWebSocketMessage = useCallback(
    (msg: WsMessage) => {
      if (msg.type === "message.received") {
        const newMessage = msg.payload as Message;
        if (
          newMessage &&
          typeof newMessage === "object" &&
          "conversationId" in newMessage &&
          newMessage.conversationId === conversation.id
        ) {
          setMessages((prev) =>
            prev.some((m) => m.id === newMessage.id) ? prev : [...prev, newMessage],
          );
        }
      }
    },
    [conversation.id],
  );

  // Issue #1043: keep the options identity tied to the session token so a
  // re-auth is driven by the token itself and not by a fresh object literal.
  const socketOptions = useMemo(() => ({ token: sessionToken }), [sessionToken]);

  useWebSocket(handleWebSocketMessage, socketOptions);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!pendingMessage.trim()) return;

    const messageContent = pendingMessage;
    setPendingMessage("");
    setSending(true);
    setError(null);

    try {
      const newMessage = await sendMessageApi(
        conversation.id,
        messageContent,
        sessionToken,
      );
      setMessages((prev) =>
        prev.some((m) => m.id === newMessage.id) ? prev : [...prev, newMessage],
      );
      scrollToBottom();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send message");
      setPendingMessage(messageContent);
    } finally {
      setSending(false);
    }
  };

  const otherParticipant =
    currentWallet.toLowerCase() === conversation.investorAddress.toLowerCase()
      ? conversation.farmerAddress
      : conversation.investorAddress;

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border p-4 bg-surface">
        <p className="text-sm text-muted truncate">{otherParticipant}</p>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {nextCursor && (
          <div className="text-center">
            <button
              type="button"
              onClick={() => void handleLoadOlder()}
              disabled={loadingOlder}
              className="px-3 py-1 text-xs rounded border border-border bg-surface hover:bg-muted disabled:opacity-50"
            >
              {loadingOlder ? "Loading older..." : "Load older messages"}
            </button>
          </div>
        )}

        {historyError && (
          <div className="text-center space-y-2">
            <p className="text-xs text-error">{historyError}</p>
            <button
              type="button"
              onClick={() => void loadInitialHistory()}
              className="px-3 py-1 text-xs rounded border border-border bg-surface hover:bg-muted"
            >
              Retry history
            </button>
          </div>
        )}

        {loadingHistory ? (
          <div className="flex items-center justify-center h-full text-muted">
            <p className="text-center">Loading messages...</p>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted">
            <p className="text-center">No messages yet. Start the conversation!</p>
          </div>
        ) : (
          messages.map((msg) => (
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
            maxLength={5000}
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
          {pendingMessage.length}/5000
        </p>
      </form>
    </div>
  );
}
