/**
 * Toast — single notification item with enter/exit animation.
 *
 * Variants:
 *   - 'success' → green check
 *   - 'error'   → red alert
 *   - 'info'    → blue info
 *
 * Animation: slides in from the top, fades out on dismiss.
 */

import { useEffect, useState } from 'react';
import { CheckCircle, XCircle, Info, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { Toast } from '../../store/toast';

interface ToastItemProps {
  toast: Toast;
  onDismiss: (id: string) => void;
}

const iconMap = {
  success: CheckCircle,
  error: XCircle,
  info: Info
};

const colorMap = {
  success: 'border-green-400 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950/40 dark:text-green-300',
  error: 'border-red-400 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300',
  info: 'border-blue-400 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300'
};

const iconColorMap = {
  success: 'text-green-500 dark:text-green-400',
  error: 'text-red-500 dark:text-red-400',
  info: 'text-blue-500 dark:text-blue-400'
};

export function ToastItem({ toast, onDismiss }: ToastItemProps) {
  const [entering, setEntering] = useState(true);
  const [exiting, setExiting] = useState(false);
  const Icon = iconMap[toast.variant] ?? Info;

  // Trigger enter animation: start off-screen, then slide in on next frame.
  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntering(false));
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    // Start exit animation 300ms before the store removes this toast.
    const duration = toast.duration ?? 3500;
    if (duration <= 0) return;
    const exitTimer = setTimeout(() => setExiting(true), duration - 300);
    return () => clearTimeout(exitTimer);
  }, [toast.duration]);

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'flex items-start gap-2.5 px-4 py-3 rounded-lg border shadow-lg',
        'max-w-sm w-full pointer-events-auto',
        'transition-all duration-300 ease-in-out',
        colorMap[toast.variant],
        entering
          ? 'opacity-0 -translate-y-3 scale-95'
          : exiting
            ? 'opacity-0 translate-x-4 scale-95'
            : 'opacity-100 translate-y-0 translate-x-0 scale-100'
      )}
    >
      <Icon className={cn('w-4 h-4 mt-0.5 flex-shrink-0', iconColorMap[toast.variant])} />
      <span className="text-sm flex-1 leading-relaxed">{toast.message}</span>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        className="flex-shrink-0 ml-1 p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
        aria-label="关闭通知"
      >
        <X className="w-3.5 h-3.5 opacity-60" />
      </button>
    </div>
  );
}
