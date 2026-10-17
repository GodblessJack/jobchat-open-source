// jchat/src/components/wizard/WizardStepLoading.tsx
// Plan: Task 12

import { useEffect, useState } from 'react';
import { useDistillationStore } from '../../store/distillation';

const SCRIPT: ReadonlyArray<{ until: number; text: string }> = [
  { until: 8_000, text: '正在读 ta 在 X 上的公开内容…' },
  { until: 24_000, text: '正在抓取 ta 的推文和讨论…' },
  { until: 48_000, text: '正在提炼 ta 的表达风格…' },
  { until: 80_000, text: '正在为 ta 搭建人格…' },
  { until: Number.POSITIVE_INFINITY, text: '马上好了…' },
];

export function WizardStepLoading() {
  const xUrl = useDistillationStore((s) => s.xUrl);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const start = Date.now();
    const id = setInterval(() => setElapsed(Date.now() - start), 500);
    return () => clearInterval(id);
  }, []);

  const stage = SCRIPT.find((s) => elapsed < s.until)!;
  const handle = xUrl.match(/\/([A-Za-z0-9_]+)\/?(\?.*)?$/)?.[1] ?? '';

  return (
    <div className="wizard-step wizard-step-loading" aria-live="polite">
      <h2 className="wizard-title">正在为你准备 @{handle}</h2>
      <div className="wizard-spinner" aria-hidden="true">
        <span className="wizard-spinner-dot" />
      </div>
      <p className="wizard-loading-text">{stage.text}</p>
      <p className="wizard-loading-hint">通常需要 1–2 分钟，关掉这个窗口也没关系，ta 会自己出现在联系人里。</p>
    </div>
  );
}
