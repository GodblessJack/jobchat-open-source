// Global test setup: deterministic local-only configuration, never real credentials.
import '@testing-library/jest-dom/vitest';

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.LOCAL_JWT_ACCESS_SECRET ||= 'test-only-access-secret-0123456789abcdef0123456789abcdef';
process.env.LOCAL_JWT_REFRESH_SECRET ||= 'test-only-refresh-secret-abcdef0123456789abcdef0123456789';
process.env.ANTHROPIC_API_KEY ||= 'test-only-anthropic-key';
process.env.DATABASE_URL ||= 'postgresql://postgres:postgres@127.0.0.1:5432/jobchat_test';
process.env.JCHAT_SESSIONS_ROOT ||= '/tmp/jobchat-test-sessions';
process.env.FILES_ROOT ||= '/tmp/jobchat-test-files';
process.env.AUTH_TRANSITION = '0';
