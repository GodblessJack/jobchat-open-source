// tests/mock-db.ts
//
// Reusable Drizzle `db` mock for unit tests. Since Drizzle's query builder
// uses a deep chainable API (e.g. db.select().from().where().limit()), we
// provide a Proxy-based mock that intercepts any property access and returns
// itself. The final result is controlled by a `.resolve(value)` call that
// makes the chain thenable.
//
// Usage:
//   import { mockDb, mockChain } from '../../mock-db.js';
//   vi.mock('../../../server/lib/db.js', () => ({ db: mockDb }));
//
//   // Configure return value for a specific call:
//   const rows = [{ id: 'x', name: 'y' }];
//   mockDb.__setNextResult(rows);
//   // Next awaited call returns `rows`
//
// Or use per-method spies:
//   const selectSpy = vi.fn(() => mockChain([{ ... }]));
//   mockDb.select = selectSpy;

import { vi } from 'vitest';

/**
 * Returns a thenable Proxy that resolves to `value`. Any property access or
 * function call returns another mockChain resolving to the same `value`.
 * This allows mocking any depth of Drizzle's chainable builder.
 */
export function mockChain(value: unknown = undefined): any {
  const fn: any = vi.fn(() => mockChain(value));
  fn.then = (resolve: any, reject: any) => Promise.resolve(value).then(resolve, reject);
  fn.catch = (reject: any) => Promise.resolve(value).catch(reject);
  fn.finally = (cb: any) => Promise.resolve(value).finally(cb);
  return new Proxy(fn, {
    get(_target, prop) {
      if (prop === 'then' || prop === 'catch' || prop === 'finally') {
        return fn[prop];
      }
      return mockChain(value);
    },
    apply(_target, _thisArg, _args) {
      return mockChain(value);
    },
  }) as any;
}

/** Mock db.select(...) — returns chainable resolving to `rows`. */
export function mockSelect(rows: unknown[] = []) {
  return vi.fn(() => mockChain(rows));
}

/** Mock db.insert(...) — returns chainable resolving to inserted rows. */
export function mockInsert(returned: unknown[] = [{}]) {
  return vi.fn(() => mockChain(returned));
}

/** Mock db.update(...) — returns chainable resolving to updated rows. */
export function mockUpdate(returned: unknown[] = [{}]) {
  return vi.fn(() => mockChain(returned));
}

/** Mock db.delete(...) — returns chainable resolving to void. */
export function mockDelete() {
  return vi.fn(() => mockChain(undefined));
}

/** Mock db.execute(...) — resolves to raw SQL result. */
export function mockExecute(result: unknown = { rows: [] }) {
  return vi.fn(() => mockChain(result));
}

/**
 * Returns a mockChain that REJECTS with the given error.
 * Use for testing error-handling paths (Drizzle's .catch()).
 */
export function mockChainError(err: Error): any {
  const fn: any = vi.fn(() => mockChainError(err));
  fn.then = (_resolve: any, reject: any) => Promise.reject(err).catch(reject);
  fn.catch = (cb: any) => Promise.reject(err).catch(cb);
  fn.finally = (cb: any) => Promise.reject(err).catch(() => {}).finally(cb);
  return new Proxy(fn, {
    get(_target, prop) {
      if (prop === 'then' || prop === 'catch' || prop === 'finally') {
        return fn[prop];
      }
      return mockChainError(err);
    },
    apply(_target, _thisArg, _args) {
      return mockChainError(err);
    },
  }) as any;
}

/**
 * Default mock db instance. Tests can override individual methods:
 *   mockDb.select = mockSelect([{ id: '1' }]);
 */
export const mockDb = {
  select: mockSelect([]),
  insert: mockInsert([{ id: 'mock-id' }]),
  update: mockUpdate(),
  delete: mockDelete(),
  execute: mockExecute({ rows: [] }),
  transaction: vi.fn((cb: any) => cb(mockDb)),
};
