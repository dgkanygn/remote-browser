import { useCallback, useEffect, useRef, useState } from 'react';
import { socket } from '../lib/socket';
import type { User } from '../types';

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

export interface RemotePeerMedia {
  socketId: string;
  stream: MediaStream | null;
  audioEnabled: boolean;
  videoEnabled: boolean;
}

export function useWebRTCMesh(roomId: string, users: User[]) {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [audioEnabled, setAudioEnabled] = useState<boolean>(true);
  const [videoEnabled, setVideoEnabled] = useState<boolean>(true);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [remotePeers, setRemotePeers] = useState<Record<string, RemotePeerMedia>>({});

  const localStreamRef = useRef<MediaStream | null>(null);
  const pcsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const pendingCandidatesRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const mediaInitializedRef = useRef<boolean>(false);

  const cleanupPeer = useCallback((peerSocketId: string) => {
    const pc = pcsRef.current.get(peerSocketId);
    if (pc) {
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.onconnectionstatechange = null;
      pc.close();
      pcsRef.current.delete(peerSocketId);
    }
    pendingCandidatesRef.current.delete(peerSocketId);
    setRemotePeers((prev) => {
      if (!(peerSocketId in prev)) return prev;
      const next = { ...prev };
      delete next[peerSocketId];
      return next;
    });
  }, []);

  const createPeerConnection = useCallback(
    (peerSocketId: string): RTCPeerConnection => {
      const existing = pcsRef.current.get(peerSocketId);
      if (existing) {
        return existing;
      }

      const pc = new RTCPeerConnection(RTC_CONFIG);
      pcsRef.current.set(peerSocketId, pc);

      const stream = localStreamRef.current;
      if (stream) {
        stream.getTracks().forEach((track) => {
          pc.addTrack(track, stream);
        });
      }

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit('ice-candidate', {
            roomId,
            targetSocketId: peerSocketId,
            candidate: event.candidate.toJSON(),
          });
        }
      };

      pc.ontrack = (event) => {
        const [remoteStream] = event.streams;
        if (remoteStream) {
          setRemotePeers((prev) => ({
            ...prev,
            [peerSocketId]: {
              socketId: peerSocketId,
              stream: remoteStream,
              audioEnabled: prev[peerSocketId]?.audioEnabled ?? true,
              videoEnabled: prev[peerSocketId]?.videoEnabled ?? true,
            },
          }));
        }
      };

      pc.onconnectionstatechange = () => {
        if (
          pc.connectionState === 'failed' ||
          pc.connectionState === 'closed'
        ) {
          cleanupPeer(peerSocketId);
        }
      };

      return pc;
    },
    [roomId, cleanupPeer]
  );

  const flushPendingCandidates = useCallback(async (peerSocketId: string, pc: RTCPeerConnection) => {
    const queued = pendingCandidatesRef.current.get(peerSocketId);
    if (!queued || queued.length === 0) return;
    pendingCandidatesRef.current.delete(peerSocketId);
    for (const candidate of queued) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.warn('[WebRTC] ICE candidate eklenemedi:', err);
      }
    }
  }, []);

  const initiateOfferToPeer = useCallback(
    async (peerSocketId: string) => {
      if (!peerSocketId || peerSocketId === socket.id) return;
      try {
        const pc = createPeerConnection(peerSocketId);
        const offer = await pc.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: true,
        });
        await pc.setLocalDescription(offer);
        socket.emit('peer-offer', {
          roomId,
          targetSocketId: peerSocketId,
          sdp: pc.localDescription,
        });
      } catch (err) {
        console.warn('[WebRTC] Offer oluşturulamadı:', err);
      }
    },
    [roomId, createPeerConnection]
  );

  // 1. Yerel kamera/mikrofon akışını başlat
  useEffect(() => {
    let cancelled = false;
    const pcsMap = pcsRef.current;
    const pendingCandidatesMap = pendingCandidatesRef.current;

    async function initLocalMedia() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 24 } },
          audio: { echoCancellation: true, noiseSuppression: true },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        localStreamRef.current = stream;
        setLocalStream(stream);
        setAudioEnabled(stream.getAudioTracks().some((t) => t.enabled));
        setVideoEnabled(stream.getVideoTracks().some((t) => t.enabled));
      } catch {
        // Kamera yoksa sadece mikrofon dene
        try {
          const audioOnlyStream = await navigator.mediaDevices.getUserMedia({
            video: false,
            audio: { echoCancellation: true, noiseSuppression: true },
          });
          if (cancelled) {
            audioOnlyStream.getTracks().forEach((t) => t.stop());
            return;
          }
          localStreamRef.current = audioOnlyStream;
          setLocalStream(audioOnlyStream);
          setAudioEnabled(true);
          setVideoEnabled(false);
          setMediaError('Kamera bulunamadı, yalnızca mikrofon aktif.');
        } catch {
          if (!cancelled) {
            setAudioEnabled(false);
            setVideoEnabled(false);
            setMediaError('Kamera/mikrofon erişimi sağlanamadı.');
          }
        }
      } finally {
        if (!cancelled) {
          mediaInitializedRef.current = true;
          // Mevcut bağlantılara yeni track'leri ekle
          pcsRef.current.forEach((pc) => {
            const stream = localStreamRef.current;
            if (stream) {
              const senders = pc.getSenders();
              stream.getTracks().forEach((track) => {
                if (!senders.some((s) => s.track === track)) {
                  pc.addTrack(track, stream);
                }
              });
            }
          });
        }
      }
    }

    initLocalMedia();

    return () => {
      cancelled = true;
      pcsMap.forEach((pc) => pc.close());
      pcsMap.clear();
      pendingCandidatesMap.clear();
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => track.stop());
        localStreamRef.current = null;
      }
    };
  }, [roomId]);

  // 2. Socket.io WebRTC Signaling dinleyicileri
  useEffect(() => {
    const handleUserJoined = async ({ socketId }: { socketId: string }) => {
      if (socketId && socketId !== socket.id) {
        await initiateOfferToPeer(socketId);
      }
    };

    const handleUserLeft = ({ socketId }: { socketId: string }) => {
      if (socketId) {
        cleanupPeer(socketId);
      }
    };

    const handlePeerOffer = async ({
      fromSocketId,
      sdp,
    }: {
      fromSocketId: string;
      sdp: RTCSessionDescriptionInit;
    }) => {
      if (!fromSocketId || !sdp) return;
      try {
        const pc = createPeerConnection(fromSocketId);
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        await flushPendingCandidates(fromSocketId, pc);

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        socket.emit('peer-answer', {
          roomId,
          targetSocketId: fromSocketId,
          sdp: pc.localDescription,
        });
      } catch (err) {
        console.warn('[WebRTC] Offer işlenirken hata:', err);
      }
    };

    const handlePeerAnswer = async ({
      fromSocketId,
      sdp,
    }: {
      fromSocketId: string;
      sdp: RTCSessionDescriptionInit;
    }) => {
      if (!fromSocketId || !sdp) return;
      const pc = pcsRef.current.get(fromSocketId);
      if (!pc) return;
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        await flushPendingCandidates(fromSocketId, pc);
      } catch (err) {
        console.warn('[WebRTC] Answer işlenirken hata:', err);
      }
    };

    const handleIceCandidate = async ({
      fromSocketId,
      candidate,
    }: {
      fromSocketId: string;
      candidate: RTCIceCandidateInit;
    }) => {
      if (!fromSocketId || !candidate) return;
      const pc = pcsRef.current.get(fromSocketId);
      if (pc && pc.remoteDescription && pc.remoteDescription.type) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (err) {
          console.warn('[WebRTC] ICE candidate eklenemedi:', err);
        }
      } else {
        const list = pendingCandidatesRef.current.get(fromSocketId) || [];
        list.push(candidate);
        pendingCandidatesRef.current.set(fromSocketId, list);
      }
    };

    const handlePeerMediaState = ({
      socketId,
      audioEnabled: peerAudio,
      videoEnabled: peerVideo,
    }: {
      socketId: string;
      audioEnabled: boolean;
      videoEnabled: boolean;
    }) => {
      setRemotePeers((prev) => ({
        ...prev,
        [socketId]: {
          socketId,
          stream: prev[socketId]?.stream ?? null,
          audioEnabled: peerAudio,
          videoEnabled: peerVideo,
        },
      }));
    };

    socket.on('user-joined', handleUserJoined);
    socket.on('user-left', handleUserLeft);
    socket.on('peer-offer', handlePeerOffer);
    socket.on('peer-answer', handlePeerAnswer);
    socket.on('ice-candidate', handleIceCandidate);
    socket.on('peer-media-state', handlePeerMediaState);

    return () => {
      socket.off('user-joined', handleUserJoined);
      socket.off('user-left', handleUserLeft);
      socket.off('peer-offer', handlePeerOffer);
      socket.off('peer-answer', handlePeerAnswer);
      socket.off('ice-candidate', handleIceCandidate);
      socket.off('peer-media-state', handlePeerMediaState);
    };
  }, [roomId, createPeerConnection, initiateOfferToPeer, cleanupPeer, flushPendingCandidates]);

  // Odadan ayrılan kullanıcıların peer kayıtlarını temizle
  useEffect(() => {
    const activeSocketIds = new Set(users.map((u) => u.socketId));
    pcsRef.current.forEach((_pc, peerSocketId) => {
      if (!activeSocketIds.has(peerSocketId)) {
        cleanupPeer(peerSocketId);
      }
    });
  }, [users, cleanupPeer]);

  const toggleAudio = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) return;

    const nextState = !audioEnabled;
    audioTracks.forEach((t) => {
      t.enabled = nextState;
    });
    setAudioEnabled(nextState);
    socket.emit('media-state-changed', {
      roomId,
      audioEnabled: nextState,
      videoEnabled,
    });
  }, [audioEnabled, videoEnabled, roomId]);

  const toggleVideo = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const videoTracks = stream.getVideoTracks();
    if (videoTracks.length === 0) return;

    const nextState = !videoEnabled;
    videoTracks.forEach((t) => {
      t.enabled = nextState;
    });
    setVideoEnabled(nextState);
    socket.emit('media-state-changed', {
      roomId,
      audioEnabled,
      videoEnabled: nextState,
    });
  }, [audioEnabled, videoEnabled, roomId]);

  return {
    localStream,
    remotePeers,
    audioEnabled,
    videoEnabled,
    mediaError,
    toggleAudio,
    toggleVideo,
  };
}
