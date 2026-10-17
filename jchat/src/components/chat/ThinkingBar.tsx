import React, { useEffect, useRef } from 'react';
import { Brain, Wrench, CheckCircle, Loader2, XCircle } from 'lucide-react';
import type { ThinkingEvent } from '../../store/messages';

interface ThinkingBarProps {
  events: ThinkingEvent[];
}

/** Map event type to icon + color. */
function eventStyle(e: ThinkingEvent) {
  switch (e.type) {
    case 'thinking':
      return { Icon: Brain, color: 'text-cyan-500' };
    case 'tool_call':
      return { Icon: Wrench, color: 'text-amber-500' };
    case 'tool_result':
      return { Icon: CheckCircle, color: 'text-green-500' };
    case 'tool_progress':
      return { Icon: Loader2, color: 'text-blue-400' };
  }
}

const ThinkingBar: React.FC<ThinkingBarProps> = ({ events }) => {
  const logEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'auto' });
    }
  }, [events.length]);

  if (events.length === 0) return null;

  return (
    <div
      ref={containerRef}
      className="mt-1.5 mb-3 rounded-md border border-gray-200 dark:border-gray-600 bg-gray-50/80 dark:bg-gray-800/50 overflow-hidden"
    >
      {/* Hide scrollbar via CSS */}
      <style>{`
        .thinkingbar-scroll::-webkit-scrollbar { display: none; }
        .thinkingbar-scroll { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
      <div className="thinkingbar-scroll overflow-y-auto max-h-20 px-2.5 py-2 text-[11px] leading-relaxed font-mono space-y-0.5">
        {events.map((e, i) => {
          const { Icon, color } = eventStyle(e);
          return (
            <div key={i} className="flex items-start gap-1.5 animate-fadeIn">
              {e.type === 'tool_call' && e.status === 'error' ? (
                <XCircle className="w-3 h-3 mt-px flex-shrink-0 text-red-500" />
              ) : (
                <Icon className={`w-3 h-3 mt-px flex-shrink-0 ${color}`} />
              )}
              <span className="text-gray-500 dark:text-gray-400 break-all">
                {e.type === 'tool_call' ? (
                  e.status === 'error' ? (
                    <span>
                      <span className="font-semibold text-red-600 dark:text-red-400">{e.toolName ?? e.text}</span>
                      {e.detail && <span className="text-red-500 dark:text-red-400">: {e.detail}</span>}
                    </span>
                  ) : (
                    <span className="font-semibold text-gray-600 dark:text-gray-300">{e.toolName ?? e.text}</span>
                  )
                ) : e.type === 'tool_result' ? (
                  <>
                    <span className="font-semibold text-gray-600 dark:text-gray-300">{e.toolName ?? e.text}</span>
                    <span className="text-green-600 dark:text-green-400"> 完成</span>
                  </>
                ) : e.type === 'tool_progress' ? (
                  <>
                    <span className="font-semibold text-gray-600 dark:text-gray-300">{e.toolName ?? e.text}</span>
                    <span className="text-gray-400"> ({e.elapsed ?? 0}s)</span>
                  </>
                ) : (
                  <span>{e.text}</span>
                )}
              </span>
            </div>
          );
        })}
        <div ref={logEndRef} />
      </div>
    </div>
  );
};

export default ThinkingBar;
