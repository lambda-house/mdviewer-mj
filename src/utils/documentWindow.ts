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
          'theme', 'zoom', 'markdownTextColor', 'markdownTextColorLight',
          'smoothScroll', 'loadRemoteImages', 'languageAliases', 'tocWidth', 'tocVisible',
        ].filter(key => key in saved).map(key => [key, saved[key]]));
      } catch { /* Use the reader defaults if the saved preferences are invalid. */ }
      return JSON.stringify({ version: 4, state: {
        ...preferences, filePanelVisible: false, agentVisible: false,
        checkUpdatesOnStart: false, editMode: false,
      } });
    },
    setItem: () => {},
    removeItem: () => {},
  };
}
