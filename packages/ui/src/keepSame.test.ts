import { describe, expect, it } from 'vitest';
import { keepSame } from './keepSame';

describe('keepSame', () => {
  it('keeps the held value when the new one says the same, and takes a changed one', () => {
    const held = { clients: ['a'], grant: { enabled: true } };
    expect(keepSame(held, { clients: ['a'], grant: { enabled: true } })).toBe(held);
    const changed = { clients: ['a', 'b'], grant: { enabled: true } };
    expect(keepSame(held, changed)).toBe(changed);
    expect(keepSame<typeof held | null>(null, held)).toBe(held);
  });

  it('takes the new value when either cannot be compared', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const next = {};
    expect(keepSame<object>(cyclic, next)).toBe(next);
  });
});
