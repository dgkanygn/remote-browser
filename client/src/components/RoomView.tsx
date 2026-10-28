import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  Crown,
  Hand,
  Link2,
  LogOut,
  Maximize2,
  MessageSquare,
  Mic,
  MicOff,
  Monitor,
  MousePointer,
  RefreshCw,
  Send,
  Users,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { RoomClientPayload } from '../types';
import { socket } from '../lib/socket';
import { useWebRTCMesh } from '../hooks/useWebRTCMesh';
import { useNekoStream } from '../hooks/useNekoStream';
import { VideoTile } from './VideoTile';

interface RoomViewProps {
  room: RoomClientPayload;
  onSendMessage: (content: string) => void;
  onLeaveRoom: () => void;
  onAssignControl: (targetSocketId: string) => void;
  onRequestControl: () => void;
}

function copyTextToClipboard(text: string): void {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    navigator.clipboard.writeText(text).catch(() => {
      fallbackCopyText(text);
    });
    return;
  }
  fallbackCopyText(text);
}

function fallbackCopyText(text: string): void {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  try {
    document.execCommand('copy');
  } catch {
    // Yoksay
  }
  document.body.removeChild(textarea);
}

export const RoomView: React.FC<RoomViewProps> = ({
  room,
  onSendMessage,
  onLeaveRoom,
  onAssignControl,
  onRequestControl,
}) => {
  const [messageInput, setMessageInput] = useState('');
  const [copiedLink, setCopiedLink] = useState(false);
  const [isMousePressed, setIsMousePressed] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const stageContainerRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);

  const mySocketId = socket.id || '';
  const isAmHost = room.hostId === mySocketId;
  const activeControllerId = room.controllerId || room.hostId;
  const isController = activeControllerId === mySocketId;

  const meUser = room.users.find((u) => u.socketId === mySocketId);

  const {
    localStream,
    remotePeers,
    audioEnabled,
    videoEnabled,
    mediaError,
    toggleAudio,
    toggleVideo,
  } = useWebRTCMesh(room.id, room.users);

  const {
    videoRef,
    status: nekoStatus,
    error: nekoError,
    screenSize,
    isMuted: nekoMuted,
    mutedByAutoplay,
    toggleMute: toggleNekoMute,
    reconnect: reconnectNeko,
    releaseAllKeys,
    sendMouseMove,
    sendMouseButton,
    sendMouseWheel,
    sendKeyEvent,
    sendPasteText,
  } = useNekoStream({
    roomId: room.id,
    nekoUrl: room.nekoUrl,
    nekoPassword: room.nekoPassword,
    nickname: meUser?.nickname || 'Katilimci',
    isController,
  });

  // Yeni mesaj geldiğinde sohbeti en alta kaydır
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [room.messages.length]);

  // Mouse basılıyken pencere dışına çıkıp bırakılırsa takılı kalmayı önle
  useEffect(() => {
    if (!isMousePressed) return;
    const handleWindowMouseUp = (e: MouseEvent) => {
      setIsMousePressed(false);
      if (!isController || !overlayRef.current) return;
      const rect = overlayRef.current.getBoundingClientRect();
      sendMouseButton(e.button, false, e.clientX, e.clientY, rect);
    };
    window.addEventListener('mouseup', handleWindowMouseUp, { capture: true });
    return () => {
      window.removeEventListener('mouseup', handleWindowMouseUp, {
        capture: true,
      });
    };
  }, [isMousePressed, isController, sendMouseButton]);

  const handleChatSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = messageInput.trim();
    if (!trimmed) return;
    onSendMessage(trimmed);
    setMessageInput('');
  };

  const handleCopyInviteLink = () => {
    const inviteUrl = `${window.location.origin}/room/${room.id}`;
    copyTextToClipboard(inviteUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 1800);
  };

  const handleFullscreen = () => {
    if (!stageContainerRef.current) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      stageContainerRef.current.requestFullscreen().catch(() => {});
    }
  };

  // Transparan Kontrol Katmanı Olay Yöneticileri
  const handleOverlayMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isController || !overlayRef.current) return;
    const rect = overlayRef.current.getBoundingClientRect();
    sendMouseMove(e.clientX, e.clientY, rect);
  };

  const handleOverlayMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    overlayRef.current?.focus();
    if (!isController || !overlayRef.current) return;
    e.preventDefault();
    setIsMousePressed(true);
    const rect = overlayRef.current.getBoundingClientRect();
    sendMouseButton(e.button, true, e.clientX, e.clientY, rect);
  };

  const handleOverlayMouseUp = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isController || !overlayRef.current) return;
    e.preventDefault();
    setIsMousePressed(false);
    const rect = overlayRef.current.getBoundingClientRect();
    sendMouseButton(e.button, false, e.clientX, e.clientY, rect);
  };

  const handleOverlayWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (!isController || !overlayRef.current) return;
    const rect = overlayRef.current.getBoundingClientRect();
    sendMouseWheel(
      e.deltaX,
      e.deltaY,
      e.ctrlKey,
      e.clientX,
      e.clientY,
      rect
    );
  };

  const handleOverlayKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!isController) return;
    if (!(e.ctrlKey && e.key.toLowerCase() === 'v')) {
      e.preventDefault();
    }
    e.stopPropagation();
    sendKeyEvent(e, true);
  };

  const handleOverlayKeyUp = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!isController) return;
    e.preventDefault();
    e.stopPropagation();
    sendKeyEvent(e, false);
  };

  const handleOverlayPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    if (!isController) return;
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    if (text) {
      sendPasteText(text);
    }
  };

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('tr-TR', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="h-screen w-screen overflow-hidden bg-zinc-950 text-zinc-100 flex flex-col">
      {/* Üst Bilgi, Yayın ve Medya Kontrol Çubuğu */}
      <header className="h-12 shrink-0 border-b border-zinc-800 bg-zinc-900 px-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-6 h-6 rounded bg-zinc-950 border border-zinc-800 flex items-center justify-center shrink-0">
            <Monitor className="w-3.5 h-3.5 text-zinc-100" />
          </div>
          <span className="text-xs font-semibold text-zinc-100 truncate max-w-[180px]">
            {room.title}
          </span>

          <button
            type="button"
            onClick={handleCopyInviteLink}
            className="h-7 px-2.5 rounded bg-zinc-950 border border-zinc-800 hover:border-zinc-700 text-xs text-zinc-300 hover:text-zinc-100 flex items-center gap-1.5 transition-colors cursor-pointer shrink-0"
            title="Oda davet linkini kopyala"
          >
            {copiedLink ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span>Link Kopyalandı</span>
              </>
            ) : (
              <>
                <Link2 className="w-3.5 h-3.5" />
                <span>Linki Kopyala</span>
              </>
            )}
          </button>

          {/* Neko WebRTC Akış Durumu */}
          <div className="hidden lg:flex items-center gap-1.5 h-7 px-2.5 rounded bg-zinc-950 border border-zinc-800 text-[11px] text-zinc-400 shrink-0">
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                nekoStatus === 'connected'
                  ? 'bg-emerald-500'
                  : nekoStatus === 'connecting'
                    ? 'bg-amber-500'
                    : 'bg-red-500'
              }`}
            />
            <span>
              {nekoStatus === 'connected'
                ? `${screenSize.width}x${screenSize.height}`
                : nekoStatus === 'connecting'
                  ? 'Bağlanıyor...'
                  : 'Bağlantı Kesildi'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {/* Ekran Kontrolü İste / Al / Bırak Butonları */}
          {!isController && isAmHost && (
            <button
              type="button"
              onClick={() => onAssignControl(mySocketId)}
              className="h-7 px-2.5 rounded bg-zinc-100 hover:bg-zinc-200 text-zinc-950 text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
              title="Ekran kontrolünü kendinize alın"
            >
              <MousePointer className="w-3 h-3" />
              <span className="hidden sm:inline">Kontrolü Al</span>
            </button>
          )}

          {!isController && !isAmHost && (
            <button
              type="button"
              onClick={onRequestControl}
              className="h-7 px-2.5 rounded bg-zinc-950 border border-zinc-800 hover:border-zinc-700 text-xs text-zinc-300 hover:text-zinc-100 flex items-center gap-1.5 transition-colors cursor-pointer"
              title="Oda sahibinden ekran kontrolü iste"
            >
              <Hand className="w-3 h-3" />
              <span className="hidden md:inline">Kontrol İste</span>
            </button>
          )}

          {isController && !isAmHost && (
            <button
              type="button"
              onClick={() => onAssignControl(room.hostId)}
              className="h-7 px-2.5 rounded bg-zinc-950 border border-zinc-800 hover:border-zinc-700 text-xs text-zinc-400 hover:text-zinc-100 flex items-center gap-1.5 transition-colors cursor-pointer"
              title="Ekran kontrolünü Host'a devret"
            >
              <MousePointer className="w-3 h-3" />
              <span className="hidden md:inline">Kontrolü Bırak</span>
            </button>
          )}

          {/* Neko Yayın Sesi Aç/Kapa */}
          <button
            type="button"
            onClick={toggleNekoMute}
            className="h-7 px-2 rounded bg-zinc-950 border border-zinc-800 hover:border-zinc-700 text-xs text-zinc-400 hover:text-zinc-100 flex items-center gap-1.5 transition-colors cursor-pointer"
            title={nekoMuted ? 'Tarayıcı Sesini Aç' : 'Tarayıcı Sesini Kapat'}
          >
            {nekoMuted ? (
              <VolumeX className="w-3.5 h-3.5 text-red-400" />
            ) : (
              <Volume2 className="w-3.5 h-3.5 text-zinc-100" />
            )}
          </button>

          {/* Tam Ekran */}
          <button
            type="button"
            onClick={handleFullscreen}
            className="h-7 px-2 rounded bg-zinc-950 border border-zinc-800 hover:border-zinc-700 text-xs text-zinc-400 hover:text-zinc-100 flex items-center justify-center transition-colors cursor-pointer"
            title="Tam Ekran"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>

          {/* Neko Yayınını Yeniden Bağla */}
          <button
            type="button"
            onClick={reconnectNeko}
            className="h-7 px-2 rounded bg-zinc-950 border border-zinc-800 hover:border-zinc-700 text-xs text-zinc-400 hover:text-zinc-100 flex items-center justify-center transition-colors cursor-pointer"
            title="Yayını Yenile"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>

          <div className="w-px h-4 bg-zinc-800 mx-1" />

          {/* Mikrofon Aç/Kapa */}
          <button
            type="button"
            onClick={toggleAudio}
            title={
              mediaError
                ? mediaError
                : audioEnabled
                  ? 'Mikrofonu Kapat'
                  : 'Mikrofonu Aç'
            }
            className={`h-7 px-2.5 rounded border text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
              audioEnabled
                ? 'bg-zinc-950 border-zinc-800 text-zinc-100 hover:border-zinc-700'
                : 'bg-red-950/60 border-red-900/70 text-red-300 hover:bg-red-950'
            }`}
          >
            {audioEnabled ? (
              <Mic className="w-3.5 h-3.5" />
            ) : (
              <MicOff className="w-3.5 h-3.5" />
            )}
            <span className="hidden xl:inline">
              {audioEnabled ? 'Mikrofon' : 'Sessiz'}
            </span>
          </button>

          {/* Kamera Aç/Kapa */}
          <button
            type="button"
            onClick={toggleVideo}
            title={
              mediaError
                ? mediaError
                : videoEnabled
                  ? 'Kamerayı Kapat'
                  : 'Kamerayı Aç'
            }
            className={`h-7 px-2.5 rounded border text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
              videoEnabled
                ? 'bg-zinc-950 border-zinc-800 text-zinc-100 hover:border-zinc-700'
                : 'bg-red-950/60 border-red-900/70 text-red-300 hover:bg-red-950'
            }`}
          >
            {videoEnabled ? (
              <Video className="w-3.5 h-3.5" />
            ) : (
              <VideoOff className="w-3.5 h-3.5" />
            )}
            <span className="hidden xl:inline">Kamera</span>
          </button>

          {/* Odadan Ayrıl */}
          <button
            type="button"
            onClick={onLeaveRoom}
            title="Odadan Ayrıl"
            className="h-7 px-2.5 rounded bg-zinc-950 border border-zinc-800 hover:border-red-900/80 hover:text-red-400 text-zinc-100 text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Ayrıl</span>
          </button>
        </div>
      </header>

      {/* Orta Çalışma Alanı (Grid Layout: Merkez Neko Video + Alt Video Grid + Sağ Panel) */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12">
        {/* Sol/Merkez: Saf <video> Neko Akışı + Transparan Kontrol Katmanı + Alt Kamera Grid'i */}
        <div className="lg:col-span-9 flex flex-col min-h-0 bg-zinc-950">
          {/* Merkez: Neko WebRTC Video ve Transparan Kontrol Katmanı */}
          <div
            ref={stageContainerRef}
            className="flex-1 min-h-0 relative bg-zinc-950 border-b border-zinc-800 flex items-center justify-center overflow-hidden select-none"
          >
            {/* Saf HTML5 <video> Elementi */}
            <video
              ref={videoRef}
              autoPlay
              playsInline
              className="w-full h-full object-contain pointer-events-none select-none bg-zinc-950"
            />

            {/* Transparan Mouse & Klavye Kontrol Katmanı */}
            <div
              ref={overlayRef}
              tabIndex={0}
              onBlur={() => releaseAllKeys()}
              onMouseMove={handleOverlayMouseMove}
              onMouseDown={handleOverlayMouseDown}
              onMouseUp={handleOverlayMouseUp}
              onWheel={handleOverlayWheel}
              onContextMenu={(e) => e.preventDefault()}
              onKeyDown={handleOverlayKeyDown}
              onKeyUp={handleOverlayKeyUp}
              onPaste={handleOverlayPaste}
              className={`absolute inset-0 outline-none ${
                isController ? 'cursor-crosshair' : 'cursor-default'
              }`}
            />

            {/* Otomatik Oynatma (Autoplay) Ses Açma Uyarısı */}
            {mutedByAutoplay && nekoStatus === 'connected' && (
              <button
                type="button"
                onClick={toggleNekoMute}
                className="absolute top-3 left-3 z-20 h-8 px-3 rounded bg-zinc-900/90 border border-zinc-700 text-xs text-zinc-100 flex items-center gap-2 hover:bg-zinc-800 transition-colors cursor-pointer"
              >
                <VolumeX className="w-3.5 h-3.5 text-amber-400" />
                <span>Tarayıcı sesini etkinleştirmek için tıklayın</span>
              </button>
            )}

            {/* Bağlantı Yükleniyor / Hata Durumu Katmanı */}
            {nekoStatus !== 'connected' && (
              <div className="absolute inset-0 z-20 bg-zinc-950/85 flex flex-col items-center justify-center p-6 text-center">
                <div className="max-w-sm w-full p-4 rounded bg-zinc-900 border border-zinc-800 space-y-3">
                  <div className="flex items-center justify-center gap-2 text-xs font-semibold text-zinc-100">
                    <Monitor className="w-4 h-4 text-zinc-400" />
                    <span>
                      {nekoStatus === 'connecting'
                        ? 'Neko WebRTC Yayınına Bağlanılıyor...'
                        : 'Neko Yayın Bağlantısı Kesildi'}
                    </span>
                  </div>
                  {nekoError && (
                    <p className="text-xs text-red-400 break-words">
                      {nekoError}
                    </p>
                  )}
                  {nekoStatus !== 'connecting' && (
                    <button
                      type="button"
                      onClick={reconnectNeko}
                      className="w-full h-8 rounded bg-zinc-100 hover:bg-zinc-200 text-zinc-950 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>Tekrar Bağlan</span>
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Alt Panel: 2-4 Kişilik WebRTC Kamera & Mikrofon Grid'i */}
          <div className="h-44 shrink-0 bg-zinc-950 p-3 flex flex-col justify-between">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 h-full">
              {room.users.map((user) => {
                const isMe = user.socketId === mySocketId;
                const peerMedia = remotePeers[user.socketId];

                return (
                  <VideoTile
                    key={user.socketId}
                    nickname={user.nickname}
                    isLocal={isMe}
                    isHost={user.socketId === room.hostId}
                    stream={isMe ? localStream : peerMedia?.stream ?? null}
                    audioEnabled={
                      isMe ? audioEnabled : peerMedia?.audioEnabled ?? true
                    }
                    videoEnabled={
                      isMe ? videoEnabled : peerMedia?.videoEnabled ?? true
                    }
                  />
                );
              })}
            </div>
          </div>
        </div>

        {/* Sağ Panel: Katılımcı Listesi (Kontrol Atama) ve Son 50 Mesajlık Canlı Sohbet */}
        <aside className="lg:col-span-3 border-l border-zinc-800 bg-zinc-900 flex flex-col min-h-0">
          {/* Katılımcı Listesi ve Ekran Kontrol Yönetimi */}
          <div className="p-3 border-b border-zinc-800 shrink-0">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-100">
                <Users className="w-3.5 h-3.5 text-zinc-400" />
                <span>Katılımcılar</span>
              </div>
              <span className="text-[11px] text-zinc-400">
                {room.users.length}/{room.maxUsers}
              </span>
            </div>

            <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
              {room.users.map((u) => {
                const isMe = u.socketId === mySocketId;
                const isUserHost = u.socketId === room.hostId;
                const isUserController = u.socketId === activeControllerId;

                return (
                  <div
                    key={u.socketId}
                    className="px-2 py-1.5 rounded bg-zinc-950 border border-zinc-800 flex items-center justify-between gap-2 text-xs"
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                      <span className="text-zinc-100 truncate">
                        {u.nickname}
                        {isMe ? ' (Sen)' : ''}
                      </span>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      {isUserController && (
                        <span
                          className="inline-flex items-center gap-1 text-[10px] font-medium text-zinc-100 bg-zinc-800 px-1.5 py-0.5 rounded border border-zinc-700"
                          title="Ekran kontrolü bu kullanıcıda"
                        >
                          <MousePointer className="w-2.5 h-2.5" />
                          <span>Kontrol</span>
                        </span>
                      )}

                      {isUserHost && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-medium text-zinc-400 bg-zinc-900 px-1.5 py-0.5 rounded border border-zinc-800">
                          <Crown className="w-2.5 h-2.5 text-zinc-100" />
                          <span>Host</span>
                        </span>
                      )}

                      {isAmHost && !isUserController && (
                        <button
                          type="button"
                          onClick={() => onAssignControl(u.socketId)}
                          className="h-5 px-1.5 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-[10px] text-zinc-200 transition-colors cursor-pointer"
                          title={`${u.nickname} kullanıcısına ekran kontrolü ver`}
                        >
                          Yetki Ver
                        </button>
                      )}

                      {isAmHost && isUserController && !isMe && (
                        <button
                          type="button"
                          onClick={() => onAssignControl(mySocketId)}
                          className="h-5 px-1.5 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-[10px] text-zinc-400 hover:text-zinc-100 transition-colors cursor-pointer"
                          title="Ekran kontrolünü geri al"
                        >
                          Geri Al
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Canlı Sohbet Başlığı */}
          <div className="px-3 py-2 border-b border-zinc-800 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-100">
              <MessageSquare className="w-3.5 h-3.5 text-zinc-400" />
              <span>Canlı Sohbet</span>
            </div>
            <span className="text-[10px] text-zinc-400">
              {room.messages.length}/50
            </span>
          </div>

          {/* Mesaj Listesi (Kendi mesajların sağda, diğer kullanıcıların mesajları solda) */}
          <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2.5">
            {room.messages.map((msg) => {
              if (msg.isSystem) {
                return (
                  <div key={msg.id} className="flex justify-center">
                    <div className="px-2.5 py-1 rounded bg-zinc-950/60 border border-zinc-800/70 text-[11px] text-zinc-400 text-center max-w-[92%]">
                      <span>{msg.content}</span>
                    </div>
                  </div>
                );
              }

              const isOwn = msg.senderId === mySocketId;

              return (
                <div
                  key={msg.id}
                  className={`flex flex-col ${
                    isOwn ? 'items-end' : 'items-start'
                  }`}
                >
                  <div className="flex items-center gap-1.5 mb-1 px-0.5">
                    {isOwn ? (
                      <>
                        <span className="text-[10px] text-zinc-500">
                          {formatTime(msg.timestamp)}
                        </span>
                        <span className="text-[11px] font-medium text-zinc-300">
                          Sen
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="text-[11px] font-medium text-zinc-300 truncate max-w-[140px]">
                          {msg.senderName}
                        </span>
                        <span className="text-[10px] text-zinc-500">
                          {formatTime(msg.timestamp)}
                        </span>
                      </>
                    )}
                  </div>

                  <div
                    className={`max-w-[85%] px-3 py-2 text-xs break-words leading-relaxed border ${
                      isOwn
                        ? 'bg-zinc-800 border-zinc-700 text-zinc-100 rounded-md rounded-tr-none'
                        : 'bg-zinc-950 border-zinc-800 text-zinc-200 rounded-md rounded-tl-none'
                    }`}
                  >
                    {msg.content}
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>

          {/* Mesaj Gönderme Formu */}
          <form
            onSubmit={handleChatSubmit}
            className="p-2.5 border-t border-zinc-800 bg-zinc-900 flex items-center gap-2 shrink-0"
          >
            <input
              type="text"
              maxLength={500}
              placeholder="Mesaj yazın..."
              value={messageInput}
              onChange={(e) => setMessageInput(e.target.value)}
              className="flex-1 h-8 px-2.5 rounded bg-zinc-950 border border-zinc-800 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-zinc-600"
            />
            <button
              type="submit"
              disabled={!messageInput.trim()}
              className="h-8 w-8 rounded bg-zinc-100 hover:bg-zinc-200 disabled:opacity-40 disabled:pointer-events-none text-zinc-950 flex items-center justify-center transition-colors cursor-pointer shrink-0"
              title="Gönder"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </form>
        </aside>
      </div>
    </div>
  );
};
