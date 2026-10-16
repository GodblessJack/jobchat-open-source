import { useCallback, useState } from 'react';
import { FileText, File, Table, Archive, Presentation, Download, Loader2 } from 'lucide-react';
import { useSignedUrl } from '../../hooks/useSignedUrl';
import { useJchatWsClient } from '../../ws/JchatWsProvider';
import { useAuthStore } from '../../store/auth';

export interface FileItem {
  name: string;
  url: string;
  size?: number;
  type: string;
}

const FILE_TYPE_MAP: Record<string, string> = {
  pdf: 'PDF', ppt: 'PPT', pptx: 'PPT',
  doc: 'DOCX', docx: 'DOCX',
  xls: 'Excel', xlsx: 'Excel',
  zip: 'ZIP', rar: 'RAR', '7z': 'ZIP'
};

const FILE_ICONS: Record<string, { Icon: typeof File; color: string; darkColor: string; bg: string; darkBg: string }> = {
  PDF: { Icon: FileText, color: 'text-red-500', darkColor: 'dark:text-red-400', bg: 'bg-red-50', darkBg: 'dark:bg-red-950/40' },
  PPT: { Icon: Presentation, color: 'text-orange-500', darkColor: 'dark:text-orange-400', bg: 'bg-orange-50', darkBg: 'dark:bg-orange-950/40' },
  DOCX: { Icon: FileText, color: 'text-blue-600', darkColor: 'dark:text-blue-400', bg: 'bg-blue-50', darkBg: 'dark:bg-blue-950/40' },
  Excel: { Icon: Table, color: 'text-green-600', darkColor: 'dark:text-green-400', bg: 'bg-green-50', darkBg: 'dark:bg-green-950/40' },
  ZIP: { Icon: Archive, color: 'text-yellow-600', darkColor: 'dark:text-yellow-400', bg: 'bg-yellow-50', darkBg: 'dark:bg-yellow-950/40' }
};

function formatFileSize(bytes?: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface FileCardProps {
  file: FileItem;
}

export function FileCard({ file }: FileCardProps) {
  const { url: resolvedUrl, loading, error } = useSignedUrl(file.url);
  const ws = useJchatWsClient();
  const accessToken = useAuthStore(s => s.accessToken);
  const [opening, setOpening] = useState(false);
  const fileCategory = FILE_TYPE_MAP[file.type.toLowerCase()] || 'File';
  const iconConfig = FILE_ICONS[fileCategory] || { Icon: File, color: 'text-gray-500', darkColor: 'dark:text-gray-400', bg: 'bg-gray-50', darkBg: 'dark:bg-gray-800' };
  const { Icon, color, darkColor, bg, darkBg } = iconConfig;

  // Extract the storage filePath from supabase:// or /files/ URLs.
  // Handles legacy bucket-prefixed paths (e.g. supabase://chat-files/jchat/... → jchat/...)
  // matching the resolveUrl logic in useSignedUrl.
  const extractFilePath = (url: string): string | null => {
    let raw: string;
    if (url.startsWith('supabase://')) raw = url.slice('supabase://'.length);
    else if (url.startsWith('/files/')) raw = url.slice('/files/'.length);
    else return null;
    // Strip known bucket prefix if present
    const firstSlash = raw.indexOf('/');
    if (firstSlash > 0) {
      const firstSegment = raw.slice(0, firstSlash);
      if (['skill-assets', 'chat-files', 'avatars'].includes(firstSegment)) {
        return raw.slice(firstSlash + 1);
      }
    }
    return raw;
  };

  const handleOpen = useCallback(async () => {
    // For image types, the /files/ endpoint allows public access — open directly.
    const isImage = file.type === 'png' || file.type === 'jpg' || file.type === 'jpeg' ||
      file.type === 'gif' || file.type === 'webp' || file.type === 'bmp';
    if (isImage && resolvedUrl) {
      window.open(resolvedUrl, '_blank');
      return;
    }
    // For non-image files, fetch a signed download URL with a short-lived
    // JWT token so the /files auth middleware allows the request.
    const fp = extractFilePath(file.url);
    if (!fp) {
      if (resolvedUrl) window.open(resolvedUrl, '_blank');
      return;
    }
    setOpening(true);
    // Try WebSocket first with a short timeout; fall through to REST if it hangs.
    const WS_TIMEOUT_MS = 3000;
    try {
      if (ws) {
        const result = await Promise.race([
          ws.command<{ url: string }>('file.signed_url', { filePath: fp }),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('WS timeout')), WS_TIMEOUT_MS)),
        ]);
        window.open(result.url, '_blank');
        setOpening(false);
        return;
      }
    } catch {
      // WS timed out or failed — fall through to REST endpoint.
    }
    // Fallback: REST endpoint for signed download URL (works even without WebSocket).
    try {
      const headers: Record<string, string> = {};
      if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;
      const resp = await fetch(`/api/files/signed-download-url?filePath=${encodeURIComponent(fp)}`, { headers });
      if (resp.ok) {
        const data = await resp.json();
        window.open(data.url, '_blank');
      } else if (resolvedUrl) {
        window.open(resolvedUrl, '_blank');
      }
    } catch {
      if (resolvedUrl) window.open(resolvedUrl, '_blank');
    } finally {
      setOpening(false);
    }
  }, [file, resolvedUrl, ws, accessToken]);

  return (
    <div className="rounded-lg overflow-hidden shadow-sm border border-gray-200 dark:border-gray-700 max-w-xs">
      <div className={`flex items-center gap-3 px-4 py-3 ${bg} ${darkBg}`}>
        <div className={`flex-shrink-0 ${color} ${darkColor}`}>
          <Icon className="w-8 h-8" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-[#101828] dark:text-gray-200 truncate">{file.name}</div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-xs px-1.5 py-0.5 rounded bg-[#e5e7eb] dark:bg-gray-700 text-[#4a5565] dark:text-gray-300">{fileCategory}</span>
            {file.size ? <span className="text-xs text-[#6a7282] dark:text-gray-400">{formatFileSize(file.size)}</span> : null}
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between px-4 py-2 bg-white dark:bg-gray-800 border-t border-gray-100 dark:border-gray-700">
        {loading ? (
          <span className="text-xs text-[#6a7282] dark:text-gray-400">Loading...</span>
        ) : error ? (
          <span className="text-xs text-red-400">Failed to load file</span>
        ) : (
          <span className="text-xs text-[#6a7282] dark:text-gray-400">Click to view file</span>
        )}
        <button
          onClick={handleOpen}
          disabled={!resolvedUrl || opening}
          className="flex items-center gap-1 text-xs font-medium text-[#4a90e2] dark:text-blue-400 hover:text-[#3a7bc8] dark:hover:text-blue-300 px-2 py-1 rounded hover:bg-[#4a90e2]/5 dark:hover:bg-blue-400/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          aria-label={`Open ${file.name}`}
        >
          {opening ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
          {opening ? '...' : 'Open'}
        </button>
      </div>
    </div>
  );
}
