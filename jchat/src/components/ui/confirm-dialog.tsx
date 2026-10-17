/**
 * ConfirmDialog — accessible, styled replacement for window.confirm / window.alert.
 *
 * Uses @radix-ui/react-dialog for focus trapping, Escape-to-close, and ARIA.
 * Two variants:
 *   - 'danger'  → red confirm button (for destructive actions like delete)
 *   - 'default' → green confirm button
 */

import * as Dialog from '@radix-ui/react-dialog';
import { type ReactNode, useEffect, useRef } from 'react';
import { cn } from '../../lib/utils';

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  /** Label for the confirm button. Defaults to "确认". */
  confirmLabel?: string;
  /** Label for the cancel button. Defaults to "取消". */
  cancelLabel?: string;
  variant?: 'default' | 'danger';
  /** Called when the user clicks confirm. Dialog stays open until the promise resolves. */
  onConfirm: () => Promise<void> | void;
  /** When true, the confirm button shows a spinner and is disabled. */
  loading?: boolean;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = '确认',
  cancelLabel = '取消',
  variant = 'default',
  onConfirm,
  loading = false
}: ConfirmDialogProps) {
  const pendingRef = useRef(false);
  useEffect(() => { if (!loading) pendingRef.current = false; }, [loading]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        {/* Overlay */}
        <Dialog.Overlay
          className={cn(
            'fixed inset-0 z-50 bg-black/30',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0'
          )}
        />

        {/* Content */}
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2',
            'rounded-xl bg-white dark:bg-gray-800 p-6 shadow-xl',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
            'data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95',
            'data-[state=open]:slide-in-from-bottom-2 data-[state=closed]:slide-out-to-bottom-2'
          )}
          aria-describedby={description ? 'confirm-dialog-desc' : undefined}
        >
          <Dialog.Title className="text-base font-semibold text-gray-900 dark:text-gray-100">
            {title}
          </Dialog.Title>

          {description && (
            <Dialog.Description
              id="confirm-dialog-desc"
              className="mt-2 text-sm text-gray-500 dark:text-gray-400 leading-relaxed"
            >
              {description}
            </Dialog.Description>
          )}

          <div className="mt-5 flex gap-3 justify-end">
            <Dialog.Close asChild>
              <button
                type="button"
                disabled={loading}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors disabled:opacity-50"
              >
                {cancelLabel}
              </button>
            </Dialog.Close>

            <button
              type="button"
              disabled={loading}
              onClick={() => {
                if (pendingRef.current) return;
                pendingRef.current = true;
                void Promise.resolve(onConfirm()).finally(() => { pendingRef.current = false; });
              }}
              className={cn(
                'px-4 py-2 text-sm font-medium rounded-lg transition-colors disabled:opacity-50',
                'inline-flex items-center gap-2',
                variant === 'danger'
                  ? 'bg-red-500 text-white hover:bg-red-600'
                  : 'bg-wechat-accent text-white hover:bg-green-600'
              )}
            >
              {loading && (
                <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              )}
              {loading ? '处理中…' : confirmLabel}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
