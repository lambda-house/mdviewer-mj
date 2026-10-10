import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { DEFAULT_SEARCH_OPTIONS, type SearchOptions } from '../utils/search';
import type { ColorTheme } from '../utils/markdown';
import { normalizeDirPath, isPathInside, pathChain, reuseUnchangedNodes } from '../utils/files';

// ============================================================
// Constants
// ============================================================

export const MAX_RECENT_CLOSED = 10;
/** Back/forward tab navigation entries kept in memory. */
const MAX_NAV_HISTORY = 50;
export const MIN_ZOOM = 50;
export const MAX_ZOOM = 1600;
/** Zoom in/out is multiplicative so 50%..1600% stays a reasonable number of steps. */
const ZOOM_STEP = 1.1;
export const DEFAULT_MARKDOWN_TEXT_COLOR = '#9a9996';
export const DEFAULT_MARKDOWN_TEXT_COLOR_LIGHT = '#1f1f1f';
/** Default text color before 1.0.3 - migrated to the new default if never changed. */
const LEGACY_MARKDOWN_TEXT_COLOR = '#cccccc';

const clampZoom = (zoom: number) => Math.round(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom)));

export const PANEL_MIN_WIDTH = 200;
export const PANEL_MAX_WIDTH = 400;
export const TOC_MIN_WIDTH = 180;
export const TOC_MAX_WIDTH = 320;

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

export interface Document {
  path: string;
  content: string;
  originalContent: string; // For dirty checking
  renderedHtml: string;
  headings: Heading[];
  lastModified: number; // timestamp for serialization
  isDirty: boolean;
}

export interface Heading {
  id: string;
  text: string;
  level: number;
}

export interface Tab {
  id: string;
  path: string;
  title: string;
  isDirty: boolean;
  /**
   * Preview tab (VS Code model): a single-click in the file tree reuses it,
   * shown in italics. Pinning, double-clicking or editing makes it permanent.
   */
  isPreview?: boolean;
}

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

/** Jump to a search result once its document is rendered. */
export interface FindRequest {
  path: string;
  /** 0-based source line and column of the match. */
  line: number;
  column: number;
  nonce: number;
}

export interface OpenDocumentOptions {
  /** Open in (or replace) the preview tab instead of a permanent tab. */
  preview?: boolean;
}

export interface ClosedTab {
  path: string;
  title: string;
  closedAt: number;
}

/** A document restored from the previous session. */
export interface RestoredDocument {
  path: string;
  content: string;
}

// ============================================================
// Store Interface
// ============================================================

interface AppState {
  // File Panel (use arrays for serialization)
  directories: string[];
  files: FileNode[];
  expandedPaths: string[];
  selectedPath: string | null;
  filterQuery: string;
  
  // Document Panel (use Record for serialization)
  documents: Record<string, Document>;
  tabs: Tab[];
  activeTabId: string | null;
  recentlyClosed: ClosedTab[];
  /**
   * Scroll offset per document path. Kept out of `tabs` on purpose: it changes
   * while scrolling and must not invalidate anything that renders tabs.
   */
  scrollPositions: Record<string, number>;
  /** True once the previous session's tabs have been reloaded (or found empty). */
  sessionRestored: boolean;
  /** Tab ids in activation order, for back/forward. Not persisted. */
  navHistory: string[];
  navIndex: number;
  
  // UI State
  panelWidth: number;
  filePanelVisible: boolean;
  tocWidth: number;
  tocVisible: boolean;
  zoom: number;
  /** Zoom of the file panel and the TOC, independent of the document zoom. */
  panelZoom: Record<ZoomPanel, number>;
  statusBarVisible: boolean;
  statusBarPinned: boolean;
  activeHeadingId: string | null;
  autoRefresh: boolean;
  /** List other text files (code, txt, fb2...) in the file tree, not just markdown. */
  showTextFiles: boolean;
  smoothScroll: boolean;
  /** Show web images in documents without asking first. */
  loadRemoteImages: boolean;

