// @vitest-environment jsdom
import '@testing-library/jest-dom';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChatBubble } from '../../../src/components/chat/ChatBubble';

describe('ChatBubble — fromCall badge', () => {
  it('renders 📞 badge when fromCall is true', () => {
    render(
      <ChatBubble role="assistant" name="李雷" time="12:00" fromCall>
        <span>hi</span>
      </ChatBubble>
    );
    expect(screen.getByLabelText('来自视频通话')).toBeInTheDocument();
  });

  it('does not render badge when fromCall is false or undefined', () => {
    const { rerender } = render(
      <ChatBubble role="assistant" name="李雷" time="12:00">
        <span>hi</span>
      </ChatBubble>
    );
    expect(screen.queryByLabelText('来自视频通话')).not.toBeInTheDocument();

    rerender(
      <ChatBubble role="assistant" name="李雷" time="12:00" fromCall={false}>
        <span>hi</span>
      </ChatBubble>
    );
    expect(screen.queryByLabelText('来自视频通话')).not.toBeInTheDocument();
  });
});
