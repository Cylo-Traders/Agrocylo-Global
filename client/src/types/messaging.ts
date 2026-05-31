export interface User {
  id: string;
  name: string;
  avatar: string;
  role: 'buyer' | 'seller' | 'admin';
  isOnline: boolean;
  lastSeen: Date;
}

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  type: 'text' | 'image' | 'file';
  fileUrl?: string;
  fileName?: string;
  fileSize?: number;
  reactions: Reaction[];
  isEdited: boolean;
  editedAt?: Date;
  createdAt: Date;
  readBy: string[]; // user IDs who have read
  replyTo?: string; // message ID
}

export interface Reaction {
  userId: string;
  emoji: string;
}

export interface Conversation {
  id: string;
  participants: User[];
  lastMessage?: Message;
  unreadCount: number;
  isArchived: boolean;
  isMuted: boolean;
  blockedBy?: string; // user ID who blocked
  createdAt: Date;
  updatedAt: Date;
  transactionId?: string; // linked escrow transaction
}

export interface TypingIndicator {
  conversationId: string;
  userId: string;
  isTyping: boolean;
  timestamp: Date;
}

export interface NotificationPayload {
  type: 'new_message' | 'mention' | 'reaction';
  title: string;
  body: string;
  icon?: string;
  data: {
    conversationId: string;
    messageId: string;
  };
}