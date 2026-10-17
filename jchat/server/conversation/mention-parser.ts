// jchat/server/conversation/mention-parser.ts
//
// Server-authoritative @-mention parser. Spec §7.2 + Plan §6.1.
// Ported from clay/lib/project-debate.js detectMentions(), with these
// jchat-specific extensions:
//   - `@all` and `@everyone` expand to every member.
//   - Output is deduped and sorted by the member-list order so callers
//     get deterministic dispatch order.
//   - Markdown link TARGETS are stripped before matching (so URLs that
//     happen to contain "@张三" do not falsely register), while the
//     DISPLAY portion of a markdown link is preserved.

import type { Uuid } from '@shared/domain.js';

export interface MentionMember {
  agentId: Uuid;
  name: string;
}

export interface ParseMentionsResult {
  /** Agent IDs that were explicitly @mentioned (in member-list order). */
  mentions: Uuid[];
  /** True when the message contained @all / @everyone (explicit broadcast). */
  isExplicitAll: boolean;
}

const ALL_KEYWORDS = ['all', 'everyone'];

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Strip markdown formatting that may wrap an @mention without changing
 * the underlying name token. We:
 *   - replace `[display](url)` with `display` (display still scanned;
 *     URL target dropped so it can't smuggle a stray @name match)
 *   - strip backticks (code span)
 *   - strip *, _, ~ markers (bold / italic / strikethrough)
 *
 * Underscores are only stripped when they appear at word boundaries
 * (markdown emphasis), NOT when they're between word characters
 * (e.g. foo_bar is a name, not markdown).
 */
function stripMarkdown(text: string): string {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/(\*{1,3}|(?<!\w)_{1,3}|_{1,3}(?!\w)|~{2})/g, '');
}

/**
 * Whether the character before an @ is "boundary-safe" for an at-mention.
 * Email addresses (foo@bar) should NOT register as mentions.
 *
 * Uses Unicode-aware character classes to cover all scripts (Latin, CJK,
 * Cyrillic, Arabic, etc.) rather than hardcoded ranges.
 */
function isAtBoundary(text: string, atIndex: number): boolean {
  if (atIndex === 0) return true;
  const prev = text.charAt(atIndex - 1);
  // Letter, digit, underscore-or-dash adjacency = NOT a mention boundary.
  return !/[\p{L}\p{N}_-]/u.test(prev);
}

/**
 * Parse @mentions from `text` against the given conversation members.
 *
 * Returns a deduplicated list of agentIds, ordered by the position each
 * member appears in the input `members` list (stable, deterministic).
 *
 * @all / @everyone keywords expand to all members.
 */
export function parseMentions(text: string, members: MentionMember[]): ParseMentionsResult {
  if (!text || members.length === 0) return { mentions: [], isExplicitAll: false };

  const cleaned = stripMarkdown(text);

  // Sort names by length descending to match longest first (avoids
  // "Eli" matching inside "Elizabeth").
  const byLength = [...members].sort((a, b) => b.name.length - a.name.length);

  const matched = new Set<Uuid>();

  // First: check @all / @everyone keywords. If present, return [] immediately.
  // Round-table dispatch interprets an empty mention list as "fan out to all
  // members in join order". Returning [] is the simplest representation and
  // routes @all messages through the same fan-out path as un-mentioning messages.
  for (const kw of ALL_KEYWORDS) {
    const reGlobal = new RegExp('@' + kw + '(?![\\p{L}\\p{N}_-])', 'giu');
    let m;
    while ((m = reGlobal.exec(cleaned)) !== null) {
      if (isAtBoundary(cleaned, m.index)) {
        return { mentions: [], isExplicitAll: true };
      }
    }
  }

  // Then per-name matches.
  if (matched.size < members.length) {
    for (const m of byLength) {
      const pattern = new RegExp(
        '@' + escapeRegex(m.name) + '(?![\\p{L}\\p{N}_-])',
        'giu'
      );
      let mm;
      while ((mm = pattern.exec(cleaned)) !== null) {
        if (isAtBoundary(cleaned, mm.index)) {
          matched.add(m.agentId);
          break;
        }
      }
    }
  }

  // Emit in member-list order.
  const mentionIds = members.filter((m) => matched.has(m.agentId)).map((m) => m.agentId);
  return { mentions: mentionIds, isExplicitAll: false };
}
