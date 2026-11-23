import { describe, expect, it } from 'vitest';
import {
  MAIN_GROUP, activeDocumentOf, activeTabOf, allTabs, canNavigateBack, canNavigateForward, createReaderStore, focusedGroupOf,
  newGroup, scrollKey, type ReaderStore,
} from './index';

const memory = (initial: Record<string, string> = {}) => {
  const data: Record<string, string> = { ...initial };
  return { data, getItem: (key: string) => data[key] ?? null, setItem: (key: string, value: string) => { data[key] = value; }, removeItem: (key: string) => { delete data[key]; } };
};

const fresh = (): ReaderStore => createReaderStore({ storage: null, name: 'test-reader' });
const main = (store: ReaderStore) => store.getState().groups[MAIN_GROUP];
const paths = (store: ReaderStore, group = MAIN_GROUP) => store.getState().groups[group].tabs.map((t) => t.path);
const activePath = (store: ReaderStore, group = MAIN_GROUP) => activeTabOf(store.getState().groups[group])?.path ?? null;

/** A second group beside the main one, as a split will make. */
function addGroup(store: ReaderStore, id: string) {
  store.setState((s) => ({ groups: { ...s.groups, [id]: newGroup(id) } }));
}

describe('reader store: tabs', () => {
  it('opens a document once, activating it when opened again', () => {
    const store = fresh();
    store.getState().openDocument('/a.md', '# A');
    store.getState().openDocument('/b.md', '# B');
    store.getState().openDocument('/a.md', 'ignored');
    expect(paths(store)).toEqual(['/a.md', '/b.md']);
    expect(activePath(store)).toBe('/a.md');
    expect(store.getState().documents['/a.md'].content).toBe('# A');
  });

  it('reuses the preview tab for the next preview, and pins it on a permanent open', () => {
    const store = fresh();
    store.getState().openDocument('/a.md', 'a', { preview: true });
    store.getState().openDocument('/b.md', 'b', { preview: true });
    expect(paths(store)).toEqual(['/b.md']);
    expect(store.getState().documents['/a.md']).toBeUndefined();
    store.getState().openDocument('/b.md', 'b');
    expect(main(store).tabs[0].isPreview).toBe(false);
    store.getState().openDocument('/c.md', 'c', { preview: true });
    expect(paths(store)).toEqual(['/b.md', '/c.md']);
  });

  it('closes a tab: the neighbour to the right takes over, the tab can be reopened', () => {
    const store = fresh();
    for (const p of ['/a.md', '/b.md', '/c.md']) store.getState().openDocument(p, p);
    store.getState().setActiveTab(main(store).tabs[1].id);
    store.getState().closeDocument(main(store).tabs[1].id);
    expect(paths(store)).toEqual(['/a.md', '/c.md']);
    expect(activePath(store)).toBe('/c.md');
    expect(store.getState().documents['/b.md']).toBeUndefined();
    expect(store.getState().reopenClosedTab()?.path).toBe('/b.md');
    expect(store.getState().reopenClosedTab()).toBeNull();
  });

  it('asks before closing a document with unsaved changes, and keeps it in a bulk close', () => {
    const store = fresh();
    store.getState().openDocument('/a.md', 'a');
    store.getState().openDocument('/b.md', 'b');
    store.getState().updateDocumentContent('/a.md', 'a!');
    const a = main(store).tabs[0];
    expect(a.isDirty).toBe(true);
    store.getState().closeDocument(a.id);
    expect(store.getState().pendingCloseTabId).toBe(a.id);
    store.getState().cancelCloseDocument();
    expect(paths(store)).toEqual(['/a.md', '/b.md']);
    expect(store.getState().closeAllTabs()).toEqual({ success: false, error: 'Kept 1 tab(s) with unsaved changes: a.md' });
    expect(paths(store)).toEqual(['/a.md']);
    store.getState().closeDocument(a.id);
    store.getState().confirmCloseDocument();
    expect(paths(store)).toEqual([]);
  });

  it('marks a saved document clean, but keeps edits made while it was written', () => {
    const store = fresh();
    store.getState().openDocument('/a.md', 'a');
    store.getState().updateDocumentContent('/a.md', 'ab');
    store.getState().updateDocumentContent('/a.md', 'abc');
    store.getState().saveDocument('/a.md', 'ab');
    expect(store.getState().documents['/a.md'].isDirty).toBe(true);
    store.getState().saveDocument('/a.md');
    expect([store.getState().documents['/a.md'].isDirty, main(store).tabs[0].isDirty]).toEqual([false, false]);
  });

  it('reloads a changed file unless it has unsaved edits', () => {
    const store = fresh();
    store.getState().openDocument('/a.md', 'a');
    expect(store.getState().reloadDocument('/a.md', 'a2')).toBe(true);
    store.getState().updateDocumentContent('/a.md', 'mine');
    expect(store.getState().reloadDocument('/a.md', 'a3')).toBe(false);
    expect(store.getState().documents['/a.md'].content).toBe('mine');
  });

  it('goes back and forward through the tabs shown', () => {
    const store = fresh();
    for (const p of ['/a.md', '/b.md', '/c.md']) store.getState().openDocument(p, p);
    expect(canNavigateForward(main(store))).toBe(false);
    store.getState().navigateBack();
    expect(activePath(store)).toBe('/b.md');
    store.getState().navigateBack();
    expect(activePath(store)).toBe('/a.md');
    expect(canNavigateBack(main(store))).toBe(false);
    store.getState().navigateForward();
    expect(activePath(store)).toBe('/b.md');
    // A new activation drops the forward entries
    store.getState().setActiveTab(main(store).tabs[0].id);
    expect(canNavigateForward(main(store))).toBe(false);
  });

  it('restores the previous session: tabs whose file was read, with the active one kept', () => {
    const store = fresh();
    for (const p of ['/a.md', '/b.md']) store.getState().openDocument(p, p);
    store.setState({ documents: {} });
    store.getState().restoreSession([{ path: '/b.md', content: 'B' }]);
    expect(paths(store)).toEqual(['/b.md']);
    expect(activePath(store)).toBe('/b.md');
    expect(store.getState().documents['/b.md'].content).toBe('B');
    expect(store.getState().sessionRestored).toBe(true);
  });

  it('replaces a group’s tabs with a workspace’s', () => {
    const store = fresh();
    store.getState().openDocument('/a.md', 'a');
    store.getState().replaceTabs(['/x.md', '/y.md'], '/y.md');
    expect(paths(store)).toEqual(['/x.md', '/y.md']);
    expect(activePath(store)).toBe('/y.md');
    expect(store.getState().documents).toEqual({});
  });
});

