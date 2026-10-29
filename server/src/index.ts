import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import http from 'http';
import cors from 'cors';
import { Server, Socket } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import {
  appendMessage,
  assignControl,
  createRoom,
  getRoom,
  getRoomBySocket,
  getRoomInviteInfo,
  joinRoom,
  removeUserFromRoom,
  serializeRoomForClient,
} from './roomManager';
import { getNekoUrl } from './dockerManager';
import {
  AssignControlPayload,
  CreateRoomPayload,
  JoinRoomPayload,
  RoomInviteInfo,
  SendMessagePayload,
  WebRTCSignalPayload,
} from './types';

const PORT = parseInt(process.env.PORT || '3001', 10);

const app = express();
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Neko v3 / v2 Kimlik Doğrulama ve WebSocket Oturum Proxy Endpoint'i (CORS Bypasser)
app.post('/api/neko/session', async (req, res) => {
  try {
    const { roomId, nickname, password } = req.body as {
      roomId?: string;
      nickname?: string;
      password?: string;
    };

    const room = roomId ? getRoom(roomId) : undefined;
    const nekoBaseUrl = (room?.nekoUrl || getNekoUrl()).replace(/\/+$/, '');
    const wsBaseUrl = nekoBaseUrl.replace(/^http/, 'ws');

    // Nginx / SSL ters proxy arkasındaysa istemcinin Mixed Content hatası almaması için
    // WSS URL'sini Nginx'in /neko/<port> dinamik kuralına yönlendir:
    const forwardedProto = req.headers['x-forwarded-proto'] as string | undefined;
    const isHttps =
      forwardedProto === 'https' ||
      req.secure ||
      process.env.PUBLIC_URL?.startsWith('https');

    const forwardedHost =
      (req.headers['x-forwarded-host'] as string | undefined) ||
      req.headers.host ||
      (process.env.PUBLIC_URL ? new URL(process.env.PUBLIC_URL).host : undefined);

    const roomPort = room?.port || 8080;

    let clientWsBaseUrl: string;
    if (isHttps && forwardedHost) {
      clientWsBaseUrl = `wss://${forwardedHost}/neko/${roomPort}`;
    } else {
      clientWsBaseUrl = wsBaseUrl;
    }

    // Neko kullanıcı adını temizle ve benzersiz bir sonek ekle (aynı isimli kullanıcı çakışmasını önler)
    const baseName = (nickname || 'user')
      .replace(/[^a-zA-Z0-9_-]/g, '')
      .slice(0, 16) || 'user';
    const uniqueUsername = `${baseName}_${Math.random().toString(36).slice(2, 6)}`;

    const candidates = Array.from(
      new Set(
        [
          password,
          room?.nekoPassword,
          process.env.NEKO_PASSWORD,
          'admin',
          'neko',
        ].filter((p): p is string => Boolean(p && p.trim().length > 0))
      )
    );

    for (const candidatePassword of candidates) {
      const loginRes = await fetch(`${nekoBaseUrl}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: uniqueUsername,
          password: candidatePassword,
        }),
      });

      if (loginRes.status === 404) {
        // Neko v2 fallback (/ws?password=...)
        return res.json({
          ok: true,
          mode: 'v2',
          token: '',
          nekoUrl: nekoBaseUrl,
          wsUrl: `${clientWsBaseUrl}/ws?password=${encodeURIComponent(candidatePassword)}`,
        });
      }

      if (loginRes.ok) {
        const data = (await loginRes.json()) as { id?: string; token?: string };
        if (data.token) {
          if (room && room.nekoPassword !== candidatePassword) {
            room.nekoPassword = candidatePassword;
          }
          return res.json({
            ok: true,
            mode: 'v3',
            token: data.token,
            sessionId: data.id,
            nekoUrl: nekoBaseUrl,
            wsUrl: `${clientWsBaseUrl}/api/ws?token=${encodeURIComponent(data.token)}`,
          });
        }
      }
    }

    return res.status(401).json({
      ok: false,
      error: 'Neko sunucusu kimlik doğrulaması başarısız oldu (şifre hatalı).',
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Neko sunucusuna bağlanılamadı.';
    return res.status(502).json({ ok: false, error: message });
  }
});

// Neko v3 Donanım/Xorg Kontrolünü Aktif Kullanıcıya Zorla Atama Endpoint'i
app.post('/api/neko/take-control', async (req, res) => {
  try {
    const { roomId, token } = req.body as { roomId?: string; token?: string };
    if (!token) {
      return res.status(400).json({ ok: false, error: 'Token gerekli.' });
    }
    const room = roomId ? getRoom(roomId) : undefined;
    const nekoBaseUrl = (room?.nekoUrl || getNekoUrl()).replace(/\/+$/, '');

    const takeRes = await fetch(`${nekoBaseUrl}/api/room/control/take`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    return res.json({ ok: takeRes.ok, status: takeRes.status });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Kontrol alınamadı.';
    return res.status(502).json({ ok: false, error: message });
  }
});

// Neko Oturumunu Temizleme Endpoint'i
app.post('/api/neko/logout', async (req, res) => {
  try {
    const { roomId, token } = req.body as { roomId?: string; token?: string };
    if (!token) {
      return res.json({ ok: true });
    }
    const room = roomId ? getRoom(roomId) : undefined;
    const nekoBaseUrl = (room?.nekoUrl || getNekoUrl()).replace(/\/+$/, '');

    await fetch(`${nekoBaseUrl}/api/logout`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }).catch(() => {});

    return res.json({ ok: true });
  } catch {
    return res.json({ ok: true });
  }
});

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

function handleSocketLeave(socket: Socket): void {
  const { room, removedUser } = removeUserFromRoom(socket.id);

  if (room && removedUser) {
    socket.leave(room.id);
    io.to(room.id).emit('user-left', {
      socketId: socket.id,
      user: removedUser,
      hostId: room.hostId,
      controllerId: room.controllerId,
    });
    io.to(room.id).emit('room-state', serializeRoomForClient(room));
  }
}

io.on('connection', (socket: Socket) => {
  console.log(`[Socket] Bağlantı kuruldu: ${socket.id}`);

  socket.on(
    'get-room-info',
    (
      payload: { roomId: string },
      callback?: (res: { ok: boolean; room?: RoomInviteInfo; error?: string }) => void
    ) => {
      if (typeof callback !== 'function') return;
      const info = payload?.roomId ? getRoomInviteInfo(payload.roomId) : null;
      if (!info) {
        callback({
          ok: false,
          error: 'Bu davet linkine ait aktif bir oda bulunamadı.',
        });
        return;
      }
      callback({ ok: true, room: info });
    }
  );

  socket.on(
    'create-room',
    async (
      payload: CreateRoomPayload,
      callback?: (res: { ok: boolean; room?: ReturnType<typeof serializeRoomForClient>; error?: string }) => void
    ) => {
      try {
        // Eger kullanici zaten baska bir odadaysa once cikar
        handleSocketLeave(socket);

        const { room } = await createRoom(socket.id, payload);
        socket.join(room.id);

        const clientRoom = serializeRoomForClient(room);
        socket.emit('room-joined', clientRoom);

        if (typeof callback === 'function') {
          callback({ ok: true, room: clientRoom });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Oda oluşturulurken hata oluştu.';
        if (typeof callback === 'function') {
          callback({ ok: false, error: message });
        } else {
          socket.emit('error-message', message);
        }
      }
    }
  );

  socket.on(
    'join-room',
    (
      payload: JoinRoomPayload,
      callback?: (res: { ok: boolean; room?: ReturnType<typeof serializeRoomForClient>; error?: string }) => void
    ) => {
      try {
        handleSocketLeave(socket);

        const { room, user } = joinRoom(
          socket.id,
          payload.roomId,
          payload.nickname,
          payload.password
        );
        socket.join(room.id);

        const clientRoom = serializeRoomForClient(room);
        socket.emit('room-joined', clientRoom);

        // Odadaki diğer kullanıcılara yeni katılımcıyı bildir (WebRTC mesh bağlantısı için)
        socket.to(room.id).emit('user-joined', {
          user,
          socketId: socket.id,
        });

        io.to(room.id).emit('room-state', clientRoom);

        if (typeof callback === 'function') {
          callback({ ok: true, room: clientRoom });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Odaya katılırken hata oluştu.';
        if (typeof callback === 'function') {
          callback({ ok: false, error: message });
        } else {
          socket.emit('error-message', message);
        }
      }
    }
  );

  socket.on('leave-room', (callback?: () => void) => {
    handleSocketLeave(socket);
    if (typeof callback === 'function') {
      callback();
    }
  });

  socket.on('send-message', (payload: SendMessagePayload) => {
    const room = getRoom(payload.roomId) || getRoomBySocket(socket.id);
    if (!room) return;

    const sender = room.users.get(socket.id);
    if (!sender) return;

    const trimmed = (payload.content || '').trim();
    if (!trimmed) return;

    const msg = appendMessage(room, {
      id: uuidv4(),
      senderId: socket.id,
      senderName: sender.nickname,
      content: trimmed.slice(0, 1000),
      timestamp: Date.now(),
    });

    io.to(room.id).emit('new-message', msg);
  });

  // Ekran Kontrolü Yetki Atama ve İstek Olayları (Etap 2)
  socket.on(
    'assign-control',
    (
      payload: AssignControlPayload,
      callback?: (res: { ok: boolean; error?: string }) => void
    ) => {
      try {
        const { room, targetUser, systemMessage } = assignControl(
          socket.id,
          payload.roomId,
          payload.targetSocketId
        );

        if (systemMessage) {
          io.to(room.id).emit('new-message', systemMessage);
        }

        io.to(room.id).emit('control-changed', {
          controllerId: room.controllerId,
          controllerName: targetUser.nickname,
        });

        io.to(room.id).emit('room-state', serializeRoomForClient(room));

        if (typeof callback === 'function') {
          callback({ ok: true });
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Kontrol yetkisi atanamadı.';
        if (typeof callback === 'function') {
          callback({ ok: false, error: message });
        } else {
          socket.emit('error-message', message);
        }
      }
    }
  );

  socket.on('request-control', (payload: { roomId: string }) => {
    const room = getRoom(payload.roomId) || getRoomBySocket(socket.id);
    if (!room) return;

    const sender = room.users.get(socket.id);
    if (!sender || room.controllerId === socket.id) return;

    const msg = appendMessage(room, {
      id: uuidv4(),
      senderId: 'system',
      senderName: 'Sistem',
      content: `${sender.nickname} ekran kontrolü talep etti.`,
      timestamp: Date.now(),
      isSystem: true,
    });

    io.to(room.id).emit('new-message', msg);
    io.to(room.hostId).emit('control-requested', {
      requesterId: socket.id,
      requesterName: sender.nickname,
    });
  });

  // WebRTC P2P Kamera Mesh Signaling Olayları
  socket.on('peer-offer', (payload: WebRTCSignalPayload) => {
    const room = getRoomBySocket(socket.id);
    if (!room || !payload.targetSocketId || !payload.sdp) return;

    const sender = room.users.get(socket.id);
    io.to(payload.targetSocketId).emit('peer-offer', {
      fromSocketId: socket.id,
      fromNickname: sender?.nickname || 'Katılımcı',
      roomId: room.id,
      sdp: payload.sdp,
    });
  });

  socket.on('peer-answer', (payload: WebRTCSignalPayload) => {
    const room = getRoomBySocket(socket.id);
    if (!room || !payload.targetSocketId || !payload.sdp) return;

    const sender = room.users.get(socket.id);
    io.to(payload.targetSocketId).emit('peer-answer', {
      fromSocketId: socket.id,
      fromNickname: sender?.nickname || 'Katılımcı',
      roomId: room.id,
      sdp: payload.sdp,
    });
  });

  socket.on('ice-candidate', (payload: WebRTCSignalPayload) => {
    const room = getRoomBySocket(socket.id);
    if (!room || !payload.targetSocketId || !payload.candidate) return;

    io.to(payload.targetSocketId).emit('ice-candidate', {
      fromSocketId: socket.id,
      roomId: room.id,
      candidate: payload.candidate,
    });
  });

  socket.on(
    'media-state-changed',
    (payload: { roomId: string; audioEnabled: boolean; videoEnabled: boolean }) => {
      const room = getRoomBySocket(socket.id);
      if (!room) return;
      socket.to(room.id).emit('peer-media-state', {
        socketId: socket.id,
        audioEnabled: payload.audioEnabled,
        videoEnabled: payload.videoEnabled,
      });
    }
  );

  socket.on('disconnect', () => {
    console.log(`[Socket] Bağlantı koptu: ${socket.id}`);
    handleSocketLeave(socket);
  });
});

server.listen(PORT, () => {
  console.log(`[Server] Watch Party Backend http://localhost:${PORT} üzerinde çalışıyor.`);
});

