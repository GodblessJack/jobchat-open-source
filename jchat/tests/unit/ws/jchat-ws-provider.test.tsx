// @vitest-environment jsdom
import '@testing-library/jest-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { JchatWsProvider } from '../../../src/ws/JchatWsProvider';
import { useAuthStore } from '../../../src/store/auth';

beforeEach(() => {
  useAuthStore.setState({
    user: null,
    accessToken: null,
    jwt: null,
    isAuthenticated: false,
    isLoading: false,
    ready: true,
  });
});

describe('JchatWsProvider', () => {
  it('renders children when unauthenticated so the login route can render', () => {
    render(
      <JchatWsProvider>
        <div>Login form</div>
      </JchatWsProvider>
    );

    expect(screen.getByText('Login form')).toBeInTheDocument();
  });
});
