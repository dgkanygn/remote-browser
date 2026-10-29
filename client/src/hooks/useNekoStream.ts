import { useCallback, useEffect, useRef, useState } from 'react';
import { getServerUrl } from '../lib/socket';

export interface NekoScreenSize {
  width: number;
  height: number;
  rate: number;
}

export type NekoConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'error';

interface UseNekoStreamParams {
  roomId: string;
  nekoUrl: string;
  nekoPassword?: string;
  nickname: string;
  isController: boolean;
}

// X11 Keysym haritası (Neko / Guacamole uyumlu)
const SPECIAL_KEYSYMS: Record<string, number> = {
  Backspace: 0xff08,
  Tab: 0xff09,
  Clear: 0xff0b,
  Enter: 0xff0d,
  Pause: 0xff13,
  ScrollLock: 0xff14,
  Escape: 0xff1b,
  Delete: 0xffff,
  Home: 0xff50,
  ArrowLeft: 0xff51,
  Left: 0xff51,
  ArrowUp: 0xff52,
  Up: 0xff52,
  ArrowRight: 0xff53,
  Right: 0xff53,
  ArrowDown: 0xff54,
  Down: 0xff54,
  PageUp: 0xff55,
  PageDown: 0xff56,
  End: 0xff57,
  Insert: 0xff63,
  ContextMenu: 0xff67,
  NumLock: 0xff7f,
  CapsLock: 0xffe5,
  F1: 0xffbe,
  F2: 0xffbf,
  F3: 0xffc0,
  F4: 0xffc1,
  F5: 0xffc2,
  F6: 0xffc3,
  F7: 0xffc4,
  F8: 0xffc5,
  F9: 0xffc6,
  F10: 0xffc7,
  F11: 0xffc8,
  F12: 0xffc9,
  ShiftLeft: 0xffe1,
  ShiftRight: 0xffe2,
  ControlLeft: 0xffe3,
  ControlRight: 0xffe4,
  MetaLeft: 0xffe7,
  MetaRight: 0xffe8,
  AltLeft: 0xffe9,
  AltRight: 0xffea,
  AltGraph: 0xfe03,
};

export function keyboardEventToKeysym(e: React.KeyboardEvent | KeyboardEvent): number | null {
  // Modifier ve özel lokasyonlu tuşlar için code kontrolü
  if (e.code && SPECIAL_KEYSYMS[e.code]) {
    return SPECIAL_KEYSYMS[e.code];
  }

  // Standart özel tuş isimleri
  if (SPECIAL_KEYSYMS[e.key]) {
    if (e.key === 'Shift') return e.location === 2 ? 0xffe2 : 0xffe1;
    if (e.key === 'Control') return e.location === 2 ? 0xffe4 : 0xffe3;
    if (e.key === 'Alt') return e.location === 2 ? 0xffea : 0xffe9;
    if (e.key === 'Meta' || e.key === 'OS') return e.location === 2 ? 0xffe8 : 0xffe7;
    return SPECIAL_KEYSYMS[e.key];
  }

  // Tek karakterli basılabilir tuşlar (ASCII + Türkçe/Unicode karakter desteği)
  if (e.key && e.key.length === 1) {
    const codePoint = e.key.codePointAt(0);
    if (codePoint === undefined) return null;

    if (codePoint >= 0x20 && codePoint <= 0xff) {
      return codePoint;
    }
    if (codePoint >= 0x100 && codePoint <= 0x10ffff) {
      return 0x01000000 | codePoint;
    }
  }

  return null;
}

