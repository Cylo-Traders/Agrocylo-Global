import React from 'react';
import MessagesPage from '../page';

// This is a wrapper that pre-selects the conversation from URL
export default async function ConversationPage({ params }: { params: Promise<{ conversationId: string }> }) {
  const { conversationId } = await params;
  return <MessagesPage initialConversationId={conversationId} />;
}
