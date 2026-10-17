// jchat/server/mcp/create-attachment-mcp.ts
//
// MCP tool that lets an SDK agent attach a workspace file to its reply message.
// The agent creates a file (e.g. via the Write tool), then calls this tool to
// copy it into shared storage and register it as a message attachment.
//
// SECURITY: workspace_path is resolved relative to the agent's sandboxed
// workspace directory — agents cannot escape to arbitrary filesystem paths.
// The handler closure captures userId/conversationId from the WS-verified JWT,
// never from tool args.

import path from 'node:path';
import fs from 'node:fs/promises';
import type { Stats } from 'node:fs';
import { randomUUID as uuid } from 'node:crypto';
import { z } from 'zod';
import { config } from '../config.js';
import { logger } from '../logger.js';
import type { MessageAttachmentRef } from '@shared/domain.js';

// ======================================================================
// Zod schema — loose types so the SDK passes model args through verbatim.
// Real validation lives in createAttachmentInputSchemaStrict (handler-side).
// ======================================================================

// Use JSON-Schema-style definition so the SDK worker's buildZodShape
// correctly detects it (isJsonSchema check looks for `properties` key).
// Zod-shape pass-through style was not detected for this tool, causing
// the model to see empty properties: {} and call the tool without args.
export const createAttachmentInputSchema = {
  properties: {
    workspace_path: { type: 'string', description: 'Relative or absolute path to the file in the agent workspace.' },
    display_name: { type: 'string', description: 'Optional human-readable name shown in the chat UI.' },
  },
  required: ['workspace_path'],
};

const createAttachmentInputSchemaStrict = z.object({
  workspace_path: z.string().min(1).max(1024),
  display_name: z.string().min(1).max(255).optional(),
});

// ======================================================================
// MIME detection from file extension
// ======================================================================

const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.md': 'text/markdown',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.zip': 'application/zip',
  '.tar': 'application/x-tar',
  '.gz': 'application/gzip',
  '.7z': 'application/x-7z-compressed',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.webm': 'video/webm',
};

function detectMime(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_BY_EXT[ext] ?? 'application/octet-stream';
}

// ======================================================================
// Safe filename: replace path separators and nulls, truncate to 200 chars
// ======================================================================

function safeBasename(name: string): string {
  return path
    .basename(name)
    .replace(/[\x00-\x1f/\\]/g, '_')
    .slice(0, 200);
}

// ======================================================================
// Tool definition factory
// ======================================================================

export interface CreateAttachmentDeps {
  userId: string;
  conversationId: string;
  /** Returns the workspace root path. Called at tool-invocation time so the
   *  orchestrator can set it after worker acquisition. */
  getWorkspacePath: () => string;
  /** Optional: called on success so the orchestrator can collect attachment
   *  refs for the agent's reply message. */
  onAttachmentCreated?: (ref: { filePath: string; mime: string; size: number }) => void;
}

export interface CreateAttachmentToolDef {
  name: 'create_attachment';
  description: string;
  inputSchema: typeof createAttachmentInputSchema;
  handler: (
    args: { workspace_path: string; display_name?: string }
  ) => Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }>;
}

