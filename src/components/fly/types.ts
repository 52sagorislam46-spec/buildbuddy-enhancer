export interface UserProfile {
  uid: string;
  username: string;
  displayName: string;
  bio: string;
  photoURL: string;
  phone?: string;
  email?: string;
  birthDate?: string;
  gender?: string;
  pronoun?: string;
  country?: string;
  preferredLanguage?: string;
  followers: string[];
  following: string[];
  viewedStoryIds?: string[];
  /** Admin moderation: epoch ms until which the account is suspended (0 = active). */
  suspendedUntil?: number;
  suspendedReason?: string;
  createdAt: number;
}

export interface Comment {
  id: string;
  authorId: string;
  authorName: string;
  authorPhoto: string;
  text: string;
  createdAt: number;
  likes?: string[];
  replies?: Comment[];
}

export interface Post {
  id: string;
  authorId: string;
  authorName: string;
  authorUsername: string;
  authorPhoto: string;
  text: string;
  mediaUrl: string;
  mediaType: string;
  likes: string[];
  comments: Comment[];
  tags?: string[];
  bgStyle?: string;
  views?: number;
  shares?: number;
  createdAt: number;
}

export interface Story {
  id: string;
  authorId: string;
  authorName: string;
  authorUsername: string;
  authorPhoto: string;
  mediaUrl: string;
  mediaType: string;
  createdAt: number;
  reactions?: Record<string, string>;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  text: string;
  kind: "text" | "call";
  mediaUrl: string;
  mediaType: string;
  mediaName: string;
  postId?: string;
  replyToId?: string;
  replyToText?: string;
  replyToSenderId?: string;
  editedAt?: number;
  createdAt: number;
  deliveredTo: string[];
  seenBy: string[];
  deletedFor: string[];
  deleted: boolean;
  reactions?: Record<string, string>;
}



export interface GroupMember {
  uid: string;
  displayName: string;
  username: string;
  photoURL: string;
}

export interface GroupConversation {
  id: string;
  type: "group";
  name: string;
  photoURL: string;
  participantIds: string[];
  members: GroupMember[];
  adminIds?: string[];
  createdBy?: string;
  createdAt: number;
}

export interface Conversation {
  id: string;
  type?: "direct" | "group";
  otherId: string;
  otherProfile: UserProfile;
  group?: GroupConversation;
  lastMessage: string;
  lastMessageAt: number;
  lastSenderId?: string;
}
