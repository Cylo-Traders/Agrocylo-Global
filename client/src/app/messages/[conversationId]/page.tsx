import React from 'react';
import MessagesPage from '../page';

// This is a wrapper that pre-selects the conversation from URL
export default function ConversationPage({ params }: { params: { conversationId: string } }) {
  return <MessagesPage initialConversationId={params.conversationId} />;
}