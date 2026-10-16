// jchat/src/components/wizard/AddContactWizard.tsx
// Plan: Task 14

import { useEffect } from 'react';
import { useDistillationStore } from '../../store/distillation';
import { WizardStepInput } from './WizardStepInput';
import { WizardStepLoading } from './WizardStepLoading';
import { WizardStepResult } from './WizardStepResult';
import './wizard.css';

export function AddContactWizard() {
  const open = useDistillationStore((s) => s.open);
  const status = useDistillationStore((s) => s.status);
  const closeWizard = useDistillationStore((s) => s.closeWizard);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Close on Escape in any non-idle state. Loading is safe because
      // distillation.ts tick() guards against runId mismatch on close.
      if (status === 'input' || status === 'loading' || status === 'success' || status === 'error') {
        closeWizard();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, status, closeWizard]);

  if (!open) return null;

  return (
    <div className="wizard-overlay" role="dialog" aria-modal="true" aria-label="添加好友">
      <div
        className="wizard-backdrop"
        onClick={() => {
          if (status === 'input' || status === 'loading' || status === 'success' || status === 'error') {
            closeWizard();
          }
        }}
      />
      <div className="wizard-modal" onClick={(e) => e.stopPropagation()}>
        {status === 'input' && <WizardStepInput />}
        {status === 'loading' && <WizardStepLoading />}
        {(status === 'success' || status === 'error') && <WizardStepResult />}
      </div>
    </div>
  );
}
