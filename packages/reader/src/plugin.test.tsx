// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PluginRegistry, Workbench } from '@lambda-house/workbench';
import { allTabs, createReaderStore, focusedGroupOf, readerCommands, readerPlugin, reloadChangedDocuments, type Reader, type ReaderPluginOptions } from './index';

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

function fakeReader(files: Record<string, string> = {}): Reader {
  return {
    store: createReaderStore({ storage: null, name: 'test' }),
    host: {
      readFile: vi.fn(async (path: string) => {
        if (!(path in files)) throw new Error(`No ${path}`);
        return files[path];
      }),
      writeFile: vi.fn(async () => {}),
      saveAs: vi.fn(async () => {}),
      openPath: vi.fn(async () => {}),
      followLocalLink: vi.fn(async () => 'open' as const),
      openExternal: vi.fn(async () => {}),
    },
  };
}

const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

async function mount(reader: Reader, options: ReaderPluginOptions = {}) {
  const registry = new PluginRegistry();
  registry.register(readerPlugin(reader, options));
  await act(async () => root.render(
    <Workbench registry={registry} surface="documents" onSurface={() => {}} menu={[]} commandContext={() => null} useCommandContext={() => null} settings={{ open: false, onOpenChange: () => {} }} />,
  ));
  await flush();
  return registry;
}

describe('readerPlugin', () => {
  it('brings the documents and contents panes of its view, its Settings tab and its dialogs; it is always on', async () => {
    const registry = await mount(fakeReader(), { view: 'docs' });
    expect(registry.items('workbench:pane-type').map((p) => `${p.view}:${p.type.type}`)).toEqual(['docs:documents', 'docs:contents']);
    expect(registry.items('workbench:settings-tab').map((t) => t.label)).toEqual(['Documents']);
    expect(registry.items('workbench:overlay').map((o) => o.id)).toEqual(['reader', 'reader-save-all', 'reader-close-document']);
    expect(registry.listPlugins()[0].required).toBe(true);
  });

  it('reads the saved tabs’ documents back once each, and drops a tab whose file is gone', async () => {
    // The last run kept its tabs (paths only); this one starts from them
    const saved: Record<string, string> = {};
    const storage = { getItem: (key: string) => saved[key] ?? null, setItem: (key: string, value: string) => { saved[key] = value; }, removeItem: (key: string) => { delete saved[key]; } };
    const last = createReaderStore({ storage, name: 'saved' });
    last.getState().openDocument('/a.md', 'old');
    last.getState().openDocument('/b.md', 'old');
    last.getState().openDocument('/gone.md', 'old');
    last.getState().splitGroup(undefined, 'row');
    const reader = { ...fakeReader({ '/a.md': '# A, read again', '/b.md': '# B' }), store: createReaderStore({ storage, name: 'saved' }) };
    const state = () => reader.store.getState();
    expect(Object.keys(state().documents)).toEqual([]);
    await mount(reader, { restore: true });
    const reads = vi.mocked(reader.host.readFile).mock.calls.map(([path]) => path).sort();
    expect(reads).toEqual(['/a.md', '/b.md', '/gone.md']);
    expect(state().sessionRestored).toBe(true);
    expect(state().documents['/a.md'].content).toBe('# A, read again');
    expect(allTabs(state()).some((tab) => tab.path === '/gone.md')).toBe(false);
  });

  it('reads nothing back unless asked to restore the tabs', async () => {
    const reader = fakeReader({ '/a.md': '# A' });
    reader.store.getState().openDocument('/a.md', 'old');
    await mount(reader);
    expect(reader.host.readFile).not.toHaveBeenCalled();
    expect(reader.store.getState().sessionRestored).toBe(true);
  });

  it('opens a reader window’s one document once started', async () => {
    const reader = fakeReader();
    await mount(reader, { windowDocument: '/memory/MEMORY.md' });
    expect(reader.host.openPath).toHaveBeenCalledWith('/memory/MEMORY.md');
  });

  it('goes to a tab with Mod+1…9, and back with the mouse’s side button', async () => {
    const reader = fakeReader();
    await mount(reader);
    const state = () => reader.store.getState();
    act(() => { state().openDocument('/a.md', 'a'); state().openDocument('/b.md', 'b'); });
    const press = new KeyboardEvent('keydown', { key: '1', ctrlKey: true, bubbles: true, cancelable: true });
    act(() => { window.dispatchEvent(press); });
    expect(press.defaultPrevented).toBe(true);
    const active = () => focusedGroupOf(state()).tabs.find((tab) => tab.id === focusedGroupOf(state()).activeTabId)?.path;
    expect(active()).toBe('/a.md');
    act(() => { window.dispatchEvent(new MouseEvent('mouseup', { button: 3, bubbles: true, cancelable: true })); });
    expect(active()).toBe('/b.md');
  });

  it('asks before the window closes with unsaved edits, and closes it if told to', async () => {
    const reader = fakeReader();
    let send: (request: { preventDefault(): void; close(): Promise<void> }) => Promise<void> = async () => {};
    const stop = vi.fn();
    await mount(reader, { confirmClose: { name: 'The App', onCloseRequested: async (handler) => { send = handler; return stop; } } });
    const request = () => ({ preventDefault: vi.fn(), close: vi.fn(async () => {}) });
    // happy-dom has no confirm()
    const confirm = vi.fn((_message?: string) => false);
    window.confirm = confirm;

    // Nothing unsaved: the window closes as it would
    act(() => { reader.store.getState().openDocument('/a.md', 'a'); });
    const clean = request();
    await send(clean);
    expect(clean.preventDefault).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();

    act(() => { reader.store.getState().updateDocumentContent('/a.md', 'a, edited'); });
    confirm.mockReturnValueOnce(false);
    const kept = request();
    await send(kept);
    expect(kept.preventDefault).toHaveBeenCalled();
    expect(confirm).toHaveBeenCalledWith('Unsaved changes in a.md. Close The App and discard them?');
    expect(kept.close).not.toHaveBeenCalled();

    confirm.mockReturnValueOnce(true);
    const closed = request();
    await send(closed);
    expect(closed.close).toHaveBeenCalled();

    Reflect.deleteProperty(window, 'confirm');
    act(() => root.unmount());
    expect(stop).toHaveBeenCalled();
    root = createRoot(host);
  });
});

