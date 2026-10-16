import { describe, it, expect } from 'vitest';
import { FRIENDLY_ERROR } from '../../../../server/mcp/create-contact-mcp.js';

describe('create-contact FRIENDLY_ERROR map', () => {
  it('maps PERSONA_SUMMARY_TOO_SHORT to user-friendly Chinese', () => {
    expect(FRIENDLY_ERROR.PERSONA_SUMMARY_TOO_SHORT).toBe(
      '蒸馏产出的身份摘要太短（< 50 字），请重新启动流程。'
    );
  });

  it('maps NO_ENABLED_SKILL to user-friendly Chinese', () => {
    expect(FRIENDLY_ERROR.NO_ENABLED_SKILL).toBe(
      '蒸馏产出未生成有效能力包，请重新启动流程。'
    );
  });

  it('preserves existing error keys', () => {
    expect(FRIENDLY_ERROR.QUOTA_EXCEEDED).toBeTruthy();
    expect(FRIENDLY_ERROR.SLUG_EXHAUSTED).toBeTruthy();
    expect(FRIENDLY_ERROR.SKILL_MD_INVALID_LENGTH).toBeTruthy();
    expect(FRIENDLY_ERROR.INVALID_SLUG).toBeTruthy();
    expect(FRIENDLY_ERROR.INVALID_SOURCE_TYPE).toBeTruthy();
    expect(FRIENDLY_ERROR.USER_ID_REQUIRED).toBeTruthy();
  });
});
