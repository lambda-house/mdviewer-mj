// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProviderPalette } from '@lambda-house/workbench';
import { openPath } from './readerHost';
import { useStore, type FileNode } from './store';
import { useReader } from './reader';
import { filesProvider } from './documents';

// The palette's files (documents.tsx): the opened folders' files that match
// and aren't open in a tab; choosing one shows Documents and opens it.

vi.mock('./readerHost', () => ({ openPath: vi.fn(async () => {}) }));
vi.mock('./opening', () => ({ errorText: String, openFolder: vi.fn() }));

const file = (path: string): FileNode => ({ id: path, name: path.split('/').pop()!, path, displayPath: path.replace('/work/', ''), type: 'file' });

let root: Root; let host: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  useStore.setState({ files: [{ id: '/work', name: 'work', path: '/work', displayPath: '/work', type: 'directory', children: [file('/work/guide.md'), file('/work/docs/api.md'), file('/work/notes.txt')] }], surface: 'journal' });
  useReader.getState().openDocument('/work/guide.md', '# Guide');
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

const type = (text: string) => act(() => {
  const input = document.querySelector<HTMLInputElement>('.cmd-search__input')!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text);
  input.dispatchEvent(new Event('input', { bubbles: true }));
});
const rows = () => [...document.querySelectorAll('.cmd-item')].map((row) => `${row.querySelector('.cmd-item__label')?.textContent} ${row.querySelector('.cmd-item__hint')?.textContent}`);

describe('the palette’s files', () => {
  it('lists none without a query, then those that match and aren’t open', () => {
    act(() => root.render(<ProviderPalette providers={[filesProvider]} onClose={() => {}} />));
    expect(rows()).toEqual([]);
    type('md');
    expect(rows()).toEqual(['api.md docs']);
    type('notes');
    // A file at the top of a folder: its display path has no folder
    expect(rows()).toEqual(['notes.txt notes.txt']);
  });

  it('shows Documents and opens the chosen one', () => {
    act(() => root.render(<ProviderPalette providers={[filesProvider]} onClose={() => {}} />));
    type('api');
    act(() => document.querySelector<HTMLElement>('.cmd-item')!.click());
    expect(useStore.getState().surface).toBe('documents');
    expect(openPath).toHaveBeenCalledWith('/work/docs/api.md');
  });
});
