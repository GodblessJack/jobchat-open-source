// jchat/tests/unit/server/conversation/mention-parser.test.ts
//
// TDD coverage for the @-mention parser. Cases drawn from spec §7.2 and
// the Clay reference implementation in lib/project-debate.js.

import { describe, it, expect } from 'vitest';
import { parseMentions, type ParseMentionsResult } from '@/server/conversation/mention-parser.js';

const ZHANG = '11111111-1111-1111-1111-111111111111';
const LI = '22222222-2222-2222-2222-222222222222';
const ELON = '33333333-3333-3333-3333-333333333333';

const members = [
  { agentId: ZHANG, name: '张三' },
  { agentId: LI, name: '李四' },
  { agentId: ELON, name: 'Elon' }
];

/** helper: build expected result for normal (non-@all) mentions */
function mentionResult(mentions: string[]): ParseMentionsResult {
  return { mentions, isExplicitAll: false };
}

describe('mention-parser', () => {
  it('returns empty mentions when text contains no @', () => {
    expect(parseMentions('hello world', members)).toEqual(mentionResult([]));
  });

  it('returns empty mentions when @ refers to non-member', () => {
    expect(parseMentions('@王五 帮帮我', members)).toEqual(mentionResult([]));
  });

  it('detects a single Chinese name', () => {
    expect(parseMentions('@张三 帮看看', members)).toEqual(mentionResult([ZHANG]));
  });

  it('detects multiple names in one message', () => {
    expect(parseMentions('@张三 @李四 hi', members)).toEqual(mentionResult([ZHANG, LI]));
  });

  describe('@all / @everyone keyword', () => {
    it('returns isExplicitAll=true with empty mentions for @all', () => {
      expect(parseMentions('@all 大家好', members)).toEqual({ mentions: [], isExplicitAll: true });
    });

    it('returns isExplicitAll=true for @everyone', () => {
      expect(parseMentions('@everyone hi', members)).toEqual({ mentions: [], isExplicitAll: true });
    });

    it('returns isExplicitAll=true when @all coexists with a named mention (all wins)', () => {
      expect(parseMentions('@张三 @all', members)).toEqual({ mentions: [], isExplicitAll: true });
    });
  });

  it('detects through markdown bold wrapper', () => {
    expect(parseMentions('**@张三** 看看', members)).toEqual(mentionResult([ZHANG]));
  });

  it('detects through markdown italic wrapper', () => {
    expect(parseMentions('*@张三* 注意', members)).toEqual(mentionResult([ZHANG]));
  });

  it('does NOT extract @name from inside markdown link target', () => {
    // The target URL portion of a markdown link should be stripped before scanning.
    // Display text portion still scans normally.
    expect(parseMentions('[link](http://example.com/@张三)', members)).toEqual(mentionResult([]));
    expect(parseMentions('[@张三](http://example.com)', members)).toEqual(mentionResult([ZHANG]));
  });

  it('detects through code span wrapper', () => {
    expect(parseMentions('`@张三` quick', members)).toEqual(mentionResult([ZHANG]));
  });

  it('case-insensitive English match', () => {
    expect(parseMentions('@elon hi', members)).toEqual(mentionResult([ELON]));
  });

  it('mixed Chinese-English in one message', () => {
    const result = parseMentions('@张三 @Elon 你们俩看看', members);
    expect(result.mentions.sort()).toEqual([ZHANG, ELON].sort());
    expect(result.isExplicitAll).toBe(false);
  });

  it('deduplicates repeated mentions of the same member', () => {
    expect(parseMentions('@张三 @张三 @张三', members)).toEqual(mentionResult([ZHANG]));
  });

  it('returns empty when members list is empty', () => {
    expect(parseMentions('@anyone', [])).toEqual(mentionResult([]));
  });

  it('does not match when @ is glued to a longer word (e.g. email)', () => {
    expect(parseMentions('contact me at foo@张三bar.com', members)).toEqual(mentionResult([]));
  });

  it('handles longest-name-first prefix collision', () => {
    const ms = [
      { agentId: 'a1', name: 'Eli' },
      { agentId: 'a2', name: 'Elizabeth' }
    ];
    // @Eli should NOT also match Elizabeth; @Elizabeth should match Elizabeth only.
    expect(parseMentions('@Eli ping', ms)).toEqual(mentionResult(['a1']));
    expect(parseMentions('@Elizabeth ping', ms)).toEqual(mentionResult(['a2']));
  });

  it('preserves member-list order in output', () => {
    // Matches in text are 李四 first then 张三; output follows member-list order.
    expect(parseMentions('@李四 @张三', members)).toEqual(mentionResult([ZHANG, LI]));
  });
});
