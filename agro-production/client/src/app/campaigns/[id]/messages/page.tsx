"use client";

/**
 * Issue #1256: campaign messaging rewritten against the implemented
 * conversation API. The pre-#1256 page forced a wallet session into
 * `{ address, token: "" }` and exited the loader whenever the token
 * was empty, so `loading` never flipped false and the view spun
 * forever. The same page also called a `GET /conversations` list the
 * server never exposed.
 *
 * The new page talks to the one endpoint the server actually has
 * (`GET /campaigns/:id/conversation`), reads the access token managed
 * by `authToken` through the centralized `apiClient` (so a 401 goes
 * through the shared session-expired path pinned by #1255), and loads
 * paginated history separately through `getConversationMessages`.
 *
 * View states are distinct so a user never sees the same spinner for
 * "no wallet", "not signed in", "forbidden", "empty", "network error"
 * or "really loading".
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { loadWalletSession } from "@/lib/walletSession";
import { getAccessToken } from "@/lib/authToken";
import { ApiError } from "@/lib/apiClient";
import {
  createCampaignConversation,
  getCampaignConversation,
  getConversationMessages,
  type Conversation,
  type Message,
} from "@/services/conversationService";
import MessageThread from "@/components/MessageThread";

/**
 * How the page is currently rendering. Extracted so a reviewer sees
 * every branch in one list and a future state is added to the union
 * rather than slipped in behind a boolean.
 */
type ViewState =
  | { kind: "no-wallet" }
  | { kind: "no-session" }
  | { kind: "loading" }
  | { kind: "forbidden" }
  | { kind: "empty"; canCreate: boolean; creating: boolean; createError: string | null }
  | { kind: "error"; message: string }
  | {
      kind: "open";
      conversation: Conversation;
      messages: Message[];
      nextCursor: string | undefined;
      loadingOlder: boolean;
    };

const HISTORY_PAGE_SIZE = 50;

