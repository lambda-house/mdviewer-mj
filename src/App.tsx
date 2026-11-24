import React, { useEffect, useRef } from 'react';
import { Activity } from 'lucide-react';
import { useStore } from './store';
import { useReader } from './reader';
import { reader } from './readerHost';
import { allTabs, flushEditorChanges, getFileName, readerPlugin, reloadChangedDocuments } from '@lambda-house/reader';
import { journalPlugin } from '@lambda-house/journal';
import { Workbench } from '@lambda-house/workbench';
import {
  scanDirectories,
  isTauri,
  startWatching,
  stopWatching,
  onFileDrop,
  takeLaunchPaths,
  onOpenPaths,
  onMenuCommand,
  checkForUpdate,
  onAgentFilesChanged,
  onWindowCloseRequested,
} from './utils/tauri';
import { appMenu, buildMenu, commandContext, useCommandContext } from './utils/commands';
import { agentFilesWatched, refreshAgentWorkspace } from './utils/agent';
import { journal } from './journal';
import { documentWindowPath } from './utils/documentWindow';
import { registry } from './workbench';
import { NO_DOCUMENT, documentsPlugin, zoomOf } from './documents';
import { openPaths } from './opening';

// ============================================================
// MDViewer's window: the Workbench of its plugins (shared UI spec §3.3), the
// reader's, the journal's and MDViewer's own (documents.tsx), and what the
// window does through Tauri: scanning and watching the opened folders,
// agent files, drops and launch paths, the update check. A memory window has
// Documents only, and its one document.
// ============================================================

/** Quiet time after the last file change event before the tree is rescanned. */
const RESCAN_DEBOUNCE = 300;
/** Quiet time after the last agent file change before agent files are rescanned. */
const AGENT_CHANGE_DEBOUNCE = 500;
/** How often agent files are rescanned when they can't be watched (ms). */
const AGENT_POLL_INTERVAL = 10000;

registry.register(readerPlugin(reader, {
  empty: NO_DOCUMENT,
  contents: { zoom: zoomOf('toc'), onClose: () => useStore.getState().toggleTocVisible() },
  // A memory window doesn't take the main window's tabs
  restore: isTauri() && !documentWindowPath,
  windowDocument: documentWindowPath,
  confirmClose: { name: 'MDViewer', onCloseRequested: onWindowCloseRequested },
}));
if (!documentWindowPath) {
  registry.register(journalPlugin(journal, {
    surface: { id: 'journal', label: 'Journal', icon: <Activity size={13} />, order: 20, tools: { refresh: true, memories: true, agentAccess: true } },
  }));
}
registry.register(documentsPlugin);

// The commands, with their shortcuts, are in utils/commands.ts; the main
// menu, the keys, the native menu and the palette all read this one list
const menu = buildMenu();
appMenu.set(menu);

const openPalette = () => useStore.getState().setPaletteOpen(true);

const App: React.FC = () => {
  // The shown surface is the store's: commands of the other one wait
  const surface = useStore((s) => s.surface);
  const setSurface = useStore((s) => s.setSurface);
  const statusBarPinned = useStore((s) => s.statusBarPinned);
  const setStatusBarPinned = useStore((s) => s.setStatusBarPinned);
  const settingsOpen = useStore((s) => s.settingsOpen);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const agentVisible = useStore((s) => s.agentVisible);
  const agentEntries = useStore((s) => s.agentEntries);
  const hasAgentTabs = useReader((s) => allTabs(s).some((t) => agentEntries.some((e) => e.path === t.path)));
  const openedDirectories = useStore((s) => s.directories);
  const setFiles = useStore((s) => s.setFiles);
  const showTextFiles = useStore((s) => s.showTextFiles);
  const sessionRestored = useReader((s) => s.sessionRestored);

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
              await reloadChangedDocuments(reader, names);
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
    const { directories } = useStore.getState();
    if (!isTauri() || directories.length === 0) return;
    scanDirectories(directories).then(setFiles).catch((error) => console.error('Failed to scan directories:', error));
  }, [showTextFiles, setFiles]);

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

  // Drag & drop: the native event carries real file paths; the Documents surface says what a drop does
  useEffect(() => {
    if (!isTauri()) return;

    let unlisten: (() => void) | undefined;
    let disposed = false;
    const { setDropTarget } = useStore.getState();

    onFileDrop({
      onEnter: () => setDropTarget(true),
      onLeave: () => setDropTarget(false),
      onDrop: openPaths,
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
  }, []);

  // Listen before draining startup paths so Finder / a second instance cannot
  // deliver a file between the two steps and lose its event.
  useEffect(() => {
    if (!sessionRestored || documentWindowPath) return;

    let unlisten: (() => void) | undefined;
    let disposed = false;

    onOpenPaths(openPaths)
      .then(async (fn) => {
        if (disposed) { fn(); return; }
        unlisten = fn;
        const paths = await takeLaunchPaths();
        if (!disposed && paths.length > 0) await openPaths(paths);
      })
      .catch((error) => console.error('Failed to listen for opened paths:', error));

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [sessionRestored]);

  return (
    <Workbench
      registry={registry}
      surface={surface}
      onSurface={setSurface}
      menu={menu}
      commandContext={commandContext}
      useCommandContext={useCommandContext}
      onMenuOpen={flushEditorChanges}
      nativeMenu={onMenuCommand}
      status={{ pinned: statusBarPinned, onPinnedChange: setStatusBarPinned }}
      palette={{ open: openPalette }}
      settings={{ open: settingsOpen, onOpenChange: setSettingsOpen }}
      appearance={{ theme, setTheme }}
    />
  );
};

export default App;
