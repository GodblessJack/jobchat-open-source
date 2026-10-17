/**
 * ToastContainer — fixed-position stack of toast notifications.
 *
 * Renders at the top-center of the viewport. Toasts stack vertically
 * and auto-dismiss. Wired into AppShell so it renders once per app.
 */

import { useToastStore } from '../../store/toast';
import { ToastItem } from '../ui/toast';

export function ToastContainer() {
  const toasts = useToastStore(s => s.toasts);
  const removeToast = useToastStore(s => s.removeToast);

  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] flex flex-col items-center gap-2 pointer-events-none"
      aria-label="通知"
    >
      {toasts.map(t => (
        <ToastItem key={t.id} toast={t} onDismiss={removeToast} />
      ))}
    </div>
  );
}
