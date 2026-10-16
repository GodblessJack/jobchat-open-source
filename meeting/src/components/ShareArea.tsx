import { PenTool, MonitorUp } from 'lucide-react';
import { Whiteboard } from './Whiteboard';
import { useAudioCall } from '../hooks/useAudioCall';

interface ShareAreaProps {
  shareMode: 'whiteboard' | 'screen';
  onShareModeChange: (mode: 'whiteboard' | 'screen') => void;
  callState: ReturnType<typeof useAudioCall>;
  contact?: any;
}

export function ShareArea({ shareMode, onShareModeChange, callState, contact }: ShareAreaProps) {
  return (
    <div className="flex-1 flex flex-col bg-gradient-to-br from-gray-50 to-gray-100/50">
      {/* 切换标签 */}
      <div className={`h-16 bg-white/80 backdrop-blur-sm border-b border-gray-100 flex items-center px-8 gap-3 transition-all duration-500 ${shareMode === 'screen' ? 'opacity-50 pointer-events-none grayscale' : 'opacity-100'}`}>
        <button
          onClick={() => onShareModeChange('whiteboard')}
          className={`px-5 h-10 rounded-xl flex items-center gap-2 transition-all ${shareMode === 'whiteboard'
            ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-md shadow-blue-200'
            : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
            }`}
        >
          <PenTool className="w-4 h-4" />
          <span>Whiteboard</span>
        </button>
      </div>

      {/* 内容区域 */}
      <div className="flex-1 overflow-hidden relative">
        {shareMode === 'whiteboard' && <Whiteboard />}

        {shareMode === 'screen' && (
          <div className="absolute inset-0 bg-zinc-900 flex flex-col items-center justify-center p-12 text-center">
            <div className="w-24 h-24 rounded-3xl bg-blue-500/10 flex items-center justify-center mb-8 animate-pulse">
              <div className="w-16 h-16 rounded-2xl bg-blue-500 flex items-center justify-center shadow-lg shadow-blue-500/20">
                <span className="w-8 h-8 text-white"><MonitorUp /></span>
              </div>
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">Screen Sharing Active</h2>
            <p className="text-zinc-400 max-w-md">
              You are currently presenting your screen to the interview.
              Click the screen share button in the dock to stop.
            </p>
            <button
              onClick={callState.shareScreen}
              className="mt-8 px-6 py-2.5 bg-red-500/10 hover:bg-red-500 text-red-500 hover:text-white rounded-xl font-semibold transition-all border border-red-500/20"
            >
              Stop Sharing
            </button>
          </div>
        )}
      </div>
    </div>
  );
}