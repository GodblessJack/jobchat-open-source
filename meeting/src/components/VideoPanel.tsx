import {
  Mic, MicOff, Video, VideoOff,
  ShieldCheck, Users, MessageSquare, MonitorUp, Smile, PhoneOff, Settings
} from 'lucide-react';
import { useAudioCall } from '../hooks/useAudioCall';
import { User } from './AuthContext';

interface Contact {
  id: string;
  name: string;
  role: string;
  avatar_url: string;
  persona_description: string;
}

interface VideoPanelProps {
  callState: ReturnType<typeof useAudioCall>;
  contact: Contact | null;
  user: User | null;
}

export function VideoPanel({ callState, contact, user }: VideoPanelProps) {
  const {
    status,
    isAiSpeaking,
    userVolume,
    interrupt,
    localVideoRef,
    isMuted,
    toggleMute,
    isVideoEnabled,
    toggleVideo,
    connect,
    disconnect,
    aiVolume,
    isScreenSharing
  } = callState;

  return (
    <div className="w-[450px] bg-zinc-900 flex flex-col h-full shadow-2xl border-l border-zinc-800 relative z-20">

      {/* HEADER */}
      <div className="h-14 bg-zinc-900/90 backdrop-blur-md flex items-center justify-between px-6 border-b border-zinc-800 z-10">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
            <ShieldCheck className="w-4 h-4 text-white" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white tracking-wide">
              {contact?.name || 'Friend'}
            </h2>
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[10px] uppercase tracking-wider text-emerald-500 font-medium">
                {status === 'connected' ? 'Live Connection' : 'Ready'}
              </span>
            </div>
          </div>
        </div>
      </div>


      {/* MAIN CONTENT AREA */}
      <div className="flex-1 p-4 flex flex-col gap-4 overflow-hidden relative">

        {/* AI AVATAR SECTION */}
        <div className="flex-[1.2] relative rounded-2xl overflow-hidden bg-zinc-950 border border-zinc-800 shadow-inner group">

          {/* Subtle Ambient Background */}
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-blue-500/10 via-transparent to-transparent opacity-40 z-0" />

          {/* Central Assistant UI */}
          <div className="absolute inset-0 flex flex-col items-center justify-center z-10 p-6">

            {/* Dynamic Waveforms/Ripples around Avatar */}
            <div className="relative w-full h-48 flex items-center justify-center">

              {/* Siri-style Waveform Overlay - Placed behind avatar */}
              {isAiSpeaking && (
                <div className="absolute inset-x-0 h-40 pointer-events-none flex items-center justify-center opacity-90 z-0">
                  <VoiceWave volume={aiVolume} />
                </div>
              )}

              {/* Avatar Core with its own relative positioning to be on top */}
              <div className="relative flex items-center justify-center w-48 h-48">
                {/* Outer Ripples (React to Volume) */}
                {isAiSpeaking && [1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="absolute inset-0 border border-blue-500/30 rounded-full animate-ping"
                    style={{
                      animationDelay: `${i * 0.4}s`,
                      animationDuration: '2s',
                      transform: `scale(${1 + (aiVolume * 0.5)})`,
                      opacity: 0.2 - (i * 0.05)
                    }}
                  />
                ))}

                {/* Glowing Aura */}
                <div
                  className="absolute inset-0 bg-blue-500/20 rounded-full blur-3xl transition-all duration-150"
                  style={{
                    transform: `scale(${1 + (aiVolume * 1.5)})`,
                    opacity: 0.2 + (aiVolume * 0.6)
                  }}
                />

                {/* Circular Avatar Core */}
                <div
                  className="relative w-32 h-32 rounded-full border-2 border-zinc-700/50 shadow-2xl overflow-hidden transition-transform duration-150 z-20"
                  style={{ transform: `scale(${1 + (aiVolume * 0.1)})` }}
                >
                  <img
                    src={contact?.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(contact?.name || 'AI')}&background=random`}
                    alt={contact?.name}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${encodeURIComponent(contact?.name || 'AI')}&background=random`;
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Information Section */}
            <div className="mt-12 text-center">
              <h3 className="text-xl font-semibold text-white tracking-tight">{contact?.name || 'Friend'}</h3>
              <p className="text-zinc-500 text-xs font-medium uppercase tracking-widest mt-1">
                {contact?.role || 'Friend'}
              </p>

              {status === 'idle' && (
                <button
                  onClick={connect}
                  className="mt-6 px-8 py-2.5 bg-white text-black rounded-full font-bold text-sm hover:scale-105 active:scale-95 transition-all shadow-xl"
                >
                  Start Call
                </button>
              )}
            </div>
          </div>
        </div>

        {/* USER VIDEO PIP - Balanced Split */}
        <div className="flex-1 rounded-2xl overflow-hidden bg-zinc-900 border border-zinc-800 relative shadow-xl min-h-0">
          <div className="w-full h-full flex items-center justify-center bg-zinc-800">
            <video
              ref={localVideoRef}
              autoPlay
              muted
              playsInline
              className={`w-full h-full object-cover ${!isScreenSharing ? 'transform scale-x-[-1]' : ''} ${!isVideoEnabled && !isScreenSharing ? 'hidden' : ''}`}
            />
            {!isVideoEnabled && !isScreenSharing && (
              <div className="w-16 h-16 rounded-full bg-zinc-700 flex items-center justify-center overflow-hidden">
                {user?.avatar ? (
                  <img
                    src={user.avatar}
                    alt={user.name || 'User'}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${encodeURIComponent(user?.name || 'U')}&background=random`;
                    }}
                  />
                ) : (
                  <span className="text-xl text-zinc-400">Me</span>
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
              {isMuted ? <MicOff className="w-3 h-3 text-red-500" /> : <Mic className={`w-3 h-3 ${userVolume > 0.05 ? 'text-emerald-400' : 'text-zinc-400'}`} />}
              {user?.name || 'You'}
            </div>
          </div>
        </div>
      </div>

      {/* FLOATING CONTROLS */}
      <div className="p-6 pt-2 bg-zinc-900">
        <div className="bg-zinc-800/50 backdrop-blur-xl border border-zinc-700/50 rounded-2xl p-2 flex items-center justify-between shadow-2xl">

          <div className="flex items-center gap-1">
            <ControlBtn
              icon={isMuted ? MicOff : Mic}
              isActive={!isMuted}
              isDestructive={isMuted}
              onClick={toggleMute}
            />
            <ControlBtn
              icon={isVideoEnabled ? Video : VideoOff}
              isActive={isVideoEnabled}
              isDestructive={!isVideoEnabled}
              onClick={toggleVideo}
            />
          </div>

          <div className="w-px h-8 bg-zinc-700/50 mx-1" />

          <div className="flex items-center gap-1">
            <ControlBtn
              icon={MonitorUp}
              isActive={isScreenSharing}
              className={isScreenSharing ? "bg-blue-500/20 text-blue-400 border border-blue-500/30" : "text-blue-400 hover:bg-blue-500/10"}
              onClick={callState.shareScreen}
            />
          </div>

          <div className="pl-2">
            <button
              onClick={disconnect}
              className="w-10 h-10 rounded-xl bg-red-500/10 hover:bg-red-500 text-red-500 hover:text-white flex items-center justify-center transition-all duration-300"
            >
              <PhoneOff className="w-5 h-5 fill-current" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ControlBtn({ icon: Icon, isActive = true, isDestructive = false, onClick, className = "" }: any) {
  return (
    <button
      onClick={onClick}
      className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-200 ${isDestructive
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

function VoiceWave({ volume }: { volume: number }) {
  // Use a ref for persistent animation phase if needed, but here CSS animation works
  return (
    <svg className="w-full h-full" viewBox="0 0 800 300" preserveAspectRatio="none">
      <defs>
        <linearGradient id="wave1" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="rgba(59, 130, 246, 0)" />
          <stop offset="50%" stopColor="rgba(59, 130, 246, 0.4)" />
          <stop offset="100%" stopColor="rgba(59, 130, 246, 0)" />
        </linearGradient>
        <linearGradient id="wave2" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="rgba(34, 197, 94, 0)" />
          <stop offset="50%" stopColor="rgba(34, 197, 94, 0.4)" />
          <stop offset="100%" stopColor="rgba(34, 197, 94, 0)" />
        </linearGradient>
        <linearGradient id="wave3" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="rgba(129, 140, 248, 0)" />
          <stop offset="50%" stopColor="rgba(129, 140, 248, 0.4)" />
          <stop offset="100%" stopColor="rgba(129, 140, 248, 0)" />
        </linearGradient>
      </defs>

      {/* Wave 1 - Blue */}
      <path
        d="M 0 150 Q 200 100 400 150 Q 600 200 800 150"
        stroke="url(#wave1)"
        strokeWidth="5"
        fill="transparent"
        className="transition-all duration-75"
        style={{
          transform: `scaleY(${0.8 + volume * 3})`,
          transformOrigin: '50% 50%',
          opacity: 0.9 + volume * 0.1
        }}
      >
        <animate
          attributeName="d"
          dur="3s"
          repeatCount="indefinite"
          values="M 0 150 Q 200 100 400 150 Q 600 200 800 150; M 0 150 Q 200 200 400 150 Q 600 100 800 150; M 0 150 Q 200 100 400 150 Q 600 200 800 150"
        />
      </path>

      {/* Wave 2 - Green */}
      <path
        d="M 0 150 Q 150 200 350 150 Q 550 100 800 150"
        stroke="url(#wave2)"
        strokeWidth="4"
        fill="transparent"
        className="transition-all duration-75"
        style={{
          transform: `scaleY(${1 + volume * 4})`,
          transformOrigin: '50% 50%',
          opacity: 0.8 + volume * 0.2
        }}
      >
        <animate
          attributeName="d"
          dur="4s"
          repeatCount="indefinite"
          values="M 0 150 Q 150 200 350 150 Q 550 100 800 150; M 0 150 Q 150 100 350 150 Q 550 200 800 150; M 0 150 Q 150 200 350 150 Q 550 100 800 150"
        />
      </path>

      {/* Wave 3 - Indigo */}
      <path
        d="M 0 150 Q 250 120 450 150 Q 650 180 800 150"
        stroke="url(#wave3)"
        strokeWidth="3"
        fill="transparent"
        className="transition-all duration-75"
        style={{
          transform: `scaleY(${1.2 + volume * 2.5})`,
          transformOrigin: '50% 50%',
          opacity: 1
        }}
      >
        <animate
          attributeName="d"
          dur="2.5s"
          repeatCount="indefinite"
          values="M 0 150 Q 250 120 450 150 Q 650 180 800 150; M 0 150 Q 250 180 450 150 Q 650 120 800 150; M 0 150 Q 250 120 450 150 Q 650 180 800 150"
        />
      </path>
    </svg>
  );
}