export function useNekoStream({
  roomId,
  nekoUrl,
  nekoPassword,
  nickname,
  isController,
}: UseNekoStreamParams) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const tokenRef = useRef<string>('');
  const modeRef = useRef<'v3' | 'v2'>('v3');
  const candidatesQueueRef = useRef<RTCIceCandidateInit[]>([]);
  const pressedKeysRef = useRef<Set<number>>(new Set());
  const lastMoveTimeRef = useRef<number>(0);
  const moveTimerRef = useRef<number | null>(null);
  const pendingMoveRef = useRef<{ x: number; y: number } | null>(null);
  const isControllerRef = useRef<boolean>(isController);

  const [status, setStatus] = useState<NekoConnectionStatus>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [screenSize, setScreenSize] = useState<NekoScreenSize>({
    width: 1280,
    height: 720,
    rate: 30,
  });
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [mutedByAutoplay, setMutedByAutoplay] = useState<boolean>(false);
  const [nekoHasControl, setNekoHasControl] = useState<boolean>(false);
  const [reconnectTrigger, setReconnectTrigger] = useState<number>(0);

  isControllerRef.current = isController;

  const sendWs = useCallback((event: string, payload?: unknown) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify(
          payload !== undefined ? { event, payload } : { event }
        )
      );
    }
  }, []);

  // Tüm basılı tuşları serbest bırak (kontrol kaybedildiğinde veya blur olduğunda takılı kalmayı önler)
  const releaseAllKeys = useCallback(() => {
    if (pressedKeysRef.current.size === 0) return;
    for (const keysym of pressedKeysRef.current) {
      sendWs('control/keyup', { keysym });
    }
    pressedKeysRef.current.clear();
  }, [sendWs]);

  // Neko üzerinde kontrolü al veya bırak
  const syncNekoControl = useCallback(
    async (shouldControl: boolean) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;

      if (shouldControl) {
        if (modeRef.current === 'v3' && tokenRef.current) {
          try {
            await fetch(`${getServerUrl()}/api/neko/take-control`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                roomId,
                token: tokenRef.current,
              }),
            });
          } catch {
            // Fallback olarak WS üzerinden control/request gönderilecek
          }
        }
        sendWs('control/request');
        sendWs('keyboard/map', { layout: 'tr', variant: '' });
      } else {
        releaseAllKeys();
        sendWs('control/release');
      }
    },
    [roomId, sendWs, releaseAllKeys]
  );

  // Oda içerisindeki controllerId değiştiğinde Neko oturumunun kontrolünü senkronize et
  useEffect(() => {
    syncNekoControl(isController);
  }, [isController, syncNekoControl]);

  // Ana Neko WebSocket + WebRTC bağlantısı
  useEffect(() => {
    let isCancelled = false;

    const cleanupPeer = () => {
      if (moveTimerRef.current) {
        window.clearTimeout(moveTimerRef.current);
        moveTimerRef.current = null;
      }
      if (dcRef.current) {
        dcRef.current.close();
        dcRef.current = null;
      }
      if (pcRef.current) {
        pcRef.current.onicecandidate = null;
        pcRef.current.ontrack = null;
        pcRef.current.onconnectionstatechange = null;
        pcRef.current.close();
        pcRef.current = null;
      }
      candidatesQueueRef.current = [];
    };

    const connectToNeko = async () => {
      setStatus('connecting');
      setError(null);

      try {
        const sessionRes = await fetch(`${getServerUrl()}/api/neko/session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            roomId,
            nickname,
            password: nekoPassword,
          }),
        });

        const sessionData = (await sessionRes.json()) as {
          ok: boolean;
          mode?: 'v3' | 'v2';
          token?: string;
          sessionId?: string;
          wsUrl?: string;
          error?: string;
        };

        if (isCancelled) return;

        if (!sessionRes.ok || !sessionData.ok || !sessionData.wsUrl) {
          setStatus('error');
          setError(sessionData.error || 'Neko oturumu açılamadı.');
          return;
        }

        tokenRef.current = sessionData.token || '';
        modeRef.current = sessionData.mode || 'v3';
        let myNekoSessionId = sessionData.sessionId || '';

        // Mixed Content koruması: Sayfa HTTPS ise ve URL 'ws://' olarak geldiyse
        // tarayıcı bağlantıyı engellemesin diye WSS ve Nginx proxy formatına uyarla
        let finalWsUrl = sessionData.wsUrl;
        if (
          typeof window !== 'undefined' &&
          window.location.protocol === 'https:' &&
          finalWsUrl.startsWith('ws://')
        ) {
          try {
            const rawUrl = new URL(finalWsUrl);
            const serverUrl = new URL(getServerUrl());
            if (serverUrl.protocol === 'https:') {
              const port = rawUrl.port;
              if (port && port !== '80' && port !== '443') {
                finalWsUrl = `wss://${serverUrl.host}/neko/${port}${rawUrl.pathname}${rawUrl.search}`;
              } else {
                finalWsUrl = `wss://${serverUrl.host}${rawUrl.pathname}${rawUrl.search}`;
              }
            } else {
              finalWsUrl = finalWsUrl.replace(/^ws:/, 'wss:');
            }
          } catch {
            finalWsUrl = finalWsUrl.replace(/^ws:/, 'wss:');
          }
        }

        const ws = new WebSocket(finalWsUrl);
        wsRef.current = ws;

        const handleOffer = async (
          sdp: string,
          iceServers?: RTCIceServer[]
        ) => {
          if (isCancelled) return;

          let pc = pcRef.current;
          if (!pc || iceServers !== undefined) {
            cleanupPeer();
            const fallbackIceServers: RTCIceServer[] = [
              { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
              { urls: ['stun:stun.cloudflare.com:3478'] },
            ];
            const finalIceServers =
              iceServers && iceServers.length > 0 ? iceServers : fallbackIceServers;

            pc = new RTCPeerConnection({
              iceServers: finalIceServers,
            });
            pcRef.current = pc;

            const mediaStream = new MediaStream();

            pc.onicecandidate = (ev) => {
              if (ev.candidate) {
                sendWs('signal/candidate', ev.candidate.toJSON());
              }
            };

            pc.onicecandidateerror = (ev) => {
              console.warn('[Neko WebRTC] ICE aday hatası:', (ev as unknown as { errorText?: string }).errorText);
            };

            pc.ondatachannel = (ev) => {
              ev.channel.binaryType = 'arraybuffer';
              dcRef.current = ev.channel;
            };

            pc.ontrack = (ev) => {
              if ('jitterBufferTarget' in ev.receiver) {
                try {
                  (ev.receiver as unknown as { jitterBufferTarget: number }).jitterBufferTarget = 0;
                } catch {
                  // Tarayıcı desteklemiyorsa yoksay
                }
              }

              if (ev.streams && ev.streams[0]) {
                if (videoRef.current && videoRef.current.srcObject !== ev.streams[0]) {
                  videoRef.current.srcObject = ev.streams[0];
                }
              } else {
                mediaStream.addTrack(ev.track);
                if (videoRef.current && videoRef.current.srcObject !== mediaStream) {
                  videoRef.current.srcObject = mediaStream;
                }
              }

              const videoEl = videoRef.current;
              if (videoEl) {
                videoEl.play().catch(async () => {
                  videoEl.muted = true;
                  setIsMuted(true);
                  setMutedByAutoplay(true);
                  try {
                    await videoEl.play();
                  } catch {
                    // Kullanıcı etkileşimi bekleniyor
                  }
                });
              }
            };

            const currentPc = pc;
            currentPc.onconnectionstatechange = () => {
              if (isCancelled || pcRef.current !== currentPc) return;
              console.log('[Neko WebRTC] ICE Bağlantı Durumu:', currentPc.connectionState);
              if (currentPc.connectionState === 'connected') {
                setStatus('connected');
                setError(null);
              } else if (currentPc.connectionState === 'failed') {
                console.warn('[Neko WebRTC] Bağlantı failed durumuna geçti, signal/request ile yeniden deneniyor...');
                sendWs('signal/request', { video: {}, audio: {} });
              }
            };
          }

          await pc.setRemoteDescription({ type: 'offer', sdp });

          while (candidatesQueueRef.current.length > 0) {
            const candidate = candidatesQueueRef.current.shift();
            if (candidate) {
              await pc.addIceCandidate(candidate).catch(() => {});
            }
          }

          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);

          sendWs('signal/answer', {
            sdp: pc.localDescription?.sdp || answer.sdp,
            displayname: nickname,
          });
        };

        ws.onmessage = (event) => {
          if (isCancelled) return;
          try {
            const msg = JSON.parse(event.data as string) as {
              event: string;
              payload?: Record<string, unknown>;
            };
            const payload = msg.payload || {};

            switch (msg.event) {
              case 'system/init': {
                if (typeof payload.session_id === 'string') {
                  myNekoSessionId = payload.session_id;
                }
                const size = payload.screen_size as NekoScreenSize | undefined;
                if (size && size.width && size.height) {
                  setScreenSize({
                    width: size.width,
                    height: size.height,
                    rate: size.rate || 30,
                  });
                }
                const controlHost = payload.control_host as
                  | { has_host?: boolean; host_id?: string }
                  | undefined;
                if (controlHost) {
                  setNekoHasControl(
                    Boolean(
                      controlHost.has_host &&
                        controlHost.host_id === myNekoSessionId
                    )
                  );
                }

                // Neko v3 WebRTC akışını başlatmak için signal/request gönderir
                sendWs('signal/request', { video: {}, audio: {} });

                if (isControllerRef.current) {
                  syncNekoControl(true);
                }
                break;
              }

              case 'system/heartbeat': {
                sendWs('client/heartbeat');
                break;
              }

              case 'screen/updated': {
                const width = Number(payload.width);
                const height = Number(payload.height);
                const rate = Number(payload.rate) || 30;
                if (width > 0 && height > 0) {
                  setScreenSize({ width, height, rate });
                }
                break;
              }

              case 'control/host': {
                const hasHost = Boolean(payload.has_host);
                const hostId = payload.host_id as string | undefined;
                const amIHost = Boolean(
                  hasHost && hostId && hostId === myNekoSessionId
                );
                setNekoHasControl(amIHost);
                break;
              }

              case 'signal/provide': {
                const sdp = payload.sdp as string | undefined;
                const iceServers = (payload.iceservers ||
                  payload.ice) as RTCIceServer[] | undefined;
                if (sdp) {
                  handleOffer(sdp, iceServers).catch((err) => {
                    console.error('[Neko WebRTC] signal/provide hatası:', err);
                  });
                }
                break;
              }

              case 'signal/offer':
              case 'signal/restart': {
                const sdp = payload.sdp as string | undefined;
                if (sdp) {
                  handleOffer(sdp).catch((err) => {
                    console.error('[Neko WebRTC] signal/offer hatası:', err);
                  });
                }
                break;
              }

              case 'signal/answer': {
                const sdp = payload.sdp as string | undefined;
                if (sdp && pcRef.current) {
                  pcRef.current
                    .setRemoteDescription({ type: 'answer', sdp })
                    .catch(() => {});
                }
                break;
              }

              case 'signal/candidate': {
                const candidate = payload as unknown as RTCIceCandidateInit;
                if (candidate && candidate.candidate) {
                  if (pcRef.current && pcRef.current.remoteDescription) {
                    pcRef.current.addIceCandidate(candidate).catch(() => {});
                  } else {
                    candidatesQueueRef.current.push(candidate);
                  }
                }
                break;
              }

              case 'system/disconnect': {
                const reason =
                  (payload.message as string) || 'Neko bağlantısı kesildi.';
                setStatus('error');
                setError(reason);
                break;
              }

              default:
                break;
            }
          } catch {
            // JSON olmayan paketleri yoksay
          }
        };

        ws.onerror = () => {
          if (isCancelled) return;
          setStatus('error');
          setError('Neko WebSocket bağlantı hatası.');
        };

        ws.onclose = () => {
          if (isCancelled) return;
          setStatus((prev) => (prev === 'error' ? 'error' : 'disconnected'));
        };
      } catch (err) {
        if (isCancelled) return;
        setStatus('error');
        setError(
          err instanceof Error
            ? err.message
            : 'Neko yayın sunucusuna bağlanılamadı.'
        );
      }
    };

    connectToNeko();

    return () => {
      isCancelled = true;
      releaseAllKeys();
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        if (isControllerRef.current) {
          wsRef.current.send(JSON.stringify({ event: 'control/release' }));
        }
        wsRef.current.close(1000);
      }
      wsRef.current = null;
      cleanupPeer();

      if (tokenRef.current) {
        const tokenToLogout = tokenRef.current;
        tokenRef.current = '';
        fetch(`${getServerUrl()}/api/neko/logout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roomId, token: tokenToLogout }),
        }).catch(() => {});
      }
    };
  }, [
    roomId,
    nekoUrl,
    nekoPassword,
    nickname,
    reconnectTrigger,
    sendWs,
    syncNekoControl,
    releaseAllKeys,
  ]);

  // Ekran üzerindeki tıklama/hareket koordinatlarını Neko çözünürlüğüne (örn: 1280x720) normalize et
  const normalizePoint = useCallback(
    (clientX: number, clientY: number, containerRect: DOMRect) => {
      const videoEl = videoRef.current;
      const remoteWidth = screenSize.width || videoEl?.videoWidth || 1280;
      const remoteHeight = screenSize.height || videoEl?.videoHeight || 720;

      if (containerRect.width <= 0 || containerRect.height <= 0) {
        return { x: 0, y: 0, inside: false };
      }

      // object-contain kaynaklı letterbox / pillarbox boşluklarını hesapla
      const containerRatio = containerRect.width / containerRect.height;
      const streamRatio = remoteWidth / remoteHeight;

      let renderWidth = containerRect.width;
      let renderHeight = containerRect.height;
      let offsetX = 0;
      let offsetY = 0;

      if (containerRatio > streamRatio) {
        // Sağ ve solda boşluk (pillarbox)
        renderWidth = containerRect.height * streamRatio;
        offsetX = (containerRect.width - renderWidth) / 2;
      } else {
        // Üst ve altta boşluk (letterbox)
        renderHeight = containerRect.width / streamRatio;
        offsetY = (containerRect.height - renderHeight) / 2;
      }

      const relX = clientX - containerRect.left - offsetX;
      const relY = clientY - containerRect.top - offsetY;

      const x = Math.max(
        0,
        Math.min(remoteWidth, Math.round((relX / renderWidth) * remoteWidth))
      );
      const y = Math.max(
        0,
        Math.min(remoteHeight, Math.round((relY / renderHeight) * remoteHeight))
      );

      const inside =
        relX >= 0 &&
        relX <= renderWidth &&
        relY >= 0 &&
        relY <= renderHeight;

      return { x, y, inside };
    },
    [screenSize.width, screenSize.height]
  );

  const flushMove = useCallback(() => {
    if (moveTimerRef.current) {
      window.clearTimeout(moveTimerRef.current);
      moveTimerRef.current = null;
    }
    const pos = pendingMoveRef.current;
    if (!pos || !isControllerRef.current) return;
    pendingMoveRef.current = null;
    lastMoveTimeRef.current = performance.now();
    sendWs('control/move', { x: pos.x, y: pos.y });
  }, [sendWs]);

  const sendMouseMove = useCallback(
    (clientX: number, clientY: number, containerRect: DOMRect) => {
      if (!isControllerRef.current) return;
      const { x, y } = normalizePoint(clientX, clientY, containerRect);
      pendingMoveRef.current = { x, y };

      const elapsed = performance.now() - lastMoveTimeRef.current;
      if (elapsed >= 16) {
        flushMove();
      } else if (!moveTimerRef.current) {
        moveTimerRef.current = window.setTimeout(flushMove, 16 - elapsed);
      }
    },
    [normalizePoint, flushMove]
  );

  const sendMouseButton = useCallback(
    (
      button: number,
      isDown: boolean,
      clientX: number,
      clientY: number,
      containerRect: DOMRect
    ) => {
      if (!isControllerRef.current) return;
      const { x, y } = normalizePoint(clientX, clientY, containerRect);
      pendingMoveRef.current = { x, y };
      flushMove();

      // Neko X11 buton kodları: 1 = Sol, 2 = Orta, 3 = Sağ
      const code = button + 1;
      sendWs(isDown ? 'control/buttondown' : 'control/buttonup', { code });
    },
    [normalizePoint, flushMove, sendWs]
  );

  const sendMouseWheel = useCallback(
    (
      deltaX: number,
      deltaY: number,
      ctrlKey: boolean,
      clientX: number,
      clientY: number,
      containerRect: DOMRect
    ) => {
      if (!isControllerRef.current) return;
      const { x, y } = normalizePoint(clientX, clientY, containerRect);
      pendingMoveRef.current = { x, y };
      flushMove();

      // Neko scroll yönü ve adımı normalize edilir
      const stepX = deltaX === 0 ? 0 : -Math.sign(deltaX);
      const stepY = deltaY === 0 ? 0 : -Math.sign(deltaY);

      if (stepX !== 0 || stepY !== 0) {
        sendWs('control/scroll', {
          delta_x: stepX,
          delta_y: stepY,
          control_key: ctrlKey,
        });
      }
    },
    [normalizePoint, flushMove, sendWs]
  );

  const sendKeyEvent = useCallback(
    (e: React.KeyboardEvent, isDown: boolean) => {
      if (!isControllerRef.current) return;
      const keysym = keyboardEventToKeysym(e);
      if (keysym === null) return;

      flushMove();

      if (isDown) {
        pressedKeysRef.current.add(keysym);
        sendWs('control/keydown', { keysym });
      } else {
        pressedKeysRef.current.delete(keysym);
        sendWs('control/keyup', { keysym });
      }
    },
    [flushMove, sendWs]
  );

  const sendPasteText = useCallback(
    (text: string) => {
      if (!isControllerRef.current || !text) return;
      sendWs('clipboard/set', { text });
      sendWs('control/paste', { text });
    },
    [sendWs]
  );

  const toggleMute = useCallback(() => {
    const videoEl = videoRef.current;
    if (!videoEl) return;
    const nextMuted = !videoEl.muted;
    videoEl.muted = nextMuted;
    setIsMuted(nextMuted);
    if (!nextMuted) {
      setMutedByAutoplay(false);
      videoEl.play().catch(() => {});
    }
  }, []);

  const reconnect = useCallback(() => {
    setReconnectTrigger((prev) => prev + 1);
  }, []);

  return {
    videoRef,
    status,
    error,
    screenSize,
    isMuted,
    mutedByAutoplay,
    nekoHasControl,
    toggleMute,
    reconnect,
    releaseAllKeys,
    sendMouseMove,
    sendMouseButton,
    sendMouseWheel,
    sendKeyEvent,
    sendPasteText,
  };
}
