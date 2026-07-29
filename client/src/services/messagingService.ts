import type { Message, Conversation } from '../types/messaging';
import { API_BASE_URL } from '../lib/apiConfig';
import { getAccessToken } from '../lib/authToken';

const API_BASE = API_BASE_URL;

function getAuthHeader(): { 'Authorization': string } | null {
  const token = getAccessToken();
  if (!token) return null;
  return { 'Authorization': `Bearer ${token}` };
}

//  REST API Methods

export async function createOrderConversation(orderId: string): Promise<Conversation> {
  const authHeader = getAuthHeader();
  if (!authHeader) throw new Error('Not authenticated');

  const res = await fetch(`${API_BASE}/api/v1/orders/${orderId}/conversation`, {
    method: 'POST',
    headers: authHeader,
  });
  if (!res.ok) throw new Error('Failed to create conversation');
  return res.json();
}

export async function fetchConversations(): Promise<Conversation[]> {
  const authHeader = getAuthHeader();
  if (!authHeader) throw new Error('Not authenticated');

  const res = await fetch(`${API_BASE}/api/v1/conversations`, {
    headers: authHeader,
  });
  if (!res.ok) throw new Error('Failed to fetch conversations');
  return res.json();
}

export async function fetchMessages(
  conversationId: string,
  cursor?: string,
  limit = 20
): Promise<{ messages: Message[]; nextCursor?: string }> {
  const authHeader = getAuthHeader();
  if (!authHeader) throw new Error('Not authenticated');

  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.append('cursor', cursor);

  const res = await fetch(
    `${API_BASE}/api/v1/conversations/${conversationId}/messages?${params}`,
    { headers: authHeader }
  );
  if (!res.ok) throw new Error('Failed to fetch messages');
  return res.json();
}

export async function sendMessage(
  conversationId: string,
  content: string
): Promise<Message> {
  const authHeader = getAuthHeader();
  if (!authHeader) throw new Error('Not authenticated');

  const res = await fetch(`${API_BASE}/api/v1/conversations/${conversationId}/messages`, {
    method: 'POST',
    headers: {
      ...authHeader,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) throw new Error('Failed to send message');
  return res.json();
}

export async function editMessage(
  conversationId: string,
  messageId: string,
  newContent: string
): Promise<Message> {
  const authHeader = getAuthHeader();
  if (!authHeader) throw new Error('Not authenticated');

  const res = await fetch(
    `${API_BASE}/api/v1/conversations/${conversationId}/messages/${messageId}`,
    {
      method: 'PATCH',
      headers: {
        ...authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content: newContent }),
    }
  );
  if (!res.ok) throw new Error('Failed to edit message');
  return res.json();
}

export async function deleteMessage(
  conversationId: string,
  messageId: string
): Promise<void> {
  const authHeader = getAuthHeader();
  if (!authHeader) throw new Error('Not authenticated');

  const res = await fetch(
    `${API_BASE}/api/v1/conversations/${conversationId}/messages/${messageId}`,
    {
      method: 'DELETE',
      headers: authHeader,
    }
  );
  if (!res.ok) throw new Error('Failed to delete message');
}

export async function markAsRead(conversationId: string): Promise<void> {
  const authHeader = getAuthHeader();
  if (!authHeader) throw new Error('Not authenticated');

  await fetch(`${API_BASE}/api/v1/conversations/${conversationId}/read`, {
    method: 'POST',
    headers: authHeader,
  });
}

export async function searchMessages(
  conversationId: string,
  query: string
): Promise<Message[]> {
  const authHeader = getAuthHeader();
  if (!authHeader) throw new Error('Not authenticated');

  const res = await fetch(
    `${API_BASE}/api/v1/conversations/${conversationId}/messages/search?q=${encodeURIComponent(query)}`,
    { headers: authHeader }
  );
  if (!res.ok) throw new Error('Search failed');
  return res.json();
}

// Admin Actions (placeholders - backend implementation needed)

export async function blockUser(conversationId: string, userId: string): Promise<void> {
  // TODO: Implement block user endpoint
  console.warn('blockUser not yet implemented');
}

export async function unblockUser(conversationId: string, userId: string): Promise<void> {
  // TODO: Implement unblock user endpoint
  console.warn('unblockUser not yet implemented');
}

export async function muteConversation(conversationId: string): Promise<void> {
  // TODO: Implement mute conversation endpoint
  console.warn('muteConversation not yet implemented');
}

export async function unmuteConversation(conversationId: string): Promise<void> {
  // TODO: Implement unmute conversation endpoint
  console.warn('unmuteConversation not yet implemented');
}

export async function archiveConversation(conversationId: string): Promise<void> {
  // TODO: Implement archive conversation endpoint
  console.warn('archiveConversation not yet implemented');
}

export async function reportMessage(
  conversationId: string,
  messageId: string,
  reason: string
): Promise<void> {
  // TODO: Implement report message endpoint
  console.warn('reportMessage not yet implemented');
}

// Push Notifications

export async function requestNotificationPermission(): Promise<boolean> {
  if (!('Notification' in window)) return false;

  const permission = await Notification.requestPermission();
  return permission === 'granted';
}

export function showNotification(title: string, options: NotificationOptions) {
  if (Notification.permission === 'granted') {
    new Notification(title, options);
  }
}
