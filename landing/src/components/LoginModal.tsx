import React, { useState, useEffect, useRef } from 'react';
import { X, User, Lock } from 'lucide-react';

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type FormMode = 'login' | 'register';

const s = {
  overlay: {
    position: 'fixed' as const,
    inset: 0,
    zIndex: 100,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.4)',
    backdropFilter: 'blur(4px)',
  },
  modal: {
    position: 'relative' as const,
    backgroundColor: 'white',
    borderRadius: '16px',
    boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)',
    width: '400px',
    maxWidth: '90vw',
    padding: '32px',
  },
  closeBtn: {
    position: 'absolute' as const,
    top: '16px',
    right: '16px',
    color: 'rgba(0,0,0,0.3)',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
  },
  header: { textAlign: 'center' as const, marginBottom: '24px' },
  title: { fontSize: '20px', fontWeight: 600, color: '#000', letterSpacing: '-0.01em' },
  subtitle: { fontSize: '14px', color: 'rgba(0,0,0,0.5)', marginTop: '8px' },
  inputWrap: {
    position: 'relative' as const,
    marginBottom: '12px',
  },
  inputIcon: {
    position: 'absolute' as const,
    left: '12px',
    top: '50%',
    transform: 'translateY(-50%)',
    color: 'rgba(0,0,0,0.3)',
  },
  input: {
    width: '100%',
    paddingLeft: '40px',
    paddingRight: '16px',
    paddingTop: '10px',
    paddingBottom: '10px',
    border: '1px solid rgba(0,0,0,0.1)',
    borderRadius: '12px',
    fontSize: '15px',
    outline: 'none',
    boxSizing: 'border-box' as const,
  },
  btn: (disabled: boolean) => ({
    width: '100%',
    padding: '10px 16px',
    borderRadius: '12px',
    backgroundColor: '#000',
    color: 'white',
    fontSize: '15px',
    fontWeight: 500,
    border: 'none',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.4 : 1,
    marginTop: '12px',
  }),
  toggleRow: {
    display: 'flex',
    justifyContent: 'center' as const,
    gap: '4px',
    marginTop: '16px',
    fontSize: '13px',
    color: 'rgba(0,0,0,0.5)',
  },
  toggleLink: {
    color: '#000',
    fontWeight: 500,
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: 0,
    fontSize: '13px',
    textDecoration: 'none',
  },
  error: {
    marginTop: '12px',
    fontSize: '13px',
    color: '#ef4444',
    textAlign: 'center' as const,
  },
  usernameHint: {
    fontSize: '12px',
    color: 'rgba(0,0,0,0.35)',
    marginTop: '4px',
    marginLeft: '4px',
  },
};

function getReturnTo(): string {
  const params = new URLSearchParams(window.location.search);
  return params.get('returnTo') || '/chat';
}

export function LoginModal({ isOpen, onClose }: LoginModalProps) {
  const [mode, setMode] = useState<FormMode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const modalRef = useRef<HTMLDivElement>(null);

  // Reset form when modal opens/closes
  useEffect(() => {
    if (!isOpen) {
      setMode('login');
      setUsername('');
      setPassword('');
      setError('');
      setLoading(false);
    }
  }, [isOpen]);

  // Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose]);

  // Backdrop click
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (modalRef.current && !modalRef.current.contains(e.target as Node)) onClose();
  };

  const isValidUsername = (v: string) => v.length >= 3 && v.length <= 30;
  const isValidPassword = (v: string) => v.length >= 8;

  const canSubmit = () => {
    return isValidUsername(username) && isValidPassword(password);
  };

  const handleSubmit = async () => {
    if (!canSubmit()) return;
    setError('');
    setLoading(true);

    try {
      const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username: username.trim(), password }),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(errBody.error ?? 'Request failed');
      }

      // On success, redirect to returnTo or /chat
      window.location.href = getReturnTo();
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') void handleSubmit();
  };

  const toggleMode = () => {
    setMode(mode === 'login' ? 'register' : 'login');
    setError('');
    setPassword('');
  };

  if (!isOpen) return null;

  return (
    <div style={s.overlay} onClick={handleBackdropClick}>
      <div ref={modalRef} style={s.modal}>
        <button onClick={onClose} style={s.closeBtn}>
          <X style={{ width: 20, height: 20 }} />
        </button>

        <div style={s.header}>
          <h2 style={s.title}>
            {mode === 'login' ? 'Sign in to JobChat' : 'Create an account'}
          </h2>
          <p style={s.subtitle}>
            {mode === 'login'
              ? 'Enter your username and password'
              : 'Choose a username and password'}
          </p>
        </div>

        <div>
          {/* Username */}
          <div style={s.inputWrap}>
            <User style={{ ...s.inputIcon, width: 16, height: 16 }} />
            <input
              type="text"
              placeholder="Username"
              value={username}
              onChange={e => {
                setUsername(e.target.value);
                setError('');
              }}
              onKeyDown={handleKeyDown}
              autoComplete="username"
              maxLength={30}
              style={s.input}
            />
          </div>
          {username.length > 0 && username.length < 3 && (
            <div style={s.usernameHint}>Username must be at least 3 characters</div>
          )}

          {/* Password */}
          <div style={s.inputWrap}>
            <Lock style={{ ...s.inputIcon, width: 16, height: 16 }} />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={e => {
                setPassword(e.target.value);
                setError('');
              }}
              onKeyDown={handleKeyDown}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              style={s.input}
            />
          </div>
          {password.length > 0 && password.length < 8 && (
            <div style={s.usernameHint}>Password must be at least 8 characters</div>
          )}

          <button
            onClick={handleSubmit}
            disabled={loading || !canSubmit()}
            style={s.btn(loading || !canSubmit())}
          >
            {loading
              ? 'Please wait...'
              : mode === 'login'
                ? 'Sign In'
                : 'Create Account'}
          </button>

          <div style={s.toggleRow}>
            {mode === 'login' ? (
              <>
                Don't have an account?
                <button onClick={toggleMode} style={s.toggleLink}>
                  Sign up
                </button>
              </>
            ) : (
              <>
                Already have an account?
                <button onClick={toggleMode} style={s.toggleLink}>
                  Sign in
                </button>
              </>
            )}
          </div>
        </div>

        {error && <p style={s.error}>{error}</p>}
      </div>
    </div>
  );
}