export default function MessagesPage() {
  const params = useParams();
  const campaignId = params.id as string;

  // Browser storage is read once, lazily, in the first render — not mirrored
  // from state inside an effect (#1084). `loadWalletSession` is a no-op on
  // the server, so SSR still renders the "connect your wallet" branch.
  const [walletSession] = useState(() => loadWalletSession());
  const [accessToken] = useState<string | null>(() => getAccessToken());

  const [view, setView] = useState<ViewState>(() => {
    if (!walletSession) return { kind: "no-wallet" };
    if (!accessToken) return { kind: "no-session" };
    return { kind: "loading" };
  });

  // `view` carries every runtime piece the thread needs. Read it as a
  // plain variable inside the loader closure so the narrowing survives.
  const walletAddress = walletSession?.address;

  const loadConversation = useCallback(
    async (signal?: { cancelled: boolean }) => {
      try {
        const conversation = await getCampaignConversation(campaignId);
        if (signal?.cancelled) return;
        if (!conversation) {
          setView({
            kind: "empty",
            // Server-side `POST /campaigns/:id/conversation` is
            // investor-initiated; farmer sees "empty" without a
            // create action. We cannot know the role on the client
            // ahead of a POST, so the button attempts to create and
            // surfaces the server's 400 to the farmer path.
            canCreate: true,
            creating: false,
            createError: null,
          });
          return;
        }
        const history = await getConversationMessages(conversation.id, {
          limit: HISTORY_PAGE_SIZE,
        });
        if (signal?.cancelled) return;
        setView({
          kind: "open",
          conversation,
          // History arrives newest-first per the server's query; the
          // thread renders oldest-at-top, so flip here once.
          messages: [...history.messages].reverse(),
          nextCursor: history.nextCursor,
          loadingOlder: false,
        });
      } catch (err) {
        if (signal?.cancelled) return;
        if (err instanceof ApiError && err.status === 403) {
          setView({ kind: "forbidden" });
          return;
        }
        // A 401 is already consumed by the apiClient layer (#1255
        // clears the token and dispatches session-expired). The thrown
        // ApiError still reaches here, so surface it as "no session"
        // rather than a generic error.
        if (err instanceof ApiError && err.status === 401) {
          setView({ kind: "no-session" });
          return;
        }
        setView({
          kind: "error",
          message: err instanceof Error ? err.message : "Failed to load messages",
        });
      }
    },
    [campaignId],
  );

  useEffect(() => {
    if (view.kind !== "loading") return;
    const signal = { cancelled: false };
    void loadConversation(signal);
    return () => {
      signal.cancelled = true;
    };
  }, [view.kind, loadConversation]);

  const handleCreate = useCallback(async () => {
    if (view.kind !== "empty" || view.creating) return;
    setView({ ...view, creating: true, createError: null });
    try {
      const conversation = await createCampaignConversation(campaignId);
      const history = await getConversationMessages(conversation.id, {
        limit: HISTORY_PAGE_SIZE,
      });
      setView({
        kind: "open",
        conversation,
        messages: [...history.messages].reverse(),
        nextCursor: history.nextCursor,
        loadingOlder: false,
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        // Farmer-initiated create is rejected by the server; fall
        // back to the empty state with a clear message instead of
        // the generic error.
        setView({
          kind: "empty",
          canCreate: false,
          creating: false,
          createError:
            "Only investors can start a campaign conversation. Wait for an investor to reach out.",
        });
        return;
      }
      if (err instanceof ApiError && err.status === 403) {
        setView({ kind: "forbidden" });
        return;
      }
      setView({
        ...view,
        creating: false,
        createError: err instanceof Error ? err.message : "Failed to start the conversation",
      });
    }
  }, [campaignId, view]);

  const handleOlder = useCallback(async () => {
    if (view.kind !== "open" || view.loadingOlder || !view.nextCursor) return;
    setView({ ...view, loadingOlder: true });
    try {
      const page = await getConversationMessages(view.conversation.id, {
        cursor: view.nextCursor,
        limit: HISTORY_PAGE_SIZE,
      });
      setView((current) => {
        if (current.kind !== "open") return current;
        return {
          ...current,
          messages: [...[...page.messages].reverse(), ...current.messages],
          nextCursor: page.nextCursor,
          loadingOlder: false,
        };
      });
    } catch {
      setView((current) =>
        current.kind === "open" ? { ...current, loadingOlder: false } : current,
      );
    }
  }, [view]);

  const handleNewMessage = useCallback((message: Message) => {
    setView((current) => {
      if (current.kind !== "open") return current;
      // Drop duplicates (WebSocket + optimistic insert on send).
      if (current.messages.some((m) => m.id === message.id)) return current;
      return { ...current, messages: [...current.messages, message] };
    });
  }, []);

  const otherParticipant = useMemo(() => {
    if (view.kind !== "open" || !walletAddress) return null;
    return walletAddress.toLowerCase() === view.conversation.investorAddress.toLowerCase()
      ? view.conversation.farmerAddress
      : view.conversation.investorAddress;
  }, [view, walletAddress]);

  if (view.kind === "no-wallet") {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-muted">Please connect your wallet to view messages.</p>
      </div>
    );
  }

  if (view.kind === "no-session") {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-muted">Your session has expired. Sign in again to view messages.</p>
      </div>
    );
  }

  if (view.kind === "loading") {
    return (
      <div className="flex items-center justify-center min-h-screen" aria-busy="true">
        <div className="animate-spin rounded-full h-8 w-8 border border-primary border-t-transparent" />
      </div>
    );
  }

  if (view.kind === "forbidden") {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-muted">
          You cannot view this campaign's conversation. Only the farmer and campaign
          investors have access.
        </p>
      </div>
    );
  }

  if (view.kind === "error") {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <p className="text-error mb-4">{view.message}</p>
          <button
            type="button"
            className="px-4 py-2 bg-primary text-primary-foreground rounded"
            onClick={() => setView({ kind: "loading" })}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (view.kind === "empty") {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center max-w-md">
          <p className="text-muted mb-4">
            No conversation yet for this campaign.
          </p>
          {view.canCreate && (
            <button
              type="button"
              className="px-4 py-2 bg-primary text-primary-foreground rounded disabled:opacity-60"
              onClick={handleCreate}
              disabled={view.creating}
            >
              {view.creating ? "Starting..." : "Start conversation"}
            </button>
          )}
          {view.createError && (
            <p className="text-error text-sm mt-3">{view.createError}</p>
          )}
        </div>
      </div>
    );
  }

  // view.kind === 'open'
  return (
    <div className="h-screen bg-background p-4">
      <div className="h-full bg-surface border border-border rounded-lg overflow-hidden flex flex-col">
        <div className="p-4 border-b border-border">
          <h3 className="font-semibold">Campaign conversation</h3>
          {otherParticipant && (
            <p className="text-xs text-muted truncate">with {otherParticipant}</p>
          )}
          {view.nextCursor && (
            <button
              type="button"
              className="text-xs underline text-muted mt-1 disabled:opacity-60"
              onClick={handleOlder}
              disabled={view.loadingOlder}
            >
              {view.loadingOlder ? "Loading older..." : "Load older messages"}
            </button>
          )}
        </div>
        <MessageThread
          conversation={view.conversation}
          currentWallet={walletAddress ?? ""}
          initialMessages={view.messages}
          onNewMessage={handleNewMessage}
        />
      </div>
    </div>
  );
}
