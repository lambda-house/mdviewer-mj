import { useEffect, type ReactNode } from 'react';
import { FileText, List } from 'lucide-react';
import { useStore } from 'zustand';
import type { PaneZoom, Plugin } from '@lambda-house/workbench';
import { ReaderProvider, useReaderContext, type Reader } from './host';
import { DocumentGroups } from './DocumentGroups';
import { Contents, CONTENTS_MAX_WIDTH, CONTENTS_MIN_WIDTH } from './Contents';
import { CloseDocumentDialog, SaveAllDialog } from './SaveAllDialog';
import { readerSettingsTab } from './ReaderSettings';
import { allTabs, type RestoredDocument } from './store';
import { getFileName } from './files';
import { openTabsProvider } from './palette';

// The reader as a workbench plugin (shared UI spec §5.7): what it brings to
// the window. Its provider; the `documents` and `contents` panes of a view;
// its Settings tab; its dialogs; the open tabs in the palette, if asked;
// and what it does on its own: read the saved
// tabs' documents back, open a reader window's one document, go back and
// forward with the mouse's side buttons, Mod+1…9 to a tab, ask before the
// window closes with unsaved edits.

/** A request to close the window, which the reader may hold. */
export interface CloseRequest {
  /** The window stays open. */
  preventDefault(): void;
  /** Close it after all, once held. */
  close(): Promise<void>;
}

export interface ReaderPluginOptions {
  /** The view whose layout shows the document groups and the contents ('documents'). */
  view?: string;
  /** What an empty document group shows: how to open a document here. */
  empty?: ReactNode;
  /** The contents pane: its zoom, where the app keeps it, and how its close button hides it. */
  contents?: { zoom?: PaneZoom; onClose?: () => void };
  /** Read the saved tabs' documents back at start (the main window); otherwise start without tabs. */
  restore?: boolean;
  /** A reader window for one document: open it once started, and reload the documents when the window gets the focus. */
  windowDocument?: string | null;
  /**
   * Closing the window with unsaved edits asks first. `name` is the app's, in
   * the question; `onCloseRequested` gives the window's close requests to the
   * reader and returns how to stop.
   */
  confirmClose?: { name: string; onCloseRequested: (onClose: (request: CloseRequest) => Promise<void>) => Promise<() => void> };
  /** The palette lists the open tabs; choosing one calls `show` first (to bring up the surface the documents are on). */
  openTabs?: { show?: () => void };
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return String(error);
}

/**
 * Reload the open documents an outside program changed (unless they have
 * unsaved edits). Matched by file name: a watcher reports real paths, which
 * can differ from the path a document was opened under (symlinks, /private).
 */
export async function reloadChangedDocuments(reader: Reader, names: string[]): Promise<void> {
  if (names.length === 0) return;
  const changed = new Set(names);
  const { documents, reloadDocument } = reader.store.getState();
  await Promise.all(Object.values(documents)
    .filter((doc) => !doc.isDirty && changed.has(getFileName(doc.path)))
    .map(async (doc) => {
      try {
        reloadDocument(doc.path, await reader.host.readFile(doc.path));
      } catch {
        // Removed or renamed: the tab keeps the last text
      }
    }));
}

