/**
 * MentionPicker — popover candidate list for `@mention` typing.
 *
 * Visual model:
 *  - 40x40 agent avatar + name + role description per row
 *  - Matched substring of the query is bolded inside the name
 *  - Active row: light gray bg + 3px green left bar (sidebar parity)
 *
 * Keyboard:
 *  - ArrowDown / ArrowUp: navigate
 *  - Enter: select
 *  - Escape: close
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '../../lib/utils';
import { avatarFallback } from '../../utils/avatar';

export interface MentionCandidate {
  agentId: string;
  name: string;
  avatarUrl?: string | null;
  description?: string | null;
}

interface Props {
  open: boolean;
  query: string;
  candidates: MentionCandidate[];
  onSelect: (c: MentionCandidate) => void;
  onClose: () => void;
}

export function MentionPicker({ open, query, candidates, onSelect, onClose }: Props) {
  const rows = useMemo(() => filterCandidates(candidates, query), [candidates, query]);

  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const activeRef = useRef(active);
  const rowsRef = useRef(rows);
  activeRef.current = active;
  rowsRef.current = rows;

  useEffect(() => {
    setActive(0);
  }, [query, open, rows.length]);

  useEffect(() => {
    if (!open) return;
    function handler(e: KeyboardEvent) {
      const total = rowsRef.current.length;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (total === 0) return;
        setActive(i => (i + 1) % total);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (total === 0) return;
        setActive(i => (i - 1 + total) % total);
      } else if (e.key === 'Enter') {
        if (total === 0) return;
        e.preventDefault();
        const c = rowsRef.current[activeRef.current];
        if (c) onSelect(c);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [open, onSelect, onClose]);

  if (!open) return null;

  const empty = rows.length === 0;

  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label="Mention candidates"
      className="absolute bottom-full left-0 mb-2 w-72 max-h-72 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 shadow-lg"
    >
      {empty ? (
        <div className="px-4 py-5 text-center">
          <div className="text-sm text-gray-500 dark:text-gray-400">没有匹配的成员</div>
        </div>
      ) : (
        rows.map((c, idx) => {
          const isActive = idx === active;
          return (
            <button
              key={c.agentId}
              role="option"
              aria-selected={isActive}
              type="button"
              onClick={() => onSelect(c)}
              onMouseEnter={() => setActive(idx)}
              className={cn(
                'group relative flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors',
                isActive ? 'bg-[#ededed] dark:bg-gray-600' : 'hover:bg-gray-50 dark:hover:bg-gray-700'
              )}
            >
              {isActive && (
                <span
                  aria-hidden
                  className="absolute left-0 top-1/2 h-8 w-[3px] -translate-y-1/2 rounded-r bg-[#07c160]"
                />
              )}
              <img
                src={c.avatarUrl || avatarFallback(c.name)}
                alt={c.name}
                className="h-10 w-10 flex-shrink-0 rounded-md object-cover"
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-gray-800 dark:text-gray-200">
                  {renderHighlighted(c.name, query)}
                </div>
                <div className="truncate text-xs text-gray-500 dark:text-gray-400">
                  {c.description?.trim() || '无简介'}
                </div>
              </div>
            </button>
          );
        })
      )}
    </div>
  );
}

/**
 * Filter candidates by case-insensitive substring match on `name`.
 * Empty query returns the first 10. Capped at 10 results.
 */
export function filterCandidates(list: MentionCandidate[], query: string): MentionCandidate[] {
  if (!query) return list.slice(0, 10);
  const q = query.toLowerCase();
  return list
    .filter(c => (c.name ?? '').toLowerCase().includes(q))
    .slice(0, 10);
}

/**
 * Render `text` with the first occurrence of `query` (case-insensitive)
 * wrapped in <strong> with a soft yellow highlight. Returns React nodes.
 */
function renderHighlighted(text: string, query: string) {
  if (!query || !text) return text;
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  const idx = lower.indexOf(q);
  if (idx === -1) return text;
  const before = text.slice(0, idx);
  const match = text.slice(idx, idx + query.length);
  const after = text.slice(idx + query.length);
  return (
    <>
      {before}
      <mark className="rounded bg-yellow-100 dark:bg-yellow-900/50 px-0.5 font-semibold text-gray-900 dark:text-yellow-100">
        {match}
      </mark>
      {after}
    </>
  );
}
