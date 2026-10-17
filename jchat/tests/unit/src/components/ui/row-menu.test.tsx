// @vitest-environment jsdom
// jchat/tests/unit/src/components/ui/row-menu.test.tsx
//
// RowMenu is the click-outside / Escape-dismissable popover used by
// ContactList rows for the `···` menu. Verify open/closed rendering and
// the two dismiss paths.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { RowMenu } from '../../../../../src/components/ui/row-menu';

afterEach(cleanup);

describe('RowMenu', () => {
  it('renders children when open', () => {
    render(
      <RowMenu open onClose={() => {}}>
        <button>Delete</button>
      </RowMenu>
    );
    expect(screen.getByText('Delete')).toBeTruthy();
  });

  it('does not render when closed', () => {
    render(
      <RowMenu open={false} onClose={() => {}}>
        <button>Delete</button>
      </RowMenu>
    );
    expect(screen.queryByText('Delete')).toBeNull();
  });

  it('calls onClose on Escape', () => {
    const onClose = vi.fn();
    render(
      <RowMenu open onClose={onClose}>
        <button>Delete</button>
      </RowMenu>
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls onClose on outside mousedown', () => {
    const onClose = vi.fn();
    render(
      <div>
        <RowMenu open onClose={onClose}>
          <button>Delete</button>
        </RowMenu>
        <div data-testid="outside">outside</div>
      </div>
    );
    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('does NOT call onClose on inside mousedown', () => {
    const onClose = vi.fn();
    render(
      <RowMenu open onClose={onClose}>
        <button>Delete</button>
      </RowMenu>
    );
    fireEvent.mouseDown(screen.getByText('Delete'));
    expect(onClose).not.toHaveBeenCalled();
  });
});
