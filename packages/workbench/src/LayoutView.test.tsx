// @vitest-environment happy-dom
import { act, useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LayoutView, Pane, closeLeaf, findLeaf, focusedPane, leaves, splitLeaf, swapPanes, type Layout, type LayoutNode, type PaneType } from './index';

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
    expect(host.querySelector('.wb-layout [data-terminal="t2"]')).toBeNull();
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
    // The owner's current leaf is still a (it didn't take b); the window's focus line is on b
    expect(host.querySelector('[data-leaf="a"]')?.className).toContain('is-focused');
    expect(host.querySelector('[data-leaf="b"]')?.className).toContain('has-focus');
    expect(host.querySelectorAll('.has-focus')).toHaveLength(1);
  });

  it('gives the focus to a kept-alive pane pointed at or focused inside, although its content is drawn elsewhere', () => {
    const onFocusLeaf = vi.fn();
    act(() => root.render(<LayoutView layout={start} onChange={() => {}} paneTypes={paneTypes} onFocusLeaf={onFocusLeaf} focusedLeaf="left" />));
    act(() => { host.querySelector('[data-terminal="t1"]')!.dispatchEvent(new Event('pointerdown', { bubbles: true })); });
    expect(focusedPane()?.pane.key).toBe('t1');
    expect(onFocusLeaf).toHaveBeenLastCalledWith('a');
    expect(host.querySelector('.has-focus')?.getAttribute('data-leaf')).toBe('a');
    act(() => { host.querySelector('[data-terminal="t2"]')!.dispatchEvent(new FocusEvent('focusin', { bubbles: true })); });
    expect(focusedPane()?.pane.key).toBe('t2');
    expect(host.querySelector('.has-focus')?.getAttribute('data-leaf')).toBe('b');
  });

  it('moves the window’s focus with the owner’s current leaf while the focus is in the layout', () => {
    const draw = (focusedLeaf: string) => act(() => root.render(<LayoutView layout={start} onChange={() => {}} paneTypes={paneTypes} focusedLeaf={focusedLeaf} />));
    draw('a');
    // Not in this layout yet: a new current leaf takes nothing
    draw('b');
    expect(host.querySelector('.has-focus')).toBeNull();
    act(() => { host.querySelector('[data-terminal="t2"]')!.dispatchEvent(new Event('pointerdown', { bubbles: true })); });
    // The owner opens something in a (a split, a click in its list): the focus goes there
    draw('a');
    expect(host.querySelector('.has-focus')?.getAttribute('data-leaf')).toBe('a');
    expect(focusedPane()?.pane.key).toBe('t1');
  });

  describe('panes', () => {
    /** Left panes that take turns, a document that can't close, contents that zoom. */
    let zoom = 100;
    const sidePanes: Record<string, PaneType> = {
      files: { type: 'files', title: 'Files', switchable: true, singleton: true, collapsible: true, min: { w: 200 }, render: () => <Pane title="Files"><p data-files /></Pane> },
      search: { type: 'search', title: 'Search', switchable: true, singleton: true, collapsible: true, min: { w: 200 }, render: () => <Pane title="Search"><p data-search /></Pane> },
      history: { type: 'history', title: 'History', switchable: true, singleton: true, render: () => <Pane title="History" /> },
      documents: { type: 'documents', title: 'Documents', closable: false, render: () => <div data-documents /> },
      contents: {
        type: 'contents', title: 'Contents', singleton: true,
        zoom: { get: () => zoom, step: (_c, d) => { zoom = d === 0 ? 100 : zoom + d * 10; } },
        render: () => <Pane title="Contents"><p data-contents /></Pane>,
      },
    };
    const view: LayoutNode = {
      kind: 'split', id: 'documents', dir: 'row',
      children: [
        { kind: 'leaf', id: 'left', pane: { type: 'files', key: 'files' } },
        { kind: 'leaf', id: 'main', pane: { type: 'documents', key: 'main' } },
        { kind: 'leaf', id: 'right', pane: { type: 'contents', key: 'contents' } },
      ],
      sizes: [{ px: 280 }, { fr: 1 }, { px: 220 }],
    };
    let current: LayoutNode = view;
    function Host() {
      const [layout, setLayout] = useState<Layout>({ version: 1, root: view });
      current = layout.root;
      return <LayoutView layout={layout} onChange={setLayout} paneTypes={sidePanes} />;
    }
    const menuOf = (leaf: string) => host.querySelector<HTMLButtonElement>(`[data-leaf="${leaf}"] button[aria-haspopup="menu"][aria-label$="pane menu"]`)!;
    const items = () => [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
    const choose = (label: string) => act(() => items().find((b) => b.textContent === label)!.click());
    const types = () => leaves(current).map((l) => l.pane?.type);
    /** Ctrl+wheel (happy-dom's WheelEvent drops ctrlKey). */
    const ctrlWheel = (deltaY: number) => {
      const event = new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true });
      Object.defineProperty(event, 'ctrlKey', { value: true });
      return event;
    };

    beforeEach(() => { zoom = 100; act(() => root.render(<Host />)); });

    it('offers what can be done with a pane where it is', () => {
      act(() => menuOf('left').click());
      expect(items().map((b) => `${b.textContent}${b.disabled ? ' (off)' : ''}`)).toEqual([
        'Split Right', 'Split Down', 'Join with Documents (off)'.replace(' (off)', ''), 'Swap with Documents', 'Swap with Contents', 'Close Pane',
      ].filter((label) => label !== 'Join with Documents'));
    });

    it('splits a switchable pane into one that is not shown yet, and closes it again', () => {
      act(() => menuOf('left').click());
      choose('Split Down');
      expect(types()).toEqual(['files', 'search', 'documents', 'contents']);
      expect(host.querySelector('[data-search]')).not.toBeNull();
      const search = leaves(current).find((l) => l.pane?.type === 'search')!.id;
      act(() => menuOf(search).click());
      choose('Close Pane');
      expect(types()).toEqual(['files', 'documents', 'contents']);
    });

    it('turns a switchable pane into another from its title', () => {
      act(() => host.querySelector<HTMLButtonElement>('[data-leaf="left"] .wb-pane-type')!.click());
      expect(items().map((b) => b.textContent)).toEqual(['Search', 'History']);
      choose('History');
      expect(types()).toEqual(['history', 'documents', 'contents']);
      // Contents is not switchable: a plain title
      expect(host.querySelector('[data-leaf="right"] .wb-pane-type')).toBeNull();
    });

    it('joins a neighbour that may close, and swaps any two', () => {
      act(() => menuOf('right').click());
      expect(items().some((b) => b.textContent === 'Join with Documents')).toBe(false);
      choose('Swap with Files');
      expect(types()).toEqual(['contents', 'documents', 'files']);
      // Files, now on the right, splits down into Search; Search takes its room back
      act(() => menuOf('right').click());
      choose('Split Down');
      expect(types()).toEqual(['contents', 'documents', 'files', 'search']);
      const search = leaves(current)[3].id;
      act(() => menuOf(search).click());
      choose('Join with Files');
      expect(types()).toEqual(['contents', 'documents', 'search']);
    });

    it('zooms the pane under the pointer with Ctrl+wheel and shows its zoom', () => {
      const target = host.querySelector('[data-contents]')!;
      act(() => { target.dispatchEvent(ctrlWheel(-1)); });
      expect(zoom).toBe(110);
      act(() => root.render(<Host />));
      expect(host.querySelector('[data-leaf="right"] .wb-zoom-badge')?.textContent).toBe('110%');
      act(() => host.querySelector<HTMLButtonElement>('[data-leaf="right"] .wb-zoom-badge')!.click());
      expect(zoom).toBe(100);
      // A pane without zoom leaves the wheel alone
      const plain = ctrlWheel(-1);
      act(() => { host.querySelector('[data-files]')!.dispatchEvent(plain); });
      expect(plain.defaultPrevented).toBe(false);
    });

    it('lets an inner layout zoom its own pane first', () => {
      let inner = 100;
      const innerTypes: Record<string, PaneType> = {
        group: { type: 'group', zoom: { get: () => inner, step: (_c, d) => { inner += d; } }, render: () => <p data-group /> },
      };
      const outerTypes: Record<string, PaneType> = {
        host: {
          type: 'host', zoom: { get: () => 100, step: () => { throw new Error('the outer pane zoomed'); } },
          render: () => <LayoutView layout={{ version: 1, root: { kind: 'leaf', id: 'main', pane: { type: 'group', key: 'g' } } }} onChange={() => {}} paneTypes={innerTypes} />,
        },
      };
      act(() => root.render(<LayoutView layout={{ version: 1, root: { kind: 'leaf', id: 'main', pane: { type: 'host', key: 'h' } } }} onChange={() => {}} paneTypes={outerTypes} />));
      act(() => { host.querySelector('[data-group]')!.dispatchEvent(ctrlWheel(1)); });
      expect(inner).toBe(99);
    });
  });
});
