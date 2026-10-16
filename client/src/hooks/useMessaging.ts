"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import type { Message, Conversation, TypingIndicator } from '../types/messaging';
import {
  messagingSocket,
  fetchConversations,
  fetchMessages,
  sendMessage,
  editMessage,
  deleteMessage,
  addReaction,
  markAsRead,
  searchMessages,
  sendTypingIndicator,
} from '../services/messagingService';

export function useMessaging(conversationId?: string) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const cursorRef = useRef<string | undefined>(undefined);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const isLoadingRef = useRef(false);
  const activeConversationIdRef = useRef<string | undefined>(conversationId);
  const requestIdRef = useRef(0);

  // Keep active id in sync without causing re-renders
  useEffect(() => {
    activeConversationIdRef.current = conversationId;
  }, [conversationId]);

  // Keep isLoadingRef in sync for guards that read state
  useEffect(() => {
    isLoadingRef.current = isLoading;
  }, [isLoading]);

  const loadConversations = useCallback(async () => {
    try {
      const data = await fetchConversations();
      setConversations(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load conversations');
    }
  }, []);

  // Load Conversations + socket for conversation list (stable, not dependent on message loading)
  useEffect(() => {
    void loadConversations();

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

  // Conversation-scoped history + subscriptions
  // Resets only when conversation identity changes; stable while loading toggles
  useEffect(() => {
    if (!conversationId) {
      setMessages([]);
      cursorRef.current = undefined;
      setHasMore(false);
      setTypingUsers(new Set());
      if (typingTimerRef.current) {
        clearTimeout(typingTimerRef.current);
        typingTimerRef.current = undefined;
      }
      return;
    }

    // Reset history/cursor/typing state only when conversation identity changes
    cursorRef.current = undefined;
    setMessages([]);
    setHasMore(false);
    setTypingUsers(new Set());
    setError(null);
    if (typingTimerRef.current) {
      clearTimeout(typingTimerRef.current);
      typingTimerRef.current = undefined;
    }

    const requestedConversationId = conversationId;
    const requestedCursor = undefined;
    const requestId = ++requestIdRef.current;
    isLoadingRef.current = true;
    setIsLoading(true);
    let cancelled = false;

    void (async () => {
      try {
        const { messages: newMessages, nextCursor } = await fetchMessages(
          requestedConversationId,
          requestedCursor,
        );
        if (cancelled) return;
        // Discard responses from superseded conversations
        if (activeConversationIdRef.current !== requestedConversationId) return;
        if (requestId !== requestIdRef.current) return;

        setMessages(prev => {
          // Merge by ID so HTTP and real-time delivery cannot create duplicates
          // For initial load prev is [] after reset; handle socket race by deduping
          const existingIds = new Set(prev.map(m => m.id));
          const unique = newMessages.filter(m => !existingIds.has(m.id));
          if (prev.length === 0) return unique;
          const fetchedIds = new Set(newMessages.map(m => m.id));
          return [...unique, ...prev.filter(m => !fetchedIds.has(m.id))];
        });
        cursorRef.current = nextCursor;
        setHasMore(!!nextCursor);
      } catch (err) {
        if (!cancelled && activeConversationIdRef.current === requestedConversationId && requestId === requestIdRef.current) {
          setError(err instanceof Error ? err.message : 'Failed to load messages');
        }
      } finally {
        if (!cancelled && requestId === requestIdRef.current && activeConversationIdRef.current === requestedConversationId) {
          isLoadingRef.current = false;
          setIsLoading(false);
        }
      }
    })();

    // Handle mark-as-read failures without unhandled promises
    void markAsRead(requestedConversationId).catch(() => {});

    const unsubMessage = messagingSocket.on('new_message', (msg: Message) => {
      if (msg.conversationId === requestedConversationId) {
        setMessages(prev => {
          if (prev.some(m => m.id === msg.id)) return prev;
          return [...prev, msg];
        });
        void markAsRead(requestedConversationId).catch(() => {});
      }
    });

    const unsubEdit = messagingSocket.on('message_edited', (msg: Message) => {
      if (msg.conversationId === requestedConversationId) {
        setMessages(prev => prev.map(m => m.id === msg.id ? msg : m));
      }
    });

    const unsubDelete = messagingSocket.on('message_deleted', ({ messageId }: { messageId: string }) => {
      setMessages(prev => prev.filter(m => m.id !== messageId));
    });

    const unsubReaction = messagingSocket.on('reaction_added', (msg: Message) => {
      if (msg.conversationId === requestedConversationId) {
        setMessages(prev => prev.map(m => m.id === msg.id ? msg : m));
      }
    });

    const unsubTyping = messagingSocket.on('typing', (indicator: TypingIndicator) => {
      if (indicator.conversationId === requestedConversationId) {
        setTypingUsers(prev => {
          const next = new Set(prev);
          if (indicator.isTyping) {
            next.add(indicator.userId);
          } else {
            next.delete(indicator.userId);
          }
          return next;
        });
      }
    });

    return () => {
      cancelled = true;
      // If this effect's request is still the latest, clear loading
      if (requestId === requestIdRef.current) {
        isLoadingRef.current = false;
        setIsLoading(false);
      }
      unsubMessage();
      unsubEdit();
      unsubDelete();
      unsubReaction();
      unsubTyping();
      if (typingTimerRef.current) {
        clearTimeout(typingTimerRef.current);
        typingTimerRef.current = undefined;
      }
    };
  }, [conversationId]);

  const loadMore = useCallback(() => {
    const cid = activeConversationIdRef.current;
    if (!cid) return;
    if (!hasMore) return;
    if (isLoadingRef.current) return;
    const requestedCursor = cursorRef.current;
    if (!requestedCursor) return;
    const requestedConversationId = cid;
    const requestId = ++requestIdRef.current;
    // Capture cursor before awaiting
    const capturedCursor = requestedCursor;
    isLoadingRef.current = true;
    setIsLoading(true);
    void (async () => {
      try {
        const { messages: newMessages, nextCursor } = await fetchMessages(
          requestedConversationId,
          capturedCursor,
        );
        if (activeConversationIdRef.current !== requestedConversationId) return;
        if (requestId !== requestIdRef.current) return;
        setMessages(prev => {
          const existingIds = new Set(prev.map(m => m.id));
          const unique = newMessages.filter(m => !existingIds.has(m.id));
          // Prepend older page before existing
          return [...unique, ...prev];
        });
        cursorRef.current = nextCursor;
        setHasMore(!!nextCursor);
      } catch (err) {
        if (activeConversationIdRef.current === requestedConversationId && requestId === requestIdRef.current) {
          setError(err instanceof Error ? err.message : 'Failed to load messages');
        }
      } finally {
        if (activeConversationIdRef.current === requestedConversationId && requestId === requestIdRef.current) {
          isLoadingRef.current = false;
          setIsLoading(false);
        }
      }
    })();
  }, [hasMore]);

  //  Send Message 

  const handleSend = useCallback(async (content: string, file?: File) => {
    if (!conversationId) return;
    
    try {
      const msg = await sendMessage(
        conversationId,
        content,
        file ? 'file' : 'text',
        file
      );
      setMessages(prev => {
        if (prev.some(m => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
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

  // Typing Indicator 

  const handleTyping = useCallback(() => {
    if (!conversationId) return;
    
    sendTypingIndicator(conversationId, true);
    
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => {
      sendTypingIndicator(conversationId, false);
    }, 3000);
  }, [conversationId]);

  // Cleanup typing timer on unmount
  useEffect(() => {
    return () => {
      if (typingTimerRef.current) {
        clearTimeout(typingTimerRef.current);
        typingTimerRef.current = undefined;
      }
    };
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
