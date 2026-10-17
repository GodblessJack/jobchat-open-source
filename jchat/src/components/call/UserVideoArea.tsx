import { Mic, MicOff } from 'lucide-react';

interface UserVideoAreaProps {
  userName: string;
  userAvatarUrl?: string | null;
  isMuted: boolean;
  userVolume: number;
  isVideoEnabled: boolean;
  isScreenSharing: boolean;
  localVideoRef: React.RefObject<HTMLVideoElement | null>;
}

export function UserVideoArea({
  userName,
  userAvatarUrl,
  isMuted,
  userVolume,
  isVideoEnabled,
  isScreenSharing,
  localVideoRef,
}: UserVideoAreaProps) {
  const videoVisible = isVideoEnabled || isScreenSharing;

  return (
    <div className="flex-1 rounded-2xl overflow-hidden bg-zinc-900 border border-zinc-800 relative shadow-xl min-h-0">
      <div className="w-full h-full flex items-center justify-center bg-zinc-800">
        <video
          ref={localVideoRef as React.RefObject<HTMLVideoElement>}
          autoPlay
          muted
          playsInline
          className={`w-full h-full object-cover ${!isScreenSharing ? 'transform scale-x-[-1]' : ''} ${!videoVisible ? 'hidden' : ''}`}
        />
        {!videoVisible && (
          <div className="w-16 h-16 rounded-full bg-zinc-700 flex items-center justify-center overflow-hidden">
            {userAvatarUrl ? (
              <img
                src={userAvatarUrl}
                alt={userName}
                className="w-full h-full object-cover"
                onError={(e) => {
                  (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${encodeURIComponent(userName)}&background=random`;
                }}
              />
            ) : (
              <span className="text-xl text-zinc-400">{userName.charAt(0).toUpperCase()}</span>
            )}
          </div>
        )}
        {isScreenSharing && (
          <div className="absolute top-2 right-2 px-2 py-1 bg-blue-600/80 rounded text-[10px] text-white font-bold uppercase tracking-wider backdrop-blur-sm animate-pulse">
            Sharing
          </div>
        )}
      </div>

      {/* User Label / Mute Status */}
      <div className="absolute bottom-3 left-3 flex gap-2">
        <div className="bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-lg text-white text-xs font-medium flex items-center gap-2 border border-white/5">
          {isMuted ? (
            <MicOff className="w-3 h-3 text-red-500" />
          ) : (
            <Mic className={`w-3 h-3 ${userVolume > 0.05 ? 'text-emerald-400' : 'text-zinc-400'}`} />
          )}
          {userName}
        </div>
      </div>
    </div>
  );
}
