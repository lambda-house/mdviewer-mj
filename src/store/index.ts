import { create } from 'zustand';
// First: the reader store takes over the old saved tabs before this store rewrites them
import { useReader } from '../reader';
import { activeTabOf, focusedGroupOf } from '@lambda-house/reader';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { ColorTheme } from '@lambda-house/reader';
import { normalizeDirPath, isPathInside, pathChain, reuseUnchangedNodes } from '../utils/files';
import type { AgentEntry, UpdateInfo } from '../utils/tauri';
import { documentWindowPath, documentWindowStorage } from '../utils/documentWindow';
import type { LayoutNode } from '@lambda-house/workbench';
import {
  defaultDocumentsLayout, documentsLayoutFrom, hidePane, isDocumentsLayout, isPaneShown, showPane, togglePane, type DocumentsPane,
} from './documentsLayout';

export {
  PANEL_MIN_WIDTH, PANEL_MAX_WIDTH, TOC_MIN_WIDTH, TOC_MAX_WIDTH, DOCUMENTS_LEAF, LEFT_PANES, type DocumentsPane,
} from './documentsLayout';

// ============================================================
// Constants
// ============================================================

/** Panel zoom in/out is multiplicative, like the document's. */
const ZOOM_STEP = 1.1;

/** Side panels that zoom on their own (Ctrl + wheel over the panel). */
export type ZoomPanel = 'files' | 'toc';
export const MIN_PANEL_ZOOM = 50;
export const MAX_PANEL_ZOOM = 400;
const DEFAULT_PANEL_ZOOM: Record<ZoomPanel, number> = { files: 100, toc: 100 };

const clampPanelZoom = (zoom: number) =>
  Math.round(Math.max(MIN_PANEL_ZOOM, Math.min(MAX_PANEL_ZOOM, zoom)));

// ============================================================
// Types
// ============================================================

export interface FileNode {
  id: string;
  name: string;
  path: string;
  displayPath: string;
  type: 'file' | 'directory';
  children?: FileNode[];
  isExpanded?: boolean;
}

export type { Heading } from '@lambda-house/reader';

/** A saved set of open folders and tabs. */
export interface Workspace {
  name: string;
  directories: string[];
  expandedPaths: string[];
  /** Paths of the open tabs, in order. */
  tabs: string[];
  activePath: string | null;
  savedAt: number;
}

/** What `addDirectory` did with an overlapping directory. */
export interface AddDirectoryResult {
  success: boolean;
  error?: string;
  /** Already shown inside this open directory - it was revealed there instead. */
  containedIn?: string;
  /** Open directories inside the new one, which it replaced. */
  replaced?: string[];
}

/** Where the search panel looks. */
export type SearchScope = 'tabs' | 'folders';

// ============================================================
// Store Interface
// ============================================================

export interface AppState {
  // File Panel (use arrays for serialization)
  directories: string[];
  files: FileNode[];
  expandedPaths: string[];
  selectedPath: string | null;
  filterQuery: string;
  
  
  // UI State
  /**
   * The Documents view: the left panel (Files, Search or History), the
   * document groups and the contents, as a workbench layout (documentsLayout.ts).
   */
  documentsLayout: LayoutNode;
  /** Zoom of the file panel and the TOC, independent of the document zoom. */
  panelZoom: Record<ZoomPanel, number>;
  statusBarPinned: boolean;
  autoRefresh: boolean;
  /** List other text files (code, txt, fb2...) in the file tree, not just markdown. */
  showTextFiles: boolean;
  /** Look for a new version shortly after start. */
  checkUpdatesOnStart: boolean;
  /** A newer version found by the update check. Not persisted. */
  availableUpdate: UpdateInfo | null;

  // Appearance
  theme: ColorTheme;

  /** The shown surface of the window ('documents', 'journal'): commands of another one wait. Not persisted. */
  surface: string;
  setSurface: (surface: string) => void;

  // Modal state
  settingsOpen: boolean;
  /** The command palette is showing. Not persisted. */
  paletteOpen: boolean;
  /** Files are dragged over the window: the Documents surface says what a drop does. Not saved. */
  dropTarget: boolean;

  // History
  historyContent: string;

  // Whether the global agent files root is shown in the Files panel.
  agentVisible: boolean;
  /** Agent files from the last scan; empty while the workspace is off. */
  agentEntries: AgentEntry[];

  // Workspaces
  workspaces: Workspace[];
  /** Name of the workspace the current folders/tabs belong to. */
  activeWorkspace: string | null;

  // Search panel (its options are the reader's, shared with find)
  searchQuery: string;
  searchScope: SearchScope;
  /** Bumped to (re)focus the search panel input. */
  searchFocusNonce: number;
  
