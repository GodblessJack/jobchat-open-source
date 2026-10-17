export function VoiceWave({ volume }: { volume: number }) {
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
