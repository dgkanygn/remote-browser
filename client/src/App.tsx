import { useCallback, useEffect, useState } from 'react';
import { socket } from './lib/socket';
import type { ChatMessage, RoomClientPayload, RoomInviteInfo } from './types';
import { LobbyView } from './components/LobbyView';
import { RoomView } from './components/RoomView';

const NICKNAME_STORAGE_KEY = 'wp_nickname';

function extractRoomIdFromLocation(): string | null {
  if (typeof window === 'undefined') return null;

  const params = new URLSearchParams(window.location.search);
  const queryRoom = params.get('room');
  if (queryRoom && queryRoom.trim()) {
    return queryRoom.trim().toLowerCase();
  }

  const path = window.location.pathname;
  const roomRouteMatch = path.match(/^\/room\/([a-zA-Z0-9_-]+)\/?$/);
  if (roomRouteMatch && roomRouteMatch[1]) {
    return roomRouteMatch[1].toLowerCase();
  }

  const directSlugMatch = path.match(/^\/([a-zA-Z0-9_-]{6,16})\/?$/);
  if (
    directSlugMatch &&
    directSlugMatch[1] &&
    directSlugMatch[1].toLowerCase() !== 'index'
  ) {
    return directSlugMatch[1].toLowerCase();
  }

  return null;
}

