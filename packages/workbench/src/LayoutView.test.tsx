// @vitest-environment happy-dom
import { act, useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LayoutView, closeLeaf, findLeaf, splitLeaf, swapPanes, type Layout, type PaneType } from './index';

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

const mounts = vi.fn();
const unmounts = vi.fn();

/** A terminal stand-in that counts how often it mounts. */
function Terminal({ id, visible }: { id: string; visible: boolean }) {
  useEffect(() => { mounts(id); return () => unmounts(id); }, [id]);
  return <div data-terminal={id} data-visible={visible} />;
}

const paneTypes: Record<string, PaneType> = {
  terminal: { type: 'terminal', keepAlive: true, render: ({ pane, visible }) => <Terminal id={pane.key} visible={visible} /> },
  doc: { type: 'doc', render: ({ pane }) => <div data-doc={pane.key} /> },
  files: { type: 'files', label: 'file panel', collapsible: true, min: { w: 200 }, render: () => <aside data-files /> },
};

const start: Layout = {
  version: 1,
  root: {
    kind: 'split', id: 'root', dir: 'row',
    children: [
      { kind: 'leaf', id: 'left', pane: { type: 'files', key: 'files' } },
      { kind: 'leaf', id: 'a', pane: { type: 'terminal', key: 't1' } },
      { kind: 'leaf', id: 'b', pane: { type: 'terminal', key: 't2' } },
    ],
    sizes: [{ px: 240 }, { fr: 1 }, { fr: 1 }],
  },
};

const slotOf = (terminal: string) => document.querySelector(`[data-terminal="${terminal}"]`)?.closest('[data-leaf]')?.getAttribute('data-leaf');

describe('LayoutView', () => {
  beforeEach(() => { mounts.mockClear(); unmounts.mockClear(); });

  it('draws the splits, sizes the children and puts a handle between them', () => {
    act(() => root.render(<LayoutView layout={start} onChange={() => {}} paneTypes={paneTypes} />));
    const children = [...host.querySelectorAll<HTMLElement>('.wb-split__child')];
    expect(children.map((c) => c.style.flex)).toEqual(['0 0 240px', '1 1 0px', '1 1 0px']);
    expect(host.querySelectorAll('[role="separator"]')).toHaveLength(2);
    expect(host.querySelector('[role="separator"]')?.getAttribute('aria-label')).toContain('file panel');
  });

  it('keeps terminals mounted while other panes are split, swapped and closed', () => {
    function Host() {
      const [layout, setLayout] = useState(start);
      (globalThis as { setLayout?: typeof setLayout }).setLayout = setLayout;
      return <LayoutView layout={layout} onChange={setLayout} paneTypes={paneTypes} />;
    }
    const set = (fn: (l: Layout) => Layout) => act(() => (globalThis as unknown as { setLayout: (f: (l: Layout) => Layout) => void }).setLayout(fn));
    act(() => root.render(<Host />));
    expect(mounts.mock.calls.map((c) => c[0]).sort()).toEqual(['t1', 't2']);
    expect(slotOf('t1')).toBe('a');

    set((l) => ({ ...l, root: splitLeaf(l.root, 'a', 'col', 'after', { kind: 'leaf', id: 'c', pane: { type: 'doc', key: 'd' } }, 's1') }));
    expect(host.querySelector('[data-doc="d"]')).not.toBeNull();
    set((l) => ({ ...l, root: swapPanes(l.root, 'a', 'b') }));
    expect(slotOf('t1')).toBe('b');
    expect(slotOf('t2')).toBe('a');
    set((l) => ({ ...l, root: closeLeaf(l.root, 'c') }));

    expect(mounts).toHaveBeenCalledTimes(2);
    expect(unmounts).not.toHaveBeenCalled();
  });

  it('parks a retained terminal no leaf shows, and unmounts one that is neither shown nor retained', () => {
    const only: Layout = { version: 1, root: { kind: 'leaf', id: 'a', pane: { type: 'terminal', key: 't1' } } };
    act(() => root.render(<LayoutView layout={only} onChange={() => {}} paneTypes={paneTypes} retain={[{ type: 'terminal', key: 't2' }]} />));
    expect(host.querySelector('.wb-parking [data-terminal="t2"]')?.getAttribute('data-visible')).toBe('false');
    act(() => root.render(<LayoutView layout={only} onChange={() => {}} paneTypes={paneTypes} />));
    expect(unmounts).toHaveBeenCalledWith('t2');
    expect(unmounts).not.toHaveBeenCalledWith('t1');
  });

  it('hides a collapsible panel on a double-click of its handle and reports the focused leaf', () => {
    const onChange = vi.fn();
    const onFocusLeaf = vi.fn();
    act(() => root.render(<LayoutView layout={start} onChange={onChange} paneTypes={paneTypes} onFocusLeaf={onFocusLeaf} focusedLeaf="a" />));
    act(() => { host.querySelector('[role="separator"]')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); });
    expect(findLeaf(onChange.mock.calls[0][0].root, 'left')?.collapsed).toBe(true);
    act(() => { host.querySelector('[data-leaf="b"]')!.dispatchEvent(new Event('pointerdown', { bubbles: true })); });
    expect(onFocusLeaf).toHaveBeenCalledWith('b');
    expect(host.querySelector('[data-leaf="a"]')?.className).toContain('is-focused');
  });
});
