import { describe, expect, it } from 'vitest';
import { keepSame } from './keepSame';

// From Agent MCR (MCR-139), where the pollers use it
describe('keepSame', () => {
  it('keeps the held value when a poll brings the same content as a fresh object', () => {
    const held = [{ id: 'a', harness: { state: 'working' } }];
    const next = [{ id: 'a', harness: { state: 'working' } }];
    expect(keepSame(held, next)).toBe(held);
  });

  it('takes the new value when anything in it changed', () => {
    const held = [{ id: 'a', harness: { state: 'working' } }];
    const next = [{ id: 'a', harness: { state: 'idle' } }];
    expect(keepSame(held, next)).toBe(next);
    expect(keepSame<unknown>(null, next)).toBe(next);
    expect(keepSame<unknown>(held, null)).toBeNull();
  });

  it('takes the new value when the held one cannot be compared', () => {
    const held: Record<string, unknown> = {};
    held.self = held;
    const next = { self: 1 };
    expect(keepSame<unknown>(held, next)).toBe(next);
  });
});
