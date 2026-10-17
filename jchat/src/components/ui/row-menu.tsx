import { useEffect, useRef, type ReactNode } from 'react';
import { cn } from '../../lib/utils';

interface Props {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}

/**
 * RowMenu — lightweight click-outside / Escape-dismissable popover. Used
 * by ContactList rows for the hover `···` menu. No portal, no focus trap;
 * intended for single-action menus where a heavier dropdown would be
 * overkill.
 */
export function RowMenu({ open, onClose, children, className }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function handleMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={ref}
      role="menu"
      className={cn(
        'absolute right-0 top-full z-20 mt-1 min-w-[120px] rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 py-1 shadow-md',
        className
      )}
    >
      {children}
    </div>
  );
}
