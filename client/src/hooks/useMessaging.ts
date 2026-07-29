"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import type { Message, Conversation, TypingIndicator } from '../types/messaging';
import {
  fetchConversations,
  fetchMessages,
  sendMessage,
  editMessage,
  deleteMessage,
  addReaction,
  markAsRead,
  searchMessages,
} from '../services/messagingService';
import { useSocket } from './useSocket';

export function useMessaging(conversationId?: string, currentUserId?: string) {
  const { on } = useSocket();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const cursorRef = useRef<string | undefined>(undefined);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const loadConversations = useCallback(async () => {
    try {
      const data = await fetchConversations();
      setConversations(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load conversations');
    }
  }, []);

  const loadMessages = useCallback(async () => {
    if (!conversationId || isLoading) return;

    setIsLoading(true);
    try {
      const { messages: newMessages, nextCursor } = await fetchMessages(
        conversationId,
        cursorRef.current
      );

      setMessages(prev => cursorRef.current ? [...newMessages, ...prev] : newMessages);
      cursorRef.current = nextCursor;
      setHasMore(!!nextCursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load messages');
    } finally {
      setIsLoading(false);
    }
  }, [conversationId, isLoading]);

  // Load Conversations

  useEffect(() => {
    loadConversations();

    const unsubNew = messagingSocket.on('new_conversation', (conv: Conversation) => {
      setConversations(prev => [conv, ...prev]);
    });

    const unsubUpdate = messagingSocket.on('conversation_updated', (conv: Conversation) => {
      setConversations(prev => prev.map(c => c.id === conv.id ? conv : c));
    });

    return () => {
      unsubNew();
      unsubUpdate();
    };
  }, [loadConversations]);

  // Load Messages

  useEffect(() => {
    if (!conversationId) return;

    cursorRef.current = undefined;
    loadMessages();
    markAsRead(conversationId);

    const unsubMessage = on('message:new', (data: unknown) => {
      const payload = data as { conversationId?: string; message?: Message };
      if (payload.conversationId === conversationId && payload.message) {
        setMessages(prev => [...prev, payload.message]);
        markAsRead(conversationId);
      }
    });

    const unsubEdit = on('message:edited', (data: unknown) => {
      const payload = data as { conversationId?: string; message?: Message };
      if (payload.conversationId === conversationId && payload.message) {
        setMessages(prev => prev.map(m => m.id === payload.message!.id ? payload.message! : m));
      }
    });

    const unsubDelete = on('message:deleted', (data: unknown) => {
      const payload = data as { conversationId?: string; messageId?: string };
      if (payload.conversationId === conversationId && payload.messageId) {
        setMessages(prev => prev.filter(m => m.id !== payload.messageId));
      }
    });

    return () => {
      unsubMessage();
      unsubEdit();
      unsubDelete();
    };
  }, [conversationId, loadMessages, on]);

  const loadMore = () => {
    if (hasMore && !isLoading) {
      loadMessages();
    }
  };

  //  Send Message

  const handleSend = useCallback(async (content: string) => {
    if (!conversationId) return;

    try {
      const msg = await sendMessage(conversationId, content);
      setMessages(prev => [...prev, msg]);
      return msg;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send');
      throw err;
    }
  }, [conversationId]);

  // Edit Message 

  const handleEdit = useCallback(async (messageId: string, newContent: string) => {
    if (!conversationId) return;
    
    try {
      const msg = await editMessage(conversationId, messageId, newContent);
      setMessages(prev => prev.map(m => m.id === msg.id ? msg : m));
      return msg;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to edit');
      throw err;
    }
  }, [conversationId]);

  // Delete Message 

  const handleDelete = useCallback(async (messageId: string) => {
    if (!conversationId) return;
    
    try {
      await deleteMessage(conversationId, messageId);
      setMessages(prev => prev.filter(m => m.id !== messageId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete');
      throw err;
    }
  }, [conversationId]);

  //  React 

  const handleReact = useCallback(async (messageId: string, emoji: string) => {
    if (!conversationId) return;
    
    try {
      await addReaction(conversationId, messageId, emoji);
      // Optimistic update
      setMessages(prev => prev.map(m => {
        if (m.id !== messageId) return m;
        const hasReaction = m.reactions.some(r => r.userId === 'current-user' && r.emoji === emoji);
        return {
          ...m,
          reactions: hasReaction
            ? m.reactions.filter(r => !(r.userId === 'current-user' && r.emoji === emoji))
            : [...m.reactions, { userId: 'current-user', emoji }],
        };
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to react');
    }
  }, [conversationId]);

  // Search 

  const handleSearch = useCallback(async (query: string) => {
    if (!conversationId || !query.trim()) return [];
    
    try {
      return await searchMessages(conversationId, query);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
      return [];
    }
  }, [conversationId]);

  // Typing Indicator (placeholder - not yet implemented)

  const handleTyping = useCallback(() => {
    // TODO: Implement typing indicator via WebSocket
    // This requires the real WebSocket to support typing events
  }, []);

  // Current Conversation 

  const currentConversation = conversations.find(c => c.id === conversationId);

  return {
    conversations,
    messages,
    currentConversation,
    isLoading,
    hasMore,
    typingUsers,
    error,
    loadMore,
    sendMessage: handleSend,
    editMessage: handleEdit,
    deleteMessage: handleDelete,
    addReaction: handleReact,
    searchMessages: handleSearch,
    sendTyping: handleTyping,
    refreshConversations: loadConversations,
  };
}
