// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentGroups, DocumentPanel, ReaderProvider, createReaderStore, highlightCode, newGroup, type Reader, type ReaderHost } from './index';

let host: HTMLDivElement;
let root: Root;

// Shiki loads its grammars once, which takes seconds on a busy machine: that is
// the setup's time, not the first test's
beforeAll(async () => { await highlightCode('const a = 1;', 'ts'); }, 60_000);

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

function fakeReader(): Reader & { host: ReaderHost & { [K in 'openPath' | 'followLocalLink' | 'openExternal']: ReturnType<typeof vi.fn> } } {
  const store = createReaderStore({ storage: null, name: 'test' });
  return {
    store,
    host: {
      readFile: vi.fn(async () => ''),
      writeFile: vi.fn(async () => {}),
      saveAs: vi.fn(async () => {}),
      openPath: vi.fn(async () => {}),
      followLocalLink: vi.fn(async () => 'open' as const),
      openExternal: vi.fn(async () => {}),
    },
  };
}

const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

describe('DocumentPanel', () => {
  it('shows a group’s document, and says what to do when it has none', async () => {
    const reader = fakeReader();
    await act(async () => root.render(<ReaderProvider reader={reader}><DocumentPanel empty={<p>Open something</p>} /></ReaderProvider>));
    expect(host.textContent).toContain('Open something');
    act(() => { reader.store.getState().openDocument('/docs/a.md', '# Hello\n\nText'); });
    await flush();
    expect(host.querySelector('.markdown-body h1')?.textContent).toContain('Hello');
    expect(host.querySelector('.document-panel')?.getAttribute('data-group')).toBe('main');
    expect(reader.store.getState().groups.main.headings.map((h) => h.text)).toEqual(['Hello']);
  });

  it('opens a link relative to the document it is in, through the host, in its own group', async () => {
    const reader = fakeReader();
    reader.store.setState((s) => ({ groups: { ...s.groups, side: newGroup('side') } }));
    reader.store.getState().openDocument('/docs/a.md', '[next](sub/next.md) [web](https://example.com)', { group: 'side' });
    await act(async () => root.render(<ReaderProvider reader={reader}><DocumentPanel group="side" /></ReaderProvider>));
    await flush();
    const links = host.querySelectorAll<HTMLAnchorElement>('.markdown-body a');
    await act(async () => { links[0].click(); });
    expect(reader.host.followLocalLink).toHaveBeenCalledWith('/docs/sub/next.md');
    expect(reader.host.openPath).toHaveBeenCalledWith('/docs/sub/next.md');
    expect(reader.store.getState().focusedGroup).toBe('side');
    await act(async () => { links[1].click(); });
    expect(reader.host.openExternal).toHaveBeenCalledWith('https://example.com');
  });

  it('zooms per group', async () => {
    const reader = fakeReader();
    reader.store.getState().openDocument('/a.md', 'text');
    reader.store.getState().setZoom(150);
    await act(async () => root.render(<ReaderProvider reader={reader}><DocumentPanel /></ReaderProvider>));
    await flush();
    expect((host.querySelector('.markdown-body') as HTMLElement).style.zoom).toBe('1.5');
  });

  it('shows the groups side by side; a split keeps the first group mounted and focuses the new one', async () => {
    const reader = fakeReader();
    reader.store.getState().openDocument('/a.md', '# A');
    await act(async () => root.render(<ReaderProvider reader={reader}><DocumentGroups /></ReaderProvider>));
    await flush();
    const first = host.querySelector('.document-panel[data-group="main"]');

    let id = '';
    await act(async () => { id = reader.store.getState().splitGroup(); });
    await flush();
    const panels = [...host.querySelectorAll('.document-panel')].map((p) => p.getAttribute('data-group'));
    expect(panels).toEqual(['main', id]);
    expect(host.querySelector('.document-panel[data-group="main"]')).toBe(first);
    expect(host.querySelector('.wb-leaf.is-focused .document-panel')?.getAttribute('data-group')).toBe(id);
    expect(host.querySelectorAll('.markdown-body h1')).toHaveLength(2);

    // A click in the other group focuses it
    await act(async () => { first?.querySelector('.markdown-body')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); });
    expect(reader.store.getState().focusedGroup).toBe('main');
    // …and it has the window's focus line
    expect(host.querySelector('.wb-leaf.has-focus .document-panel')?.getAttribute('data-group')).toBe('main');
  });
});
