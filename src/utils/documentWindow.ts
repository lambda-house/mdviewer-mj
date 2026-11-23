export const documentWindowPath = typeof window === 'undefined'
  ? null : new URLSearchParams(window.location.search).get('memoryDocument');

/** Inherit display preferences, but never share tabs or write the main workspace. */
export function documentWindowStorage(source: Pick<Storage, 'getItem'>) {
  return {
    getItem: () => {
      let preferences: Record<string, unknown> = {};
      try {
        const saved = JSON.parse(source.getItem('mdviewer-storage') || '{}').state || {};
        preferences = Object.fromEntries([
          'theme', 'tocWidth', 'tocVisible',
        ].filter(key => key in saved).map(key => [key, saved[key]]));
      } catch { /* Use the reader defaults if the saved preferences are invalid. */ }
      return JSON.stringify({ version: 5, state: {
        ...preferences, filePanelVisible: false, agentVisible: false,
        checkUpdatesOnStart: false,
      } });
    },
    setItem: () => {},
    removeItem: () => {},
  };
}

/** The reader's side of a memory window: the main window's reader settings and zoom, no tabs, nothing written. */
export function documentWindowReaderStorage(source: Pick<Storage, 'getItem'>) {
  return {
    getItem: () => {
      let settings: unknown;
      let zoom = 100;
      try {
        const saved = JSON.parse(source.getItem('mdviewer-reader') || '{}').state || {};
        settings = saved.settings;
        const group = saved.groups?.[saved.focusedGroup];
        if (typeof group?.zoom === 'number') zoom = group.zoom;
      } catch { /* Use the reader defaults if the saved preferences are invalid. */ }
      return JSON.stringify({ version: 1, state: {
        settings, editMode: false, focusedGroup: 'main', groups: { main: { id: 'main', zoom, tabs: [], activeTabId: null } },
      } });
    },
    setItem: () => {},
    removeItem: () => {},
  };
}
