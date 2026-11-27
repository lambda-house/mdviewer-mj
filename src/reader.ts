import { createReaderStore, type LegacyReaderState, type ReaderSettings } from '@lambda-house/reader';
import { documentWindowPath, documentWindowReaderStorage } from './utils/documentWindow';

// MDViewer's reader store (@lambda-house/reader), kept in localStorage under
// `mdviewer-reader`; its host is in readerHost.ts. The app store imports this
// module, and this module imports nothing of the app's that does, so the
// reader always takes its first state from the app's old saved state before
// the app store rewrites it.

/** The app store's key: tabs, zoom and the reader settings were kept there before. */
const APP_STORAGE = 'mdviewer-storage';
/** Text colour default before 1.0.3, replaced by the new default if never changed. */
const LEGACY_MARKDOWN_TEXT_COLOR = '#cccccc';
const SETTINGS: (keyof ReaderSettings)[] = ['smoothScroll', 'loadRemoteImages', 'markdownTextColor', 'markdownTextColorLight', 'languageAliases', 'searchOptions'];

/** What the app store saved before the reader had its own store. */
export function legacyReaderState(source: Pick<Storage, 'getItem'>): LegacyReaderState | null {
  try {
    const saved = JSON.parse(source.getItem(APP_STORAGE) || 'null') as { state?: Record<string, unknown>; version?: number } | null;
    const state = saved?.state;
    if (!state) return null;
    const settings = Object.fromEntries(SETTINGS.filter((key) => key in state).map((key) => [key, state[key]])) as Partial<ReaderSettings>;
    if ((saved.version ?? 0) < 3 && settings.markdownTextColor?.toLowerCase() === LEGACY_MARKDOWN_TEXT_COLOR) delete settings.markdownTextColor;
    return {
      tabs: state.tabs,
      activeTabId: state.activeTabId,
      scrollPositions: state.scrollPositions as LegacyReaderState['scrollPositions'],
      zoom: typeof state.zoom === 'number' ? state.zoom : undefined,
      editMode: state.editMode === true,
      settings,
    };
  } catch {
    return null;
  }
}

export const READER_STORAGE = 'mdviewer-reader';

/** Not in tests that run without a DOM. */
const browserStorage = typeof localStorage === 'undefined' ? null : localStorage;

export const useReader = createReaderStore({
  storage: browserStorage && (documentWindowPath ? documentWindowReaderStorage(browserStorage) : browserStorage),
  name: READER_STORAGE,
  legacy: documentWindowPath || !browserStorage ? undefined : () => legacyReaderState(browserStorage),
});
