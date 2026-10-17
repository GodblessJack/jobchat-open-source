import { describe, it, expect } from 'vitest';
import { isValidSkillName } from '@/server/sdk/skill-loader.js';

describe('isValidSkillName', () => {
  it.each([
    'naval',
    'contact-recommender',
    'a-b-c',
    'x9',
    'a',
    'persona-distillation',
    'naval-2',
  ])('accepts valid name: %s', (name) => {
    expect(isValidSkillName(name)).toBe(true);
  });

  it.each([
    '../etc/passwd',
    'foo/bar',
    'foo\\bar',
    '..',
    '.foo',
    'foo.md',
    'Foo',
    'foo bar',
    '',
    'a'.repeat(65),
    '中文',
    'foo;rm',
    '-foo',
  ])('rejects invalid name: %s', (name) => {
    expect(isValidSkillName(name)).toBe(false);
  });
});