function getSavedNickname(): string {
  try {
    return localStorage.getItem(NICKNAME_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

function saveNickname(nickname: string): void {
  try {
    localStorage.setItem(NICKNAME_STORAGE_KEY, nickname);
  } catch {
    // Storage devre dışıysa yoksay
  }
}

function saveTabRoomSession(
  roomId: string,
  nickname: string,
  password?: string
): void {
  try {
    sessionStorage.setItem(
      `wp_session_${roomId}`,
      JSON.stringify({ nickname, password })
    );
  } catch {
    // Yoksay
  }
}

function getTabRoomSession(
  roomId: string
): { nickname: string; password?: string } | null {
  try {
    const raw = sessionStorage.getItem(`wp_session_${roomId}`);
    if (!raw) return null;
    return JSON.parse(raw) as { nickname: string; password?: string };
  } catch {
    return null;
  }
}

function clearTabRoomSession(roomId: string): void {
  try {
    sessionStorage.removeItem(`wp_session_${roomId}`);
  } catch {
    // Yoksay
  }
}

export function App() {
  const [isConnected, setIsConnected] = useState<boolean>(socket.connected);
  const [currentRoom, setCurrentRoom] = useState<RoomClientPayload | null>(
    null
  );
  const [inviteRoomId, setInviteRoomId] = useState<string | null>(() =>
    extractRoomIdFromLocation()
  );
  const [inviteRoomInfo, setInviteRoomInfo] = useState<RoomInviteInfo | null>(
    null
  );
  const [isCheckingInvite, setIsCheckingInvite] = useState<boolean>(() =>
    Boolean(extractRoomIdFromLocation())
  );
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [defaultNickname, setDefaultNickname] = useState<string>(() =>
    getSavedNickname()
  );

  // Davet linkindeki odayı doğrula (veya aynı sekmede sayfa yenilendiyse otomatik tekrar bağlan)
  const inspectInviteRoom = useCallback((targetRoomId: string) => {
    const savedSession = getTabRoomSession(targetRoomId);
    if (savedSession && savedSession.nickname) {
      setIsCheckingInvite(true);
      socket.emit(
        'join-room',
        {
          roomId: targetRoomId,
          nickname: savedSession.nickname,
          password: savedSession.password,
        },
        (res: { ok: boolean; room?: RoomClientPayload; error?: string }) => {
          if (res.ok && res.room) {
            setCurrentRoom(res.room);
            setIsCheckingInvite(false);
            setError(null);
            return;
          }
          // Otomatik giriş başarısız olduysa (örn: oda kapandı veya şifre değişti) normal davet bilgisine düş
          clearTabRoomSession(targetRoomId);
          socket.emit(
            'get-room-info',
            { roomId: targetRoomId },
            (infoRes: {
              ok: boolean;
              room?: RoomInviteInfo;
              error?: string;
            }) => {
              setIsCheckingInvite(false);
              if (infoRes.ok && infoRes.room) {
                setInviteRoomInfo(infoRes.room);
              } else {
                setInviteRoomInfo(null);
              }
            }
          );
        }
      );
      return;
    }

    setIsCheckingInvite(true);
    socket.emit(
      'get-room-info',
      { roomId: targetRoomId },
      (res: { ok: boolean; room?: RoomInviteInfo; error?: string }) => {
        setIsCheckingInvite(false);
        if (res.ok && res.room) {
          setInviteRoomInfo(res.room);
        } else {
          setInviteRoomInfo(null);
        }
      }
    );
  }, []);

  // Tarayıcı geri/ileri butonlarını dinle
  useEffect(() => {
    const handlePopState = () => {
      const urlRoomId = extractRoomIdFromLocation();
      if (!urlRoomId) {
        if (currentRoom) {
          clearTabRoomSession(currentRoom.id);
          socket.emit('leave-room');
          setCurrentRoom(null);
        }
        setInviteRoomId(null);
        setInviteRoomInfo(null);
        setIsCheckingInvite(false);
      } else if (!currentRoom || currentRoom.id !== urlRoomId) {
        if (currentRoom) {
          socket.emit('leave-room');
          setCurrentRoom(null);
        }
        setInviteRoomId(urlRoomId);
        if (socket.connected) {
          inspectInviteRoom(urlRoomId);
        }
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [currentRoom, inspectInviteRoom]);

  useEffect(() => {
    const onConnect = () => {
      setIsConnected(true);
      const urlRoomId = extractRoomIdFromLocation();
      if (urlRoomId) {
        inspectInviteRoom(urlRoomId);
      }
    };

    const onDisconnect = () => {
      setIsConnected(false);
    };

    const onRoomJoined = (roomData: RoomClientPayload) => {
      setCurrentRoom(roomData);
      setIsLoading(false);
      setIsCheckingInvite(false);
      setError(null);

      const expectedPath = `/room/${roomData.id}`;
      if (window.location.pathname !== expectedPath) {
        window.history.pushState(null, '', expectedPath);
      }
    };

    const onRoomState = (roomData: RoomClientPayload) => {
      setCurrentRoom(roomData);
    };

    const onNewMessage = (msg: ChatMessage) => {
      setCurrentRoom((prev) => {
        if (!prev) return prev;
        if (prev.messages.some((m) => m.id === msg.id)) {
          return prev;
        }
        const updated = [...prev.messages, msg];
        while (updated.length > 50) {
          updated.shift();
        }
        return {
          ...prev,
          messages: updated,
        };
      });
    };

    const onErrorMessage = (errMsg: string) => {
      setError(errMsg);
      setIsLoading(false);
    };

    const onControlChanged = (payload: { controllerId: string }) => {
      setCurrentRoom((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          controllerId: payload.controllerId,
        };
      });
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('room-joined', onRoomJoined);
    socket.on('room-state', onRoomState);
    socket.on('new-message', onNewMessage);
    socket.on('error-message', onErrorMessage);
    socket.on('control-changed', onControlChanged);

    if (socket.connected) {
      onConnect();
    }

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('room-joined', onRoomJoined);
      socket.off('room-state', onRoomState);
      socket.off('new-message', onNewMessage);
      socket.off('error-message', onErrorMessage);
      socket.off('control-changed', onControlChanged);
    };
  }, [inspectInviteRoom]);

  const handleExitInvite = useCallback(() => {
    setInviteRoomId(null);
    setInviteRoomInfo(null);
    setIsCheckingInvite(false);
    setError(null);
    if (window.location.pathname !== '/') {
      window.history.pushState(null, '', '/');
    }
  }, []);

  const handleCreateRoom = useCallback(
    (payload: {
      nickname: string;
      title: string;
      maxUsers: number;
      password?: string;
    }) => {
      setIsLoading(true);
      setError(null);
      saveNickname(payload.nickname);
      setDefaultNickname(payload.nickname);

      socket.emit(
        'create-room',
        payload,
        (res: { ok: boolean; room?: RoomClientPayload; error?: string }) => {
          setIsLoading(false);
          if (!res.ok) {
            setError(res.error || 'Oda oluşturulamadı.');
          } else if (res.room) {
            saveTabRoomSession(res.room.id, payload.nickname, payload.password);
            setCurrentRoom(res.room);
            const expectedPath = `/room/${res.room.id}`;
            if (window.location.pathname !== expectedPath) {
              window.history.pushState(null, '', expectedPath);
            }
          }
        }
      );
    },
    []
  );

  const handleJoinRoom = useCallback(
    (payload: { roomId: string; nickname: string; password?: string }) => {
      setIsLoading(true);
      setError(null);
      saveNickname(payload.nickname);
      setDefaultNickname(payload.nickname);

      socket.emit(
        'join-room',
        payload,
        (res: { ok: boolean; room?: RoomClientPayload; error?: string }) => {
          setIsLoading(false);
          if (!res.ok) {
            setError(res.error || 'Odaya katılınamadı.');
          } else if (res.room) {
            saveTabRoomSession(res.room.id, payload.nickname, payload.password);
            setCurrentRoom(res.room);
            const expectedPath = `/room/${res.room.id}`;
            if (window.location.pathname !== expectedPath) {
              window.history.pushState(null, '', expectedPath);
            }
          }
        }
      );
    },
    []
  );

  const handleLeaveRoom = useCallback(() => {
    if (currentRoom) {
      clearTabRoomSession(currentRoom.id);
    }
    socket.emit('leave-room', () => {
      setCurrentRoom(null);
    });
    setCurrentRoom(null);
    setInviteRoomId(null);
    setInviteRoomInfo(null);
    if (window.location.pathname !== '/') {
      window.history.pushState(null, '', '/');
    }
  }, [currentRoom]);

  const handleSendMessage = useCallback(
    (content: string) => {
      if (!currentRoom) return;
      socket.emit('send-message', {
        roomId: currentRoom.id,
        content,
      });
    },
    [currentRoom]
  );

  const handleAssignControl = useCallback(
    (targetSocketId: string) => {
      if (!currentRoom) return;
      socket.emit('assign-control', {
        roomId: currentRoom.id,
        targetSocketId,
      });
    },
    [currentRoom]
  );

  const handleRequestControl = useCallback(() => {
    if (!currentRoom) return;
    socket.emit('request-control', {
      roomId: currentRoom.id,
    });
  }, [currentRoom]);

  if (currentRoom) {
    return (
      <RoomView
        room={currentRoom}
        onSendMessage={handleSendMessage}
        onLeaveRoom={handleLeaveRoom}
        onAssignControl={handleAssignControl}
        onRequestControl={handleRequestControl}
      />
    );
  }

  return (
    <LobbyView
      isConnected={isConnected}
      isLoading={isLoading}
      error={error}
      inviteRoomId={inviteRoomId}
      inviteRoomInfo={inviteRoomInfo}
      isCheckingInvite={isCheckingInvite}
      defaultNickname={defaultNickname}
      onClearError={() => setError(null)}
      onExitInvite={handleExitInvite}
      onCreateRoom={handleCreateRoom}
      onJoinRoom={handleJoinRoom}
    />
  );
}

export default App;
