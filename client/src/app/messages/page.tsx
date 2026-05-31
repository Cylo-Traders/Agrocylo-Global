import React, { useState } from 'react';
import { useMessaging } from '../../hooks/useMessaging';
import ConversationList from '../../components/ConversationList';
import ChatWindow from '../../components/ChatWindow';
import { blockUser, muteConversation, archiveConversation } from '../../services/messagingService';

export default function MessagesPage() {
  const [activeConversationId, setActiveConversationId] = useState<string>();
  const {
    conversations,
    messages,
    currentConversation,
    isLoading,
    hasMore,
    typingUsers,
    loadMore,
    sendMessage,
    editMessage,
    deleteMessage,
    addReaction,
    sendTyping,
    searchMessages,
  } = useMessaging(activeConversationId);

  const otherUser = currentConversation?.participants.find(p => p.id !== 'current-user');

  const handleBlock = async () => {
    if (!currentConversation || !otherUser) return;
    if (confirm(`Block ${otherUser.name}? You won't receive messages from them.`)) {
      await blockUser(currentConversation.id, otherUser.id);
    }
  };

  const handleMute = async () => {
    if (!currentConversation) return;
    await muteConversation(currentConversation.id);
  };

  const handleArchive = async () => {
    if (!currentConversation) return;
    await archiveConversation(currentConversation.id);
    setActiveConversationId(undefined);
  };

  return (
    <div className="h-screen flex bg-gray-50">
      {/* Sidebar - Conversation List */}
      <div className="w-80 shrink-0">
        <ConversationList
          conversations={conversations}
          activeId={activeConversationId}
          onSelect={setActiveConversationId}
          onMute={handleMute}
          onArchive={handleArchive}
        />
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 min-w-0">
        {activeConversationId && currentConversation ? (
          <ChatWindow
            messages={messages}
            currentUserId="current-user"
            otherUser={otherUser}
            isLoading={isLoading}
            hasMore={hasMore}
            typingUsers={typingUsers}
            onLoadMore={loadMore}
            onSend={sendMessage}
            onEdit={editMessage}
            onDelete={deleteMessage}
            onReact={addReaction}
            onTyping={sendTyping}
            onBlock={handleBlock}
            onMute={handleMute}
            onSearch={searchMessages}
          />
        ) : (
          <div className="h-full flex items-center justify-center text-gray-400">
            <div className="text-center">
              <svg className="w-16 h-16 mx-auto mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              <p className="text-lg font-medium">Select a conversation</p>
              <p className="text-sm mt-1">Choose a buyer or seller to start messaging</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}