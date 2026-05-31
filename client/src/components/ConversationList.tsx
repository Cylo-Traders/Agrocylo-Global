import React from 'react';
import type { Conversation } from '../types/messaging';

interface ConversationListProps {
  conversations: Conversation[];
  activeId?: string;
  onSelect: (id: string) => void;
  onArchive?: (id: string) => void;
  onMute?: (id: string) => void;
}

export default function ConversationList({
  conversations,
  activeId,
  onSelect,
  onArchive,
  onMute,
}: ConversationListProps) {
  const formatTime = (date: Date) => {
    const now = new Date();
    const d = new Date(date);
    const diff = now.getTime() - d.getTime();
    
    if (diff < 86400000) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (diff < 604800000) return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  const truncate = (text: string, max = 40) => {
    return text.length > max ? text.slice(0, max) + '...' : text;
  };

  return (
    <div className="w-full h-full bg-white border-r border-gray-200 flex flex-col">
      <div className="p-4 border-b border-gray-200">
        <h2 className="text-lg font-semibold text-gray-900">Messages</h2>
        <p className="text-sm text-gray-500 mt-1">{conversations.length} conversations</p>
      </div>

      <div className="flex-1 overflow-y-auto">
        {conversations.length === 0 ? (
          <div className="p-8 text-center text-gray-400">
            <p>No conversations yet</p>
            <p className="text-sm mt-1">Start trading to chat with buyers/sellers</p>
          </div>
        ) : (
          conversations.map((conv) => {
            const otherParticipant = conv.participants.find(p => p.id !== 'current-user');
            const isActive = conv.id === activeId;
            const isUnread = conv.unreadCount > 0;

            return (
              <div
                key={conv.id}
                onClick={() => onSelect(conv.id)}
                className={`
                  relative p-4 cursor-pointer transition-colors border-b border-gray-100
                  hover:bg-gray-50
                  ${isActive ? 'bg-blue-50 border-l-4 border-l-blue-500' : 'border-l-4 border-l-transparent'}
                  ${isUnread ? 'bg-blue-50/50' : ''}
                  ${conv.isArchived ? 'opacity-60' : ''}
                `}
              >
                <div className="flex items-start gap-3">
                  <div className="relative shrink-0">
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-green-400 to-blue-500 flex items-center justify-center text-white font-semibold">
                      {otherParticipant?.name?.charAt(0).toUpperCase() || '?'}
                    </div>
                    {otherParticipant?.isOnline && (
                      <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 rounded-full border-2 border-white" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <h3 className={`font-medium truncate ${isUnread ? 'text-gray-900' : 'text-gray-700'}`}>
                        {otherParticipant?.name || 'Unknown'}
                      </h3>
                      <span className="text-xs text-gray-400 shrink-0">
                        {conv.lastMessage ? formatTime(conv.lastMessage.createdAt) : ''}
                      </span>
                    </div>

                    <p className={`text-sm mt-1 truncate ${isUnread ? 'text-gray-900 font-medium' : 'text-gray-500'}`}>
                      {conv.lastMessage?.content || 'No messages yet'}
                    </p>

                    <div className="flex items-center gap-2 mt-2">
                      {conv.unreadCount > 0 && (
                        <span className="px-2 py-0.5 bg-blue-500 text-white text-xs rounded-full font-medium">
                          {conv.unreadCount}
                        </span>
                      )}
                      {conv.isMuted && (
                        <span className="text-gray-400">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                          </svg>
                        </span>
                      )}
                      {otherParticipant?.role === 'seller' && (
                        <span className="px-1.5 py-0.5 bg-green-100 text-green-700 text-xs rounded">Seller</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}