  // Actions - Files
  setDirectories: (dirs: string[]) => void;
  /**
   * Add a directory to the file tree. A directory inside an open one is only
   * revealed there; a parent of open directories replaces them.
   */
  addDirectory: (dir: string) => AddDirectoryResult;
  /** Expand the tree down to `path` (inside an open directory) and select it. */
  revealPath: (path: string) => void;
  removeDirectory: (dir: string) => void;
  setFiles: (files: FileNode[]) => void;
  toggleExpanded: (path: string) => void;
  setSelectedPath: (path: string | null) => void;
  setFilterQuery: (query: string) => void;
  
  
  // Actions - UI
  /** The Documents layout after a resize or a pane menu; ignored unless MDViewer can draw it. */
  setDocumentsLayout: (layout: LayoutNode) => void;
  /** Show or hide a panel of the Documents view, by its rules (documentsLayout.ts). */
  showPanel: (panel: DocumentsPane) => void;
  hidePanel: (panel: DocumentsPane) => void;
  togglePanel: (panel: DocumentsPane) => void;
  setFilePanelVisible: (visible: boolean) => void;
  setTocVisible: (visible: boolean) => void;
  toggleTocVisible: () => void;
  /** Step a panel's zoom in (1) or out (-1), or reset it to 100% (0). */
  zoomPanel: (panel: ZoomPanel, direction: 1 | -1 | 0) => void;
  setStatusBarPinned: (pinned: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setDropTarget: (on: boolean) => void;
  setPaletteOpen: (open: boolean) => void;
  setAutoRefresh: (enabled: boolean) => void;
  setShowTextFiles: (enabled: boolean) => void;
  setCheckUpdatesOnStart: (enabled: boolean) => void;
  setAvailableUpdate: (update: UpdateInfo | null) => void;

  // Appearance
  setTheme: (theme: 'dark' | 'light') => void;

  // History
  setHistoryVisible: (visible: boolean) => void;
  toggleHistoryVisible: () => void;
  setAgentVisible: (visible: boolean) => void;
  toggleAgentVisible: () => void;
  setAgentEntries: (entries: AgentEntry[]) => void;

  // Workspaces
  /** Save the current folders and tabs under `name` (replacing one of that name). */
  saveWorkspace: (name: string) => { success: boolean; error?: string };
  deleteWorkspace: (name: string) => void;
  /** Detach from the active workspace, keeping the current folders and tabs. */
  closeWorkspace: () => void;
  /**
   * Replace folders and tabs with the workspace's. The tabs' documents still
   * have to be read and passed to `restoreSession`.
   */
  loadWorkspace: (name: string) => Workspace | null;

  // Search
  setSearchVisible: (visible: boolean) => void;
  /** Show (and focus) the search panel, optionally with a new query. */
  openSearch: (query?: string) => void;
  setSearchQuery: (query: string) => void;
  setSearchScope: (scope: SearchScope) => void;
  setHistoryContent: (content: string) => void;
}

// ============================================================
// Helper Functions
// ============================================================


// ============================================================
// Store
// ============================================================

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      // Initial State - Files
      directories: [],
      files: [],
      expandedPaths: [],
      selectedPath: null,
      filterQuery: '',
      
      // Initial State - Documents
      
      // Initial State - UI
      documentsLayout: defaultDocumentsLayout(),
      surface: !documentWindowPath && import.meta.env.VITE_MDVIEWER_SESSIONS_PREVIEW === '1' ? 'journal' : 'documents',
      panelZoom: DEFAULT_PANEL_ZOOM,
      statusBarPinned: false,
      autoRefresh: true,
      showTextFiles: true,
      checkUpdatesOnStart: true,
      availableUpdate: null,

      // Appearance
      theme: 'dark',

      // Modal state
      settingsOpen: false,
      paletteOpen: false,
      dropTarget: false,

      // History
      agentVisible: true,
      agentEntries: [],
      workspaces: [],
      activeWorkspace: null,
      searchQuery: '',
      searchScope: 'folders',
      searchFocusNonce: 0,
      historyContent: '',
      
      // ============================================================
      // Actions - Files
      // ============================================================
      
      setDirectories: (dirs) => set({ directories: dirs }),
      
      addDirectory: (rawDir) => {
        const state = get();
        const dir = normalizeDirPath(rawDir);

        const container = state.directories.find((d) => d === dir || isPathInside(dir, d));
        if (container) {
          if (container !== dir) get().revealPath(dir);
          return { success: true, containedIn: container };
        }

        const inside = state.directories.filter((d) => isPathInside(d, dir));
        if (inside.length === 0) {
          set({ directories: [...state.directories, dir] });
          return { success: true };
        }

        // Take the place of the first replaced directory, and keep what was
        // visible of the replaced ones expanded
        const firstIndex = state.directories.indexOf(inside[0]);
        const directories = state.directories.filter((d) => !inside.includes(d));
        directories.splice(firstIndex, 0, dir);
        const expanded = new Set(state.expandedPaths);
        for (const child of inside) {
          pathChain(dir, child).forEach((p) => expanded.add(p));
        }
        set({ directories, expandedPaths: [...expanded] });
        return { success: true, replaced: inside };
      },

