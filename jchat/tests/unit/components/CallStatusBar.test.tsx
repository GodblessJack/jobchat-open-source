// @vitest-environment jsdom
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CallStatusBar } from '../../../src/components/containers/CallStatusBar';
import { useUiStore } from '../../../src/store/ui';
import { useContactsStore } from '../../../src/store/contacts';

beforeEach(() => {
  useUiStore.getState().setActiveCall(null);
});

describe('CallStatusBar', () => {
  it('renders nothing when no active call', () => {
    const { container } = render(<CallStatusBar conversationId="c1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when activeCall belongs to a different conversation', () => {
    useUiStore.getState().setActiveCall({ sessionId: 's', conversationId: 'c2', agentId: 'a' });
    const { container } = render(<CallStatusBar conversationId="c1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders amber bar with agent name when activeCall matches', () => {
    useContactsStore.setState((s: any) => ({
      ...s,
      agents: { a: { id: 'a', name: '李雷', avatarUrl: null, description: '' } as any }
    }));
    useUiStore.getState().setActiveCall({ sessionId: 's', conversationId: 'c1', agentId: 'a' });
    render(<CallStatusBar conversationId="c1" />);
    expect(screen.getByRole('button', { name: '切回视频通话窗口' })).toHaveTextContent('李雷');
  });

  it('clicking the bar broadcasts focus-call', () => {
    useUiStore.getState().setActiveCall({ sessionId: 's', conversationId: 'c1', agentId: 'a' });
    const spy = vi.fn();
    const orig = (window as any).BroadcastChannel;
    (window as any).BroadcastChannel = function (name: string) {
      return { postMessage: spy, close: () => {}, name } as any;
    };
    render(<CallStatusBar conversationId="c1" />);
    fireEvent.click(screen.getByRole('button', { name: '切回视频通话窗口' }));
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ type: 'focus-call', sessionId: 's' }));
    (window as any).BroadcastChannel = orig;
  });
});