/** What the reader does on its own while the window is open; it draws nothing. */
function ReaderEffects({ restore, windowDocument, confirmClose }: Pick<ReaderPluginOptions, 'restore' | 'windowDocument' | 'confirmClose'>) {
  const reader = useReaderContext();
  const { store, host } = reader;
  const restored = useStore(store, (s) => s.sessionRestored);

  // The saved tabs carry only paths: their documents are read back before the tabs can be used
  useEffect(() => {
    let cancelled = false;
    const tabs = allTabs(store.getState());
    if (!restore || tabs.length === 0) {
      store.getState().restoreSession([]);
      return;
    }
    // A file open in two groups is read once
    const paths = [...new Set(tabs.map((tab) => tab.path))];
    void Promise.all(paths.map(async (path): Promise<RestoredDocument | null> => {
      try {
        return { path, content: await host.readFile(path) };
      } catch (error) {
        console.warn(`Dropping restored tab (cannot read ${path}):`, error);
        return null;
      }
    })).then((documents) => {
      if (!cancelled) store.getState().restoreSession(documents.filter((doc): doc is RestoredDocument => doc !== null));
    });
    return () => { cancelled = true; };
  }, [store, host, restore]);

  // A reader window opens its one document, and reloads what changed when it gets the focus
  useEffect(() => {
    if (!windowDocument || !restored) return;
    host.openPath(windowDocument).catch((error) => alert(`Could not open memory:\n${errorText(error)}`));
    const refresh = () => {
      void reloadChangedDocuments(reader, Object.values(store.getState().documents).map((doc) => getFileName(doc.path)));
    };
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [windowDocument, restored]);

  // The mouse's side buttons go back and forward in the focused group
  useEffect(() => {
    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 3) {
        e.preventDefault();
        store.getState().navigateBack();
      } else if (e.button === 4) {
        e.preventDefault();
        store.getState().navigateForward();
      }
    };
    window.addEventListener('mouseup', onMouseUp);
    return () => window.removeEventListener('mouseup', onMouseUp);
  }, [store]);

  // Closing the window with unsaved edits asks first
  useEffect(() => {
    if (!confirmClose) return;
    let stop: (() => void) | undefined;
    let disposed = false;
    confirmClose.onCloseRequested(async (request) => {
      const dirty = allTabs(store.getState()).filter((t) => t.isDirty);
      if (dirty.length === 0) return;
      request.preventDefault();
      const names = dirty.map((t) => t.title).join(', ');
      if (window.confirm(`Unsaved changes in ${names}. Close ${confirmClose.name} and discard them?`)) await request.close();
    })
      .then((unlisten) => {
        if (disposed) unlisten();
        else stop = unlisten;
      })
      .catch((error) => console.error('Failed to watch window close:', error));
    return () => {
      disposed = true;
      stop?.();
    };
  }, [store, confirmClose]);

  // Mod+1…9: the focused group's tab at that place
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !(e.metaKey || e.ctrlKey) || !/^[1-9]$/.test(e.key)) return;
      e.preventDefault();
      store.getState().activateTabByIndex(Number(e.key) - 1);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [store]);

  return null;
}

/** The reader's part of the window. Always on: an app's documents depend on it. */
export function readerPlugin(reader: Reader, options: ReaderPluginOptions = {}): Plugin {
  const view = options.view ?? 'documents';
  return {
    id: 'reader',
    name: 'Reader',
    description: 'Markdown documents in tabs and groups side by side: find, contents, the editor.',
    required: true,
    setup(api) {
      api.contribute('workbench:wrapper', { id: 'reader', order: 10, wrap: (children) => <ReaderProvider reader={reader}>{children}</ReaderProvider> });
      api.contribute('workbench:pane-type', {
        view,
        type: {
          type: 'documents', label: 'document', title: 'Documents', icon: <FileText size={14} />, singleton: true, closable: false, keepAlive: true, min: { w: 200 },
          render: () => <DocumentGroups empty={options.empty} />,
        },
      });
      api.contribute('workbench:pane-type', {
        view,
        type: {
          type: 'contents', label: 'table of contents', title: 'Contents', icon: <List size={14} />, singleton: true, collapsible: true,
          min: { w: CONTENTS_MIN_WIDTH }, max: { w: CONTENTS_MAX_WIDTH }, zoom: options.contents?.zoom,
          render: () => <Contents onClose={options.contents?.onClose} />,
        },
      });
      api.contribute('workbench:settings-tab', readerSettingsTab());
      if (options.openTabs) api.contribute('workbench:palette-provider', openTabsProvider(reader, options.openTabs.show));
      api.contribute('workbench:overlay', {
        id: 'reader',
        render: () => <ReaderEffects restore={options.restore} windowDocument={options.windowDocument} confirmClose={options.confirmClose} />,
      });
      api.contribute('workbench:overlay', { id: 'reader-save-all', render: () => <SaveAllDialog /> });
      api.contribute('workbench:overlay', { id: 'reader-close-document', render: () => <CloseDocumentDialog /> });
    },
  };
}
