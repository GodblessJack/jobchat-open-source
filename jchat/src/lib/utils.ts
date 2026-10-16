import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Tailwind class merger. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Format a Date / ISO string / epoch ms as `HH:MM`. Empty string on invalid input. */
export function formatTime(input: string | number | Date | null | undefined): string {
  if (!input) return '';
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return '';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/** Format a Date / ISO string for chat list (today: HH:MM; yesterday: 昨天; older: MM-DD). */
export function formatRelativeDay(input: string | number | Date | null | undefined): string {
  if (!input) return '';
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const sameDay = now.toDateString() === d.toDateString();
  if (sameDay) return formatTime(d);
  if (diffMs < 1000 * 60 * 60 * 48) return '昨天';
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/**
 * Format a date as a message-list separator label.
 * Today → "今天", yesterday → "昨天", within 7 days → "星期X",
 * this year → "M月D日 星期X", older → "YYYY年M月D日".
 */
export function formatDateLabel(input: string | number | Date): string {
  const d = input instanceof Date ? input : new Date(input);
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const targetStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((todayStart.getTime() - targetStart.getTime()) / 86400000);

  if (diffDays === 0) return '今天';
  if (diffDays === 1) return '昨天';
  if (diffDays < 7) return WEEKDAY_NAMES[d.getDay()];

  const month = d.getMonth() + 1;
  const date = d.getDate();
  const weekday = WEEKDAY_NAMES[d.getDay()];
  if (d.getFullYear() === now.getFullYear()) {
    return `${month}月${date}日 ${weekday}`;
  }
  return `${d.getFullYear()}年${month}月${date}日`;
}

/** Generate a UUID. Uses crypto.randomUUID when available. */
export function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // RFC4122-ish fallback (not for security; only for local correlation IDs)
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Truncate text with ellipsis. */
export function truncate(text: string, max: number): string {
  if (!text) return '';
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}
