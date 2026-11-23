import React, { useEffect, useCallback, useMemo, useState, useRef } from 'react';
import { Activity, FileText, Upload } from 'lucide-react';
import { defaultDocumentsLayout } from './store/documentsLayout';
import { useStore, panelShown, PANEL_MIN_WIDTH, PANEL_MAX_WIDTH, TOC_MIN_WIDTH, TOC_MAX_WIDTH, type ZoomPanel } from './store';
import { useReader } from './reader';
import { openPath, reader } from './readerHost';
import {
  CloseDocumentDialog, DocumentGroups, ReaderProvider, SaveAllDialog, allTabs, type RestoredDocument,
} from '@lambda-house/reader';
import { EmptyState, Kbd } from '@lambda-house/ui';
import { FileQuestion } from 'lucide-react';
import { LayoutView, MainMenu, Shell, type Layout, type PaneType, type ShellSurface } from '@lambda-house/workbench';
import {
  scanDirectories,
  isTauri,
  readFile,
  startWatching,
  stopWatching,
  pickDirectory,
  pickFiles,
  getFileInfo,
  onFileDrop,
  takeLaunchPaths,
  onOpenPaths,
  onMenuCommand,
  checkForUpdate,
  onAgentFilesChanged,
} from './utils/tauri';
import { appMenu, buildMenu, commandContext, menuCommands, commandForKey, useCommandContext } from './utils/commands';
import { isViewableFile, getFileName } from '@lambda-house/reader';
import { normalizeDirPath, findFirstMarkdown } from './utils/files';
import Toolbar, { ToolbarEnd } from './components/Toolbar';
import { flushEditorChanges } from '@lambda-house/reader';
import FilePanel from './components/FilePanel';
import TocSidebar from './components/TocSidebar';
import SettingsModal from './components/SettingsModal';
import HistoryPanel from './components/HistoryPanel';
import SearchPanel from './components/SearchPanel';
import { agentFilesWatched, refreshAgentWorkspace } from './utils/agent';
import UpdateBanner from './components/UpdateBanner';
import { JournalProvider, JournalView } from '@lambda-house/journal';
import { journal } from './journal';
import CommandPalette from './components/CommandPalette';
import { documentWindowPath } from './utils/documentWindow';

// ============================================================
// Main App Component
// ============================================================

/** Quiet time after the last file change event before the tree is rescanned. */
const RESCAN_DEBOUNCE = 300;
/** Quiet time after the last agent file change before agent files are rescanned. */
const AGENT_CHANGE_DEBOUNCE = 500;
/** How often agent files are rescanned when they can't be watched (ms). */
const AGENT_POLL_INTERVAL = 10000;

/** Message of an Error or of a backend error ({ code, message }). */
function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return String(error);
}

/**
 * Reload the open documents an outside program changed (unless they have
 * unsaved edits). Matched by file name: the watcher reports real paths, which
 * can differ from the path a document was opened under (symlinks, /private).
 */
async function reloadChangedDocuments(names: string[]): Promise<void> {
  if (names.length === 0) return;
  const changed = new Set(names);
  const { documents, reloadDocument } = useReader.getState();
  await Promise.all(Object.values(documents)
    .filter((doc) => !doc.isDirty && changed.has(getFileName(doc.path)))
    .map(async (doc) => {
      try {
        reloadDocument(doc.path, await readFile(doc.path));
      } catch {
        // Removed or renamed: the tab keeps the last text
      }
    }));
}

/** An empty document group: how to open a document here. */
const NO_DOCUMENT = (
  <EmptyState
    size="lg"
    icon={<FileQuestion size={64} />}
    title="No Document Open"
    hint={<><Kbd>Ctrl</Kbd>+<Kbd>P</Kbd> to quick open a file</>}
  >
    Select a markdown file from the sidebar, or drop one on this window
  </EmptyState>
);