describe('the reader beside the plugin', () => {
  it('reopens a closed tab through the app, which reads the file again', () => {
    const reader = fakeReader();
    const state = () => reader.store.getState();
    state().openDocument('/a.md', 'a');
    state().closeDocument(focusedGroupOf(state()).activeTabId!);
    const { reopenClosedTab } = readerCommands(reader);
    expect(reopenClosedTab.enabled?.(null)).toBe(true);
    reopenClosedTab.run();
    expect(reader.host.openPath).toHaveBeenCalledWith('/a.md');
    expect(reopenClosedTab.enabled?.(null)).toBe(false);
  });

  it('reloads the documents a program changed, by file name, but not one with unsaved edits', async () => {
    const reader = fakeReader({ '/x/a.md': 'a, changed', '/x/b.md': 'b, changed' });
    const state = () => reader.store.getState();
    state().openDocument('/x/a.md', 'a');
    state().openDocument('/x/b.md', 'b');
    state().updateDocumentContent('/x/b.md', 'b, edited');
    expect(state().documents['/x/b.md'].isDirty).toBe(true);
    await reloadChangedDocuments(reader, ['a.md', 'b.md']);
    expect(state().documents['/x/a.md'].content).toBe('a, changed');
    expect(state().documents['/x/b.md'].content).toBe('b, edited');
    expect(reader.host.readFile).toHaveBeenCalledTimes(1);
  });
});
