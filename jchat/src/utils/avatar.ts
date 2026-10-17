/**
 * Generate a deterministic SVG data-URL avatar with initials.
 * Same name always produces the same color.
 */

const COLORS = [
  '#4a90e2', '#e25c4a', '#50c878', '#9b59b6',
  '#f39c12', '#1abc9c', '#e74c3c', '#3498db',
  '#2ecc71', '#e67e22', '#8e44ad', '#16a085'
];

function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export function avatarFallback(name?: string | null): string {
  const displayName = (name || '').trim() || '?';
  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .map(w => [...w][0])
    .slice(0, 2)
    .join('')
    .toUpperCase() || '?';

  const bg = COLORS[hashCode(displayName) % COLORS.length];

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
    <rect width="100" height="100" rx="12" fill="${bg}"/>
    <text x="50" y="54" text-anchor="middle" dominant-baseline="middle"
          font-family="-apple-system,BlinkMacSystemFont,sans-serif"
          font-size="${initials.length > 1 ? 36 : 42}" font-weight="600" fill="white">
      ${initials}
    </text>
  </svg>`;

  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