export function getCreateAttachmentToolDef(deps: CreateAttachmentDeps): CreateAttachmentToolDef {
  return {
    name: 'create_attachment',
    description:
      'Attach a workspace file to your reply message so the user can download or preview it in the chat. ' +
      'After writing a file (PDF report, chart image, CSV data, etc.), call this tool to register it as an attachment. ' +
      'The file will appear as a downloadable card (for documents) or an inline preview (for images) in the conversation.',
    inputSchema: createAttachmentInputSchema,
    handler: async (args) => {
      // ---- Validate input ----
      const validation = createAttachmentInputSchemaStrict.safeParse(args);
      if (!validation.success) {
        const issues = validation.error.issues
          .map((e) => `- ${e.path.join('.')}: ${e.message}`)
          .join('\n');
        return {
          content: [{ type: 'text', text: `create_attachment 参数校验未通过：\n${issues}` }],
          isError: true,
        };
      }
      const { workspace_path: workspacePath, display_name } = validation.data;

      // ---- Resolve workspace root ----
      const wsRoot = deps.getWorkspacePath();
      if (!wsRoot) {
        return {
          content: [{ type: 'text', text: 'create_attachment: workspace path not available (internal error).' }],
          isError: true,
        };
      }

      // ---- Resolve source file path (security: must be under workspace root) ----
      // Resolve real paths BEFORE the startsWith check so symlinks inside the
      // workspace pointing outside can't bypass the boundary (codex P1).
      const rawSrcPath = path.isAbsolute(workspacePath)
        ? path.resolve(workspacePath)
        : path.resolve(wsRoot, workspacePath);
      let realWsRoot: string;
      let srcPath: string;
      try {
        realWsRoot = await fs.realpath(wsRoot);
        srcPath = await fs.realpath(rawSrcPath);
      } catch {
        return {
          content: [{
            type: 'text',
            text: `create_attachment: file not found at "${workspacePath}". Use an absolute path or a path relative to the workspace root.`,
          }],
          isError: true,
        };
      }
      if (!srcPath.startsWith(realWsRoot + path.sep) && srcPath !== realWsRoot) {
        return {
          content: [{
            type: 'text',
            text: `create_attachment: path traversal detected — "${workspacePath}" escapes the workspace. Provide a path relative to the workspace root.`,
          }],
          isError: true,
        };
      }

      // ---- Read source file ----
      let srcStat: Stats;
      try {
        srcStat = await fs.stat(srcPath);
      } catch {
        return {
          content: [{ type: 'text', text: `create_attachment: file not found at "${workspacePath}". Use an absolute path or a path relative to the workspace root.` }],
          isError: true,
        };
      }
      if (!srcStat.isFile()) {
        return {
          content: [{ type: 'text', text: `create_attachment: "${workspacePath}" is not a regular file.` }],
          isError: true,
        };
      }
      if (srcStat.size > config.uploadMaxSize) {
        return {
          content: [{
            type: 'text',
            text: `create_attachment: file too large (${(srcStat.size / 1024 / 1024).toFixed(1)} MB, max ${(config.uploadMaxSize / 1024 / 1024).toFixed(0)} MB).`,
          }],
          isError: true,
        };
      }

      // ---- Build destination path: <filesRoot>/<userId>/<conversationId>/<uuid>-<safeName> ----
      // Preserve extensionless display names: only strip the extension from
      // safeName when safeName itself contributed it (codex P3). Otherwise
      // "report" + "chart.png" → "re.png" instead of "report.png".
      const safeName = safeBasename(display_name || path.basename(workspacePath));
      const safeExt = path.extname(safeName);
      const ext = safeExt || path.extname(workspacePath);
      const baseName = (safeExt ? safeName.slice(0, safeName.length - safeExt.length) : safeName) || 'file';
      // Use jchat/ prefix to match signedDownloadUrl path expectations
      const destRelDir = path.join('jchat', deps.userId, deps.conversationId);
      const destRelPath = path.join(destRelDir, `${uuid()}-${safeBasename(baseName)}${ext}`);
      const destAbsPath = path.resolve(config.filesRoot, destRelPath);

      // Security: ensure dest stays within filesRoot
      if (!destAbsPath.startsWith(path.resolve(config.filesRoot) + path.sep)) {
        return {
          content: [{ type: 'text', text: 'create_attachment: internal path error.' }],
          isError: true,
        };
      }

      // ---- Copy file ----
      try {
        await fs.mkdir(path.dirname(destAbsPath), { recursive: true });
        await fs.copyFile(srcPath, destAbsPath);
      } catch (e) {
        logger.error({ err: (e as Error).message, srcPath, destAbsPath }, 'create_attachment copy failed');
        return {
          content: [{ type: 'text', text: `create_attachment: failed to copy file: ${(e as Error).message}` }],
          isError: true,
        };
      }

      const mime = detectMime(destRelPath);
      const attachment: MessageAttachmentRef = {
        filePath: destRelPath,
        mime,
        size: srcStat.size,
      };

      logger.info({ attachment, agentFile: workspacePath }, 'create_attachment succeeded');

      // Notify orchestrator so it can write attachments on the agent message.
      if (deps.onAttachmentCreated) {
        try {
          deps.onAttachmentCreated(attachment);
        } catch {
          // best-effort — must not break the tool result
        }
      }

      // Build the markdown the agent MUST copy-paste verbatim into its reply.
      // The supabase:// protocol is the ONLY valid URL scheme for attachments.
      const supabaseUrl = `supabase://${destRelPath}`;
      const isImage = mime.startsWith('image/');
      const exactMarkdown = isImage
        ? `\n![${display_name || safeName}](${supabaseUrl})\n`
        : `\n📎 [${display_name || safeName} (${(srcStat.size / 1024).toFixed(1)} KB)](${supabaseUrl})\n`;

      return {
        content: [{
          type: 'text',
          text: `File uploaded to shared storage. ` +
            `COPY the EXACT line below into your reply (do not change the URL):\n` +
            `\`\`\`\n${exactMarkdown}\`\`\`\n` +
            `The URL uses supabase:// protocol — this is intentional and correct. ` +
            `Do NOT convert it to https:// or any other scheme.`,
        }],
      };
    },
  };
}
