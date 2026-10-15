import React, { useEffect, useCallback, useMemo, useState, useRef } from 'react';
import { Upload } from 'lucide-react';
import { useStore, PANEL_MIN_WIDTH, TOC_MIN_WIDTH, type Heading, type RestoredDocument } from './store';
import {
  scanDirectories,
  isTauri,
  readFile,
  startWatching,
  stopWatching,
  pickDirectory,
  pickFiles,
  appendToHistory,
  getFileInfo,
  onFileDrop,
  takeLaunchPaths,
  onOpenPaths,
  onMenuCommand,
  openExternal,
  followLocalLink,
  checkForUpdate,
  onAgentFilesChanged,
} from './utils/tauri';
import { buildMenu, menuCommands, commandForKey } from './utils/commands';
import { isViewableFile, getFileName, normalizeDirPath, findFirstMarkdown, resolveLinkPath } from './utils/files';
import Toolbar from './components/Toolbar';
import FilePanel from './components/FilePanel';
import DocumentPanel from './components/DocumentPanel';
import TocSidebar from './components/TocSidebar';
import Resizer from './components/Resizer';
import StatusBar from './components/StatusBar';
import SettingsModal from './components/SettingsModal';
import SaveAllDialog from './components/SaveAllDialog';
import HistoryPanel from './components/HistoryPanel';
import SearchPanel from './components/SearchPanel';
import { agentFilesWatched, refreshAgentWorkspace } from './utils/agent';
import UpdateBanner from './components/UpdateBanner';

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

