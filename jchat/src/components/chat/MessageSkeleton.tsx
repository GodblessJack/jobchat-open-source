/**
 * MessageSkeleton — 3 placeholder bubbles shown while a conversation snapshot
 * is loading. WeChat-style: avatar + 2 gray bars per row.
 */

const ROWS: { side: 'left' | 'right'; widths: [string, string] }[] = [
  { side: 'left', widths: ['w-24', 'w-40'] },
  { side: 'right', widths: ['w-32', 'w-28'] },
  { side: 'left', widths: ['w-28', 'w-44'] }
];

export function MessageSkeleton() {
  return (
    <div className="space-y-4 p-4" aria-label="Loading conversation" role="status">
      {ROWS.map((row, i) => (
        <div
          key={i}
          className={`flex items-start gap-2 ${row.side === 'right' ? 'flex-row-reverse' : ''}`}
        >
          <div className="h-9 w-9 flex-shrink-0 animate-pulse rounded-md bg-gray-200 dark:bg-gray-700" />
          <div className={`flex flex-col gap-1.5 ${row.side === 'right' ? 'items-end' : ''}`}>
            <div className={`h-3 ${row.widths[0]} animate-pulse rounded bg-gray-200 dark:bg-gray-700`} />
            <div className={`h-3 ${row.widths[1]} animate-pulse rounded bg-gray-200 dark:bg-gray-700`} />
          </div>
        </div>
      ))}
      <span className="sr-only">正在加载会话</span>
    </div>
  );
}