      revealPath: (path) => set((state) => {
        const root = state.directories.find((d) => isPathInside(path, d));
        if (!root) return { selectedPath: path };
        const expanded = new Set(state.expandedPaths);
        // Expand the ancestors; `path` itself too when it is a directory
        pathChain(root, path).forEach((p) => expanded.add(p));
        return { expandedPaths: [...expanded], selectedPath: path };
      }),
      
      removeDirectory: (dir) => set((state) => ({
        directories: state.directories.filter((d) => d !== dir),
      })),
      
      // Rescans usually change little or nothing - keep unchanged nodes so the
      // tree does not re-render as a whole
      setFiles: (files) => set((state) => {
        const merged = reuseUnchangedNodes(state.files, files);
        return merged === state.files ? state : { files: merged };
      }),
      
      toggleExpanded: (path) => set((state) => {
        const isExpanded = state.expandedPaths.includes(path);
        return {
          expandedPaths: isExpanded
            ? state.expandedPaths.filter((p) => p !== path)
            : [...state.expandedPaths, path],
        };
      }),
      
      setSelectedPath: (path) => set({ selectedPath: path }),
      
      setFilterQuery: (query) => set({ filterQuery: query }),
      
      
      // ============================================================
      // Actions - UI
      // ============================================================
      
      setDocumentsLayout: (layout) => {
        if (layout !== get().documentsLayout && isDocumentsLayout(layout)) set({ documentsLayout: layout });
      },
      showPanel: (panel) => set((state) => ({ documentsLayout: showPane(state.documentsLayout, panel) })),
      hidePanel: (panel) => set((state) => ({ documentsLayout: hidePane(state.documentsLayout, panel) })),
      togglePanel: (panel) => set((state) => ({ documentsLayout: togglePane(state.documentsLayout, panel) })),

      setFilePanelVisible: (visible) => (visible ? get().showPanel('files') : get().hidePanel('files')),
      setTocVisible: (visible) => (visible ? get().showPanel('contents') : get().hidePanel('contents')),
      toggleTocVisible: () => get().togglePanel('contents'),
      

      zoomPanel: (panel, direction) => set((state) => {
        const current = state.panelZoom[panel];
        const next = direction === 0
          ? 100
          : clampPanelZoom(direction > 0 ? current * ZOOM_STEP : current / ZOOM_STEP);
        return next === current ? state : { panelZoom: { ...state.panelZoom, [panel]: next } };
      }),
      
      setStatusBarPinned: (pinned) => set({ statusBarPinned: pinned }),
      

      setSurface: (surface) => set({ surface }),
      setSettingsOpen: (open) => set({ settingsOpen: open }),
      setPaletteOpen: (open) => set({ paletteOpen: open }),
      setDropTarget: (on) => set({ dropTarget: on }),


      setAutoRefresh: (enabled) => set({ autoRefresh: enabled }),

      setShowTextFiles: (enabled) => set({ showTextFiles: enabled }),

      setCheckUpdatesOnStart: (enabled) => set({ checkUpdatesOnStart: enabled }),

      setAvailableUpdate: (update) => set({ availableUpdate: update }),

      // Appearance
      setTheme: (theme) => set({ theme }),


      // History
      // History, Search and Files take turns on the left (documentsLayout.ts)
      setHistoryVisible: (visible) => (visible ? get().showPanel('history') : get().hidePanel('history')),
      toggleHistoryVisible: () => get().togglePanel('history'),

      setAgentVisible: (visible) => {
        set({ agentVisible: visible });
        if (visible) get().showPanel('files');
      },

      toggleAgentVisible: () => {
        const state = get();
        // From Search, History or a hidden left column, the shortcut reveals
        // the root instead of hiding an entry the user cannot see.
        get().setAgentVisible(!state.agentVisible || !isPaneShown(state.documentsLayout, 'files'));
      },

      setAgentEntries: (entries) => set({ agentEntries: entries }),


      // Workspaces
      saveWorkspace: (rawName) => {
        const name = rawName.trim();
        if (!name) return { success: false, error: 'Workspace name is empty' };

        const state = get();
        const workspace: Workspace = {
          name,
          directories: state.directories,
          expandedPaths: state.expandedPaths,
          tabs: focusedGroupOf(useReader.getState()).tabs.map((t) => t.path),
          activePath: activeTabOf(focusedGroupOf(useReader.getState()))?.path ?? null,
          savedAt: Date.now(),
        };
        const index = state.workspaces.findIndex((w) => w.name === name);
        const workspaces = index === -1
          ? [...state.workspaces, workspace]
          : state.workspaces.map((w, i) => (i === index ? workspace : w));
        set({ workspaces, activeWorkspace: name });
        return { success: true };
      },

