import { describe, expect, it } from 'vitest';
import { formatAge } from './format';

describe('formatAge', () => {
  it('formats ages', () => {
    const now = Date.UTC(2026, 9, 12, 12);
    expect(formatAge(now - 20_000, now)).toBe('just now');
    expect(formatAge(now - 5 * 60_000, now)).toBe('5 min ago');
    expect(formatAge(now - 3 * 3_600_000, now)).toBe('3 h ago');
    expect(formatAge(now - 26 * 3_600_000, now)).toBe('yesterday');
    expect(formatAge(now - 3 * 86_400_000, now)).toBe('3 days ago');
  });
});