  // Appearance
  /** Rendered markdown text color in the dark theme. */
  markdownTextColor: string;
  /** Rendered markdown text color in the light theme. */
  markdownTextColorLight: string;
  theme: ColorTheme;
  /** Source editor next to (or, for non-markdown files, instead of) the preview. */
  editMode: boolean;

  // Code Highlighting
  languageAliases: Record<string, string>;

  // Modal state
  showUnsavedModal: boolean;
  pendingCloseTabId: string | null;
  settingsOpen: boolean;

  // History
  historyVisible: boolean;
  historyContent: string;

  // Workspaces
  workspaces: Workspace[];
  /** Name of the workspace the current folders/tabs belong to. */
  activeWorkspace: string | null;

  // Search - options are shared by find-in-document and the search panel
  searchOptions: SearchOptions;
  findOpen: boolean;
  findQuery: string;
  /** Bumped to (re)focus the find input. */
  findFocusNonce: number;
  findRequest: FindRequest | null;
  searchVisible: boolean;
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
  
  // Actions - Documents
  openDocument: (
    path: string,
    content: string,
    options?: OpenDocumentOptions
  ) => { success: boolean; error?: string };
  closeDocument: (tabId: string, force?: boolean) => void;
  /** Close several tabs at once. Tabs with unsaved changes are kept open. */
  closeTabs: (tabIds: string[]) => { success: boolean; error?: string };
  closeOtherTabs: (tabId: string) => { success: boolean; error?: string };
  closeTabsToLeft: (tabId: string) => { success: boolean; error?: string };
  closeTabsToRight: (tabId: string) => { success: boolean; error?: string };
  closeAllTabs: () => { success: boolean; error?: string };
  /** Turn the preview tab into a permanent one. */
  pinTab: (tabId: string) => void;
  navigateBack: () => void;
  navigateForward: () => void;
  confirmCloseDocument: () => void;
  cancelCloseDocument: () => void;
  setActiveTab: (tabId: string) => void;
  activateNextTab: () => void;
  activatePrevTab: () => void;
  activateTabByIndex: (index: number) => void;
  updateDocumentContent: (path: string, content: string) => void;
  /**
   * Mark a document as saved. `savedContent` is the text that was written -
   * edits made while the write was running stay dirty.
   */
  saveDocument: (path: string, savedContent?: string) => void;
  reopenClosedTab: () => ClosedTab | null;
  restoreSession: (documents: RestoredDocument[]) => void;
  setScrollPosition: (path: string, position: number) => void;
  getScrollPosition: (path: string) => number;
  
