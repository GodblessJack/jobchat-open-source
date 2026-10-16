import { describe, it, expect } from 'vitest';
import { renderSafety, REPLY_FORMAT, renderDatetime } from '@/server/agent/prompt-constants.js';

describe('renderSafety', () => {
  it('embeds the agent name in identity protection', () => {
    const out = renderSafety('费曼');
    expect(out).toMatch(/你就是「费曼」/);
    expect(out).toMatch(/不得说自己是 Claude/);
    expect(out).toMatch(/历史遗留的错误信息/);
    expect(out).toMatch(/防越狱/);
    expect(out).toMatch(/操作边界/);
  });
});

describe('REPLY_FORMAT', () => {
  it('mentions the file card 📎 protocol', () => {
    expect(REPLY_FORMAT).toMatch(/📎 \[文件名/);
  });
  it('tells the agent to use Read tool for supabase:// files', () => {
    expect(REPLY_FORMAT).toMatch(/你可以使用 Read 工具/);
  });
});

describe('renderDatetime', () => {
  it('renders YYYY-MM-DD with weekday in Asia/Shanghai when no tz given', () => {
    const out = renderDatetime(new Date('2026-04-29T08:00:00Z'));
    expect(out).toMatch(/2026-04-29/);
    expect(out).toMatch(/Asia\/Shanghai/);
    expect(out).toMatch(/周三/);
  });
  it('crosses the day boundary correctly per timezone', () => {
    // 2026-04-29T16:30:00Z = 2026-04-30 00:30 CST → next day, 周四
    const out = renderDatetime(new Date('2026-04-29T16:30:00Z'), 'Asia/Shanghai');
    expect(out).toMatch(/2026-04-30/);
    expect(out).toMatch(/周四/);
  });
  it('honors provided timezone', () => {
    const out = renderDatetime(new Date('2026-04-29T08:00:00Z'), 'America/New_York');
    expect(out).toMatch(/America\/New_York/);
  });
});
