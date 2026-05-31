import type { Message, Conversation } from '../types/messaging';
import { API_BASE_URL } from '../lib/apiConfig';

const API_BASE = API_BASE_URL;

interface WebSocketPayload {
  type: string;
  payload: unknown;
}

//  WebSocket Connection

class MessagingWebSocket {
  private ws: WebSocket | null = null;
  private listeners: Map<string, Set<(data: WebSocketPayload) => void>> = new Map();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;

  connect(token: string) {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    const wsUrl = `${API_BASE.replace('http', 'ws')}/messaging?token=${token}`;
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.emit('connected', {});
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.emit(data.type, data.payload);
      } catch (err) {
        console.error('Failed to parse WebSocket message:', err);
      }
    };

    this.ws.onclose = () => {
      this.attemptReconnect(token);
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      this.emit('error', error);
    };
  }

  private attemptReconnect(token: string) {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) return;
    
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      this.connect(token);
    }, Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000));
  }

  on(event: string, callback: (data: WebSocketPayload) => void) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);

    return () => this.off(event, callback);
  }

  off(event: string, callback: (data: WebSocketPayload) => void) {
    this.listeners.get(event)?.delete(callback);
  }

  private emit(event: string, data: WebSocketPayload) {
    this.listeners.get(event)?.forEach(cb => cb(data));
  }

  send(type: string, payload: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, payload }));
    }
  }

  disconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
  }
}

export const messagingSocket = new MessagingWebSocket();

//  REST API Methods 

export async function fetchConversations(): Promise<Conversation[]> {
  const res = await fetch(`${API_BASE}/conversations`, {
    credentials: 'include',
  });
  if (!res.ok) throw new Error('Failed to fetch conversations');
  return res.json();
}

export async function fetchMessages(
  conversationId: string,
  cursor?: string,
  limit = 20
): Promise<{ messages: Message[]; nextCursor?: string }> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.append('cursor', cursor);
  
  const res = await fetch(
    `${API_BASE}/conversations/${conversationId}/messages?${params}`,
    { credentials: 'include' }
  );
  if (!res.ok) throw new Error('Failed to fetch messages');
  return res.json();
}

export async function sendMessage(
  conversationId: string,
  content: string,
  type: Message['type'] = 'text',
  file?: File,
  replyTo?: string
): Promise<Message> {
  const formData = new FormData();
  formData.append('content', content);
  formData.append('type', type);
  if (file) formData.append('file', file);
  if (replyTo) formData.append('replyTo', replyTo);

  const res = await fetch(`${API_BASE}/conversations/${conversationId}/messages`, {
    method: 'POST',
    body: formData,
    credentials: 'include',
  });
  if (!res.ok) throw new Error('Failed to send message');
  return res.json();
}

export async function editMessage(
  conversationId: string,
  messageId: string,
  newContent: string
): Promise<Message> {
  const res = await fetch(
    `${API_BASE}/conversations/${conversationId}/messages/${messageId}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: newContent }),
      credentials: 'include',
    }
  );
  if (!res.ok) throw new Error('Failed to edit message');
  return res.json();
}

export async function deleteMessage(
  conversationId: string,
  messageId: string
): Promise<void> {
  const res = await fetch(
    `${API_BASE}/conversations/${conversationId}/messages/${messageId}`,
    {
      method: 'DELETE',
      credentials: 'include',
    }
  );
  if (!res.ok) throw new Error('Failed to delete message');
}

export async function addReaction(
  conversationId: string,
  messageId: string,
  emoji: string
): Promise<void> {
  const res = await fetch(
    `${API_BASE}/conversations/${conversationId}/messages/${messageId}/reactions`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emoji }),
      credentials: 'include',
    }
  );
  if (!res.ok) throw new Error('Failed to add reaction');
}

export async function markAsRead(conversationId: string): Promise<void> {
  await fetch(`${API_BASE}/conversations/${conversationId}/read`, {
    method: 'POST',
    credentials: 'include',
  });
}

export async function searchMessages(
  conversationId: string,
  query: string
): Promise<Message[]> {
  const res = await fetch(
    `${API_BASE}/conversations/${conversationId}/messages/search?q=${encodeURIComponent(query)}`,
    { credentials: 'include' }
  );
  if (!res.ok) throw new Error('Search failed');
  return res.json();
}

// Admin Actions 

export async function blockUser(conversationId: string, userId: string): Promise<void> {
  await fetch(`${API_BASE}/conversations/${conversationId}/block`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
    credentials: 'include',
  });
}

export async function unblockUser(conversationId: string, userId: string): Promise<void> {
  await fetch(`${API_BASE}/conversations/${conversationId}/unblock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
    credentials: 'include',
  });
}

export async function muteConversation(conversationId: string): Promise<void> {
  await fetch(`${API_BASE}/conversations/${conversationId}/mute`, {
    method: 'POST',
    credentials: 'include',
  });
}

export async function unmuteConversation(conversationId: string): Promise<void> {
  await fetch(`${API_BASE}/conversations/${conversationId}/unmute`, {
    method: 'POST',
    credentials: 'include',
  });
}

export async function archiveConversation(conversationId: string): Promise<void> {
  await fetch(`${API_BASE}/conversations/${conversationId}/archive`, {
    method: 'POST',
    credentials: 'include',
  });
}

export async function reportMessage(
  conversationId: string,
  messageId: string,
  reason: string
): Promise<void> {
  await fetch(`${API_BASE}/conversations/${conversationId}/report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messageId, reason }),
    credentials: 'include',
  });
}

// Typing Indicators 

export function sendTypingIndicator(conversationId: string, isTyping: boolean) {
  messagingSocket.send('typing', { conversationId, isTyping });
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