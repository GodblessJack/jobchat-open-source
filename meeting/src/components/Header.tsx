import { PhoneOff, Clock, Calendar } from 'lucide-react';
import { useState, useEffect } from 'react';

interface HeaderProps {
  contactName?: string;
}

export function Header({ contactName }: HeaderProps) {
  const [elapsedTime, setElapsedTime] = useState(0);
  const [showConfirm, setShowConfirm] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsedTime(prev => prev + 1);
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const meetingDate = new Date().toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });

  const handleEndCall = () => {
    setShowConfirm(true);
  };

  const confirmEndCall = () => {
    window.close();
    // 如果window.close()不起作用（某些浏览器限制），尝试其他方法
    setTimeout(() => {
      window.location.href = 'about:blank';
    }, 100);
  };

  return (
    <>
      <div className="h-16 bg-white border-b border-gray-100 flex items-center justify-between px-8 shadow-sm">
        <div className="flex items-center gap-6">
          <h1 className="text-gray-900">
            {contactName ? `Call with ${contactName}` : 'Preparing call...'}
          </h1>
          <div className="flex items-center gap-4 text-sm">
            <div className="flex items-center gap-2 text-gray-500">
              <Calendar className="w-4 h-4" />
              <span>{meetingDate}</span>
            </div>
            <div className="w-px h-4 bg-gray-300" />
            <div className="flex items-center gap-2 text-gray-500">
              <Clock className="w-4 h-4" />
              <span>{formatTime(elapsedTime)} / 45:00</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* End Call button removed as per user request (redundant with bottom dock) */}
        </div>
      </div>

      {/* 确认对话框 */}
      {showConfirm && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-md w-full mx-4 animate-in fade-in zoom-in duration-200">
            <h3 className="text-xl text-gray-900 mb-2">End Interview?</h3>
            <p className="text-gray-600 mb-6">
              Are you sure you want to end this interview call? This action cannot be undone.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowConfirm(false)}
                className="px-4 py-2 rounded-lg text-gray-700 hover:bg-gray-100 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmEndCall}
                className="px-4 py-2 rounded-lg bg-red-500 hover:bg-red-600 text-white transition-colors"
              >
                End Call
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}