      deleteWorkspace: (name) => set((state) => ({
        workspaces: state.workspaces.filter((w) => w.name !== name),
        activeWorkspace: state.activeWorkspace === name ? null : state.activeWorkspace,
      })),

      closeWorkspace: () => set({ activeWorkspace: null }),

      loadWorkspace: (name) => {
        const workspace = get().workspaces.find((w) => w.name === name);
        if (!workspace) return null;


        set({
          activeWorkspace: name,
          directories: workspace.directories,
          expandedPaths: workspace.expandedPaths,
          files: [],
          selectedPath: workspace.activePath ?? workspace.tabs[0] ?? null,
        });
        useReader.getState().replaceTabs(workspace.tabs, workspace.activePath);
        return workspace;
      },

      // Search



      setSearchVisible: (visible) => (visible ? get().showPanel('search') : get().hidePanel('search')),

      openSearch: (query) => set((state) => ({
        documentsLayout: showPane(state.documentsLayout, 'search'),
        searchQuery: query ?? state.searchQuery,
        searchFocusNonce: state.searchFocusNonce + 1,
      })),

      setSearchQuery: (query) => set({ searchQuery: query }),

      setSearchScope: (scope) => set({ searchScope: scope }),

      setHistoryContent: (content) => set({ historyContent: content }),
    }),
    {
      name: 'mdviewer-storage',
      version: 6,
      storage: createJSONStorage(() => documentWindowPath ? documentWindowStorage(localStorage) : localStorage),
      partialize: (state) => ({
        // Only persist these fields
        directories: state.directories,
        expandedPaths: state.expandedPaths,
        documentsLayout: state.documentsLayout,
        agentVisible: state.agentVisible,
        panelZoom: state.panelZoom,
        statusBarPinned: state.statusBarPinned,
        autoRefresh: state.autoRefresh,
        showTextFiles: state.showTextFiles,
        checkUpdatesOnStart: state.checkUpdatesOnStart,
        theme: state.theme,
        searchScope: state.searchScope,
        workspaces: state.workspaces,
        activeWorkspace: state.activeWorkspace,
      }),
      // Without this, zustand would silently drop the whole persisted state
      // (directories, workspaces, ...) on a version bump. The v3 text colour
      // default is the reader's concern now (reader.ts).
      migrate: (persistedState, version) => {
        const persisted = (persistedState ?? {}) as Partial<AppState> & Record<string, unknown>;
        // v5: tabs, zoom, edit mode and the reader settings are the reader store's
        // (reader.ts took them over before this store was created)
        if (version < 5) {
          for (const key of ['tabs', 'activeTabId', 'scrollPositions', 'zoom', 'editMode', 'smoothScroll', 'loadRemoteImages',
            'markdownTextColor', 'markdownTextColorLight', 'languageAliases', 'searchOptions']) delete persisted[key];
        }
        // The old flag meant "open the separate agent panel". The new root
        // starts visible (collapsed) for existing users too.
        if (version < 4) persisted.agentVisible = true;
        // v6: the side panels' widths and visibility are the Documents layout
        if (version < 6) {
          persisted.documentsLayout = documentsLayoutFrom(persisted as Record<string, unknown>);
          for (const key of ['panelWidth', 'filePanelVisible', 'tocWidth', 'tocVisible']) delete persisted[key];
        }
        return persisted;
      },
      merge: (persistedState, currentState) => {
        const persisted = (persistedState ?? {}) as Partial<AppState>;

        return {
          ...currentState,
          ...persisted,
          documentsLayout: isDocumentsLayout(persisted.documentsLayout) ? persisted.documentsLayout : currentState.documentsLayout,
          panelZoom: { ...DEFAULT_PANEL_ZOOM, ...persisted.panelZoom },
        };
      },
    }
  )
);

/** Whether a panel of the Documents view shows. */
export const panelShown = (state: Pick<AppState, 'documentsLayout'>, panel: DocumentsPane): boolean => isPaneShown(state.documentsLayout, panel);

// The reader renders in the app's theme
useReader.getState().setTheme(useStore.getState().theme);
useStore.subscribe((state, prev) => {
  if (state.theme !== prev.theme) useReader.getState().setTheme(state.theme);
});

// The file tree selects the document shown in the focused group
useReader.subscribe((state, prev) => {
  const path = activeTabOf(focusedGroupOf(state))?.path;
  if (path && path !== activeTabOf(focusedGroupOf(prev))?.path) useStore.getState().setSelectedPath(path);
});

export default useStore;
