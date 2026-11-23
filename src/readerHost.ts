import { getFileName, type Reader, type ReaderHost } from '@lambda-house/reader';
import { appendToHistory, followLocalLink, openExternal, openInExplorer, readFile, readSnapshot, saveFile, writeFile } from './utils/tauri';
import { markAgentFilesRead } from './utils/agent';
import { useStore } from './store';
import { useReader } from './reader';

// The reader's host in MDViewer: Tauri for files, links and the save dialog;
// the app store for the agent documents whose reads are tracked.

/**
 * Open a file in a tab of the focused group (the file tree, history, drops,
 * links): read it, select it in the tree and log it in the history.
 */
export async function openPath(path: string, options?: { preview?: boolean }): Promise<void> {
  const content = await readFile(path);
  const result = useReader.getState().openDocument(path, content, options);
  if (!result.success) throw new Error(result.error || 'Failed to open document');
  useStore.getState().setSelectedPath(path);
  appendToHistory(path, getFileName(path)).catch((err) => {
    console.error('Failed to log to history:', err);
  });
}

// The Tauri functions are looked up when called, not when this module loads
// (tests replace that module with only what they use).
export const readerHost: ReaderHost = {
  readFile: (path) => readFile(path),
  writeFile: (path, content) => writeFile(path, content),
  saveAs: async (name, content, filters, title) => { await saveFile(name, content, filters, title); },
  openPath,
  followLocalLink: (path) => followLocalLink(path),
  openExternal: (url) => openExternal(url),
  revealInFolder: (path) => openInExplorer(path),
  changes: {
    // Agent documents (the app store's agent entries)
    useIsTracked: (path) => useStore((s) => s.agentEntries.some((e) => e.path === path)),
    readSnapshot: (path) => readSnapshot(path),
    markRead: (paths) => markAgentFilesRead(paths),
  },
};

export const reader: Reader = { store: useReader, host: readerHost };
