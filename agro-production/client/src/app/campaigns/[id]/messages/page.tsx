"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { loadWalletSession } from "@/lib/walletSession";
import { getAccessToken } from "@/lib/authToken";
import { isApiError } from "@/lib/apiClient";
import {
  createCampaignConversation,
  getCampaignConversation,
  type Conversation,
} from "@/services/conversationService";
import MessageThread from "@/components/MessageThread";

type PageStatus =
  | "loading"
  | "ready"
  | "empty"
  | "forbidden"
  | "expired"
  | "error";

export default function MessagesPage() {
  const params = useParams();
  const campaignId = params.id as string;

  const [session] = useState(() => loadWalletSession());
  const [accessToken, setAccessTokenState] = useState<string | null>(() =>
    getAccessToken(),
  );

  const walletSession = useMemo(
    () =>
      session
        ? { address: session.address, token: accessToken ?? "" }
        : null,
    [session, accessToken],
  );

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversation, setSelectedConversation] =
    useState<Conversation | null>(null);
  const [status, setStatus] = useState<PageStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    const onExpired = () => {
      setAccessTokenState(null);
      setStatus("expired");
    };
    window.addEventListener("agrocylo:session-expired", onExpired);
    return () => window.removeEventListener("agrocylo:session-expired", onExpired);
  }, []);

  const loadConversation = useCallback(async () => {
    if (!walletSession) {
      setStatus("empty");
      return;
    }
    if (!walletSession.token) {
      setStatus("expired");
      return;
    }

    setStatus("loading");
    setError(null);

    try {
      const conv = await getCampaignConversation(campaignId, walletSession.token);
      if (conv) {
        setConversations([conv]);
        setSelectedConversation(conv);
        setStatus("ready");
      } else {
        setConversations([]);
        setSelectedConversation(null);
        setStatus("empty");
      }
    } catch (err) {
      if (isApiError(err)) {
        if (err.status === 401) {
          setStatus("expired");
          return;
        }
        if (err.status === 403) {
          setStatus("forbidden");
          setError(
            err.message ||
              "Only the campaign farmer or an active investor can access campaign messages.",
          );
          return;
        }
      }
      setError(
        err instanceof Error ? err.message : "Failed to load conversation",
      );
      setStatus("error");
    }
  }, [campaignId, walletSession]);

  useEffect(() => {
    void loadConversation();
  }, [loadConversation]);

  const handleStartConversation = async () => {
    if (!walletSession?.token) {
      setStatus("expired");
      return;
    }
    setStarting(true);
    setError(null);
    try {
      const created = await createCampaignConversation(
        campaignId,
        walletSession.token,
      );
      setConversations([created]);
      setSelectedConversation(created);
      setStatus("ready");
    } catch (err) {
      if (isApiError(err) && err.status === 403) {
        setStatus("forbidden");
        setError(
          err.message ||
            "Only campaign investors and the farmer can start conversations.",
        );
      } else if (isApiError(err) && err.status === 401) {
        setStatus("expired");
      } else {
        setError(
          err instanceof Error ? err.message : "Failed to start conversation",
        );
        setStatus("error");
      }
    } finally {
      setStarting(false);
    }
  };

  if (!walletSession) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-muted">Please connect your wallet to view messages.</p>
      </div>
    );
  }

  if (status === "loading") {
    return (
      <div
        role="status"
        aria-label="Loading conversation"
        className="flex items-center justify-center min-h-screen"
      >
        <div className="animate-spin rounded-full h-8 w-8 border border-primary border-t-transparent"></div>
      </div>
    );
  }

  if (status === "expired") {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center space-y-3">
          <p className="text-error">
            Your wallet session has expired. Please sign in again to view messages.
          </p>
          <button
            type="button"
            onClick={() => void loadConversation()}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (status === "forbidden") {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center space-y-2">
          <p className="text-error font-medium">Access denied</p>
          <p className="text-muted text-sm">
            {error ?? "Only the farmer or campaign investors can access this conversation."}
          </p>
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center space-y-3">
          <p className="text-error">{error ?? "Failed to load conversation"}</p>
          <button
            type="button"
            onClick={() => void loadConversation()}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (status === "empty" || conversations.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center space-y-3">
          <p className="text-muted">
            No conversations yet. Start one with the campaign farmer.
          </p>
          <button
            type="button"
            disabled={starting}
            onClick={() => void handleStartConversation()}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg disabled:opacity-50"
          >
            {starting ? "Starting..." : "Start conversation"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 h-screen bg-background p-4">
      {/* Conversation List */}
      <div className="md:col-span-1 bg-surface border border-border rounded-lg overflow-y-auto">
        <div className="p-4 border-b border-border sticky top-0 bg-surface">
          <h3 className="font-semibold">Messages</h3>
        </div>
        <div className="space-y-1 p-2">
          {conversations.map((conversation) => (
            <button
              key={conversation.id}
              onClick={() => setSelectedConversation(conversation)}
              className={`w-full text-left px-3 py-2 rounded transition ${
                selectedConversation?.id === conversation.id
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-muted text-foreground"
              }`}
            >
              <p className="text-sm font-medium truncate">
                {conversation.investorAddress === walletSession.address
                  ? conversation.farmerAddress
                  : conversation.investorAddress}
              </p>
              {conversation.messages?.[0]?.content && (
                <p className="text-xs text-muted truncate">
                  {conversation.messages[0].content}
                </p>
              )}
              {conversation.lastMessageAt && (
                <p className="text-xs text-muted">
                  {new Date(conversation.lastMessageAt).toLocaleDateString()}
                </p>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Message Thread */}
      <div className="md:col-span-3 bg-surface border border-border rounded-lg overflow-hidden">
        {selectedConversation ? (
          <MessageThread
            conversation={selectedConversation}
            currentWallet={walletSession.address}
            sessionToken={walletSession.token}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-muted">
            <p>Select a conversation to start messaging</p>
          </div>
        )}
      </div>
    </div>
  );
}
