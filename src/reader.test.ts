// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { activeTabOf, focusedGroupOf, scrollKey } from '@lambda-house/reader';

/** The app store as version 1.1 saved it: tabs, zoom and reader settings in it. */
const OLD_APP_STATE = {
  version: 4,
  state: {
    tabs: [{ id: 't1', path: '/a.md', title: 'a.md' }, { id: 't2', path: '/b.md', title: 'b.md' }],
    activeTabId: 't2',
    scrollPositions: { '/b.md': 12 },
    zoom: 130,
    smoothScroll: false,
    languageAliases: { sc: 'scala' },
    directories: ['/work'],
    theme: 'light',
  },
};

describe('the reader takes over the old saved tabs', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('mdviewer-storage', JSON.stringify(OLD_APP_STATE));
    vi.resetModules();
  });

  const check = async () => {
    const { useStore } = await import('./store');
    const { useReader } = await import('./reader');
    const reader = useReader.getState();
    const group = focusedGroupOf(reader);
    expect(group.tabs.map((t) => t.path)).toEqual(['/a.md', '/b.md']);
    expect(activeTabOf(group)?.path).toBe('/b.md');
    expect(group.zoom).toBe(130);
    expect(reader.scroll[scrollKey(group.id, '/b.md')]).toBe(12);
    expect(reader.settings.smoothScroll).toBe(false);
    expect(reader.settings.languageAliases).toEqual({ sc: 'scala' });
    expect(reader.theme).toBe('light');
    // The app keeps its own part, and saves it without the reader's
    expect(useStore.getState().directories).toEqual(['/work']);
    const app = JSON.parse(localStorage.getItem('mdviewer-storage') as string);
    expect(app.version).toBe(6);
    // and keeps its panels as the Documents layout
    expect(app.state.documentsLayout?.kind).toBe('split');
    expect(app.state.panelWidth).toBeUndefined();
    expect([app.state.tabs, app.state.zoom, app.state.smoothScroll]).toEqual([undefined, undefined, undefined]);
    expect(JSON.parse(localStorage.getItem('mdviewer-reader') as string).state.groups.main.tabs).toHaveLength(2);
  };

  it('when the app store loads first', check);

  it('when the reader loads first', async () => {
    await import('./reader');
    await check();
  });
});
