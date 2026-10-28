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

export interface UdpRange {
  start: number;
  end: number;
}

export interface Room {
  id: string;
  title: string;
  password?: string;
  nekoPassword: string;
  nekoUrl: string;
  maxUsers: number;
  hostId: string;
  controllerId: string;
  port: number;
  udpRange: UdpRange;
  containerId: string;
  users: Map<string, User>;
  messages: ChatMessage[];
  reaperTimer?: NodeJS.Timeout | null;
  createdAt: number;
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

export interface CreateRoomPayload {
  nickname: string;
  title: string;
  maxUsers: number;
  password?: string;
}

export interface JoinRoomPayload {
  roomId: string;
  nickname: string;
  password?: string;
}

export interface SendMessagePayload {
  roomId: string;
  content: string;
}

export interface SDPPayload {
  type: 'offer' | 'answer' | 'pranswer' | 'rollback';
  sdp?: string;
}

export interface IceCandidatePayload {
  candidate?: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}

export interface WebRTCSignalPayload {
  roomId: string;
  targetSocketId: string;
  sdp?: SDPPayload;
  candidate?: IceCandidatePayload;
}

export interface AssignControlPayload {
  roomId: string;
  targetSocketId: string;
}
