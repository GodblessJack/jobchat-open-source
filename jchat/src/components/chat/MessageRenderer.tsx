import { useCallback, useMemo, type MouseEvent } from 'react';
import { renderMarkdown } from '../../utils/renderMarkdown';
import { FileCard, type FileItem } from './FileCard';
import { useSignedUrls } from '../../hooks/useSignedUrl';
import { ImageLightbox, useImagePreview } from './ImageLightbox';

/**
 * Delegated click handler for inline UI inside rendered markdown:
 *  - <button class="chat-codeblock-copy" data-copy="..."> → copy decoded text
 *  - <img>                                                → open in lightbox (handled by parent)
 */
function useMarkdownClickHandler(onImageClick: (e: MouseEvent<HTMLDivElement>) => void) {
  return useCallback((e: MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    const copyBtn = target.closest<HTMLButtonElement>('button.chat-codeblock-copy');
    if (copyBtn) {
      e.preventDefault();
      e.stopPropagation();
      const encoded = copyBtn.getAttribute('data-copy') || '';
      const text = (() => {
        try { return decodeURIComponent(encoded); } catch { return encoded; }
      })();
      void navigator.clipboard.writeText(text).then(
        () => {
          const original = copyBtn.textContent;
          copyBtn.textContent = '已复制';
          copyBtn.classList.add('chat-codeblock-copied');
          setTimeout(() => {
            copyBtn.textContent = original || '复制';
            copyBtn.classList.remove('chat-codeblock-copied');
          }, 1500);
        },
        () => {
          // ignore clipboard failures (insecure context, etc)
        }
      );
      return;
    }
    onImageClick(e);
  }, [onImageClick]);
}

type Segment =
  | { type: 'markdown'; content: string }
  | { type: 'file'; file: FileItem };

const FILE_EXTENSIONS = new Set([
  'pdf', 'ppt', 'pptx', 'doc', 'docx', 'xls', 'xlsx',
  'zip', 'rar', '7z', 'tar', 'gz',
  'mp3', 'wav', 'mp4', 'mov', 'avi'
]);

function getExtension(url: string): string {
  try {
    const clean = url.split('?')[0].split('#')[0];
    const pathname = new URL(clean, 'https://placeholder.local').pathname;
    const lastDot = pathname.lastIndexOf('.');
    if (lastDot === -1) return '';
    return pathname.slice(lastDot + 1).toLowerCase();
  } catch {
    return '';
  }
}

function parseFileSize(sizeStr: string): number | undefined {
  const match = sizeStr.match(/([\d.]+)\s*(B|KB|MB|GB)/i);
  if (!match) return undefined;
  const num = parseFloat(match[1]);
  const unit = match[2].toUpperCase();
  const multipliers: Record<string, number> = { B: 1, KB: 1024, MB: 1024 * 1024, GB: 1024 * 1024 * 1024 };
  return Math.round(num * (multipliers[unit] || 1));
}

function extractFileUrls(content: string): string[] {
  const urls: string[] = [];
  // Match both supabase:// (legacy) and /files/ (new) URLs
  const regex = /(?:supabase:\/\/|\/files\/)[^\s)\]"'>]+/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    const clean = match[0].replace(/[.,;:!?]+$/, '');
    if (!urls.includes(clean)) urls.push(clean);
  }
  return urls;
}

/** Reject URLs matching known LLM hallucination patterns (legacy staging URLs). */
function isHallucinatedUrl(url: string): boolean {
  return /jobchat\.zhipin\.cn\/buster-stage\/supabase\/storage/.test(url);
}

/** Strip markdown image references where the URL is a known broken/hallucinated URL.
 *  Without this, ![alt](broken-url) becomes an <img> tag with a dead src in
 *  rendered markdown, showing "加载失败" to the user. */
function stripBrokenMarkdownImages(content: string): string {
  return content.replace(/!\[[^\]]*\]\(([^)]*jobchat\.zhipin\.cn\/buster-stage\/supabase\/storage[^)]*)\)/g, '');
}

