// jchat/src/components/wizard/WizardStepInput.tsx
// Plan: Task 11

import { useState } from 'react';
import { useDistillationStore } from '../../store/distillation';
import { validateXProfileUrl } from '../../lib/distillation-api';

export function WizardStepInput() {
  const xUrl = useDistillationStore((s) => s.xUrl);
  const quota = useDistillationStore((s) => s.quota);
  const status = useDistillationStore((s) => s.status);
  const setXUrl = useDistillationStore((s) => s.setXUrl);
  const submit = useDistillationStore((s) => s.submit);
  const closeWizard = useDistillationStore((s) => s.closeWizard);

  const [touched, setTouched] = useState(false);
  const trimmed = xUrl.trim();
  const isValid = trimmed === '' ? null : validateXProfileUrl(trimmed);
  const showError = touched && isValid === false;
  const quotaExhausted = quota?.remaining === 0;
  const disabled = !isValid || quotaExhausted || status === 'loading';

  return (
    <div className="wizard-step wizard-step-input" aria-label="添加好友 第 1 步">
      <h2 className="wizard-title">添加好友</h2>
      <p className="wizard-subtitle">粘贴 ta 的 X 主页 URL，比如 https://x.com/naval</p>
      <input
        className={`wizard-input ${showError ? 'wizard-input-invalid' : ''}`}
        type="url"
        placeholder="https://x.com/..."
        value={xUrl}
        autoFocus
        onChange={(e) => {
          setXUrl(e.target.value);
          if (!touched) setTouched(true);
        }}
        onBlur={() => setTouched(true)}
      />
      {showError && (
        <div className="wizard-input-hint wizard-input-hint-err">
          这看起来不是 X 主页 URL（请粘贴主页，不是单条推文）
        </div>
      )}
      {quotaExhausted && (
        <div className="wizard-input-hint wizard-input-hint-warn">
          今日次数已用完，明天再来吧
        </div>
      )}
      {quota && !quotaExhausted && (
        <div className="wizard-input-hint">
          今日还剩 {quota.remaining} 次
        </div>
      )}
      <div className="wizard-actions">
        <button
          type="button"
          className="wizard-btn wizard-btn-secondary"
          onClick={closeWizard}
        >
          取消
        </button>
        <button
          type="button"
          className="wizard-btn wizard-btn-primary"
          disabled={disabled}
          onClick={() => {
            void submit();
          }}
        >
          开始 →
        </button>
      </div>
    </div>
  );
}
