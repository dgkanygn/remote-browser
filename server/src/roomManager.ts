import { v4 as uuidv4 } from 'uuid';
import {
  ChatMessage,
  CreateRoomPayload,
  Room,
  RoomClientPayload,
  RoomInviteInfo,
  User,
} from './types';
import {
  allocatePorts,
  getHostIp,
  getNekoUrl,
  releasePorts,
  startNekoContainer,
  stopAndRemoveContainer,
} from './dockerManager';

const MAX_MESSAGES = 50;
const REAPER_TIMEOUT_MS = parseInt(process.env.REAPER_TIMEOUT_MS || '120000', 10);

const rooms = new Map<string, Room>();
const socketToRoom = new Map<string, string>();

function generateRoomSlug(): string {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let result = '';
  for (let i = 0; i < 10; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return rooms.has(result) ? uuidv4().replace(/-/g, '').slice(0, 12).toLowerCase() : result;
}

export function serializeRoomForClient(room: Room): RoomClientPayload {
  return {
    id: room.id,
    title: room.title,
    hasPassword: Boolean(room.password && room.password.length > 0),
    nekoPassword: room.nekoPassword,
    nekoUrl: room.nekoUrl,
    maxUsers: room.maxUsers,
    hostId: room.hostId,
    controllerId: room.controllerId,
    hostIp: getHostIp(),
    port: room.port,
    udpRange: `${room.udpRange.start}-${room.udpRange.end}`,
    containerId: room.containerId,
    users: Array.from(room.users.values()),
    messages: room.messages,
  };
}

export function getRoom(roomId: string): Room | undefined {
  return rooms.get(roomId.trim().toLowerCase());
}

export function getRoomInviteInfo(roomId: string): RoomInviteInfo | null {
  const room = getRoom(roomId);
  if (!room) return null;
  return {
    id: room.id,
    title: room.title,
    hasPassword: Boolean(room.password && room.password.length > 0),
    isFull: room.users.size >= room.maxUsers,
  };
}

export function getRoomBySocket(socketId: string): Room | undefined {
  const roomId = socketToRoom.get(socketId);
  if (!roomId) return undefined;
  return rooms.get(roomId);
}

export async function createRoom(
  socketId: string,
  payload: CreateRoomPayload
): Promise<{ room: Room; user: User }> {
  const roomId = generateRoomSlug();
  const clampedMaxUsers = Math.min(4, Math.max(2, Number(payload.maxUsers) || 4));
  const cleanTitle = payload.title.trim() || `Oda #${roomId}`;
  const cleanNickname = payload.nickname.trim() || 'Misafir';
  const password = payload.password && payload.password.trim() !== '' ? payload.password.trim() : undefined;
  const nekoPassword = process.env.NEKO_PASSWORD || password || 'admin';

  const { port, udpRange, isStatic } = allocatePorts();

  let containerId: string;
  let nekoUrl: string = getNekoUrl();
  try {
    const started = await startNekoContainer({
      roomId,
      port,
      udpRange,
      nekoPassword,
      isStatic,
    });
    containerId = started.containerId;
    nekoUrl = started.nekoUrl;
  } catch (err) {
    releasePorts(port, udpRange.start);
    throw err;
  }

  const hostUser: User = {
    id: uuidv4(),
    socketId,
    nickname: cleanNickname,
    isHost: true,
    joinedAt: Date.now(),
  };

  const usersMap = new Map<string, User>();
  usersMap.set(socketId, hostUser);

  const systemMsg: ChatMessage = {
    id: uuidv4(),
    senderId: 'system',
    senderName: 'Sistem',
    content: `${cleanNickname} odayı oluşturdu.`,
    timestamp: Date.now(),
    isSystem: true,
  };

  const room: Room = {
    id: roomId,
    title: cleanTitle,
    password,
    nekoPassword,
    nekoUrl,
    maxUsers: clampedMaxUsers,
    hostId: socketId,
    controllerId: socketId,
    port,
    udpRange,
    containerId,
    users: usersMap,
    messages: [systemMsg],
    reaperTimer: null,
    createdAt: Date.now(),
  };

  rooms.set(roomId, room);
  socketToRoom.set(socketId, roomId);

  return { room, user: hostUser };
}

export function joinRoom(
  socketId: string,
  roomIdInput: string,
  nicknameInput: string,
  passwordInput?: string
): { room: Room; user: User } {
  const normalizedId = roomIdInput.trim().toLowerCase();
  const room = rooms.get(normalizedId);

  if (!room) {
    throw new Error('Oda bulunamadı.');
  }

  if (room.users.size >= room.maxUsers && !room.users.has(socketId)) {
    throw new Error(`Oda dolu (${room.maxUsers}/${room.maxUsers}).`);
  }

  if (room.password && room.password !== (passwordInput || '').trim()) {
    throw new Error('Oda şifresi hatalı.');
  }

  // Cancel reaper timer if room was empty and waiting for cleanup
  if (room.reaperTimer) {
    clearTimeout(room.reaperTimer);
    room.reaperTimer = null;
    console.log(`[Reaper] Oda ${room.id} için silme sayacı iptal edildi (kullanıcı katıldı).`);
  }

  const cleanNickname = nicknameInput.trim() || 'Misafir';
  const isFirstUser = room.users.size === 0;

  const user: User = {
    id: uuidv4(),
    socketId,
    nickname: cleanNickname,
    isHost: isFirstUser,
    joinedAt: Date.now(),
  };

  if (isFirstUser) {
    room.hostId = socketId;
    room.controllerId = socketId;
  }

  room.users.set(socketId, user);
  socketToRoom.set(socketId, room.id);

  appendMessage(room, {
    id: uuidv4(),
    senderId: 'system',
    senderName: 'Sistem',
    content: `${cleanNickname} odaya katıldı.`,
    timestamp: Date.now(),
    isSystem: true,
  });

  return { room, user };
}

export function appendMessage(room: Room, message: ChatMessage): ChatMessage {
  room.messages.push(message);
  while (room.messages.length > MAX_MESSAGES) {
    room.messages.shift(); // FIFO: en eski mesajı sil
  }
  return message;
}

export function removeUserFromRoom(
  socketId: string,
  onRoomReaped?: (roomId: string) => void
): {
  room?: Room;
  removedUser?: User;
  newHostId?: string;
} {
  const roomId = socketToRoom.get(socketId);
  if (!roomId) return {};

  socketToRoom.delete(socketId);
  const room = rooms.get(roomId);
  if (!room) return {};

  const removedUser = room.users.get(socketId);
  if (!removedUser) return { room };

  room.users.delete(socketId);

  appendMessage(room, {
    id: uuidv4(),
    senderId: 'system',
    senderName: 'Sistem',
    content: `${removedUser.nickname} odadan ayrıldı.`,
    timestamp: Date.now(),
    isSystem: true,
  });

  let newHostId: string | undefined;

  if (room.users.size > 0) {
    if (room.hostId === socketId) {
      const nextHost = room.users.values().next().value;
      if (nextHost) {
        nextHost.isHost = true;
        room.hostId = nextHost.socketId;
        newHostId = nextHost.socketId;
      }
    }
    if (room.controllerId === socketId || !room.users.has(room.controllerId)) {
      room.controllerId = room.hostId;
    }
  } else {
    // Odada 0 kişi kaldı -> 2 dakikalık Reaper sayacını başlat
    if (room.reaperTimer) {
      clearTimeout(room.reaperTimer);
    }
    console.log(
      `[Reaper] Oda ${room.id} boşaldı. ${REAPER_TIMEOUT_MS / 1000} saniye içinde kimse dönmezse kapatılacak.`
    );
    room.reaperTimer = setTimeout(async () => {
      const currentRoom = rooms.get(room.id);
      if (currentRoom && currentRoom.users.size === 0) {
        console.log(`[Reaper] Oda ${currentRoom.id} süresi doldu, container ve bellek temizleniyor.`);
        rooms.delete(currentRoom.id);
        releasePorts(currentRoom.port, currentRoom.udpRange.start);
        await stopAndRemoveContainer(currentRoom.containerId);
        if (onRoomReaped) {
          onRoomReaped(currentRoom.id);
        }
      }
    }, REAPER_TIMEOUT_MS);
  }

  return { room, removedUser, newHostId };
}

export function assignControl(
  requesterSocketId: string,
  roomIdInput: string,
  targetSocketId: string
): { room: Room; targetUser: User; systemMessage?: ChatMessage } {
  const room =
    (roomIdInput ? getRoom(roomIdInput) : undefined) ||
    getRoomBySocket(requesterSocketId);

  if (!room) {
    throw new Error('Oda bulunamadı.');
  }

  const isHost = room.hostId === requesterSocketId;
  const isCurrentControllerReleasingToHost =
    room.controllerId === requesterSocketId && targetSocketId === room.hostId;

  if (!isHost && !isCurrentControllerReleasingToHost) {
    throw new Error('Ekran kontrolünü yalnızca oda sahibi (Host) atayabilir.');
  }

  const targetUser = room.users.get(targetSocketId);
  if (!targetUser) {
    throw new Error('Hedef kullanıcı odada bulunamadı.');
  }

  if (room.controllerId === targetSocketId) {
    return { room, targetUser };
  }

  room.controllerId = targetSocketId;

  const systemMessage = appendMessage(room, {
    id: uuidv4(),
    senderId: 'system',
    senderName: 'Sistem',
    content: `Ekran kontrolü ${targetUser.nickname} kullanıcısına atandı.`,
    timestamp: Date.now(),
    isSystem: true,
  });

  return { room, targetUser, systemMessage };
}

