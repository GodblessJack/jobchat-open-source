const BIDI_OVERRIDE_RE = /[‪-‮⁦-⁩]/g;
const UUID_PREFIX_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}-/;

export function stripBidiOverride(input: string): string {
  return input.replace(BIDI_OVERRIDE_RE, '');
}

export function clampLength(input: string, max: number): string {
  if (input.length <= max) return input;
  return input.slice(0, max) + '…';
}

export function extractDisplayName(filePath: string, maxLen = 64): string {
  if (!filePath) return '附件';
  const lastSeg = filePath.split('/').pop() ?? '';
  const stripped = lastSeg.replace(UUID_PREFIX_RE, '');
  const safe = stripBidiOverride(stripped) || '附件';
  if (safe.length <= maxLen) return safe;
  const dot = safe.lastIndexOf('.');
  const ext = dot > 0 && safe.length - dot <= 8 ? safe.slice(dot) : '';
  const head = safe.slice(0, Math.max(1, maxLen - ext.length - 1));
  return `${head}…${ext}`;
}

const MIME_TO_TYPE: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/msword': 'docx',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xlsx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'pptx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/zip': 'zip',
  'application/x-rar-compressed': 'zip',
  'application/x-7z-compressed': 'zip'
};

export function inferTypeFromMime(mime: string): string | null {
  return MIME_TO_TYPE[mime] ?? null;
}
