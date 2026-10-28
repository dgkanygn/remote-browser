import React, { useEffect, useRef } from 'react';
import { Crown, Mic, MicOff, User as UserIcon, VideoOff } from 'lucide-react';

interface VideoTileProps {
  nickname: string;
  isLocal?: boolean;
  isHost?: boolean;
  stream: MediaStream | null;
  audioEnabled: boolean;
  videoEnabled: boolean;
}

export const VideoTile: React.FC<VideoTileProps> = ({
  nickname,
  isLocal = false,
  isHost = false,
  stream,
  audioEnabled,
  videoEnabled,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (el.srcObject !== stream) {
      el.srcObject = stream;
    }
  }, [stream]);

  const hasActiveVideo =
    Boolean(stream) &&
    videoEnabled &&
    stream!.getVideoTracks().length > 0 &&
    stream!.getVideoTracks().some((t) => t.enabled);

  return (
    <div className="relative flex flex-col justify-between bg-zinc-900 border border-zinc-800 rounded-md overflow-hidden h-full min-h-[120px]">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isLocal}
        className={`w-full h-full object-cover ${hasActiveVideo ? 'block' : 'hidden'}`}
      />

      {!hasActiveVideo && (
        <div className="flex-1 flex flex-col items-center justify-center bg-zinc-900 text-zinc-400 select-none">
          <div className="w-10 h-10 rounded-md bg-zinc-950 border border-zinc-800 flex items-center justify-center mb-1.5">
            <UserIcon className="w-5 h-5 text-zinc-400" />
          </div>
          <span className="text-xs text-zinc-400 font-medium truncate max-w-[140px]">
            {nickname}
          </span>
        </div>
      )}

      <div className="absolute bottom-0 inset-x-0 px-2.5 py-1.5 bg-zinc-950/90 border-t border-zinc-800/80 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          {isHost && (
            <Crown className="w-3.5 h-3.5 text-zinc-100 shrink-0" aria-label="Oda Sahibi" />
          )}
          <span className="text-xs font-medium text-zinc-100 truncate">
            {nickname}
            {isLocal ? ' (Sen)' : ''}
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {!videoEnabled && (
            <VideoOff className="w-3.5 h-3.5 text-zinc-400" aria-label="Kamera Kapalı" />
          )}
          {audioEnabled ? (
            <Mic className="w-3.5 h-3.5 text-zinc-400" aria-label="Mikrofon Açık" />
          ) : (
            <MicOff className="w-3.5 h-3.5 text-red-400" aria-label="Mikrofon Kapalı" />
          )}
        </div>
      </div>
    </div>
  );
};

