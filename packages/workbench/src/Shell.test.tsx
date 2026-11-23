// @vitest-environment happy-dom
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Shell, ShellTools, type ShellSurface } from './index';

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

  it('has no switch with one surface', () => {
    render('documents', surfaces.slice(0, 1));
    expect(host.querySelector('[role="radiogroup"], .ui-segmented')).toBeNull();
    expect(bar()).toEqual(['Menu', 'documents start', 'documents end', 'Theme']);
  });
});
