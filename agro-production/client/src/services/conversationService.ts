"use client";

import api from "@/lib/apiClient";

export interface Message {
  id: string;
  conversationId?: string;
  senderAddress: string;
  content: string;
  isRead?: boolean;
  createdAt: string;
  deletedAt?: string | null;
}

export interface Conversation {
  id: string;
  campaignId: string;
  investorAddress: string;
  farmerAddress: string;
  lastMessageAt?: string;
  createdAt: string;
  updatedAt: string;
  messages?: Message[];
}

export interface PaginatedMessagesResponse {
  messages: Message[];
  nextCursor?: string;
}

function authHeaders(sessionToken?: string): Record<string, string> | undefined {
  if (!sessionToken) return undefined;
  return { Authorization: `Bearer ${sessionToken}` };
}

export async function getCampaignConversation(
  campaignId: string,
  sessionToken?: string,
): Promise<Conversation | null> {
  return api.get<Conversation | null>(
    `/campaigns/${encodeURIComponent(campaignId)}/conversation`,
    { headers: authHeaders(sessionToken) },
  );
}

export async function createCampaignConversation(
  campaignId: string,
  sessionToken?: string,
): Promise<Conversation> {
  return api.post<Conversation>(
    `/campaigns/${encodeURIComponent(campaignId)}/conversation`,
    {},
    { headers: authHeaders(sessionToken) },
  );
}

export async function getConversationMessages(
  conversationId: string,
  params: { cursor?: string; limit?: number } = {},
  sessionToken?: string,
): Promise<PaginatedMessagesResponse> {
  const search = new URLSearchParams();
  if (params.cursor) search.set("cursor", params.cursor);
  if (params.limit) search.set("limit", String(params.limit));
  const qs = search.toString();
  const suffix = qs ? `?${qs}` : "";
  return api.get<PaginatedMessagesResponse>(
    `/conversations/${encodeURIComponent(conversationId)}/messages${suffix}`,
    { headers: authHeaders(sessionToken) },
  );
}

export async function sendMessage(
  conversationId: string,
  content: string,
  sessionToken?: string,
): Promise<Message> {
  return api.post<Message>(
    `/conversations/${encodeURIComponent(conversationId)}/messages`,
    { content },
    { headers: authHeaders(sessionToken) },
  );
}
