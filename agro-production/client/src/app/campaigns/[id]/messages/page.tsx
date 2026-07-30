"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { loadWalletSession } from "@/lib/walletSession";
import { getConversations, createOrGetConversation, type Conversation } from "@/services/conversationService";
import MessageThread from "@/components/MessageThread";

export default function MessagesPage() {
  const params = useParams();
  const campaignId = params.id as string;

  const [walletSession, setWalletSession] = useState<{ address: string; token: string } | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const session = loadWalletSession();
    if (!session) {
      setError("Wallet not connected");
      setLoading(false);
      return;
    }

    // TODO: Get sessionToken from auth system
    // For now, we'll need this to be passed in or stored in a context
    setWalletSession({ address: session.address, token: "" });
  }, []);

  useEffect(() => {
    if (!walletSession?.token) return;

    async function loadConversations() {
      try {
        const data = await getConversations(walletSession.token);
        const campaignConversations = data.filter((c) => c.campaignId === campaignId);
        setConversations(campaignConversations);
        if (campaignConversations.length > 0) {
          setSelectedConversation(campaignConversations[0]);
        }
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load conversations");
      } finally {
        setLoading(false);
      }
    }

    loadConversations();
  }, [campaignId, walletSession]);

  if (!walletSession) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-muted">Please connect your wallet to view messages.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border border-primary border-t-transparent"></div>
      </div>
    );
  }

  if (error && !conversations.length) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <p className="text-error mb-4">{error}</p>
          <p className="text-muted text-sm">No conversations yet.</p>
        </div>
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-muted">No conversations yet. Start one by clicking "Message" on an investment.</p>
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
