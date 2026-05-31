import React, { useState, useRef, useEffect, useCallback } from 'react';
import type { Message, User } from '../types/messaging';

interface ChatWindowProps {
  messages: Message[];
  currentUserId: string;
  otherUser?: User;
  isLoading: boolean;
  hasMore: boolean;
  typingUsers: Set<string>;
  onLoadMore: () => void;
  onSend: (content: string, file?: File) => Promise<void>;
  onEdit: (messageId: string, content: string) => Promise<void>;
  onDelete: (messageId: string) => Promise<void>;
  onReact: (messageId: string, emoji: string) => void;
  onTyping: () => void;
  onBlock?: () => void;
  onReport?: (messageId: string) => void;
  onMute?: () => void;
  onSearch?: (query: string) => Promise<Message[]>;
}

const EMOJI_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🎉'];

export default function ChatWindow({
  messages,
  currentUserId,
  otherUser,
  isLoading,
  hasMore,
  typingUsers,
  onLoadMore,
  onSend,
  onEdit,
  onDelete,
  onReact,
  onTyping,
  onBlock,
  onReport,
  onMute,
  onSearch,
}: ChatWindowProps) {
  const [input, setInput] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [showEmojiPicker, setShowEmojiPicker] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Message[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const messagesEndRef = useRef<<HTMLDivElement>(null);
  const messagesContainerRef = useRef<<HTMLDivElement>(null);
  const fileInputRef = useRef<<HTMLInputElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (!hasMore) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages.length, hasMore]);

  // Handle scroll for pagination
  const handleScroll = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container || isLoading || !hasMore) return;
    
    if (container.scrollTop < 100) {
      onLoadMore();
    }
  }, [isLoading, hasMore, onLoadMore]);

  const handleSend = async () => {
    if (!input.trim() && !selectedFile) return;
    
    try {
      await onSend(input.trim(), selectedFile || undefined);
      setInput('');
      setSelectedFile(null);
    } catch (err) {
      console.error('Failed to send:', err);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    } else {
      onTyping();
    }
  };

  const startEdit = (msg: Message) => {
    setEditingId(msg.id);
    setEditContent(msg.content);
  };

  const saveEdit = async () => {
    if (!editingId || !editContent.trim()) return;
    
    try {
      await onEdit(editingId, editContent.trim());
      setEditingId(null);
      setEditContent('');
    } catch (err) {
      console.error('Failed to edit:', err);
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim() || !onSearch) return;
    
    setIsSearching(true);
    try {
      const results = await onSearch(searchQuery);
      setSearchResults(results);
    } catch (err) {
      console.error('Search failed:', err);
    } finally {
      setIsSearching(false);
    }
  };

  const formatMessageTime = (date: Date) => {
    return new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const isOwnMessage = (msg: Message) => msg.senderId === currentUserId;

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Header  */}
      <div className="px-6 py-4 bg-white border-b border-gray-200 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-green-400 to-blue-500 flex items-center justify-center text-white font-semibold">
              {otherUser?.name?.charAt(0).toUpperCase() || '?'}
            </div>
            {otherUser?.isOnline && (
              <div className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-green-500 rounded-full border-2 border-white" />
            )}
          </div>
          <div>
            <h3 className="font-semibold text-gray-900">{otherUser?.name || 'Unknown'}</h3>
            <p className="text-xs text-gray-500">
              {otherUser?.isOnline ? 'Online' : otherUser?.lastSeen ? `Last seen ${new Date(otherUser.lastSeen).toLocaleDateString()}` : 'Offline'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Search */}
          <div className="relative">
            <input
              type="text"
              placeholder="Search messages..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              className="pl-9 pr-4 py-2 bg-gray-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-48"
            />
            <svg className="w-4 h-4 text-gray-400 absolute left-3 top-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>

          {/* Actions dropdown */}
          <div className="relative group">
            <button className="p-2 hover:bg-gray-100 rounded-lg">
              <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
              </svg>
            </button>
            <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border border-gray-200 hidden group-hover:block z-50">
              {onMute && (
                <button onClick={onMute} className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2">
                  <span>🔕</span> Mute conversation
                </button>
              )}
              {onBlock && (
                <button onClick={onBlock} className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50 text-red-600 flex items-center gap-2">
                  <span>🚫</span> Block user
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/*  Search Results  */}
      {searchResults.length > 0 && (
        <div className="bg-yellow-50 px-4 py-2 border-b border-yellow-200 flex items-center justify-between">
          <span className="text-sm text-yellow-800">{searchResults.length} results found</span>
          <button onClick={() => { setSearchResults([]); setSearchQuery(''); }} className="text-sm text-yellow-600 hover:text-yellow-800">
            Clear
          </button>
        </div>
      )}

      {/* Messages Area  */}
      <div
        ref={messagesContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-6 py-4 space-y-4"
      >
        {isLoading && hasMore && (
          <div className="text-center py-2">
            <div className="inline-block w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {messages.map((msg) => {
          const own = isOwnMessage(msg);
          const showPicker = showEmojiPicker === msg.id;

          return (
            <div
              key={msg.id}
              className={`flex ${own ? 'justify-end' : 'justify-start'} group`}
            >
              <div className={`max-w-[70%] ${own ? 'bg-blue-500 text-white' : 'bg-white text-gray-900'} rounded-2xl px-4 py-2.5 shadow-sm relative`}>
                {/* Edit mode */}
                {editingId === msg.id ? (
                  <div className="flex items-center gap-2">
                    <input
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && saveEdit()}
                      className="flex-1 px-2 py-1 rounded border text-gray-900 text-sm"
                      autoFocus
                    />
                    <button onClick={saveEdit} className="text-green-500 text-sm">✓</button>
                    <button onClick={() => setEditingId(null)} className="text-red-500 text-sm">✕</button>
                  </div>
                ) : (
                  <>
                    {/* File attachment */}
                    {msg.type === 'file' && msg.fileUrl && (
                      <a
                        href={msg.fileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`flex items-center gap-2 p-2 rounded-lg mb-2 ${own ? 'bg-blue-600' : 'bg-gray-100'}`}
                      >
                        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        <div className="text-sm">
                          <p className="font-medium truncate">{msg.fileName}</p>
                          <p className="text-xs opacity-75">{msg.fileSize && `${(msg.fileSize / 1024).toFixed(1)} KB`}</p>
                        </div>
                      </a>
                    )}

                    {/* Text content */}
                    <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>

                    {/* Edited indicator */}
                    {msg.isEdited && (
                      <span className={`text-xs ${own ? 'text-blue-200' : 'text-gray-400'} ml-2`}>edited</span>
                    )}

                    {/* Reactions */}
                    {msg.reactions.length > 0 && (
                      <div className="flex gap-1 mt-1.5 flex-wrap">
                        {msg.reactions.map((r, i) => (
                          <span key={i} className={`text-xs px-1.5 py-0.5 rounded-full ${own ? 'bg-blue-600' : 'bg-gray-100'}`}>
                            {r.emoji}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Time & Read receipts */}
                    <div className={`flex items-center gap-1 mt-1 justify-end ${own ? 'text-blue-200' : 'text-gray-400'}`}>
                      <span className="text-xs">{formatMessageTime(msg.createdAt)}</span>
                      {own && (
                        <span>
                          {msg.readBy.length > 1 ? (
                            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                              <path d="M18 3a1 1 0 00-1.447-.894L8.763 6H5a3 3 0 000 6h.28l.817 4.908A1 1 0 007.755 18h.486a1 1 0 00.928-1.371L7.763 10H18a1 1 0 001-1V4a1 1 0 00-1-1zM5 10a1 1 0 010-2h2.5a1 1 0 010 2H5z" />
                            </svg>
                          ) : (
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </span>
                      )}
                    </div>
                  </>
                )}

                {/* Hover actions */}
                {!editingId && (
                  <div className={`absolute ${own ? 'left-0 -translate-x-full' : 'right-0 translate-x-full'} top-2 hidden group-hover:flex items-center gap-1 px-2`}>
                    <button
                      onClick={() => setShowEmojiPicker(showPicker ? null : msg.id)}
                      className="p-1 hover:bg-gray-100 rounded text-gray-500"
                    >
                      😊
                    </button>
                    {own && (
                      <>
                        <button onClick={() => startEdit(msg)} className="p-1 hover:bg-gray-100 rounded text-gray-500">
                          ✏️
                        </button>
                        <button onClick={() => onDelete(msg.id)} className="p-1 hover:bg-gray-100 rounded text-red-500">
                          🗑️
                        </button>
                      </>
                    )}
                    {onReport && (
                      <button onClick={() => onReport(msg.id)} className="p-1 hover:bg-gray-100 rounded text-gray-500">
                        ⚠️
                      </button>
                    )}
                  </div>
                )}

                {/* Emoji picker */}
                {showPicker && (
                  <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-white rounded-lg shadow-lg border border-gray-200 p-2 flex gap-1 z-50">
                    {EMOJI_REACTIONS.map(emoji => (
                      <button
                        key={emoji}
                        onClick={() => { onReact(msg.id, emoji); setShowEmojiPicker(null); }}
                        className="hover:bg-gray-100 p-1 rounded text-lg"
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {/* Typing indicator */}
        {typingUsers.size > 0 && (
          <div className="flex justify-start">
            <div className="bg-white rounded-2xl px-4 py-3 shadow-sm">
              <div className="flex gap-1">
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Area  */}
      <div className="px-6 py-4 bg-white border-t border-gray-200">
        {selectedFile && (
          <div className="flex items-center gap-2 mb-2 px-3 py-2 bg-gray-100 rounded-lg">
            <span className="text-sm text-gray-600">📎 {selectedFile.name}</span>
            <button onClick={() => setSelectedFile(null)} className="text-red-500 text-sm">✕</button>
          </div>
        )}

        <div className="flex items-end gap-2">
          <input
            type="file"
            ref={fileInputRef}
            onChange={(e) => e.target.files?.[0] && setSelectedFile(e.target.files[0])}
            className="hidden"
          />
          
          <button
            onClick={() => fileInputRef.current?.click()}
            className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
            </svg>
          </button>

          <div className="flex-1 relative">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a message..."
              rows={1}
              className="w-full px-4 py-2.5 bg-gray-100 rounded-2xl resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 max-h-32"
              style={{ minHeight: '44px' }}
            />
          </div>

          <button
            onClick={handleSend}
            disabled={!input.trim() && !selectedFile}
            className="p-2.5 bg-blue-500 text-white rounded-full hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}