import { describe, it, expect } from 'vitest';
import { buildSystemInstruction, MAX_HISTORY_CHARS, MAX_HISTORY_MESSAGES } from '../../../server/call/persona-builder.js';

describe('persona-builder', () => {
  it('includes identity + bootstrap_md + history snippet + voice constraint', () => {
    const out = buildSystemInstruction({
      agent: { name: '李雷', identity: '我是李雷', bootstrapMd: 'I am helpful.' },
      history: [
        { sender: 'user', text: '你好' },
        { sender: 'agent', text: '你好,有什么可以帮你' }
      ]
    });
    expect(out).toContain('我是李雷');
    expect(out).toContain('I am helpful');
    expect(out).toContain('你好');
    expect(out).toContain('你好,有什么可以帮你');
    // voice constraint
    expect(out).toMatch(/视频通话|口语化/);
  });

  it('truncates history to MAX_HISTORY_MESSAGES (oldest dropped)', () => {
    const history = Array.from({ length: 50 }, (_, i) => ({ sender: 'user' as const, text: `m${i}` }));
    const out = buildSystemInstruction({
      agent: { name: 'X', identity: '', bootstrapMd: '' },
      history
    });
    // only last 30 should be present
    expect(out).toContain('m20');
    expect(out).toContain('m49');
    expect(out).not.toContain('m0\n');  // m0 followed by newline (not m10/m20)
  });

  it('truncates history to MAX_HISTORY_CHARS budget', () => {
    const long = 'x'.repeat(800);
    const history = Array.from({ length: 30 }, () => ({ sender: 'user' as const, text: long }));
    const out = buildSystemInstruction({
      agent: { name: 'X', identity: '', bootstrapMd: '' },
      history
    });
    // Total content of history block must be <= MAX_HISTORY_CHARS
    const block = out.split('[最近的对话片段]')[1] ?? '';
    // Rough check: history block (incl. formatting) doesn't blow up
    expect(block.length).toBeLessThanOrEqual(MAX_HISTORY_CHARS + 1000);
  });

  it('handles empty history gracefully', () => {
    const out = buildSystemInstruction({
      agent: { name: 'X', identity: 'id', bootstrapMd: 'b' },
      history: []
    });
    expect(out).toContain('id');
    expect(out).toContain('b');
  });

  it('exports the expected budget constants', () => {
    expect(MAX_HISTORY_MESSAGES).toBe(30);
    expect(MAX_HISTORY_CHARS).toBe(12000);
  });
});
