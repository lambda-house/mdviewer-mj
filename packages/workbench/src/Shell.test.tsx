// @vitest-environment happy-dom
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Shell, ShellStatus, ShellTools, ShellViews, StatusItem, type ShellSurface, type ShellView } from './index';

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
function Content({ id }: { id: string }) {
  useEffect(() => { mounts(id); }, [id]);
  return (
    <div data-surface={id}>
      <ShellTools><button>{`${id} start`}</button></ShellTools>
      <ShellTools side="end"><button>{`${id} end`}</button></ShellTools>
    </div>
  );
}

const surfaces: ShellSurface[] = [
  { id: 'documents', label: 'Documents', keepMounted: false, render: () => <Content id="documents" /> },
  { id: 'sessions', label: 'Sessions', render: () => <Content id="sessions" /> },
];

const render = (active: string, list = surfaces) =>
  act(() => root.render(<Shell surfaces={list} active={active} onActivate={() => {}} menu={<button>Menu</button>} end={<button>Theme</button>} />));

const bar = () => [...host.querySelectorAll('.wb-topbar button')].map((b) => b.textContent);

describe('Shell', () => {
  it('puts the switch, the menu, the shown surface’s tools and the end into one bar, in that order', () => {
    render('documents');
    expect(bar()).toEqual(['Documents', 'Sessions', 'Menu', 'documents start', 'documents end', 'Theme']);
    render('sessions');
    expect(bar()).toEqual(['Documents', 'Sessions', 'Menu', 'sessions start', 'sessions end', 'Theme']);
  });

  it('keeps a surface that was shown mounted and hidden, unless it asks not to be', () => {
    mounts.mockClear();
    render('sessions');
    render('documents');
    expect(host.querySelector('[data-surface="sessions"]')?.closest('.wb-surface')?.hasAttribute('hidden')).toBe(true);
    render('sessions');
    expect(host.querySelector('[data-surface="documents"]')).toBeNull();
    expect(mounts.mock.calls.map(([id]) => id)).toEqual(['sessions', 'documents']);
  });

  it('mounts a surface that was never shown only when it is', () => {
    render('documents');
    expect(host.querySelector('[data-surface="sessions"]')).toBeNull();
  });

  it('renders a surface’s tools in place outside a Shell', () => {
    act(() => root.render(<Content id="alone" />));
    expect([...host.querySelectorAll('[data-surface="alone"] button')].map((b) => b.textContent)).toEqual(['alone start', 'alone end']);
  });

  it('has no switch with one surface', () => {
    render('documents', surfaces.slice(0, 1));
    expect(host.querySelector('[role="radiogroup"], .ui-segmented')).toBeNull();
    expect(bar()).toEqual(['Menu', 'documents start', 'documents end', 'Theme']);
  });

  describe('views', () => {
    const views: ShellView[] = [
      { id: 'live', label: 'Live', keepMounted: true, render: () => <Content id="live" /> },
      { id: 'journal', label: 'Journal', keepMounted: 'always', render: () => <Content id="journal" /> },
      { id: 'board', label: 'Board', render: () => <Content id="board" /> },
    ];
    const withViews = (view: string, onChange = () => {}) => [
      surfaces[0],
      { id: 'sessions', label: 'Sessions', render: () => <ShellViews label="Sessions view" views={views} value={view} onChange={onChange} /> },
    ];
    const shown = () => [...host.querySelectorAll('.wb-view')].filter((v) => !v.hasAttribute('hidden')).map((v) => v.getAttribute('data-view'));
    const mounted = () => [...host.querySelectorAll('.wb-view')].map((v) => v.getAttribute('data-view'));

    it('puts the view switch after the menu, and only the shown view’s tools', () => {
      render('sessions', withViews('live'));
      expect(bar()).toEqual(['Documents', 'Sessions', 'Menu', 'Live', 'Journal', 'Board', 'live start', 'live end', 'Theme']);
      render('sessions', withViews('board'));
      expect(bar()).toEqual(['Documents', 'Sessions', 'Menu', 'Live', 'Journal', 'Board', 'board start', 'board end', 'Theme']);
      // Another surface shows neither the switch nor the views' tools
      render('documents', withViews('board'));
      expect(bar()).toEqual(['Documents', 'Sessions', 'Menu', 'documents start', 'documents end', 'Theme']);
    });

    it('keeps views mounted as they ask: from the start, once shown, or only while shown', () => {
      render('sessions', withViews('board'));
      expect(mounted()).toEqual(['journal', 'board']);
      expect(shown()).toEqual(['board']);
      render('sessions', withViews('live'));
      render('sessions', withViews('board'));
      expect(mounted()).toEqual(['live', 'journal', 'board']);
      render('sessions', withViews('journal'));
      expect(mounted()).toEqual(['live', 'journal']);
      expect(shown()).toEqual(['journal']);
    });

    it('switches through the app', () => {
      const onChange = vi.fn();
      render('sessions', withViews('live', onChange));
      act(() => [...host.querySelectorAll<HTMLButtonElement>('.wb-topbar button')].find((b) => b.textContent === 'Board')!.click());
      expect(onChange).toHaveBeenCalledWith('board');
    });

    it('has no switch with one view, and renders in place outside a Shell', () => {
      render('sessions', [surfaces[0], { id: 'sessions', label: 'Sessions', render: () => <ShellViews label="Sessions view" views={views.slice(0, 1)} value="live" onChange={() => {}} /> }]);
      expect(bar()).toEqual(['Documents', 'Sessions', 'Menu', 'live start', 'live end', 'Theme']);
      act(() => root.render(<ShellViews label="Sessions view" views={views} value="journal" onChange={() => {}} />));
      expect([...host.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Live', 'Journal', 'Board', 'journal start', 'journal end']);
    });
  });

  describe('status bar', () => {
    const withStatus: ShellSurface[] = [
      { id: 'documents', label: 'Documents', render: () => <ShellStatus><StatusItem>readme.md</StatusItem><StatusItem>2 KB</StatusItem></ShellStatus> },
      { id: 'sessions', label: 'Sessions', render: () => <ShellStatus side="end"><StatusItem onClick={() => {}}>Revoke</StatusItem></ShellStatus> },
      { id: 'empty', label: 'Empty', render: () => <p /> },
    ];
    const onPinnedChange = vi.fn();
    const show = (active: string, pinned = false) => act(() => root.render(
      <Shell surfaces={withStatus} active={active} onActivate={() => {}} status={{ pinned, onPinnedChange }} />,
    ));
    const status = () => host.querySelector('.wb-status')!;
    const texts = () => [...status().querySelectorAll('.wb-status__item')].map((i) => i.textContent);

    it('shows what the shown surface puts in it, and is not drawn with nothing in it', () => {
      show('documents');
      expect(texts()).toEqual(['readme.md', '2 KB']);
      show('sessions');
      expect(texts()).toEqual(['Revoke']);
      expect(status().classList.contains('is-empty')).toBe(false);
      show('empty');
      expect(texts()).toEqual([]);
      expect(status().classList.contains('is-empty')).toBe(true);
    });

    it('is pinned by the app', () => {
      show('documents', true);
      expect(status().classList.contains('is-pinned')).toBe(true);
      act(() => status().querySelector<HTMLButtonElement>('.wb-status__pin')!.click());
      expect(onPinnedChange).toHaveBeenCalledWith(false);
    });
  });
});
