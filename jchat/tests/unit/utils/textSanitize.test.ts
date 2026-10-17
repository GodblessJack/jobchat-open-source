import { describe, it, expect } from 'vitest';
import {
  stripBidiOverride,
  clampLength,
  extractDisplayName,
  inferTypeFromMime
} from '@/utils/textSanitize';

describe('stripBidiOverride', () => {
  it('removes LRE/RLE/PDF/LRO/RLO and LRI/RLI/FSI/PDI', () => {
    const input = 'safe‮hidden‬end⁦wrap⁩';
    expect(stripBidiOverride(input)).toBe('safehiddenendwrap');
  });
  it('leaves ASCII and CJK alone', () => {
    expect(stripBidiOverride('Hello 世界')).toBe('Hello 世界');
  });
});

describe('clampLength', () => {
  it('passes short strings through', () => {
    expect(clampLength('short', 10)).toBe('short');
  });
  it('truncates long strings and appends ellipsis', () => {
    expect(clampLength('abcdefghij', 5)).toBe('abcde…');
  });
});

describe('extractDisplayName', () => {
  it('strips UUID prefix from <uuid>-<filename> path', () => {
    const path = 'user-abc/123e4567-e89b-12d3-a456-426614174000-report.pdf';
    expect(extractDisplayName(path)).toBe('report.pdf');
  });
  it('falls back to last segment if no UUID prefix', () => {
    expect(extractDisplayName('plain/folder/file.txt')).toBe('file.txt');
  });
  it('returns "附件" for empty input', () => {
    expect(extractDisplayName('')).toBe('附件');
  });
  it('strips bidi overrides from filename', () => {
    const path = '123e4567-e89b-12d3-a456-426614174000-safe‮evil.pdf';
    expect(extractDisplayName(path)).toBe('safeevil.pdf');
  });
  it('truncates very long filenames with middle ellipsis preserving extension', () => {
    const longName = 'a'.repeat(100) + '.pdf';
    const path = `123e4567-e89b-12d3-a456-426614174000-${longName}`;
    const result = extractDisplayName(path);
    expect(result.length).toBeLessThanOrEqual(64);
    expect(result.endsWith('.pdf')).toBe(true);
    expect(result).toContain('…');
  });
});

describe('inferTypeFromMime', () => {
  it('maps known mimes to FileCard type labels', () => {
    expect(inferTypeFromMime('application/pdf')).toBe('pdf');
    expect(inferTypeFromMime('application/msword')).toBe('docx');
    expect(inferTypeFromMime('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe('docx');
    expect(inferTypeFromMime('application/vnd.ms-excel')).toBe('xlsx');
    expect(inferTypeFromMime('application/zip')).toBe('zip');
  });
  it('returns null for unknown mime', () => {
    expect(inferTypeFromMime('application/x-weird')).toBeNull();
  });
});
