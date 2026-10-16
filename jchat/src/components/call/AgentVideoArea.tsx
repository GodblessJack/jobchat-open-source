import { VoiceWave } from './VoiceWave';

interface AgentVideoAreaProps {
  agentName: string;
  agentRole?: string | null;
  agentAvatarUrl?: string | null;
  isSpeaking: boolean;
  aiVolume: number;
  status: 'idle' | 'connecting' | 'connected' | 'speaking' | 'listening' | 'ended' | 'error';
  onStartCall?: () => void;
}

export function AgentVideoArea({
  agentName,
  agentRole,
  agentAvatarUrl,
  isSpeaking,
  aiVolume,
  status,
  onStartCall,
}: AgentVideoAreaProps) {
  const avatarSrc = agentAvatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(agentName || 'AI')}&background=random`;

  return (
    <div className="flex-1 relative rounded-2xl overflow-hidden bg-zinc-950 border border-zinc-800 shadow-inner">
      {/* Ambient Background */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-blue-500/10 via-transparent to-transparent opacity-40 z-0" />

      {/* Central UI */}
      <div className="absolute inset-0 flex flex-col items-center justify-center z-10 p-6">

        {/* Dynamic Waveforms / Ripples around Avatar */}
        <div className="relative w-full h-48 flex items-center justify-center">

          {/* Voice Wave - behind avatar */}
          {isSpeaking && (
            <div className="absolute inset-x-0 h-40 pointer-events-none flex items-center justify-center opacity-90 z-0">
              <VoiceWave volume={aiVolume} />
            </div>
          )}

          {/* Avatar Core */}
          <div className="relative flex items-center justify-center w-48 h-48">
            {/* Concentric Ping Circles */}
            {isSpeaking && [1, 2, 3].map((i) => (
              <div
                key={i}
                className="absolute inset-0 border border-blue-500/30 rounded-full animate-ping"
                style={{
                  animationDelay: `${i * 0.4}s`,
                  animationDuration: '2s',
                  transform: `scale(${1 + (aiVolume * 0.5)})`,
                  opacity: 0.2 - (i * 0.05),
                }}
              />
            ))}

            {/* Glowing Aura */}
            <div
              className="absolute inset-0 bg-blue-500/20 rounded-full blur-3xl transition-all duration-150"
              style={{
                transform: `scale(${1 + (aiVolume * 1.5)})`,
                opacity: 0.2 + (aiVolume * 0.6),
              }}
            />

            {/* Avatar Image */}
            <div
              className="relative w-32 h-32 rounded-full border-2 border-zinc-700/50 shadow-2xl overflow-hidden transition-transform duration-150 z-20"
              style={{ transform: `scale(${1 + (aiVolume * 0.1)})` }}
            >
              <img
                src={avatarSrc}
                alt={agentName}
                className="w-full h-full object-cover"
                onError={(e) => {
                  const img = e.target as HTMLImageElement;
                  if (img.src.includes('ui-avatars.com')) {
                    img.style.display = 'none';
                    return;
                  }
                  img.src =
                    `https://ui-avatars.com/api/?name=${encodeURIComponent(agentName || 'AI')}&background=random`;
                }}
              />
            </div>
          </div>
        </div>

        {/* Information Section */}
        <div className="mt-12 text-center">
          <h3 className="text-xl font-semibold text-white tracking-tight">{agentName}</h3>
          {agentRole && (
            <p className="text-zinc-500 text-xs font-medium uppercase tracking-widest mt-1">
              {agentRole}
            </p>
          )}

          {/* Status-dependent controls */}
          {status === 'idle' && onStartCall && (
            <button
              onClick={onStartCall}
              className="mt-6 px-8 py-2.5 bg-white text-black rounded-full font-bold text-sm hover:scale-105 active:scale-95 transition-all shadow-xl"
            >
              Start Call
            </button>
          )}

          {status === 'connecting' && (
            <div className="mt-6 flex items-center justify-center gap-2">
              <div className="w-4 h-4 rounded-full border-2 border-zinc-400 border-t-transparent animate-spin" />
              <span className="text-zinc-400 text-sm font-medium">Connecting...</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
