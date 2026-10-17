/**
 * ChatInput — textarea + drag-drop file + @mention picker + Enter to send.
 *
 * Mention behaviour:
 *  - Typing `@` opens the picker
 *  - Picker filters by the substring after the most recent `@`
 *  - Selecting a candidate replaces the partial token with `@<name> ` and
 *    records the agentId in `mentions`
 *  - Typing `@all` produces plain text; no agentId is added to mentions (fan-out is handled server-side)
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type KeyboardEvent } from 'react';
import { Send, Paperclip, X, FileText, File as FileIcon, Loader2 } from 'lucide-react';
import { Button } from '../ui/button';
import { useContactsStore } from '../../store/contacts';
import { useConversationsStore } from '../../store/conversations';
import { useJchatWsClient } from '../../ws/JchatWsProvider';
import { MentionPicker, type MentionCandidate } from '../group/MentionPicker';
import { useSignedUrl } from '../../hooks/useSignedUrl';
import { useToastStore } from '../../store/toast';
import type { FileUploadInitResult, MessageAttachment } from '@shared/protocol';

interface PendingAttachment extends MessageAttachment {
  /** Original local filename (the filePath returned by upload_init is a UUID). */
  name: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function AttachmentChip({
  attachment,
  onRemove
}: {
  attachment: PendingAttachment;
  onRemove: () => void;
}) {
  const isImage = attachment.mime?.startsWith('image/');
  const { url } = useSignedUrl(isImage ? `supabase://${attachment.filePath}` : '');

  if (isImage) {
    return (
      <div className="relative h-20 w-20 overflow-hidden rounded-md border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 group">
        {url ? (
          <img src={url} alt={attachment.name} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-gray-400 dark:text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        )}
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${attachment.name}`}
          className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity hover:bg-black/80 group-hover:opacity-100 focus:opacity-100"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    );
  }

  // Non-image: file-icon chip
  const ext = (attachment.name.split('.').pop() || '').toLowerCase();
  const Icon = ['pdf', 'doc', 'docx', 'txt', 'md'].includes(ext) ? FileText : FileIcon;
  return (
    <div className="group flex items-center gap-2 rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-2.5 py-1.5 pr-1.5">
      <Icon className="h-5 w-5 flex-shrink-0 text-gray-500 dark:text-gray-400" />
      <div className="flex flex-col min-w-0">
        <span className="truncate max-w-[160px] text-xs font-medium text-gray-700 dark:text-gray-200">
          {attachment.name}
        </span>
        <span className="text-[10px] text-gray-400">{formatBytes(attachment.size)}</span>
      </div>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${attachment.name}`}
        className="ml-1 flex h-5 w-5 items-center justify-center rounded-full text-gray-400 dark:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-600 hover:text-red-500 dark:hover:text-red-400 transition-colors"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

interface ChatInputProps {
  conversationId: string;
  onSend: (payload: {
    content: string;
    mentions: string[];
    attachments: MessageAttachment[];
  }) => void;
  disabled?: boolean;
}

export function ChatInput({ conversationId, onSend, disabled }: ChatInputProps) {
  const ws = useJchatWsClient();
  const conv = useConversationsStore(s => s.byId[conversationId]);
  const agentMap = useContactsStore(s => s.agents);

  const memberCandidates: MentionCandidate[] = useMemo(() => {
    if (!conv) return [];
    return (conv.members || [])
      .map(m => agentMap[m.agentId])
      .filter(Boolean)
      .map(a => ({ agentId: a.id, name: a.name, avatarUrl: a.avatarUrl, description: a.description }));
  }, [conv, agentMap]);

  const [text, setText] = useState('');
  const [mentionIds, setMentionIds] = useState<Set<string>>(new Set());
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-resize textarea height based on content, capped at ~6 lines.
  const MAX_TEXTAREA_HEIGHT = 120;
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
  }, [text]);

  const updateMentionState = useCallback((value: string, caretIndex: number) => {
    // Find the last `@` before the caret that is at start-of-string or after whitespace.
    const upto = value.slice(0, caretIndex);
    const at = upto.lastIndexOf('@');
    if (at === -1) {
      setPickerOpen(false);
      return;
    }
    const before = at === 0 ? '' : upto[at - 1];
    if (before && !/\s/.test(before)) {
      setPickerOpen(false);
      return;
    }
    const query = upto.slice(at + 1);
    if (/\s/.test(query)) {
      setPickerOpen(false);
      return;
    }
    setPickerOpen(true);
    setPickerQuery(query);
  }, []);

  const handleChange = useCallback((e: ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    const caret = e.target.selectionStart ?? e.target.value.length;
    updateMentionState(e.target.value, caret);
  }, [updateMentionState]);

  const closePicker = useCallback(() => setPickerOpen(false), []);

  const handleSelectMention = useCallback((c: MentionCandidate) => {
    const ta = textareaRef.current;
    const value = text;
    const caret = ta?.selectionStart ?? value.length;
    const upto = value.slice(0, caret);
    const at = upto.lastIndexOf('@');
    if (at === -1) {
      setPickerOpen(false);
      return;
    }
    const next = `${value.slice(0, at)}@${c.name} ${value.slice(caret)}`;
    setText(next);
    setMentionIds(prev => {
      const s = new Set(prev);
      s.add(c.agentId);
      return s;
    });
    setPickerOpen(false);
    requestAnimationFrame(() => {
      const newCaret = at + 2 + c.name.length;
      if (ta) {
        ta.focus();
        ta.setSelectionRange(newCaret, newCaret);
      }
    });
  }, [text]);

  const handleSend = useCallback(() => {
    const content = text.trim();
    if (!content && pendingAttachments.length === 0) return;
    if (disabled || uploading) return;
    // Re-extract mentions from final text — drop any agentId that does not
    // appear in the message anymore (user may have deleted the @name).
    const finalMentions = memberCandidates
      .filter(c => mentionIds.has(c.agentId) && content.includes(`@${c.name}`))
      .map(c => c.agentId);
    // Drop the local-only `name` field before sending — server expects MessageAttachment shape.
    const wireAttachments: MessageAttachment[] = pendingAttachments.map(a => ({
      filePath: a.filePath,
      mime: a.mime,
      size: a.size
    }));
    onSend({
      content,
      mentions: finalMentions,
      attachments: wireAttachments
    });
    setText('');
    setMentionIds(new Set());
    setPendingAttachments([]);
    setPickerOpen(false);
  }, [text, pendingAttachments, disabled, uploading, mentionIds, memberCandidates, onSend]);

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (pickerOpen && (e.key === 'Enter' || e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'Escape')) {
      // The MentionPicker handles these globally; let it.
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [pickerOpen, handleSend]);

  const handlePickFile = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const uploadFile = useCallback(async (file: File) => {
    setUploading(true);
    try {
      const initResult = await ws.command<FileUploadInitResult>('file.upload_init', {
        conversationId,
        filename: file.name,
        mime: file.type || 'application/octet-stream',
        size: file.size
      });
      const putRes = await fetch(initResult.uploadUrl, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type || 'application/octet-stream' }
      });
      if (!putRes.ok) throw new Error(`Upload failed: ${putRes.status}`);
      await ws.command('file.upload_complete', { filePath: initResult.filePath });
      setPendingAttachments(prev => [
        ...prev,
        {
          filePath: initResult.filePath,
          mime: file.type || 'application/octet-stream',
          size: file.size,
          name: file.name
        }
      ]);
    } catch (err) {

      console.error('[ChatInput] upload failed', err);
      const msg = err instanceof Error ? err.message : '上传失败，请重试';
      useToastStore.getState().addToast({ message: msg, variant: 'error' });
    } finally {
      setUploading(false);
    }
  }, [ws, conversationId]);

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files) return;
    for (const f of Array.from(files)) {
      await uploadFile(f);
    }
  }, [uploadFile]);

  const handleDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    void handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  return (
    <div
      onDragOver={e => e.preventDefault()}
      onDrop={handleDrop}
      className="relative border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-3"
    >
      {pendingAttachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {pendingAttachments.map((a, i) => (
            <AttachmentChip
              key={`${a.filePath}-${i}`}
              attachment={a}
              onRemove={() =>
                setPendingAttachments(prev => prev.filter((_, j) => j !== i))
              }
            />
          ))}
        </div>
      )}

      <div className="flex items-end gap-2">
        <Button variant="ghost" size="icon" onClick={handlePickFile} disabled={uploading} aria-label="添加附件">
          <Paperclip className="h-4 w-4" />
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={e => {
            void handleFiles(e.target.files);
            e.currentTarget.value = '';
          }}
        />

        <div className="relative flex-1">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            rows={1}
            placeholder={uploading ? '上传中…' : '输入消息（Enter 发送 / Shift+Enter 换行 / @ 提及成员）'}
            className="w-full resize-none overflow-y-auto rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 px-3 py-2 text-sm transition duration-200 focus:border-[#07c160] focus:outline-none focus:ring-2 focus:ring-[#07c160]/40"
          />
          <MentionPicker
            open={pickerOpen}
            query={pickerQuery}
            candidates={memberCandidates}
            onSelect={handleSelectMention}
            onClose={closePicker}
          />
        </div>

        <Button
          onClick={handleSend}
          disabled={disabled || uploading || (text.trim() === '' && pendingAttachments.length === 0)}
          aria-label="Send"
          title="发送 (Enter)"
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
