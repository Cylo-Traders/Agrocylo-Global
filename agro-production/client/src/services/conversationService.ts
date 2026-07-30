"use client";

import api from "@/lib/apiClient";

export interface Message {
  id: string;
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
  messages?: Message[];
}

export async function getConversations(sessionToken: string): Promise<Conversation[]> {
  return api.get<Conversation[]>("/conversations", {
    headers: { "x-session-token": sessionToken },
  });
}

export async function getConversation(id: string, sessionToken: string): Promise<Conversation> {
  return api.get<Conversation>(`/conversations/${encodeURIComponent(id)}`, {
    headers: { "x-session-token": sessionToken },
  });
}

export async function createOrGetConversation(
  campaignId: string,
  otherParticipant: string,
  sessionToken: string,
): Promise<Conversation> {
  return api.post<Conversation>("/conversations", { campaignId, otherParticipant }, {
    headers: { "x-session-token": sessionToken },
  });
}

export async function sendMessage(
  conversationId: string,
  content: string,
  sessionToken: string,
): Promise<Message> {
  return api.post<Message>(`/conversations/${encodeURIComponent(conversationId)}/messages`, { content }, {
    headers: { "x-session-token": sessionToken },
  });
}