  // Actions - UI
  setPanelWidth: (width: number) => void;
  setFilePanelVisible: (visible: boolean) => void;
  setTocWidth: (width: number) => void;
  setTocVisible: (visible: boolean) => void;
  toggleTocVisible: () => void;
  setZoom: (zoom: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  /** Step a panel's zoom in (1) or out (-1), or reset it to 100% (0). */
  zoomPanel: (panel: ZoomPanel, direction: 1 | -1 | 0) => void;
  setStatusBarVisible: (visible: boolean) => void;
  setStatusBarPinned: (pinned: boolean) => void;
  setActiveHeadingId: (id: string | null) => void;
  setSettingsOpen: (open: boolean) => void;
  setAutoRefresh: (enabled: boolean) => void;
  setShowTextFiles: (enabled: boolean) => void;
  setSmoothScroll: (enabled: boolean) => void;
  setLoadRemoteImages: (enabled: boolean) => void;

  // Appearance
  setMarkdownTextColor: (color: string) => void;
  setMarkdownTextColorLight: (color: string) => void;
  toggleTheme: () => void;
  toggleEditMode: () => void;

  // Code Highlighting
  setLanguageAlias: (alias: string, language: string) => void;
  removeLanguageAlias: (alias: string) => void;
  setLanguageAliases: (aliases: Record<string, string>) => void;

  // History
  setHistoryVisible: (visible: boolean) => void;
  toggleHistoryVisible: () => void;

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
  setSearchOptions: (options: Partial<SearchOptions>) => void;
  /** Open (and focus) the find bar, optionally with a new query. */
  openFind: (query?: string) => void;
  closeFind: () => void;
  setFindQuery: (query: string) => void;
  /** Open the find bar on `query` and jump to the match at path:line:column. */
  requestFindAt: (path: string, line: number, column: number, query: string) => void;
  clearFindRequest: () => void;
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

let idCounter = 0;

function generateId(): string {
  idCounter += 1;
  return `${Date.now().toString(36)}-${idCounter.toString(36)}-${Math.random().toString(36).substring(2, 9)}`;
}

function getFileName(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

/** Keep only the scroll offsets that still belong to a known document. */
function pruneScrollPositions(
  positions: Record<string, number>,
  keep: Iterable<string>
): Record<string, number> {
  const allowed = new Set(keep);
  const next: Record<string, number> = {};
  for (const [path, offset] of Object.entries(positions)) {
    if (allowed.has(path)) next[path] = offset;
  }
  return next;
}

/**
 * Persisted tabs come from older app versions too, where they were stored
 * without an `id`. A tab without an id makes every lookup by id match the
 * wrong tab (or all of them), so normalize the shape on rehydrate.
 */
function normalizeTabs(tabs: unknown): Tab[] {
  if (!Array.isArray(tabs)) return [];

  const seen = new Set<string>();
  const normalized: Tab[] = [];

  for (const raw of tabs) {
    const tab = raw as Partial<Tab> | null;
    const path = tab && typeof tab.path === 'string' ? tab.path : '';
    if (!path || seen.has(path)) continue;
    seen.add(path);

    normalized.push({
      id: tab && typeof tab.id === 'string' && tab.id ? tab.id : generateId(),
      path,
      title: tab && typeof tab.title === 'string' && tab.title ? tab.title : getFileName(path),
      isDirty: false,
      isPreview: tab?.isPreview === true,
    });
  }

  return normalized;
}

/**
 * Remove tabs (and their documents) from the state. The closed tabs go to the
 * recently-closed list; if the active tab is closed, its neighbour takes over.
 */
function removeTabs(state: AppState, tabIds: string[]): Partial<AppState> {
  const ids = new Set(tabIds);
  const closing = state.tabs.filter((t) => ids.has(t.id));
  if (closing.length === 0) return {};

  const newTabs = state.tabs.filter((t) => !ids.has(t.id));

  const now = Date.now();
  const closedTabs: ClosedTab[] = closing
    .map((t) => ({ path: t.path, title: t.title, closedAt: now }))
    .reverse(); // last tab in the strip is reopened first
  const newRecentlyClosed = [...closedTabs, ...state.recentlyClosed].slice(0, MAX_RECENT_CLOSED);

  const newDocuments = { ...state.documents };
  for (const tab of closing) {
    delete newDocuments[tab.path];
  }

  let newActiveTabId = state.activeTabId;
  if (newActiveTabId && ids.has(newActiveTabId)) {
    // Nearest surviving tab to the right of the old position, else to the left
    const oldIndex = state.tabs.findIndex((t) => t.id === newActiveTabId);
    const right = state.tabs.slice(oldIndex + 1).find((t) => !ids.has(t.id));
    const left = state.tabs.slice(0, oldIndex).reverse().find((t) => !ids.has(t.id));
    newActiveTabId = (right ?? left)?.id ?? null;
  }
  const newActiveTab = newTabs.find((t) => t.id === newActiveTabId);

  return {
    tabs: newTabs,
    activeTabId: newActiveTabId,
    selectedPath: newActiveTab?.path ?? state.selectedPath,
    documents: newDocuments,
    recentlyClosed: newRecentlyClosed,
    // Keep the offset of recently closed docs so reopening returns to it
    scrollPositions: pruneScrollPositions(state.scrollPositions, [
      ...newTabs.map((t) => t.path),
      ...newRecentlyClosed.map((t) => t.path),
    ]),
  };
}

/** Close the given tabs, skipping (and reporting) ones with unsaved changes. */
function closeTabsResult(
  get: () => AppState,
  set: (partial: Partial<AppState>) => void,
  tabIds: string[]
): { success: boolean; error?: string } {
  const state = get();
  const ids = new Set(tabIds);
  const dirty = state.tabs.filter((t) => ids.has(t.id) && t.isDirty);
  const closable = state.tabs.filter((t) => ids.has(t.id) && !t.isDirty).map((t) => t.id);

  set(removeTabs(state, closable));

  if (dirty.length > 0) {
    return {
      success: false,
      error: `Kept ${dirty.length} tab(s) with unsaved changes: ${dirty.map((t) => t.title).join(', ')}`,
    };
  }
  return { success: true };
}

/**
 * Set while back/forward is switching tabs, so that switch is not recorded
 * as a new navigation entry.
 */
let isNavigating = false;

/** Find the next still-open tab in the nav history, stepping by `direction`. */
function findNavTarget(state: AppState, direction: -1 | 1): number {
  const openIds = new Set(state.tabs.map((t) => t.id));
  for (let i = state.navIndex + direction; i >= 0 && i < state.navHistory.length; i += direction) {
    const id = state.navHistory[i];
    if (openIds.has(id) && id !== state.activeTabId) return i;
  }
  return -1;
}

export const canNavigateBack = (state: AppState) => findNavTarget(state, -1) !== -1;
export const canNavigateForward = (state: AppState) => findNavTarget(state, 1) !== -1;

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
      documents: {},
      tabs: [],
      activeTabId: null,
      recentlyClosed: [],
      scrollPositions: {},
      sessionRestored: false,
      navHistory: [],
      navIndex: -1,
      
      // Initial State - UI
      panelWidth: 280,
      filePanelVisible: true,
      tocWidth: 220,
      tocVisible: true,
      zoom: 100,
      panelZoom: DEFAULT_PANEL_ZOOM,
      statusBarVisible: false,
      statusBarPinned: false,
      activeHeadingId: null,
      autoRefresh: true,
      showTextFiles: true,
      smoothScroll: true,
      loadRemoteImages: false,

      // Appearance
      markdownTextColor: DEFAULT_MARKDOWN_TEXT_COLOR,
      markdownTextColorLight: DEFAULT_MARKDOWN_TEXT_COLOR_LIGHT,
      theme: 'dark',
      editMode: false,

      // Code Highlighting - default aliases
      languageAliases: {
        'tsx': 'typescript',
        'jsx': 'javascript',
        'sh': 'bash',
        'zsh': 'bash',
        'sc': 'scala',
        'py': 'python',
        'rb': 'ruby',
        'rs': 'rust',
        'ts': 'typescript',
        'js': 'javascript',
        'yml': 'yaml',
      },
      
      // Modal state
      showUnsavedModal: false,
      pendingCloseTabId: null,
      settingsOpen: false,

      // History
      historyVisible: false,
      workspaces: [],
      activeWorkspace: null,
      searchOptions: DEFAULT_SEARCH_OPTIONS,
      findOpen: false,
      findQuery: '',
      findFocusNonce: 0,
      findRequest: null,
      searchVisible: false,
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
      // Actions - Documents
      // ============================================================
      
      openDocument: (path, content, options = {}) => {
        const state = get();
        const preview = options.preview === true;
        
        // Check if already open. A permanent open of the preview tab pins it;
        // a preview open never un-pins a tab.
        const existingTab = state.tabs.find((t) => t.path === path);
        if (existingTab) {
          set({
            activeTabId: existingTab.id,
            selectedPath: path,
            tabs: !preview && existingTab.isPreview
              ? state.tabs.map((t) => (t.id === existingTab.id ? { ...t, isPreview: false } : t))
              : state.tabs,
          });
          return { success: true };
        }
        
        // Create new tab
        const tabId = generateId();
        const newTab: Tab = {
          id: tabId,
          path,
          title: getFileName(path),
          isDirty: false,
          isPreview: preview,
        };
        
        // Create document
        const newDocument: Document = {
          path,
          content,
          originalContent: content,
          renderedHtml: '',
          headings: [],
          lastModified: Date.now(),
          isDirty: false,
        };
        
        // A new preview replaces the current (unmodified) preview tab in place
        const previewTab = preview ? state.tabs.find((t) => t.isPreview && !t.isDirty) : undefined;
        if (previewTab) {
          const documents = { ...state.documents, [path]: newDocument };
          delete documents[previewTab.path];
          set({
            tabs: state.tabs.map((t) => (t.id === previewTab.id ? newTab : t)),
            activeTabId: tabId,
            documents,
            selectedPath: path,
          });
          return { success: true };
        }
        
        set({
          tabs: [...state.tabs, newTab],
          activeTabId: tabId,
          documents: { ...state.documents, [path]: newDocument },
          selectedPath: path,
        });
        
        return { success: true };
      },
      
      closeDocument: (tabId, force = false) => {
        const state = get();
        const tab = state.tabs.find((t) => t.id === tabId);
        
        if (!tab) return;
        
        // Check for unsaved changes
        if (tab.isDirty && !force) {
          set({ 
            showUnsavedModal: true, 
            pendingCloseTabId: tabId 
          });
          return;
        }
        
        set({
          ...removeTabs(state, [tabId]),
          showUnsavedModal: false,
          pendingCloseTabId: null,
        });
      },

      closeTabs: (tabIds) => closeTabsResult(get, set, tabIds),

      closeOtherTabs: (tabId) =>
        closeTabsResult(get, set, get().tabs.filter((t) => t.id !== tabId).map((t) => t.id)),

      closeTabsToLeft: (tabId) => {
        const tabs = get().tabs;
        const index = tabs.findIndex((t) => t.id === tabId);
        return closeTabsResult(get, set, index > 0 ? tabs.slice(0, index).map((t) => t.id) : []);
      },

      closeTabsToRight: (tabId) => {
        const tabs = get().tabs;
        const index = tabs.findIndex((t) => t.id === tabId);
        return closeTabsResult(get, set, index >= 0 ? tabs.slice(index + 1).map((t) => t.id) : []);
      },

      closeAllTabs: () => closeTabsResult(get, set, get().tabs.map((t) => t.id)),

      pinTab: (tabId) => set((state) => ({
        tabs: state.tabs.map((t) => (t.id === tabId && t.isPreview ? { ...t, isPreview: false } : t)),
      })),

      navigateBack: () => {
        const state = get();
        const index = findNavTarget(state, -1);
        if (index === -1) return;
        isNavigating = true;
        try {
          get().setActiveTab(state.navHistory[index]);
          set({ navIndex: index });
        } finally {
          isNavigating = false;
        }
      },

      navigateForward: () => {
        const state = get();
        const index = findNavTarget(state, 1);
        if (index === -1) return;
        isNavigating = true;
        try {
          get().setActiveTab(state.navHistory[index]);
          set({ navIndex: index });
        } finally {
          isNavigating = false;
        }
      },
      
      confirmCloseDocument: () => {
        const state = get();
        if (state.pendingCloseTabId) {
          get().closeDocument(state.pendingCloseTabId, true);
        }
      },
      
      cancelCloseDocument: () => {
        set({ 
          showUnsavedModal: false, 
          pendingCloseTabId: null 
        });
      },
      
      setActiveTab: (tabId) => set((state) => {
        if (state.activeTabId === tabId) return state;
        const tab = state.tabs.find((t) => t.id === tabId);
        return {
          activeTabId: tabId,
          selectedPath: tab?.path || state.selectedPath,
        };
      }),
      
      activateNextTab: () => {
        const state = get();
        if (state.tabs.length <= 1) return;
        
        const currentIndex = state.tabs.findIndex((t) => t.id === state.activeTabId);
        const nextIndex = (currentIndex + 1) % state.tabs.length;
        get().setActiveTab(state.tabs[nextIndex].id);
      },
      
      activatePrevTab: () => {
        const state = get();
        if (state.tabs.length <= 1) return;
        
        const currentIndex = state.tabs.findIndex((t) => t.id === state.activeTabId);
        const prevIndex = (currentIndex - 1 + state.tabs.length) % state.tabs.length;
        get().setActiveTab(state.tabs[prevIndex].id);
      },
      
      activateTabByIndex: (index) => {
        const state = get();
        if (index >= 0 && index < state.tabs.length) {
          get().setActiveTab(state.tabs[index].id);
        }
      },
      
      updateDocumentContent: (path, content) => set((state) => {
        const doc = state.documents[path];
        if (!doc) return state;
        
        const isDirty = content !== doc.originalContent;
        
        return {
          documents: {
            ...state.documents,
            [path]: { ...doc, content, isDirty },
          },
          tabs: state.tabs.map((t) =>
            t.path === path ? { ...t, isDirty, isPreview: t.isPreview && !isDirty } : t
          ),
        };
      }),
      
      saveDocument: (path, savedContent) => set((state) => {
        const doc = state.documents[path];
        if (!doc) return state;

        const originalContent = savedContent ?? doc.content;
        const isDirty = doc.content !== originalContent;
        
        return {
          documents: {
            ...state.documents,
            [path]: { 
              ...doc, 
              originalContent, 
              isDirty,
              lastModified: Date.now(),
            },
          },
          tabs: state.tabs.map((t) =>
            t.path === path ? { ...t, isDirty } : t
          ),
        };
      }),
      
      reopenClosedTab: () => {
        const state = get();
        if (state.recentlyClosed.length === 0) return null;
        
        const [mostRecent, ...rest] = state.recentlyClosed;
        set({ recentlyClosed: rest });
        
        return mostRecent;
      },

      /**
       * Rebuild the previous session: tabs whose file could be re-read get a
       * document again, the rest are dropped. Called once on startup.
       */
      restoreSession: (restored) => set((state) => {
        const contentByPath = new Map(restored.map((d) => [d.path, d.content]));
        const tabs = state.tabs.filter((t) => contentByPath.has(t.path));

        const documents: Record<string, Document> = { ...state.documents };
        for (const tab of tabs) {
          const content = contentByPath.get(tab.path) as string;
          documents[tab.path] = {
            path: tab.path,
            content,
            originalContent: content,
            renderedHtml: '',
            headings: [],
            lastModified: Date.now(),
            isDirty: false,
          };
        }

        const activeTabId = tabs.some((t) => t.id === state.activeTabId)
          ? state.activeTabId
          : tabs[0]?.id ?? null;
        const activeTab = tabs.find((t) => t.id === activeTabId);

        return {
          tabs,
          documents,
          activeTabId,
          selectedPath: activeTab?.path ?? state.selectedPath,
          scrollPositions: pruneScrollPositions(
            state.scrollPositions,
            tabs.map((t) => t.path)
          ),
          sessionRestored: true,
        };
      }),

      setScrollPosition: (path, position) => set((state) => {
        if (!path) return state;
        const rounded = Math.max(0, Math.round(position));
        if (state.scrollPositions[path] === rounded) return state;
        return {
          scrollPositions: { ...state.scrollPositions, [path]: rounded },
        };
      }),

      getScrollPosition: (path) => get().scrollPositions[path] ?? 0,
      
      // ============================================================
      // Actions - UI
      // ============================================================
      
      setPanelWidth: (width) => set({ 
        panelWidth: Math.round(Math.max(PANEL_MIN_WIDTH, Math.min(PANEL_MAX_WIDTH, width))) 
      }),

      setFilePanelVisible: (visible) => set({ filePanelVisible: visible }),
      
      setTocWidth: (width) => set({ 
        tocWidth: Math.round(Math.max(TOC_MIN_WIDTH, Math.min(TOC_MAX_WIDTH, width))) 
      }),
      
      setTocVisible: (visible) => set({ tocVisible: visible }),
      
      toggleTocVisible: () => set((state) => ({ tocVisible: !state.tocVisible })),
      
      setZoom: (zoom) => set({ zoom: clampZoom(zoom) }),
      
      zoomIn: () => set((state) => ({ zoom: clampZoom(state.zoom * ZOOM_STEP) })),
      
      zoomOut: () => set((state) => ({ zoom: clampZoom(state.zoom / ZOOM_STEP) })),
      
      resetZoom: () => set({ zoom: 100 }),

      zoomPanel: (panel, direction) => set((state) => {
        const current = state.panelZoom[panel];
        const next = direction === 0
          ? 100
          : clampPanelZoom(direction > 0 ? current * ZOOM_STEP : current / ZOOM_STEP);
        return next === current ? state : { panelZoom: { ...state.panelZoom, [panel]: next } };
      }),
      
      setStatusBarVisible: (visible) => set((state) => (
        state.statusBarVisible === visible ? state : { statusBarVisible: visible }
      )),
      
      setStatusBarPinned: (pinned) => set({ statusBarPinned: pinned }),
      
      // Called from the scroll handler: skip the update (and the re-render of
      // every subscriber) when the heading has not actually changed.
      setActiveHeadingId: (id) => set((state) => (
        state.activeHeadingId === id ? state : { activeHeadingId: id }
      )),

      setSettingsOpen: (open) => set({ settingsOpen: open }),

      setAutoRefresh: (enabled) => set({ autoRefresh: enabled }),

      setShowTextFiles: (enabled) => set({ showTextFiles: enabled }),

      setSmoothScroll: (enabled) => set({ smoothScroll: enabled }),

      setLoadRemoteImages: (enabled) => set({ loadRemoteImages: enabled }),

      // Appearance
      setMarkdownTextColor: (color) => set({ markdownTextColor: color }),

      setMarkdownTextColorLight: (color) => set({ markdownTextColorLight: color }),

      toggleTheme: () => set((state) => ({ theme: state.theme === 'dark' ? 'light' : 'dark' })),

      toggleEditMode: () => set((state) => ({ editMode: !state.editMode })),

      // Code Highlighting
      setLanguageAlias: (alias, language) => set((state) => ({
        languageAliases: {
          ...state.languageAliases,
          [alias.toLowerCase()]: language.toLowerCase(),
        },
      })),

      removeLanguageAlias: (alias) => set((state) => {
        const newAliases = { ...state.languageAliases };
        delete newAliases[alias.toLowerCase()];
        return { languageAliases: newAliases };
      }),

      setLanguageAliases: (aliases) => set({ languageAliases: aliases }),

      // History
      setHistoryVisible: (visible) => set({ historyVisible: visible }),

      toggleHistoryVisible: () => set((state) => ({
        historyVisible: !state.historyVisible,
        // History and search share the left slot
        searchVisible: state.historyVisible ? state.searchVisible : false,
      })),

      // Workspaces
      saveWorkspace: (rawName) => {
        const name = rawName.trim();
        if (!name) return { success: false, error: 'Workspace name is empty' };

        const state = get();
        const workspace: Workspace = {
          name,
          directories: state.directories,
          expandedPaths: state.expandedPaths,
          tabs: state.tabs.map((t) => t.path),
          activePath: state.tabs.find((t) => t.id === state.activeTabId)?.path ?? null,
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

        const tabs: Tab[] = workspace.tabs.map((path) => ({
          id: generateId(),
          path,
          title: getFileName(path),
          isDirty: false,
        }));
        const active = tabs.find((t) => t.path === workspace.activePath) ?? tabs[0];

        set({
          activeWorkspace: name,
          directories: workspace.directories,
          expandedPaths: workspace.expandedPaths,
          files: [],
          tabs,
          activeTabId: active?.id ?? null,
          selectedPath: active?.path ?? null,
          documents: {},
          navHistory: [],
          navIndex: -1,
          findOpen: false,
          findRequest: null,
        });
        return workspace;
      },

      // Search
      setSearchOptions: (options) => set((state) => ({
        searchOptions: { ...state.searchOptions, ...options },
      })),

      openFind: (query) => set((state) => ({
        findOpen: true,
        findQuery: query ?? state.findQuery,
        findFocusNonce: state.findFocusNonce + 1,
      })),

      closeFind: () => set({ findOpen: false, findRequest: null }),

      setFindQuery: (query) => set({ findQuery: query }),

      requestFindAt: (path, line, column, query) => set((state) => ({
        findOpen: true,
        findQuery: query,
        findRequest: { path, line, column, nonce: (state.findRequest?.nonce ?? 0) + 1 },
      })),

      clearFindRequest: () => set({ findRequest: null }),

      setSearchVisible: (visible) => set((state) => ({
        searchVisible: visible,
        historyVisible: visible ? false : state.historyVisible,
      })),

      openSearch: (query) => set((state) => ({
        searchVisible: true,
        historyVisible: false,
        searchQuery: query ?? state.searchQuery,
        searchFocusNonce: state.searchFocusNonce + 1,
      })),

      setSearchQuery: (query) => set({ searchQuery: query }),

      setSearchScope: (scope) => set({ searchScope: scope }),

      setHistoryContent: (content) => set({ historyContent: content }),
    }),
    {
      name: 'mdviewer-storage',
      version: 3,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        // Only persist these fields
        directories: state.directories,
        expandedPaths: state.expandedPaths,
        panelWidth: state.panelWidth,
        filePanelVisible: state.filePanelVisible,
        tocWidth: state.tocWidth,
        tocVisible: state.tocVisible,
        zoom: state.zoom,
        panelZoom: state.panelZoom,
        statusBarPinned: state.statusBarPinned,
        autoRefresh: state.autoRefresh,
        showTextFiles: state.showTextFiles,
        smoothScroll: state.smoothScroll,
        loadRemoteImages: state.loadRemoteImages,
        markdownTextColor: state.markdownTextColor,
        markdownTextColorLight: state.markdownTextColorLight,
        theme: state.theme,
        editMode: state.editMode,
        languageAliases: state.languageAliases,
        searchOptions: state.searchOptions,
        searchScope: state.searchScope,
        workspaces: state.workspaces,
        activeWorkspace: state.activeWorkspace,
        // Session restore: tab identity + which one was active + where each
        // document was scrolled to (documents themselves are re-read on start)
        tabs: state.tabs.map((t) => ({
          id: t.id,
          path: t.path,
          title: t.title,
          isDirty: false,
          isPreview: t.isPreview === true,
        })),
        activeTabId: state.activeTabId,
        scrollPositions: state.scrollPositions,
      }),
      // Nothing to transform here - `merge` below normalizes every shape we
      // have ever written. Without this, zustand would silently drop the whole
      // persisted state (directories, aliases, ...) on a version bump.
      migrate: (persistedState, version) => {
        const persisted = (persistedState ?? {}) as Partial<AppState>;
        // v3: new dark-mode text default; keep colors the user picked themselves
        if (version < 3 && persisted.markdownTextColor?.toLowerCase() === LEGACY_MARKDOWN_TEXT_COLOR) {
          persisted.markdownTextColor = DEFAULT_MARKDOWN_TEXT_COLOR;
        }
        return persisted;
      },
      merge: (persistedState, currentState) => {
        const persisted = (persistedState ?? {}) as Partial<AppState>;
        const tabs = normalizeTabs(persisted.tabs);
        const activeTabId = tabs.some((t) => t.id === persisted.activeTabId)
          ? (persisted.activeTabId as string)
          : tabs[0]?.id ?? null;

        return {
          ...currentState,
          ...persisted,
          tabs,
          activeTabId,
          scrollPositions: persisted.scrollPositions ?? {},
          panelZoom: { ...DEFAULT_PANEL_ZOOM, ...persisted.panelZoom },
          searchOptions: { ...DEFAULT_SEARCH_OPTIONS, ...persisted.searchOptions },
          // Documents are not persisted - they are re-read from disk on start
          documents: {},
          sessionRestored: false,
        };
      },
    }
  )
);

// Record every tab activation (clicks, opens, closes, shortcuts) for
// back/forward, except the switches made by back/forward themselves.
useStore.subscribe((state, prev) => {
  if (isNavigating || state.activeTabId === prev.activeTabId || !state.activeTabId) return;
  if (state.navHistory[state.navIndex] === state.activeTabId) return;

  const history = [...state.navHistory.slice(0, state.navIndex + 1), state.activeTabId]
    .slice(-MAX_NAV_HISTORY);
  useStore.setState({ navHistory: history, navIndex: history.length - 1 });
});

export default useStore;
