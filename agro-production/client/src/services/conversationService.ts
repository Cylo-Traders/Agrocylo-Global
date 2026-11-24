"use client";

import api from "@/lib/apiClient";

/**
 * Issue #1256: the campaign messaging service rewritten against the
 * endpoints `agro-production/server/src/routes/conversations.ts`
 * actually implements. The pre-#1256 service called a flat
 * `/conversations` list route that the server never exposed, and sent
 * an `x-session-token` header that the server's `requireWallet`
 * middleware ignores (it reads `Authorization: Bearer`, the shape the
 * centralized `apiClient` already adds via `getAccessToken`).
 *
 * The service never reaches into browser storage. Auth lives on the
 * `apiClient` layer so a 401 goes through the shared session-expired
 * handler that #1255 pins down.
 */

export interface Message {
  id: string;
  conversationId: string;
  senderAddress: string;
  content: string;
  isRead: boolean;
  createdAt: string;
}

export interface Conversation {
  id: string;
  campaignId: string;
  investorAddress: string;
  farmerAddress: string;
  lastMessageAt?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Server response shape for `GET /conversations/:id/messages`. Pagination
 * is cursor-based (the server's `MessagePaginationSchema` reads
 * `cursor` + `limit` from the query string).
 */
export interface MessagesPage {
  messages: Message[];
  /** Opaque cursor the server returns when more history remains. */
  nextCursor?: string;
}

export interface ListMessagesOptions {
  cursor?: string;
  limit?: number;
}

/** Fetches the campaign's conversation. `null` means no thread exists yet. */
export async function getCampaignConversation(
  campaignId: string,
): Promise<Conversation | null> {
  return api.get<Conversation | null>(
    `/campaigns/${encodeURIComponent(campaignId)}/conversation`,
  );
}

/**
 * Creates the campaign's conversation (investor-initiated per the
 * server's `requireWallet` + investment check). The server is
 * idempotent: calling twice returns the existing conversation.
 */
export async function createCampaignConversation(
  campaignId: string,
): Promise<Conversation> {
  return api.post<Conversation>(
    `/campaigns/${encodeURIComponent(campaignId)}/conversation`,
    {},
  );
}

/**
 * Loads one page of message history ordered newest-first per the
 * server's query. Pass the previous page's `nextCursor` to walk
 * backwards through older messages.
 */
export async function getConversationMessages(
  conversationId: string,
  options: ListMessagesOptions = {},
): Promise<MessagesPage> {
  const params = new URLSearchParams();
  if (options.cursor) params.set("cursor", options.cursor);
  if (typeof options.limit === "number") params.set("limit", String(options.limit));
  const qs = params.toString();
  const suffix = qs ? `?${qs}` : "";
  return api.get<MessagesPage>(
    `/conversations/${encodeURIComponent(conversationId)}/messages${suffix}`,
  );
}

/** Sends one message to an existing conversation. */
export async function sendMessage(
  conversationId: string,
  content: string,
): Promise<Message> {
  return api.post<Message>(
    `/conversations/${encodeURIComponent(conversationId)}/messages`,
    { content },
  );
}
