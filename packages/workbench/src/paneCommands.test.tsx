// @vitest-environment happy-dom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LayoutView, commandForKey, focusedPane, layoutCommands, leaves, zoomCommands,
  type Command, type Layout, type LayoutNode, type PaneType,
} from './index';

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

let zoom = 100;
const types: Record<string, PaneType> = {
  list: { type: 'list', title: 'List', render: () => <div><button data-in="list">list</button></div> },
  doc: {
    type: 'doc', title: 'Document', zoom: { get: () => zoom, step: (_c, d) => { zoom = d === 0 ? 100 : zoom + d * 10; } },
    render: ({ pane }) => <div><button data-in={pane.key}>{pane.key}</button></div>,
  },
};
const start: LayoutNode = {
  kind: 'split', id: 'root', dir: 'row',
  children: [
    { kind: 'leaf', id: 'a', pane: { type: 'list', key: 'list' } },
    { kind: 'leaf', id: 'b', pane: { type: 'doc', key: 'one' } },
  ],
  sizes: [{ px: 200 }, { fr: 1 }],
};
let current: LayoutNode = start;
const onReset = vi.fn();
function Host() {
  const [layout, setLayout] = useState<Layout>({ version: 1, root: start });
  current = layout.root;
  return <LayoutView layout={layout} onChange={setLayout} paneTypes={types} onReset={onReset} />;
}

const command = (id: string, list: Command[] = layoutCommands()) => list.find((c) => c.id === id)!;
const pointAt = (leaf: string) => act(() => { host.querySelector(`[data-leaf="${leaf}"]`)!.dispatchEvent(new Event('pointerdown', { bubbles: true })); });

describe('commands on the focused pane', () => {
  beforeEach(() => { zoom = 100; onReset.mockClear(); act(() => root.render(<Host />)); });

  it('know the pane pointed at last, as it is now', () => {
    pointAt('b');
    expect(focusedPane()?.pane.key).toBe('one');
    pointAt('a');
    expect(focusedPane()?.actions.title).toBe('List');
  });

  it('split and close it', () => {
    pointAt('b');
    act(() => command('layout.splitRight').run());
    expect(leaves(current).map((l) => l.pane?.type)).toEqual(['list', 'doc', 'doc']);
    // The new pane has the focus; closing it leaves the two
    act(() => command('layout.closePane').run());
    expect(leaves(current).map((l) => l.pane?.type)).toEqual(['list', 'doc']);
  });

  it('zoom it, or what the app falls back to', () => {
    const fallback = { get: vi.fn(() => 120), step: vi.fn() };
    const commands = zoomCommands(fallback);
    pointAt('b');
    act(() => command('view.zoomIn', commands).run());
    expect(zoom).toBe(110);
    expect(command('view.resetZoom', commands).enabled?.(undefined)).toBe(true);
    // A pane without zoom: the commands are off, not the fallback's
    pointAt('a');
    expect(command('view.zoomIn', commands).enabled?.(undefined)).toBe(false);
  });

  it('move the focus from pane to pane with F6', () => {
    pointAt('a');
    act(() => command('layout.focusNext').run());
    expect(document.activeElement?.getAttribute('data-in')).toBe('one');
    expect(focusedPane()?.pane.key).toBe('one');
    act(() => command('layout.focusNext').run());
    expect(document.activeElement?.getAttribute('data-in')).toBe('list');
    act(() => command('layout.focusPrevious').run());
    expect(focusedPane()?.pane.key).toBe('one');
  });

  it('put the layout back through its owner', () => {
    pointAt('a');
    expect(command('layout.reset').enabled?.(undefined)).toBe(true);
    act(() => command('layout.reset').run());
    expect(onReset).toHaveBeenCalled();
  });

  it('forget a pane that is no longer shown', () => {
    pointAt('b');
    act(() => root.render(<div hidden><Host /></div>));
    expect(focusedPane()).toBeNull();
  });
});

describe('commands of a surface', () => {
  it('run by their keys only while their surface is shown', () => {
    const save = { id: 'file.save', label: 'Save', shortcut: { mod: true, key: 's' }, surface: 'documents', run: () => {} };
    const press = () => new KeyboardEvent('keydown', { key: 's', ctrlKey: true });
    expect(commandForKey([save], press(), 'documents')).toBe(save);
    expect(commandForKey([save], press(), 'journal')).toBeUndefined();
    expect(commandForKey([save], press())).toBe(save);
  });
});