function parseSegments(content: string): Segment[] {
  const segments: Segment[] = [];
  let currentText = '';
  const lines = content.split('\n');

  for (const line of lines) {
    const fileConventionMatch = line.match(/^\s*📎\s*\[([^\]]+?)(?:\s*\(([^)]*)\))?\]\(([^)]+)\)\s*$/);
    if (fileConventionMatch) {
      if (currentText.trim()) {
        segments.push({ type: 'markdown', content: currentText });
        currentText = '';
      }
      const [, name, sizeStr, url] = fileConventionMatch;
      // Skip hallucinated external URLs (agent invented a staging URL)
      if (isHallucinatedUrl(url)) continue;
      const ext = getExtension(url) || name.split('.').pop() || '';
      segments.push({
        type: 'file',
        file: { name, url, type: ext, size: sizeStr ? parseFileSize(sizeStr) : undefined }
      });
      continue;
    }
    const linkMatch = line.match(/^\s*\[([^\]]+)\]\(([^)]+)\)\s*$/);
    if (linkMatch) {
      const [, text, url] = linkMatch;
      // Skip hallucinated external URLs
      if (isHallucinatedUrl(url)) {
        currentText += (currentText ? '\n' : '') + line;
        continue;
      }
      const ext = getExtension(url);
      if (FILE_EXTENSIONS.has(ext)) {
        if (currentText.trim()) {
          segments.push({ type: 'markdown', content: currentText });
          currentText = '';
        }
        segments.push({ type: 'file', file: { name: text, url, type: ext } });
        continue;
      }
    }
    currentText += (currentText ? '\n' : '') + line;
  }
  if (currentText.trim()) segments.push({ type: 'markdown', content: currentText });
  return segments;
}

interface MessageRendererProps {
  content: string;
  role: 'user' | 'assistant';
}

export function MessageRenderer({ content, role }: MessageRendererProps) {
  const isUser = role === 'user';
  const { previewSrc, handleClick, close } = useImagePreview();
  const handleMarkdownClick = useMarkdownClickHandler(handleClick);

  const fileUrls = useMemo(() => extractFileUrls(content), [content]);
  const { urls: resolvedUrls } = useSignedUrls(fileUrls);

  const resolvedContent = useMemo(() => {
    // Strip broken markdown images first (legacy Supabase staging URLs)
    const cleaned = stripBrokenMarkdownImages(content);
    if (fileUrls.length === 0 || resolvedUrls.length === 0) return cleaned;
    const urlMap = new Map<string, string>();
    fileUrls.forEach((original, i) => {
      if (resolvedUrls[i] && resolvedUrls[i] !== original) urlMap.set(original, resolvedUrls[i]);
    });
    if (urlMap.size === 0) return cleaned;
    const escaped = Array.from(urlMap.keys()).map(u => u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const regex = new RegExp(escaped.join('|'), 'g');
    return cleaned.replace(regex, match => urlMap.get(match) || match);
  }, [content, fileUrls, resolvedUrls]);

  const segments = useMemo(() => parseSegments(resolvedContent), [resolvedContent]);

  if (segments.length === 0) return null;

  if (segments.length === 1 && segments[0].type === 'markdown') {
    const hasMarkdownMedia = /!\[.*?\]\(/.test(resolvedContent);
    if (isUser && !hasMarkdownMedia) {
      return (
        <div className="px-3 py-2.5 rounded-lg bg-[#95ec69] text-[#101828] shadow-sm text-[15px] leading-relaxed">
          <span className="whitespace-pre-wrap">{resolvedContent}</span>
        </div>
      );
    }
    return (
      <>
        <div className="chat-bubble-ai px-3 py-2.5 rounded-lg bg-white dark:bg-gray-700 text-[#101828] dark:text-gray-100 shadow-sm border border-gray-100 dark:border-gray-600 max-w-full overflow-y-hidden overflow-x-auto" onClick={handleMarkdownClick}>
          <div
            className="chat-markdown prose prose-sm max-w-none"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(resolvedContent) }}
          />
        </div>
        <ImageLightbox src={previewSrc} onClose={close} />
      </>
    );
  }

  return (
    <>
      <div className="space-y-2" onClick={handleMarkdownClick}>
        {segments.map((seg, i) => {
          switch (seg.type) {
            case 'markdown': {
              const segHasMedia = isUser && /!\[.*?\]\(/.test(seg.content);
              if (isUser && !segHasMedia) {
                return (
                  <div key={i} className="px-3 py-2.5 rounded-lg bg-[#95ec69] text-[#101828] shadow-sm text-[15px] leading-relaxed">
                    <span className="whitespace-pre-wrap">{seg.content}</span>
                  </div>
                );
              }
              return (
                <div
                  key={i}
                  className={`${isUser ? '' : 'chat-bubble-ai '}px-3 py-2.5 rounded-lg max-w-full overflow-y-hidden overflow-x-auto ${isUser ? 'bg-[#95ec69] text-[#101828]' : 'bg-white dark:bg-gray-700 border border-gray-100 dark:border-gray-600 text-[#101828] dark:text-gray-100'} shadow-sm`}
                >
                  <div
                    className="chat-markdown prose prose-sm max-w-none"
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(seg.content) }}
                  />
                </div>
              );
            }
            case 'file':
              return <FileCard key={i} file={seg.file} />;
            default:
              return null;
          }
        })}
      </div>
      <ImageLightbox src={previewSrc} onClose={close} />
    </>
  );
}
