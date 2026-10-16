// jchat/src/components/wizard/WizardStepResult.tsx
// Plan: Task 13

import { useNavigate } from 'react-router-dom';
import { useDistillationStore } from '../../store/distillation';

export function WizardStepResult() {
  const status = useDistillationStore((s) => s.status);
  const result = useDistillationStore((s) => s.result);
  const error = useDistillationStore((s) => s.error);
  const closeWizard = useDistillationStore((s) => s.closeWizard);
  const reset = useDistillationStore((s) => s.reset);
  const navigate = useNavigate();

  if (status === 'success' && result) {
    return (
      <div className="wizard-step wizard-step-success" role="status">
        <div className="wizard-result-row">
          {result.avatarUrl ? (
            <img className="wizard-avatar" src={result.avatarUrl} alt="" />
          ) : (
            <div className="wizard-avatar wizard-avatar-fallback">{result.name.slice(0, 1)}</div>
          )}
          <div>
            <h2 className="wizard-title">{result.name} 加入了你的联系人</h2>
            <p className="wizard-subtitle">@{result.slug}</p>
          </div>
        </div>
        <div className="wizard-actions">
          <button type="button" className="wizard-btn wizard-btn-secondary" onClick={closeWizard}>
            关闭
          </button>
          <button
            type="button"
            className="wizard-btn wizard-btn-primary"
            onClick={() => {
              closeWizard();
              navigate(`/chat/new?agentId=${encodeURIComponent(result.agentId)}`);
            }}
          >
            和 ta 打个招呼
          </button>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    const friendly = friendlyMessage(error?.code, error?.message);
    // concurrent_running has no useful "换个人" action — the previous
    // run is still working and a new one would just hit the same error.
    // Show only a close button so the user waits it out.
    const showRetry = error?.code !== 'concurrent_running';
    return (
      <div className="wizard-step wizard-step-error" role="alert">
        <h2 className="wizard-title">没成功</h2>
        <p className="wizard-error-body">{friendly}</p>
        <div className="wizard-actions">
          <button type="button" className="wizard-btn wizard-btn-secondary" onClick={closeWizard}>
            {showRetry ? '关闭' : '知道了'}
          </button>
          {showRetry && (
            <button type="button" className="wizard-btn wizard-btn-primary" onClick={reset}>
              换个人
            </button>
          )}
        </div>
      </div>
    );
  }

  return null;
}

function friendlyMessage(code: string | undefined, raw: string | undefined): string {
  switch (code) {
    case 'invalid_x_url':
      return raw || '这看起来不是 X 主页 URL。';
    case 'quota_exhausted':
      return '今日次数已用完，明天再来吧。';
    case 'concurrent_running':
      return '还有 1 个正在准备中，等它好了再加新的。';
    case 'NO_CONTACT_CREATED':
      return 'ta 在 X 上的公开内容太少，没法做出一个像样的 ta。';
    case 'run_lost':
      return raw || '服务器重启了，蒸馏中断。刷新一下看看 ta 是不是已经在联系人里。';
    case 'not_owner':
      return '这个蒸馏不属于你。';
    case 'client_timeout':
      return raw || '等太久了，刷新页面看看 ta 是不是已经在你的联系人里。';
    case 'SDK_ERROR':
    case 'SDK_LAUNCH_FAILED':
      return '系统出了点小问题，等几秒再试一下。';
    default:
      return raw || '出错了，再试一次。';
  }
}
