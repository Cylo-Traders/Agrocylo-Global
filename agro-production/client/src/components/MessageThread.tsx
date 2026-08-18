"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useWebSocket, type WsMessage } from "@/hooks/useWebSocket";
import type { Conversation, Message } from "@/services/conversationService";
import { sendMessage as sendMessageApi } from "@/services/conversationService";

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
  const [pendingMessage, setPendingMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const handleWebSocketMessage = useCallback((msg: WsMessage) => {
    if (msg.type === "message.received") {
      const newMessage = msg.payload as Message;
      if (newMessage && typeof newMessage === "object" && "conversationId" in newMessage) {
        // Add message if it's for this conversation
        if ((newMessage as any).conversationId === conversation.id) {
          setMessages((prev) => [...prev, newMessage]);
        }
      }
    }
  }, [conversation.id]);

  useWebSocket(handleWebSocketMessage, { token: sessionToken });

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!pendingMessage.trim()) return;

    const messageContent = pendingMessage;
    setPendingMessage("");
    setSending(true);
    setError(null);

    try {
      const newMessage = await sendMessageApi(conversation.id, messageContent, sessionToken);
      setMessages((prev) => [...prev, newMessage]);
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
        {messages.length === 0 ? (
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