describe('reader store: groups', () => {
  it('shares a document between groups; closing it in one keeps it, and its edits, in the other', () => {
    const store = fresh();
    addGroup(store, 'side');
    store.getState().openDocument('/a.md', 'a');
    store.getState().openDocument('/a.md', 'a', { group: 'side' });
    store.getState().updateDocumentContent('/a.md', 'a!');
    expect(allTabs(store.getState()).map((t) => t.isDirty)).toEqual([true, true]);
    // Not the last view of it: no question
    store.getState().closeDocument(main(store).tabs[0].id);
    expect(store.getState().pendingCloseTabId).toBeNull();
    expect(store.getState().documents['/a.md'].content).toBe('a!');
    expect(paths(store, 'side')).toEqual(['/a.md']);
  });

  it('gives each group its own zoom, find and contents; actions without a group act on the focused one', () => {
    const store = fresh();
    addGroup(store, 'side');
    store.getState().zoomIn();
    store.getState().focusGroup('side');
    store.getState().setZoom(200);
    store.getState().openFind('needle');
    store.getState().setHeadings([{ id: 'h', text: 'H', level: 1 }]);
    const { groups } = store.getState();
    expect([groups.main.zoom, groups.side.zoom]).toEqual([110, 200]);
    expect([groups.main.find.open, groups.side.find.open, groups.side.find.query]).toEqual([false, true, 'needle']);
    expect([groups.main.headings.length, groups.side.headings.length]).toEqual([0, 1]);
    expect(focusedGroupOf(store.getState()).id).toBe('side');
  });

  it('keeps scroll positions per group and document', () => {
    const store = fresh();
    addGroup(store, 'side');
    store.getState().openDocument('/a.md', 'a');
    store.getState().openDocument('/a.md', 'a', { group: 'side' });
    store.getState().setScrollPosition('main', '/a.md', 10);
    store.getState().setScrollPosition('side', '/a.md', 90);
    expect([store.getState().getScrollPosition('main', '/a.md'), store.getState().getScrollPosition('side', '/a.md')]).toEqual([10, 90]);
    expect(activeDocumentOf(store.getState())?.path).toBe('/a.md');
  });
});

describe('reader store: saved state', () => {
  it('saves tabs, zoom, scroll positions and settings, not documents', () => {
    const storage = memory();
    const store = createReaderStore({ storage, name: 'r' });
    store.getState().openDocument('/a.md', 'secret text');
    store.getState().setZoom(150);
    store.getState().setScrollPosition('main', '/a.md', 42);
    store.getState().setSettings({ smoothScroll: false });
    expect(storage.data.r).not.toContain('secret text');

    const again = createReaderStore({ storage, name: 'r' });
    expect(paths(again)).toEqual(['/a.md']);
    expect(activePath(again)).toBe('/a.md');
    expect(main(again).zoom).toBe(150);
    expect(again.getState().scroll[scrollKey('main', '/a.md')]).toBe(42);
    expect(again.getState().settings.smoothScroll).toBe(false);
    expect(again.getState().settings.languageAliases.sc).toBe('scala');
    expect(again.getState().documents).toEqual({});
    expect(again.getState().sessionRestored).toBe(false);
  });

  it('takes the app’s old saved tabs on its first run, and only then', () => {
    const storage = memory();
    const legacy = () => ({
      tabs: [{ path: '/old.md', title: 'old.md' }, { id: 't2', path: '/two.md' }],
      activeTabId: 't2',
      scrollPositions: { '/two.md': 7 },
      zoom: 120,
      editMode: true,
      settings: { loadRemoteImages: true },
    });
    const first = createReaderStore({ storage, name: 'r', legacy });
    expect(paths(first)).toEqual(['/old.md', '/two.md']);
    expect(activePath(first)).toBe('/two.md');
    expect(first.getState().scroll[scrollKey('main', '/two.md')]).toBe(7);
    expect([main(first).zoom, first.getState().editMode, first.getState().settings.loadRemoteImages]).toEqual([120, true, true]);
    first.getState().closeAllTabs();
    const second = createReaderStore({ storage, name: 'r', legacy });
    expect(paths(second)).toEqual([]);
  });
});