const App: React.FC = () => {
  // The shown surface is the store's: commands of the other one wait
  const surface = useStore((s) => s.surface);
  const statusBarPinned = useStore((s) => s.statusBarPinned);
  const setStatusBarPinned = useStore((s) => s.setStatusBarPinned);
  const setSurface = useStore((s) => s.setSurface);
  const journalVisible = surface === 'journal';
  // Subscribe field by field so that high frequency updates (scroll offsets,
  // active heading) do not re-render the whole application.
  const documentsLayoutRoot = useStore((s) => s.documentsLayout);
  const setDocumentsLayout = useStore((s) => s.setDocumentsLayout);
  const historyVisible = panelShown({ documentsLayout: documentsLayoutRoot }, 'history');
  const agentVisible = useStore((s) => s.agentVisible);
  const toggleAgentVisible = useStore((s) => s.toggleAgentVisible);
  const agentEntries = useStore((s) => s.agentEntries);
  const hasAgentTabs = useReader((s) => allTabs(s).some((t) => agentEntries.some((e) => e.path === t.path)));
  const openedDirectories = useStore((s) => s.directories);

  const toggleTocVisible = useStore((s) => s.toggleTocVisible);
  const toggleHistoryVisible = useStore((s) => s.toggleHistoryVisible);
  const setFiles = useStore((s) => s.setFiles);
  const activateTabByIndex = useReader((s) => s.activateTabByIndex);
  const navigateBack = useReader((s) => s.navigateBack);
  const navigateForward = useReader((s) => s.navigateForward);
  const reopenClosedTab = useReader((s) => s.reopenClosedTab);
  const addDirectory = useStore((s) => s.addDirectory);
  const restoreSession = useReader((s) => s.restoreSession);
  const sessionRestored = useReader((s) => s.sessionRestored);
  
  const filePanelVisible = panelShown({ documentsLayout: documentsLayoutRoot }, 'files');
  const showPanel = useStore((s) => s.showPanel);
  const searchVisible = panelShown({ documentsLayout: documentsLayoutRoot }, 'search');
  const setSearchVisible = useStore((s) => s.setSearchVisible);
  const openSearch = useStore((s) => s.openSearch);
  const revealPath = useStore((s) => s.revealPath);
  const showTextFiles = useStore((s) => s.showTextFiles);
  const [isDropTarget, setIsDropTarget] = useState(false);
  
  // Load persisted directories on startup
  useEffect(() => {
    const loadDirectories = async () => {
      const { directories } = useStore.getState();
      if (directories.length > 0 && isTauri()) {
        try {
          const files = await scanDirectories(directories);
          setFiles(files);
        } catch (error) {
          console.error('Failed to scan directories:', error);
        }
      }
    };
    loadDirectories();
  }, [setFiles]);

  // Restore the previous session: the persisted tabs only carry paths, so the
  // documents behind them have to be re-read before the tabs become usable.
  useEffect(() => {
    let cancelled = false;

    const restore = async () => {
      const persistedTabs = allTabs(useReader.getState());

      if (documentWindowPath || persistedTabs.length === 0 || !isTauri()) {
        restoreSession([]);
        return;
      }

      // A file open in two groups is read once
      const paths = [...new Set(persistedTabs.map((tab) => tab.path))];
      const results = await Promise.all(
        paths.map(async (path): Promise<RestoredDocument | null> => {
          try {
            return { path, content: await readFile(path) };
          } catch (error) {
            console.warn(`Dropping restored tab (cannot read ${path}):`, error);
            return null;
          }
        })
      );

      if (cancelled) return;
      restoreSession(results.filter((doc): doc is RestoredDocument => doc !== null));
    };

    restore();
    return () => {
      cancelled = true;
    };
  }, [restoreSession]);

  // Auto-refresh: Start/stop file watching based on settings
  const watcherCleanup = useRef<(() => void) | null>(null);

  useEffect(() => {
    // The main window owns the process-wide directory watcher.
    if (documentWindowPath) return;
    const setupWatcher = async () => {
      const { directories, autoRefresh } = useStore.getState();

      if (!isTauri() || directories.length === 0) return;

      if (autoRefresh) {
        try {
          // Start watching directories
          await startWatching(directories);

          // Listen for file change events from Tauri
          const { listen } = await import('@tauri-apps/api/event');
          // Events come one per file (a checkout or build sends hundreds):
          // rescan once they have been quiet for a moment, and never run two
          // scans at the same time
          let timer: ReturnType<typeof setTimeout> | undefined;
          let scanning = false;
          let rescanAgain = false;
          // Names of the files changed since the last scan
          const changedNames = new Set<string>();

          const rescan = async () => {
            if (scanning) {
              rescanAgain = true;
              return;
            }
            const { directories: currentDirs } = useStore.getState();
            if (currentDirs.length === 0) return;

            scanning = true;
            const names = [...changedNames];
            changedNames.clear();
            try {
              setFiles(await scanDirectories(currentDirs));
              await reloadChangedDocuments(names);
            } catch (error) {
              console.error('Failed to refresh after file change:', error);
            } finally {
              scanning = false;
              if (rescanAgain) {
                rescanAgain = false;
                scheduleRescan();
              }
            }
          };

          const scheduleRescan = () => {
            clearTimeout(timer);
            timer = setTimeout(rescan, RESCAN_DEBOUNCE);
          };

          const unlisten = await listen<{ path: string }>('files-changed', (event) => {
            changedNames.add(getFileName(event.payload.path));
            scheduleRescan();
          });

          watcherCleanup.current = () => {
            clearTimeout(timer);
            unlisten();
            stopWatching().catch(console.error);
          };
        } catch (error) {
          console.error('Failed to start file watcher:', error);
        }
      } else {
        // Stop watching if auto-refresh is disabled
        if (watcherCleanup.current) {
          watcherCleanup.current();
          watcherCleanup.current = null;
        }
        await stopWatching().catch(console.error);
      }
    };

    setupWatcher();

    // Subscribe to store changes for autoRefresh and directories
    const unsubscribe = useStore.subscribe(
      (state, prevState) => {
        if (state.autoRefresh !== prevState.autoRefresh ||
            state.directories !== prevState.directories) {
          setupWatcher();
        }
      }
    );

    return () => {
      unsubscribe();
      if (watcherCleanup.current) {
        watcherCleanup.current();
      }
    };
  }, [setFiles]);
  
  // Rescan every configured directory and refresh the tree
  const refreshFileTree = useCallback(async () => {
    const { directories } = useStore.getState();
    if (!isTauri() || directories.length === 0) return;
    try {
      const files = await scanDirectories(directories);
      setFiles(files);
    } catch (error) {
      console.error('Failed to scan directories:', error);
    }
  }, [setFiles]);
  

  // Agent files change while agents work: rescan while the global root or an
  // agent file is open, when the backend reports a change and when the window
  // gets focus. Each scan also makes the backend watch newly opened folders.
  useEffect(() => {
    if (!isTauri() || documentWindowPath) return;
    if (!agentVisible && !hasAgentTabs) {
      // Still learn which documents are agent files (for "what changed")
      refreshAgentWorkspace().catch(() => {});
      return;
    }
    const refresh = () => {
      if (document.visibilityState === 'visible') {
        refreshAgentWorkspace().catch((error) => console.error('Failed to refresh agent files:', error));
      }
    };
    refresh();
    // An agent writes several files in a row: rescan once they pause
    let debounce: ReturnType<typeof setTimeout> | undefined;
    const scheduleRefresh = () => {
      clearTimeout(debounce);
      debounce = setTimeout(refresh, AGENT_CHANGE_DEBOUNCE);
    };
    const unlisten = onAgentFilesChanged(scheduleRefresh);
    // The watcher couldn't start: poll instead
    const poll = setInterval(() => {
      if (!agentFilesWatched()) refresh();
    }, AGENT_POLL_INTERVAL);
    window.addEventListener('focus', refresh);
    return () => {
      clearTimeout(debounce);
      clearInterval(poll);
      unlisten.then((fn) => fn()).catch(() => {});
      window.removeEventListener('focus', refresh);
    };
  }, [agentVisible, hasAgentTabs, openedDirectories]);
  
  // Rescan when the "show text files" setting changes (not on startup - the
  // directories are scanned once above)
  const showTextFilesRef = useRef(showTextFiles);
  useEffect(() => {
    if (showTextFilesRef.current === showTextFiles) return;
    showTextFilesRef.current = showTextFiles;
    refreshFileTree();
  }, [showTextFiles, refreshFileTree]);

  
  // A native memory window opens only its requested document, independently of
  // the main window's launch queue and saved tabs.
  useEffect(() => {
    if (!documentWindowPath || !sessionRestored) return;
    void openPath(documentWindowPath).catch(error => alert(`Could not open memory:\n${errorText(error)}`));
    const refresh = () => {
      const names = Object.values(useReader.getState().documents).map(doc => getFileName(doc.path));
      void reloadChangedDocuments(names);
    };
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [sessionRestored]);

  // Look for a new version a few seconds after start (not during startup work)
  useEffect(() => {
    if (!isTauri() || !useStore.getState().checkUpdatesOnStart) return;
    const timer = setTimeout(() => {
      checkForUpdate()
        .then((update) => useStore.getState().setAvailableUpdate(update))
        .catch((error) => console.warn('Update check failed:', error));
    }, 5000);
    return () => clearTimeout(timer);
  }, []);

  /**
   * Add directories to the tree (merging overlaps, see `addDirectory`), then
   * rescan. A newly added directory is expanded down to its first markdown
   * file, which opens in the preview tab.
   */
  const addDirectories = useCallback(async (dirs: string[]) => {
    const added = dirs
      .map((dir) => ({ dir, result: addDirectory(dir) }))
      .filter(({ result }) => !result.containedIn)
      .map(({ dir }) => normalizeDirPath(dir));
    // A folder can already be open, and another panel may be covering Files.
    // Always bring the requested folder into view after the picker closes.
    showPanel('files');
    useStore.getState().setFilterQuery('');
    revealPath(normalizeDirPath(dirs[dirs.length - 1]));
    if (added.length === 0) return;

    const files = await scanDirectories(useStore.getState().directories);
    setFiles(files);

    const root = useStore.getState().files.find((node) => node.path === added[added.length - 1]);
    const first = root && findFirstMarkdown(root);
    if (!first) return;

    revealPath(first.file.path);
    try {
      await openPath(first.file.path, { preview: true });
    } catch (error) {
      console.error('Failed to open first markdown file:', error);
    }
  }, [addDirectory, setFiles, showPanel, revealPath, openPath]);

  // Handle add directory - opens native picker
  const handleAddDirectory = useCallback(async () => {
    try {
      const dir = await pickDirectory();
      if (dir) await addDirectories([dir]);
    } catch (error) {
      console.error('Failed to open folder:', error);
      alert(`Could not open folder:\n${errorText(error)}`);
    }
  }, [addDirectories]);
  
  // ============================================================
  // Drag & Drop (native Tauri event - carries real file paths)
  // ============================================================
  
  const handleDroppedPaths = useCallback(async (paths: string[]) => {
    const errors: string[] = [];
    const dirs: string[] = [];

    for (const path of paths) {
      try {
        const info = await getFileInfo(path);
        if (info.isDirectory) {
          dirs.push(path);
        } else if (isViewableFile(path)) {
          await openPath(path);
        } else {
          errors.push(`${getFileName(path)} is not a markdown or text file`);
        }
      } catch (error) {
        console.error('Failed to handle dropped path:', path, error);
        errors.push(`${getFileName(path)}: ${errorText(error)}`);
      }
    }

    if (dirs.length > 0) {
      try {
        await addDirectories(dirs);
      } catch (error) {
        errors.push(`Folders: ${errorText(error)}`);
      }
    }

    if (errors.length > 0) {
      alert(`Could not open:\n${errors.join('\n')}`);
    }
  }, [openPath, addDirectories]);

  // Handle open file - opens native picker; the chosen files open like dropped ones
  const handleOpenFile = useCallback(async () => {
    try {
      const paths = await pickFiles();
      if (paths.length > 0) {
        await handleDroppedPaths(paths);
      }
    } catch (error) {
      console.error('Failed to pick files:', error);
      alert(`Could not open the file dialog:\n${errorText(error)}`);
    }
  }, [handleDroppedPaths]);
  
  useEffect(() => {
    if (!isTauri()) return;

    let unlisten: (() => void) | undefined;
    let disposed = false;

    onFileDrop({
      onEnter: () => setIsDropTarget(true),
      onLeave: () => setIsDropTarget(false),
      onDrop: handleDroppedPaths,
    })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch((error) => console.error('Failed to listen for file drops:', error));

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [handleDroppedPaths]);

  // Listen before draining startup paths so Finder / a second instance cannot
  // deliver a file between the two steps and lose its event.
  useEffect(() => {
    if (!sessionRestored || documentWindowPath) return;

    let unlisten: (() => void) | undefined;
    let disposed = false;

    onOpenPaths(handleDroppedPaths)
      .then(async (fn) => {
        if (disposed) { fn(); return; }
        unlisten = fn;
        const paths = await takeLaunchPaths();
        if (!disposed && paths.length > 0) await handleDroppedPaths(paths);
      })
      .catch((error) => console.error('Failed to listen for opened paths:', error));

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [sessionRestored, handleDroppedPaths]);
  
  // Handle TOC toggle
  const handleToggleToc = useCallback(() => {
    toggleTocVisible();
  }, [toggleTocVisible]);
  
  // Toggle file panel (from Search or History it shows Files)
  const handleToggleFilePanel = useCallback(() => useStore.getState().togglePanel('files'), []);

  // Toggle history panel
  const handleToggleHistory = useCallback(() => {
    toggleHistoryVisible();
  }, [toggleHistoryVisible]);
  
  // Reopen closed tab
  const handleReopenClosedTab = useCallback(async () => {
    const closedTab = reopenClosedTab();
    if (closedTab) {
      try {
        await openPath(closedTab.path);
      } catch (error) {
        console.error('Failed to reopen file:', error);
      }
    }
  }, [reopenClosedTab, openPath]);
  
  // ============================================================
  // Keyboard Shortcuts
  // ============================================================
  
  // The commands, with their shortcuts, are defined in utils/commands.ts;
  // the toolbar's menu shows the same list
  const menu = useMemo(
    () => buildMenu({
      openFile: handleOpenFile,
      openFolder: handleAddDirectory,
      reopenClosedTab: handleReopenClosedTab,
    }),
    [handleOpenFile, handleAddDirectory, handleReopenClosedTab]
  );

  // The command palette lists the same commands
  useEffect(() => appMenu.set(menu), [menu]);

  // The system menu uses the same commands as the toolbar menu.
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    onMenuCommand((id) => {
      const command = menuCommands(menu).find((item) => item.id === id);
      if (command && (!command.enabled || command.enabled(commandContext()))) command.run();
    }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    }).catch((error) => console.error('Failed to listen for menu commands:', error));
    return () => { disposed = true; unlisten?.(); };
  }, [menu]);

  useEffect(() => {
    const commands = menuCommands(menu);

    const handleKeyDown = (e: KeyboardEvent) => {
      // Already handled - e.g. by the editor (its own Ctrl+F search, Ctrl+S,
      // Alt+Left/Right word moves)
      if (e.defaultPrevented) return;

      const isMod = e.metaKey || e.ctrlKey;
      const isShift = e.shiftKey;
      
      // Prevent default for our shortcuts
      const shouldPrevent = (
        (isMod && ['w', 'b', 'e', 's', 'f', 'p', 'h', '0', '=', '-'].includes(e.key.toLowerCase())) ||
        (isMod && isShift && ['o', 'f', 't', 'w'].includes(e.key.toLowerCase())) ||
        (isMod && e.key === 'Tab') ||
        (isMod && /^[1-9]$/.test(e.key))
      );
      
      if (shouldPrevent) {
        e.preventDefault();
      }
      
      const command = commandForKey(commands, e, useStore.getState().surface);
      if (command) {
        e.preventDefault();
        command.run();
        return;
      }
      
      // Ctrl/Cmd + 1-9: Go to tab by index
      if (isMod && /^[1-9]$/.test(e.key)) {
        const index = parseInt(e.key, 10) - 1;
        activateTabByIndex(index);
        return;
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [menu, activateTabByIndex]);
  
  // ============================================================
  // Closing the window with unsaved edits asks first
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;

    import('@tauri-apps/api/window')
      .then(({ getCurrentWindow }) => {
        const appWindow = getCurrentWindow();
        return appWindow.onCloseRequested(async (event) => {
          const dirty = allTabs(useReader.getState()).filter((t) => t.isDirty);
          if (dirty.length === 0) return;
          event.preventDefault();
          const names = dirty.map((t) => t.title).join(', ');
          if (window.confirm(`Unsaved changes in ${names}. Close MDViewer and discard them?`)) {
            await appWindow.destroy();
          }
        });
      })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch((error) => console.error('Failed to watch window close:', error));

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  // Mouse back/forward buttons switch between tabs
  useEffect(() => {
    const handleMouseUp = (e: MouseEvent) => {
      if (e.button === 3) {
        e.preventDefault();
        navigateBack();
      } else if (e.button === 4) {
        e.preventDefault();
        navigateForward();
      }
    };
    window.addEventListener('mouseup', handleMouseUp);
    return () => window.removeEventListener('mouseup', handleMouseUp);
  }, [navigateBack, navigateForward]);

  // Ctrl+Scroll for zoom
  // ============================================================
  
  // Ctrl+wheel zooms the pane under the pointer: the workbench's LayoutView does it (each pane type's zoom)
  


  // ============================================================
  // Documents: the left panel (Files, Search or History), the document groups
  // and the contents, on the workbench layout the store keeps
  // (store/documentsLayout.ts). Its handles and pane menus change it there.
  // ============================================================

  const documentsLayout = useMemo<Layout>(() => ({ version: 1, root: documentsLayoutRoot }), [documentsLayoutRoot]);
  const applyDocumentsLayout = useCallback((next: Layout) => setDocumentsLayout(next.root), [setDocumentsLayout]);
  const resetDocumentsLayout = useCallback(() => setDocumentsLayout(defaultDocumentsLayout()), [setDocumentsLayout]);

  const documentPanes = useMemo<Record<string, PaneType>>(() => {
    const left = { collapsible: true, switchable: true, singleton: true, min: { w: PANEL_MIN_WIDTH }, max: { w: PANEL_MAX_WIDTH } };
    const zoomOf = (panel: ZoomPanel) => ({
      get: () => useStore.getState().panelZoom[panel],
      step: (_: unknown, direction: 1 | -1 | 0) => useStore.getState().zoomPanel(panel, direction),
      subscribe: useStore.subscribe,
    });
    return {
      files: { type: 'files', label: 'file panel', title: 'Files', ...left, zoom: zoomOf('files'), render: () => <FilePanel onAddDirectory={handleAddDirectory} /> },
      search: { type: 'search', label: 'search panel', title: 'Search', ...left, render: () => <SearchPanel /> },
      history: { type: 'history', label: 'history panel', title: 'History', ...left, render: () => <HistoryPanel /> },
      documents: {
        type: 'documents', label: 'document', title: 'Documents', singleton: true, closable: false, keepAlive: true, min: { w: 200 },
        render: () => <DocumentGroups empty={NO_DOCUMENT} />,
      },
      contents: {
        type: 'contents', label: 'table of contents', title: 'Contents', singleton: true, collapsible: true,
        min: { w: TOC_MIN_WIDTH }, max: { w: TOC_MAX_WIDTH }, zoom: zoomOf('toc'),
        render: () => <TocSidebar onToggle={handleToggleToc} />,
      },
    };
  }, [handleAddDirectory, handleToggleToc]);

  // The window's surfaces under one top bar (the workbench Shell). Documents is mounted only while shown;
  // the Journal stays mounted once opened. A memory window has Documents only.
  const surfaces: ShellSurface[] = [
    {
      id: 'documents', label: 'Documents', icon: <FileText size={13} />, keepMounted: false,
      render: () => (
        <>
          <Toolbar
            onAddDirectory={handleAddDirectory}
            filePanelVisible={filePanelVisible}
            onToggleFilePanel={handleToggleFilePanel}
            historyVisible={historyVisible}
            onToggleHistory={handleToggleHistory}
            agentVisible={agentVisible}
            onToggleAgent={toggleAgentVisible}
            searchVisible={searchVisible}
            onToggleSearch={() => (searchVisible ? setSearchVisible(false) : openSearch())}
          />

          <UpdateBanner />

          <div className="main-content">
            <LayoutView layout={documentsLayout} onChange={applyDocumentsLayout} paneTypes={documentPanes} onReset={resetDocumentsLayout} />
          </div>


          {isDropTarget && (
            <div className="drop-overlay" aria-hidden="true">
              <div className="drop-overlay-inner">
                <Upload size={40} />
                <span className="drop-overlay-title">Drop to open</span>
                <span className="drop-overlay-hint">
                  Markdown and text files open in a tab, folders are added to the file tree
                </span>
              </div>
            </div>
          )}
        </>
      ),
    },
    ...(documentWindowPath ? [] : [{
      id: 'journal', label: 'Journal', icon: <Activity size={13} />,
      render: () => (
        <JournalProvider journal={journal}>
          <JournalView active={journalVisible} tools={{ refresh: true, memories: true, agentAccess: true }} />
        </JournalProvider>
      ),
    }]),
  ];

  return (
    <ReaderProvider reader={reader}>
    <div className="app-container">
      <Shell
        surfaces={surfaces}
        active={surface}
        onActivate={setSurface}
        status={{ pinned: statusBarPinned, onPinnedChange: setStatusBarPinned }}
        menu={<MainMenu items={menu} useCommandContext={useCommandContext} onOpen={flushEditorChanges} buttonClassName="toolbar-button" surface={surface} />}
        end={<ToolbarEnd />}
      />
      <SettingsModal />
      <SaveAllDialog />
      <CloseDocumentDialog />
      <CommandPalette openFile={(path) => { openPath(path).catch((error) => alert(`Could not open ${path}:\n${errorText(error)}`)); }} />
    </div>
    </ReaderProvider>
  );
};

export default App;
