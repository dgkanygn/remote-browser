import React, { useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Lock,
  Monitor,
  Plus,
  X,
} from 'lucide-react';
import type { RoomInviteInfo } from '../types';

interface LobbyViewProps {
  isConnected: boolean;
  isLoading: boolean;
  error: string | null;
  inviteRoomId: string | null;
  inviteRoomInfo: RoomInviteInfo | null;
  isCheckingInvite: boolean;
  defaultNickname: string;
  onClearError: () => void;
  onExitInvite: () => void;
  onCreateRoom: (data: {
    nickname: string;
    title: string;
    maxUsers: number;
    password?: string;
  }) => void;
  onJoinRoom: (data: {
    roomId: string;
    nickname: string;
    password?: string;
  }) => void;
}

export const LobbyView: React.FC<LobbyViewProps> = ({
  isConnected,
  isLoading,
  error,
  inviteRoomId,
  inviteRoomInfo,
  isCheckingInvite,
  defaultNickname,
  onClearError,
  onExitInvite,
  onCreateRoom,
  onJoinRoom,
}) => {
  // Davet Linki ile Katılım State
  const [joinNickname, setJoinNickname] = useState(defaultNickname);
  const [joinPassword, setJoinPassword] = useState('');

  // Yeni Oda Oluştur State
  const [createNickname, setCreateNickname] = useState(defaultNickname);
  const [createTitle, setCreateTitle] = useState('');
  const [createMaxUsers, setCreateMaxUsers] = useState<number>(4);
  const [createPassword, setCreatePassword] = useState('');

  const handleJoinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteRoomId || !joinNickname.trim()) return;
    onJoinRoom({
      roomId: inviteRoomId,
      nickname: joinNickname.trim(),
      password: joinPassword.trim() || undefined,
    });
  };

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!createNickname.trim() || !createTitle.trim()) return;
    onCreateRoom({
      nickname: createNickname.trim(),
      title: createTitle.trim(),
      maxUsers: createMaxUsers,
      password: createPassword.trim() || undefined,
    });
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
      {/* Üst Bar */}
      <header className="h-12 border-b border-zinc-800 bg-zinc-950 px-6 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded bg-zinc-900 border border-zinc-800 flex items-center justify-center">
            <Monitor className="w-3.5 h-3.5 text-zinc-100" />
          </div>
          <span className="text-xs font-semibold tracking-tight text-zinc-100">
            WatchParty
          </span>
          <span className="text-xs text-zinc-400 border-l border-zinc-800 pl-2.5">
            Neko WebRTC
          </span>
        </div>

        <div className="flex items-center gap-1.5 text-xs text-zinc-400">
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              isConnected ? 'bg-emerald-500' : 'bg-red-500'
            }`}
          />
          <span>{isConnected ? 'Sunucu Bağlı' : 'Bağlantı Bekleniyor'}</span>
        </div>
      </header>

      {/* Merkez Kart Alanı */}
      <main className="flex-1 flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-md space-y-4">
          {error && (
            <div className="px-3.5 py-2.5 rounded bg-zinc-900 border border-red-900/60 flex items-center justify-between gap-3 text-xs text-red-400">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
              <button
                type="button"
                onClick={onClearError}
                className="text-zinc-400 hover:text-zinc-100 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {inviteRoomId ? (
            /* Davet Linki Üzerinden Doğrudan Odaya Giriş Ekranı */
            <section className="bg-zinc-900 border border-zinc-800 rounded-md p-5">
              {isCheckingInvite ? (
                <div className="py-8 text-center space-y-2">
                  <p className="text-xs font-medium text-zinc-100">
                    Oda bağlantısı kontrol ediliyor...
                  </p>
                  <p className="text-[11px] text-zinc-400">
                    Lütfen bekleyin.
                  </p>
                </div>
              ) : !inviteRoomInfo ? (
                <div className="space-y-4">
                  <div className="space-y-1">
                    <h2 className="text-sm font-semibold text-zinc-100">
                      Oda Bulunamadı
                    </h2>
                    <p className="text-xs text-zinc-400">
                      Bu bağlantıya ait oda kapatılmış veya geçersiz olabilir.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={onExitInvite}
                    className="w-full h-9 rounded bg-zinc-100 hover:bg-zinc-200 text-zinc-950 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Yeni Oda Oluştur</span>
                  </button>
                </div>
              ) : (
                <div>
                  <div className="mb-4 pb-3 border-b border-zinc-800 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <span className="text-[11px] text-zinc-400 block">
                        Davet Edilen Oda
                      </span>
                      <h2 className="text-sm font-semibold text-zinc-100 truncate mt-0.5">
                        {inviteRoomInfo.title}
                      </h2>
                    </div>
                    {inviteRoomInfo.hasPassword && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-zinc-400 bg-zinc-950 px-2 py-1 rounded border border-zinc-800 shrink-0">
                        <Lock className="w-3 h-3" />
                        <span>Şifreli</span>
                      </span>
                    )}
                  </div>

                  <form onSubmit={handleJoinSubmit} className="space-y-3.5">
                    <div>
                      <label className="block text-xs font-medium text-zinc-400 mb-1">
                        Takma Ad (Nickname)
                      </label>
                      <input
                        type="text"
                        required
                        autoFocus
                        maxLength={24}
                        placeholder="Örn: dogukan"
                        value={joinNickname}
                        onChange={(e) => setJoinNickname(e.target.value)}
                        className="w-full h-9 px-3 rounded bg-zinc-950 border border-zinc-800 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-zinc-600"
                      />
                    </div>

                    {inviteRoomInfo.hasPassword && (
                      <div>
                        <label className="block text-xs font-medium text-zinc-400 mb-1">
                          Oda Şifresi
                        </label>
                        <input
                          type="password"
                          required
                          maxLength={32}
                          placeholder="Oda şifresini girin"
                          value={joinPassword}
                          onChange={(e) => setJoinPassword(e.target.value)}
                          className="w-full h-9 px-3 rounded bg-zinc-950 border border-zinc-800 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-zinc-600"
                        />
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={
                        isLoading ||
                        inviteRoomInfo.isFull ||
                        !joinNickname.trim() ||
                        (inviteRoomInfo.hasPassword && !joinPassword.trim())
                      }
                      className="w-full h-9 mt-1 rounded bg-zinc-100 hover:bg-zinc-200 disabled:opacity-40 disabled:pointer-events-none text-zinc-950 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <span>
                        {inviteRoomInfo.isFull
                          ? 'Oda Dolu'
                          : isLoading
                            ? 'Odaya Giriliyor...'
                            : 'Odaya Gir'}
                      </span>
                      {!inviteRoomInfo.isFull && (
                        <ArrowRight className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </form>

                  <div className="mt-4 pt-3 border-t border-zinc-800 flex items-center justify-between text-xs text-zinc-400">
                    <button
                      type="button"
                      onClick={onExitInvite}
                      className="inline-flex items-center gap-1.5 text-zinc-400 hover:text-zinc-100 transition-colors cursor-pointer"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                      <span>Yeni oda oluştur</span>
                    </button>
                  </div>
                </div>
              )}
            </section>
          ) : (
            /* Ana Giriş Ekranı: Sadece Özel Oda Oluşturma */
            <section className="bg-zinc-900 border border-zinc-800 rounded-md p-5">
              <div className="mb-4 pb-3 border-b border-zinc-800">
                <h2 className="text-sm font-semibold text-zinc-100">
                  Oda Oluştur
                </h2>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Özel bir izleme odası başlatın ve davet linkini paylaşarak arkadaşlarınızı çağırın.
                </p>
              </div>

              <form onSubmit={handleCreateSubmit} className="space-y-3.5">
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1">
                    Takma Ad (Nickname)
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={24}
                    placeholder="Örn: dogukan"
                    value={createNickname}
                    onChange={(e) => setCreateNickname(e.target.value)}
                    className="w-full h-9 px-3 rounded bg-zinc-950 border border-zinc-800 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-zinc-600"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1">
                    Oda Başlığı
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={40}
                    placeholder="Örn: Film Gecesi"
                    value={createTitle}
                    onChange={(e) => setCreateTitle(e.target.value)}
                    className="w-full h-9 px-3 rounded bg-zinc-950 border border-zinc-800 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-zinc-600"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1">
                    Kapasite (2 - 4 Kişi)
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {[2, 3, 4].map((num) => (
                      <button
                        key={num}
                        type="button"
                        onClick={() => setCreateMaxUsers(num)}
                        className={`h-8 rounded border text-xs font-medium transition-colors cursor-pointer ${
                          createMaxUsers === num
                            ? 'bg-zinc-100 text-zinc-950 border-zinc-100'
                            : 'bg-zinc-950 text-zinc-400 border-zinc-800 hover:text-zinc-100'
                        }`}
                      >
                        {num} Kişi
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1">
                    Oda Şifresi (Opsiyonel)
                  </label>
                  <input
                    type="password"
                    maxLength={32}
                    placeholder="Boş bırakılırsa linke sahip herkes katılabilir"
                    value={createPassword}
                    onChange={(e) => setCreatePassword(e.target.value)}
                    className="w-full h-9 px-3 rounded bg-zinc-950 border border-zinc-800 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-zinc-600"
                  />
                </div>

                <button
                  type="submit"
                  disabled={
                    isLoading || !createNickname.trim() || !createTitle.trim()
                  }
                  className="w-full h-9 mt-2 rounded bg-zinc-100 hover:bg-zinc-200 disabled:opacity-40 disabled:pointer-events-none text-zinc-950 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>
                    {isLoading ? 'Oda Başlatılıyor...' : 'Oda Oluştur ve Başlat'}
                  </span>
                </button>
              </form>
            </section>
          )}
        </div>
      </main>
    </div>
  );
};