const App: React.FC = () => {
  // Subscribe field by field so that high frequency updates (scroll offsets,
  // active heading) do not re-render the whole application.
  const panelWidth = useStore((s) => s.panelWidth);
  const tocWidth = useStore((s) => s.tocWidth);
  const tocVisible = useStore((s) => s.tocVisible);
  const historyVisible = useStore((s) => s.historyVisible);
  const agentVisible = useStore((s) => s.agentVisible);
  const toggleAgentVisible = useStore((s) => s.toggleAgentVisible);
  const hasAgentTabs = useStore((s) => s.tabs.some((t) => s.agentEntries.some((e) => e.path === t.path)));
  const openedDirectories = useStore((s) => s.directories);

  const setPanelWidth = useStore((s) => s.setPanelWidth);
  const setTocWidth = useStore((s) => s.setTocWidth);
  const toggleTocVisible = useStore((s) => s.toggleTocVisible);
  const toggleHistoryVisible = useStore((s) => s.toggleHistoryVisible);
  const setFiles = useStore((s) => s.setFiles);
  const activateTabByIndex = useStore((s) => s.activateTabByIndex);
  const navigateBack = useStore((s) => s.navigateBack);
  const navigateForward = useStore((s) => s.navigateForward);
  const zoomIn = useStore((s) => s.zoomIn);
  const zoomOut = useStore((s) => s.zoomOut);
  const zoomPanel = useStore((s) => s.zoomPanel);
  const reopenClosedTab = useStore((s) => s.reopenClosedTab);
  const openDocument = useStore((s) => s.openDocument);
  const addDirectory = useStore((s) => s.addDirectory);
  const restoreSession = useStore((s) => s.restoreSession);
  const sessionRestored = useStore((s) => s.sessionRestored);
  
  const [headings, setHeadings] = useState<Heading[]>([]);
  const filePanelVisible = useStore((s) => s.filePanelVisible);
  const setFilePanelVisible = useStore((s) => s.setFilePanelVisible);
  const setHistoryVisible = useStore((s) => s.setHistoryVisible);
  const setTocVisible = useStore((s) => s.setTocVisible);
  const searchVisible = useStore((s) => s.searchVisible);
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
      const persistedTabs = useStore.getState().tabs;

      if (persistedTabs.length === 0 || !isTauri()) {
        restoreSession([]);
        return;
      }

      const results = await Promise.all(
        persistedTabs.map(async (tab): Promise<RestoredDocument | null> => {
          try {
            return { path: tab.path, content: await readFile(tab.path) };
          } catch (error) {
            console.warn(`Dropping restored tab (cannot read ${tab.path}):`, error);
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

          const rescan = async () => {
            if (scanning) {
              rescanAgain = true;
              return;
            }
            const { directories: currentDirs } = useStore.getState();
            if (currentDirs.length === 0) return;

            scanning = true;
            try {
              setFiles(await scanDirectories(currentDirs));
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

          const unlisten = await listen('files-changed', scheduleRescan);

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
  
  // Search and history temporarily replace the Files panel. Global agent files
  // are a root inside Files and keep their own visibility when the panel hides.
  const leftPanelVisible = searchVisible || historyVisible || filePanelVisible;
  const setLeftPanelVisible = useCallback((visible: boolean) => {
    if (visible) {
      if (!historyVisible && !searchVisible) setFilePanelVisible(true);
    } else {
      setSearchVisible(false);
      setHistoryVisible(false);
      setFilePanelVisible(false);
    }
  }, [historyVisible, searchVisible, setFilePanelVisible, setHistoryVisible, setSearchVisible]);

  // Agent files change while agents work: rescan while the global root or an
  // agent file is open, when the backend reports a change and when the window
  // gets focus. Each scan also makes the backend watch newly opened folders.
  useEffect(() => {
    if (!isTauri()) return;
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

  // Open a file by path (shared by the file tree, history and drops)
  const openPath = useCallback(async (path: string, options?: { preview?: boolean }) => {
    const content = await readFile(path);
    const result = openDocument(path, content, options);

    if (!result.success) {
      throw new Error(result.error || 'Failed to open document');
    }

    appendToHistory(path, getFileName(path)).catch((err) => {
      console.error('Failed to log to history:', err);
    });
  }, [openDocument]);
  
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

  // Links in the document. The window itself never navigates (the backend
  // blocks it): anchors scroll, web/mail links open in the default browser,
  // links to local files open in a tab (or are revealed if not viewable),
  // after a native confirmation when they're outside what the user opened.
  useEffect(() => {
    const handleClick = async (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0) return;
      const link = (e.target as HTMLElement).closest?.('.document-panel .markdown-body a[href]');
      if (!link) return;
      const href = link.getAttribute('href') ?? '';
      e.preventDefault();

      if (href.startsWith('#')) {
        let id = href.slice(1);
        try {
          id = decodeURIComponent(id);
        } catch {
          // Malformed escape: use the id as written
        }
        link.closest('.markdown-body')?.querySelector(`[id="${CSS.escape(id)}"]`)?.scrollIntoView({ behavior: 'smooth' });
        return;
      }

      try {
        if (/^(https?|mailto):/i.test(href)) {
          await openExternal(href);
          return;
        }
        if (/^[a-z][a-z0-9+.-]*:/i.test(href) && !/^file:/i.test(href) && !/^[A-Za-z]:[\\/]/.test(href)) {
          return; // other schemes (javascript:, data:, ...) are ignored
        }

        const { tabs, activeTabId } = useStore.getState();
        const documentPath = tabs.find((tab) => tab.id === activeTabId)?.path;
        if (!documentPath) return;
        const path = resolveLinkPath(href, documentPath);
        if ((await followLocalLink(path)) === 'open') {
          await openPath(path);
        }
      } catch (error) {
        console.error('Failed to open link:', href, error);
        alert(`Could not open ${href}:\n${errorText(error)}`);
      }
    };

    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [openPath]);

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
    setSearchVisible(false);
    setHistoryVisible(false);
    setFilePanelVisible(true);
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
  }, [addDirectory, setFiles, setSearchVisible, setHistoryVisible, setFilePanelVisible, revealPath, openPath]);

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
    if (!sessionRestored) return;

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
  
  // Handle headings change from document
  const handleHeadingsChange = useCallback((newHeadings: Heading[]) => {
    setHeadings(newHeadings);
  }, []);
  
  // Handle TOC toggle
  const handleToggleToc = useCallback(() => {
    toggleTocVisible();
  }, [toggleTocVisible]);
  
  // Toggle file panel
  const handleToggleFilePanel = useCallback(() => {
    const state = useStore.getState();
    setFilePanelVisible(state.searchVisible || state.historyVisible || !state.filePanelVisible);
  }, [setFilePanelVisible]);

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

  // The system menu uses the same commands as the toolbar menu.
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    onMenuCommand((id) => {
      const command = menuCommands(menu).find((item) => item.id === id);
      if (command && (!command.enabled || command.enabled(useStore.getState()))) command.run();
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
      
      const command = commandForKey(commands, e);
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
          const dirty = useStore.getState().tabs.filter((t) => t.isDirty);
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
  
  // Zooms whatever is under the cursor: the file panel and the TOC have their
  // own zoom, everywhere else it is the document zoom.
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.deltaY === 0) return;
      e.preventDefault();

      const direction = e.deltaY < 0 ? 1 : -1;
      const panel = (e.target as Element | null)
        ?.closest?.('[data-zoom-panel]')
        ?.getAttribute('data-zoom-panel');

      if (panel === 'files' || panel === 'toc') {
        zoomPanel(panel, direction);
      } else if (direction > 0) {
        zoomIn();
      } else {
        zoomOut();
      }
    };
    
    window.addEventListener('wheel', handleWheel, { passive: false });
    return () => window.removeEventListener('wheel', handleWheel);
  }, [zoomIn, zoomOut, zoomPanel]);
  
  return (
    <div className="app-container">
      <Toolbar
        menu={menu}
        onAddDirectory={handleAddDirectory}
        filePanelVisible={filePanelVisible && !searchVisible && !historyVisible}
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
        {searchVisible && <SearchPanel width={panelWidth} />}

        {historyVisible && !searchVisible && <HistoryPanel width={panelWidth} />}

        {filePanelVisible && !historyVisible && !searchVisible && (
          <FilePanel
            width={panelWidth}
            onAddDirectory={handleAddDirectory}
          />
        )}

        <Resizer
          side="left"
          width={panelWidth}
          minWidth={PANEL_MIN_WIDTH}
          visible={leftPanelVisible}
          onWidthChange={setPanelWidth}
          onVisibleChange={setLeftPanelVisible}
          label={searchVisible ? 'search panel' : historyVisible ? 'history panel' : 'file panel'}
        />

        <DocumentPanel onHeadingsChange={handleHeadingsChange} />

        <Resizer
          side="right"
          width={tocWidth}
          minWidth={TOC_MIN_WIDTH}
          visible={tocVisible}
          onWidthChange={setTocWidth}
          onVisibleChange={setTocVisible}
          label="table of contents"
        />

        {tocVisible && (
          <TocSidebar
            headings={headings}
            width={tocWidth}
            isVisible={tocVisible}
            onToggle={handleToggleToc}
          />
        )}
      </div>

      <StatusBar />
      <SettingsModal />
      <SaveAllDialog />

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
    </div>
  );
};

export default App;
