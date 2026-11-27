import { describe, expect, it, vi } from 'vitest';
import { PluginRegistry, type PluginStorage } from './index';

// The points, slots and events these tests use, declared the way an app declares its own
declare module './plugins' {
  interface WorkbenchPoints { 'test:item': { id: string; order?: number } }
  interface WorkbenchSlots { 'test:slot': (name: string) => string }
  interface WorkbenchEvents { 'test:ping': { n: number } }
}

const memory = (initial: Record<string, string> = {}): PluginStorage & { data: Record<string, string> } => {
  const data = { ...initial };
  return { data, getItem: (key) => data[key] ?? null, setItem: (key, value) => { data[key] = value; } };
};

describe('PluginRegistry', () => {
  it('lists what plugins contributed to a point by order, then by registration', () => {
    const registry = new PluginRegistry();
    registry.register({ id: 'a', name: 'A', setup: (api) => { api.contribute('test:item', { id: 'a1' }); api.contribute('test:item', { id: 'a2', order: 10 }); } });
    registry.register({ id: 'b', name: 'B', setup: (api) => { api.contribute('test:item', { id: 'b1' }); } });
    expect(registry.items('test:item').map((item) => item.id)).toEqual(['a2', 'a1', 'b1']);
  });

  it('takes back what a disabled plugin brought, and brings it again when enabled', () => {
    const storage = memory();
    const registry = new PluginRegistry(storage, 'app');
    const cleanup = vi.fn();
    registry.register({ id: 'a', name: 'A', setup: (api) => { api.contribute('test:item', { id: 'a1' }); return cleanup; } });
    registry.setEnabled('a', false);
    expect(registry.items('test:item')).toEqual([]);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(registry.isEnabled('a')).toBe(false);
    expect(JSON.parse(storage.data['app:disabled-plugins'])).toEqual(['a']);
    registry.setEnabled('a', true);
    registry.setEnabled('a', true);
    expect(registry.items('test:item').map((item) => item.id)).toEqual(['a1']);
  });

  it('keeps which plugins are off in its storage, and a plugin that is off by default stays off until turned on', () => {
    const storage = memory({ 'app:disabled-plugins': '["a"]', 'app:enabled-plugins': '["c"]' });
    const registry = new PluginRegistry(storage, 'app');
    const plugin = (id: string, defaultDisabled = false) => ({ id, name: id, defaultDisabled, setup: () => {} });
    registry.register(plugin('a'));
    registry.register(plugin('b', true));
    registry.register(plugin('c', true));
    expect(registry.listPlugins().map((p) => [p.id, p.enabled])).toEqual([['a', false], ['b', false], ['c', true]]);
  });

  it('gives a slot the last enabled override, and the one before when that plugin goes', () => {
    const registry = new PluginRegistry();
    registry.register({ id: 'a', name: 'A', setup: (api) => api.overrideSlot('test:slot', (name) => `a:${name}`) });
    registry.register({ id: 'b', name: 'B', setup: (api) => api.overrideSlot('test:slot', (name) => `b:${name}`) });
    expect(registry.slot('test:slot')?.('x')).toBe('b:x');
    registry.setEnabled('b', false);
    expect(registry.slot('test:slot')?.('x')).toBe('a:x');
    registry.unregister('a');
    expect(registry.slot('test:slot')).toBeUndefined();
  });

  it('delivers events to the plugins that listen, until they are disabled; a failing listener stops no other', () => {
    const registry = new PluginRegistry();
    const heard = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    registry.register({ id: 'bad', name: 'Bad', setup: (api) => { api.onEvent('test:ping', () => { throw new Error('no'); }); } });
    registry.register({ id: 'a', name: 'A', setup: (api) => { api.onEvent('test:ping', heard); } });
    registry.emitEvent('test:ping', { n: 1 });
    registry.setEnabled('a', false);
    registry.emitEvent('test:ping', { n: 2 });
    expect(heard.mock.calls).toEqual([[{ n: 1 }]]);
  });

  it('loads the other plugins when one fails to start, without what the failing one registered', () => {
    const registry = new PluginRegistry();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    registry.register({ id: 'bad', name: 'Bad', setup: (api) => { api.contribute('test:item', { id: 'half' }); throw new Error('no'); } });
    registry.register({ id: 'a', name: 'A', setup: (api) => { api.contribute('test:item', { id: 'a1' }); } });
    expect(registry.items('test:item').map((item) => item.id)).toEqual(['a1']);
  });

  it('tells subscribers when plugins come, go or change', () => {
    const registry = new PluginRegistry();
    const changed = vi.fn();
    const off = registry.subscribe(changed);
    const before = registry.getRevision();
    registry.register({ id: 'a', name: 'A', setup: () => {} });
    registry.setEnabled('a', false);
    off();
    registry.unregister('a');
    expect(changed).toHaveBeenCalledTimes(2);
    expect(registry.getRevision()).toBe(before + 3);
  });
});
