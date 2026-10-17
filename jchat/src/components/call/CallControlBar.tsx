import { Mic, MicOff, Video, VideoOff, MonitorUp, PhoneOff } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

interface CallControlBarProps {
  isMuted: boolean;
  isVideoEnabled: boolean;
  isScreenSharing: boolean;
  onToggleMute: () => void;
  onToggleVideo: () => void;
  onToggleScreenShare: () => void;
  onHangup: () => void;
}

function ControlBtn({
  icon: Icon,
  isActive = true,
  isDestructive = false,
  onClick,
  className = '',
}: {
  icon: LucideIcon;
  isActive?: boolean;
  isDestructive?: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-200 ${
        isDestructive
          ? 'bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white'
          : isActive
            ? 'hover:bg-zinc-700 text-zinc-200'
            : 'bg-zinc-800 text-zinc-500'
      } ${className}`}
    >
      <Icon className="w-5 h-5" />
    </button>
  );
}

export function CallControlBar({
  isMuted,
  isVideoEnabled,
  isScreenSharing,
  onToggleMute,
  onToggleVideo,
  onToggleScreenShare,
  onHangup,
}: CallControlBarProps) {
  return (
    <div className="p-6 pt-2 bg-zinc-900">
      <div className="bg-zinc-800/50 backdrop-blur-xl border border-zinc-700/50 rounded-2xl p-2 flex items-center justify-between">
        <div className="flex items-center gap-1">
          <ControlBtn
            icon={isMuted ? MicOff : Mic}
            isActive={!isMuted}
            isDestructive={isMuted}
            onClick={onToggleMute}
          />
          <ControlBtn
            icon={isVideoEnabled ? Video : VideoOff}
            isActive={isVideoEnabled}
            isDestructive={!isVideoEnabled}
            onClick={onToggleVideo}
          />
        </div>

        <div className="w-px h-8 bg-zinc-700/50 mx-1" />

        <div className="flex items-center gap-1">
          <ControlBtn
            icon={MonitorUp}
            isActive={isScreenSharing}
            className={
              isScreenSharing
                ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                : 'text-blue-400 hover:bg-blue-500/10'
            }
            onClick={onToggleScreenShare}
          />
        </div>

        <div className="pl-2">
          <button
            onClick={onHangup}
            className="w-10 h-10 rounded-xl bg-red-500/10 hover:bg-red-500 text-red-500 hover:text-white flex items-center justify-center transition-all duration-300"
          >
            <PhoneOff className="w-5 h-5 fill-current" />
          </button>
        </div>
      </div>
    </div>
  );
}
