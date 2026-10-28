export interface User {
  id: string;
  socketId: string;
  nickname: string;
  isHost: boolean;
  joinedAt: number;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  content: string;
  timestamp: number;
  isSystem?: boolean;
}

export interface RoomInviteInfo {
  id: string;
  title: string;
  hasPassword: boolean;
  isFull: boolean;
}

export interface RoomClientPayload {
  id: string;
  title: string;
  hasPassword: boolean;
  nekoPassword: string;
  nekoUrl: string;
  maxUsers: number;
  hostId: string;
  controllerId: string;
  hostIp: string;
  port: number;
  udpRange: string;
  containerId: string;
  users: User[];
  messages: ChatMessage[];
}

export interface PeerStreamInfo {
  socketId: string;
  nickname: string;
  stream: MediaStream | null;
  audioEnabled: boolean;
  videoEnabled: boolean;
}

