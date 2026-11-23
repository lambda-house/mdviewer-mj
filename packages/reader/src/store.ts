import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import type { Heading } from './types';
import type { ColorTheme } from './markdown';
import { getFileName } from './files';
import { DEFAULT_SEARCH_OPTIONS, type SearchOptions } from './search';
import { sameScrollPosition, type ScrollPosition } from './scrollAnchor';

// The reader's state: open documents, the document groups that show them
// (tabs, zoom, find, contents), and the reader's settings (shared UI spec
// §6.1). Each app creates one store with its storage; nothing here knows the
// app. A group is the content of one `documents` pane; until groups can be
// split there is one, MAIN_GROUP.

// ============================================================
// Constants
// ============================================================

export const MAIN_GROUP = 'main';
export const MAX_RECENT_CLOSED = 10;
/** Back/forward entries kept per group, in memory. */
const MAX_NAV_HISTORY = 50;
export const MIN_ZOOM = 50;
export const MAX_ZOOM = 1600;
/** Zoom in/out is multiplicative so 50%..1600% stays a reasonable number of steps. */
const ZOOM_STEP = 1.1;
export const DEFAULT_MARKDOWN_TEXT_COLOR = '#9a9996';
export const DEFAULT_MARKDOWN_TEXT_COLOR_LIGHT = '#1f1f1f';

export const clampZoom = (zoom: number) => Math.round(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom)));

// ============================================================
// Types
// ============================================================

export interface ReaderDocument {
  path: string;
  content: string;
  /** The text on disk, for dirty checking. */
  originalContent: string;
  renderedHtml: string;
  headings: Heading[];
  lastModified: number;
  isDirty: boolean;
}

export interface Tab {
  id: string;
  path: string;
  title: string;
  isDirty: boolean;
  /**
   * Preview tab (VS Code model): a single-click in a file list reuses it,
   * shown in italics. Pinning, double-clicking or editing makes it permanent.
   */
  isPreview?: boolean;
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

/** Jump to a search result once its document is rendered. */
export interface FindRequest {
  path: string;
  /** 0-based source line and column of the match. */
  line: number;
  column: number;
  nonce: number;
}

export interface FindState {
  open: boolean;
  query: string;
  /** Bumped to (re)focus the find input. */
  focusNonce: number;
  request: FindRequest | null;
}

export interface OpenDocumentOptions {
  /** Open in (or replace) the preview tab instead of a permanent tab. */
  preview?: boolean;
  /** The group to open it in; the focused one by default. */
  group?: string;
}

/** The documents shown in one pane: its tabs, zoom, find and contents. */
export interface DocumentGroup {
  id: string;
  tabs: Tab[];
  activeTabId: string | null;
  /** Percent; the editor uses it too. */
  zoom: number;
  /** Tab ids in activation order, for back/forward. Not saved. */
  navHistory: string[];
  navIndex: number;
  /** The shown document's headings and the one in view, for the contents. Not saved. */
  headings: Heading[];
  activeHeadingId: string | null;
  /** Not saved. */
  find: FindState;
}

export interface ReaderSettings {
  smoothScroll: boolean;
  /** Show web images in documents without asking first. */
  loadRemoteImages: boolean;
  /** Rendered markdown text colour in the dark theme. */
  markdownTextColor: string;
  /** Rendered markdown text colour in the light theme. */
  markdownTextColorLight: string;
  /** Code fence language aliases, e.g. `sc` -> `scala`. */
  languageAliases: Record<string, string>;
  /** Find's options; a search panel can share them. */
  searchOptions: SearchOptions;
}

export const DEFAULT_LANGUAGE_ALIASES: Record<string, string> = {
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
};

export const DEFAULT_READER_SETTINGS: ReaderSettings = {
  smoothScroll: true,
  loadRemoteImages: false,
  markdownTextColor: DEFAULT_MARKDOWN_TEXT_COLOR,
  markdownTextColorLight: DEFAULT_MARKDOWN_TEXT_COLOR_LIGHT,
  languageAliases: DEFAULT_LANGUAGE_ALIASES,
  searchOptions: DEFAULT_SEARCH_OPTIONS,
};

type Result = { success: boolean; error?: string };

export interface ReaderState {
  /** Open documents by path; a document open in two groups is one entry. */
  documents: Record<string, ReaderDocument>;
  groups: Record<string, DocumentGroup>;
  focusedGroup: string;
  recentlyClosed: ClosedTab[];
  /**
   * Scroll position per group and document (`scrollKey`). Kept out of the
   * tabs on purpose: it changes while scrolling and must not invalidate
   * anything that renders tabs.
   */
  scroll: Record<string, ScrollPosition>;
  /** True once the previous session's tabs have been reloaded (or found empty). */
  sessionRestored: boolean;
  /** Source editor next to (or, for non-markdown files, instead of) the preview. */
  editMode: boolean;
  /** A tab with unsaved changes waiting for "close anyway?". */
  pendingCloseTabId: string | null;
  /** The "Save All Files?" dialog is showing. */
  saveAllPromptOpen: boolean;
  /** The app's theme; the reader renders with it. Not saved here. */
  theme: ColorTheme;
  settings: ReaderSettings;

  // Documents and tabs
  openDocument: (path: string, content: string, options?: OpenDocumentOptions) => Result;
  closeDocument: (tabId: string, force?: boolean) => void;
  /** Close several tabs at once. Tabs with unsaved changes are kept open. */
  closeTabs: (tabIds: string[]) => Result;
  closeOtherTabs: (tabId: string) => Result;
  closeTabsToLeft: (tabId: string) => Result;
  closeTabsToRight: (tabId: string) => Result;
  closeAllTabs: (group?: string) => Result;
  /** Turn the preview tab into a permanent one. */
  pinTab: (tabId: string) => void;
  navigateBack: (group?: string) => void;
  navigateForward: (group?: string) => void;
  confirmCloseDocument: () => void;
  cancelCloseDocument: () => void;
  setActiveTab: (tabId: string) => void;
  activateNextTab: (group?: string) => void;
  activatePrevTab: (group?: string) => void;
  activateTabByIndex: (index: number, group?: string) => void;
  updateDocumentContent: (path: string, content: string) => void;
  /**
   * Mark a document as saved. `savedContent` is the text that was written -
   * edits made while the write was running stay dirty.
   */
  saveDocument: (path: string, savedContent?: string) => void;
  /** Show what is on disk now, unless the document has unsaved edits. Returns whether it changed. */
  reloadDocument: (path: string, content: string) => boolean;
  reopenClosedTab: () => ClosedTab | null;
  /**
   * Rebuild the previous session: tabs whose file could be re-read get a
   * document again, the rest are dropped. Called once on startup.
   */
  restoreSession: (documents: RestoredDocument[]) => void;
  /** Replace a group's tabs (a saved workspace); their documents still have to be read and restored. */
  replaceTabs: (paths: string[], activePath: string | null, group?: string) => void;
  setScrollPosition: (group: string, path: string, position: ScrollPosition) => void;
  getScrollPosition: (group: string, path: string) => ScrollPosition;
  focusGroup: (group: string) => void;

  // Zoom, contents
  setZoom: (zoom: number, group?: string) => void;
  zoomIn: (group?: string) => void;
  zoomOut: (group?: string) => void;
  resetZoom: (group?: string) => void;
  setHeadings: (headings: Heading[], group?: string) => void;
  setActiveHeadingId: (id: string | null, group?: string) => void;

  // Find
  openFind: (query?: string, group?: string) => void;
  closeFind: (group?: string) => void;
  setFindQuery: (query: string, group?: string) => void;
  /** Open the find bar on `query` and jump to the match at path:line:column. */
  requestFindAt: (path: string, line: number, column: number, query: string, group?: string) => void;
  clearFindRequest: (group?: string) => void;

  // Modes, dialogs, settings
  toggleEditMode: () => void;
  setEditMode: (editMode: boolean) => void;
  setSaveAllPromptOpen: (open: boolean) => void;
  setTheme: (theme: ColorTheme) => void;
  setSettings: (settings: Partial<ReaderSettings>) => void;
  setSearchOptions: (options: Partial<SearchOptions>) => void;
}

/** What an app saved before the reader had its own store: its old tabs, zoom and settings. */
export interface LegacyReaderState {
  tabs?: unknown;
  activeTabId?: unknown;
  scrollPositions?: Record<string, ScrollPosition>;
  zoom?: number;
  editMode?: boolean;
  settings?: Partial<ReaderSettings>;
}

export interface ReaderStoreOptions {
  /** Where the reader keeps tabs, zoom and settings between runs (localStorage); null keeps nothing. */
  storage: StateStorage | null;
  /** The storage key. */
  name: string;
  /** The first run's state, when `name` holds nothing yet: what the app saved before. */
  legacy?: () => LegacyReaderState | null;
}

export type ReaderStore = UseBoundStore<StoreApi<ReaderState>>;

// ============================================================
// Helpers
// ============================================================

let idCounter = 0;

export function generateTabId(): string {
  idCounter += 1;
  return `${Date.now().toString(36)}-${idCounter.toString(36)}-${Math.random().toString(36).substring(2, 9)}`;
}

/** The key of a document's scroll position in a group. */
export const scrollKey = (group: string, path: string) => `${group}\n${path}`;

export function newGroup(id: string, zoom = 100): DocumentGroup {
  return {
    id, tabs: [], activeTabId: null, zoom,
    navHistory: [], navIndex: -1, headings: [], activeHeadingId: null,
    find: { open: false, query: '', focusNonce: 0, request: null },
  };
}

function newDocument(path: string, content: string): ReaderDocument {
  return { path, content, originalContent: content, renderedHtml: '', headings: [], lastModified: Date.now(), isDirty: false };
}

// ---- selectors

export const focusedGroupOf = (state: Pick<ReaderState, 'groups' | 'focusedGroup'>): DocumentGroup =>
  state.groups[state.focusedGroup] ?? Object.values(state.groups)[0];

export const activeTabOf = (group: DocumentGroup | undefined): Tab | null =>
  group?.tabs.find((t) => t.id === group.activeTabId) ?? null;

/** The focused group's shown document. */
export const activeDocumentOf = (state: Pick<ReaderState, 'groups' | 'focusedGroup' | 'documents'>): ReaderDocument | null => {
  const tab = activeTabOf(focusedGroupOf(state));
  return tab ? state.documents[tab.path] ?? null : null;
};

/** Every open tab, group by group. */
export const allTabs = (state: Pick<ReaderState, 'groups'>): Tab[] => Object.values(state.groups).flatMap((g) => g.tabs);

export const groupOfTab = (state: Pick<ReaderState, 'groups'>, tabId: string): DocumentGroup | undefined =>
  Object.values(state.groups).find((g) => g.tabs.some((t) => t.id === tabId));

/** Find the next still-open tab in a group's history, stepping by `direction`. */
function findNavTarget(group: DocumentGroup, direction: -1 | 1): number {
  const openIds = new Set(group.tabs.map((t) => t.id));
  for (let i = group.navIndex + direction; i >= 0 && i < group.navHistory.length; i += direction) {
    const id = group.navHistory[i];
    if (openIds.has(id) && id !== group.activeTabId) return i;
  }
  return -1;
}

export const canNavigateBack = (group: DocumentGroup | undefined) => !!group && findNavTarget(group, -1) !== -1;
export const canNavigateForward = (group: DocumentGroup | undefined) => !!group && findNavTarget(group, 1) !== -1;

/**
 * Saved tabs come from older app versions too, where they were stored without
 * an `id`. A tab without an id makes every lookup by id match the wrong tab
 * (or all of them), so normalize the shape on rehydrate.
 */
export function normalizeTabs(tabs: unknown): Tab[] {
  if (!Array.isArray(tabs)) return [];
  const seen = new Set<string>();
  const normalized: Tab[] = [];
  for (const raw of tabs) {
    const tab = raw as Partial<Tab> | null;
    const path = tab && typeof tab.path === 'string' ? tab.path : '';
    if (!path || seen.has(path)) continue;
    seen.add(path);
    normalized.push({
      id: tab && typeof tab.id === 'string' && tab.id ? tab.id : generateTabId(),
      path,
      title: tab && typeof tab.title === 'string' && tab.title ? tab.title : getFileName(path),
      isDirty: false,
      isPreview: tab?.isPreview === true,
    });
  }
  return normalized;
}

/** Keep only the scroll positions of documents open in their group, or recently closed. */
function pruneScroll(state: Pick<ReaderState, 'scroll' | 'groups' | 'recentlyClosed'>): Record<string, ScrollPosition> {
  const keep = new Set<string>();
  const closed = state.recentlyClosed.map((t) => t.path);
  for (const group of Object.values(state.groups)) {
    for (const path of [...group.tabs.map((t) => t.path), ...closed]) keep.add(scrollKey(group.id, path));
  }
  const next: Record<string, ScrollPosition> = {};
  for (const [key, position] of Object.entries(state.scroll)) if (keep.has(key)) next[key] = position;
  return next;
}

/** Documents no group shows any more go. */
function pruneDocuments(documents: Record<string, ReaderDocument>, groups: Record<string, DocumentGroup>): Record<string, ReaderDocument> {
  const open = new Set(Object.values(groups).flatMap((g) => g.tabs.map((t) => t.path)));
  const next: Record<string, ReaderDocument> = {};
  for (const [path, doc] of Object.entries(documents)) if (open.has(path)) next[path] = doc;
  return next;
}

/**
 * Remove tabs from the state. The closed tabs go to the recently-closed list;
 * if a group's active tab is closed, its neighbour takes over.
 */
function removeTabs(state: ReaderState, tabIds: string[]): Partial<ReaderState> {
  const ids = new Set(tabIds);
  const closing = allTabs(state).filter((t) => ids.has(t.id));
  if (closing.length === 0) return {};

  const groups: Record<string, DocumentGroup> = {};
  for (const group of Object.values(state.groups)) {
    if (!group.tabs.some((t) => ids.has(t.id))) { groups[group.id] = group; continue; }
    let activeTabId = group.activeTabId;
    if (activeTabId && ids.has(activeTabId)) {
      // Nearest surviving tab to the right of the old position, else to the left
      const oldIndex = group.tabs.findIndex((t) => t.id === activeTabId);
      const right = group.tabs.slice(oldIndex + 1).find((t) => !ids.has(t.id));
      const left = group.tabs.slice(0, oldIndex).reverse().find((t) => !ids.has(t.id));
      activeTabId = (right ?? left)?.id ?? null;
    }
    groups[group.id] = { ...group, tabs: group.tabs.filter((t) => !ids.has(t.id)), activeTabId };
  }

  const now = Date.now();
  const closedTabs: ClosedTab[] = closing
    .map((t) => ({ path: t.path, title: t.title, closedAt: now }))
    .reverse(); // last tab in the strip is reopened first
  const recentlyClosed = [...closedTabs, ...state.recentlyClosed].slice(0, MAX_RECENT_CLOSED);

  return {
    groups,
    documents: pruneDocuments(state.documents, groups),
    recentlyClosed,
    // Keep the offset of recently closed docs so reopening returns to it
    scroll: pruneScroll({ scroll: state.scroll, groups, recentlyClosed }),
  };
}

/** Close the given tabs, skipping (and reporting) ones with unsaved changes. */
function closeTabsResult(get: () => ReaderState, set: (partial: Partial<ReaderState>) => void, tabIds: string[]): Result {
  const state = get();
  const ids = new Set(tabIds);
  const tabs = allTabs(state).filter((t) => ids.has(t.id));
  const dirty = tabs.filter((t) => t.isDirty);
  set(removeTabs(state, tabs.filter((t) => !t.isDirty).map((t) => t.id)));
  if (dirty.length > 0) {
    return { success: false, error: `Kept ${dirty.length} tab(s) with unsaved changes: ${dirty.map((t) => t.title).join(', ')}` };
  }
  return { success: true };
}

// ============================================================
// Store
// ============================================================

export function createReaderStore({ storage, name, legacy }: ReaderStoreOptions): ReaderStore {
  /** Set while back/forward switch tabs, so that switch is not recorded as a new entry. */
  let isNavigating = false;

  const store = create<ReaderState>()(
    persist(
      (set, get) => {
        /** The group an action without one acts on. */
        const groupId = (group?: string) => (group && get().groups[group] ? group : focusedGroupOf(get()).id);
        const updateGroup = (group: string | undefined, update: (g: DocumentGroup) => Partial<DocumentGroup>) =>
          set((state) => {
            const id = group && state.groups[group] ? group : focusedGroupOf(state).id;
            const current = state.groups[id];
            return { groups: { ...state.groups, [id]: { ...current, ...update(current) } } };
          });
        const updateFind = (group: string | undefined, update: (f: FindState) => Partial<FindState>) =>
          updateGroup(group, (g) => ({ find: { ...g.find, ...update(g.find) } }));
        const step = (group: string | undefined, direction: -1 | 1) => {
          const g = get().groups[groupId(group)];
          const index = findNavTarget(g, direction);
          if (index === -1) return;
          isNavigating = true;
          try {
            get().setActiveTab(g.navHistory[index]);
            updateGroup(g.id, () => ({ navIndex: index }));
          } finally {
            isNavigating = false;
          }
        };
        const cycle = (group: string | undefined, offset: 1 | -1) => {
          const g = get().groups[groupId(group)];
          if (g.tabs.length <= 1) return;
          const current = g.tabs.findIndex((t) => t.id === g.activeTabId);
          get().setActiveTab(g.tabs[(current + offset + g.tabs.length) % g.tabs.length].id);
        };

        return {
          documents: {},
          groups: { [MAIN_GROUP]: newGroup(MAIN_GROUP) },
          focusedGroup: MAIN_GROUP,
          recentlyClosed: [],
          scroll: {},
          sessionRestored: false,
          editMode: false,
          pendingCloseTabId: null,
          saveAllPromptOpen: false,
          theme: 'dark',
          settings: DEFAULT_READER_SETTINGS,

          openDocument: (path, content, options = {}) => {
            const state = get();
            const preview = options.preview === true;
            const id = groupId(options.group);
            const group = state.groups[id];
            const documents = state.documents[path] ? state.documents : { ...state.documents, [path]: newDocument(path, content) };

            // Already open here: a permanent open of the preview tab pins it; a preview open never un-pins a tab
            const existing = group.tabs.find((t) => t.path === path);
            if (existing) {
              updateGroup(id, (g) => ({
                activeTabId: existing.id,
                tabs: !preview && existing.isPreview ? g.tabs.map((t) => (t.id === existing.id ? { ...t, isPreview: false } : t)) : g.tabs,
              }));
              return { success: true };
            }

            const tab: Tab = { id: generateTabId(), path, title: getFileName(path), isDirty: false, isPreview: preview };
            // A new preview replaces the group's current (unmodified) preview tab in place
            const previewTab = preview ? group.tabs.find((t) => t.isPreview && !t.isDirty) : undefined;
            const tabs = previewTab ? group.tabs.map((t) => (t.id === previewTab.id ? tab : t)) : [...group.tabs, tab];
            const groups = { ...state.groups, [id]: { ...group, tabs, activeTabId: tab.id } };
            set({ groups, documents: pruneDocuments(documents, groups) });
            return { success: true };
          },

          closeDocument: (tabId, force = false) => {
            const state = get();
            const tab = allTabs(state).find((t) => t.id === tabId);
            if (!tab) return;
            if (tab.isDirty && !force && allTabs(state).filter((t) => t.path === tab.path).length === 1) {
              set({ pendingCloseTabId: tabId });
              return;
            }
            set({ ...removeTabs(state, [tabId]), pendingCloseTabId: null });
          },

          closeTabs: (tabIds) => closeTabsResult(get, set, tabIds),
          closeOtherTabs: (tabId) => {
            const g = groupOfTab(get(), tabId);
            return closeTabsResult(get, set, g ? g.tabs.filter((t) => t.id !== tabId).map((t) => t.id) : []);
          },
          closeTabsToLeft: (tabId) => {
            const tabs = groupOfTab(get(), tabId)?.tabs ?? [];
            const index = tabs.findIndex((t) => t.id === tabId);
            return closeTabsResult(get, set, index > 0 ? tabs.slice(0, index).map((t) => t.id) : []);
          },
          closeTabsToRight: (tabId) => {
            const tabs = groupOfTab(get(), tabId)?.tabs ?? [];
            const index = tabs.findIndex((t) => t.id === tabId);
            return closeTabsResult(get, set, index >= 0 ? tabs.slice(index + 1).map((t) => t.id) : []);
          },
          closeAllTabs: (group) => closeTabsResult(get, set, get().groups[groupId(group)].tabs.map((t) => t.id)),

          pinTab: (tabId) => {
            const g = groupOfTab(get(), tabId);
            if (g) updateGroup(g.id, (group) => ({ tabs: group.tabs.map((t) => (t.id === tabId && t.isPreview ? { ...t, isPreview: false } : t)) }));
          },

          navigateBack: (group) => step(group, -1),
          navigateForward: (group) => step(group, 1),

          confirmCloseDocument: () => {
            const id = get().pendingCloseTabId;
            if (id) get().closeDocument(id, true);
          },
          cancelCloseDocument: () => set({ pendingCloseTabId: null }),

          setActiveTab: (tabId) => {
            const g = groupOfTab(get(), tabId);
            if (!g || g.activeTabId === tabId) return;
            updateGroup(g.id, () => ({ activeTabId: tabId }));
          },
          activateNextTab: (group) => cycle(group, 1),
          activatePrevTab: (group) => cycle(group, -1),
          activateTabByIndex: (index, group) => {
            const g = get().groups[groupId(group)];
            if (index >= 0 && index < g.tabs.length) get().setActiveTab(g.tabs[index].id);
          },

          updateDocumentContent: (path, content) => set((state) => {
            const doc = state.documents[path];
            if (!doc) return state;
            const isDirty = content !== doc.originalContent;
            return {
              documents: { ...state.documents, [path]: { ...doc, content, isDirty } },
              groups: mapTabs(state.groups, (t) => (t.path === path ? { ...t, isDirty, isPreview: t.isPreview && !isDirty } : t)),
            };
          }),

          saveDocument: (path, savedContent) => set((state) => {
            const doc = state.documents[path];
            if (!doc) return state;
            const originalContent = savedContent ?? doc.content;
            const isDirty = doc.content !== originalContent;
            return {
              documents: { ...state.documents, [path]: { ...doc, originalContent, isDirty, lastModified: Date.now() } },
              groups: mapTabs(state.groups, (t) => (t.path === path ? { ...t, isDirty } : t)),
            };
          }),

          reloadDocument: (path, content) => {
            const doc = get().documents[path];
            if (!doc || doc.isDirty || doc.content === content) return false;
            set((state) => ({
              documents: { ...state.documents, [path]: { ...doc, content, originalContent: content, lastModified: Date.now() } },
            }));
            return true;
          },

          reopenClosedTab: () => {
            const [mostRecent, ...rest] = get().recentlyClosed;
            if (!mostRecent) return null;
            set({ recentlyClosed: rest });
            return mostRecent;
          },

          restoreSession: (restored) => set((state) => {
            const contentByPath = new Map(restored.map((d) => [d.path, d.content]));
            const documents = { ...state.documents };
            const groups: Record<string, DocumentGroup> = {};
            for (const group of Object.values(state.groups)) {
              // A tab whose document is open already keeps it (and its edits)
              const tabs = group.tabs.filter((t) => contentByPath.has(t.path) || documents[t.path]);
              for (const tab of tabs) documents[tab.path] ??= newDocument(tab.path, contentByPath.get(tab.path) as string);
              const activeTabId = tabs.some((t) => t.id === group.activeTabId) ? group.activeTabId : tabs[0]?.id ?? null;
              groups[group.id] = { ...group, tabs, activeTabId };
            }
            return { groups, documents, scroll: pruneScroll({ ...state, groups }), sessionRestored: true };
          }),

          replaceTabs: (paths, activePath, group) => {
            const tabs: Tab[] = paths.map((path) => ({ id: generateTabId(), path, title: getFileName(path), isDirty: false }));
            const active = tabs.find((t) => t.path === activePath) ?? tabs[0];
            set((state) => {
              const id = groupId(group);
              const groups = { ...state.groups, [id]: { ...state.groups[id], tabs, activeTabId: active?.id ?? null, navHistory: [], navIndex: -1, find: newGroup(id).find } };
              // Documents still shown elsewhere stay (with their edits); the new tabs' are read and restored
              return { groups, documents: pruneDocuments(state.documents, groups) };
            });
          },

          setScrollPosition: (group, path, position) => set((state) => {
            if (!path) return state;
            const key = scrollKey(group, path);
            const next = typeof position === 'number' ? Math.max(0, Math.round(position)) : position;
            if (sameScrollPosition(state.scroll[key], next)) return state;
            return { scroll: { ...state.scroll, [key]: next } };
          }),
          getScrollPosition: (group, path) => get().scroll[scrollKey(group, path)] ?? 0,

          focusGroup: (group) => {
            if (get().groups[group] && get().focusedGroup !== group) set({ focusedGroup: group });
          },

          setZoom: (zoom, group) => updateGroup(group, () => ({ zoom: clampZoom(zoom) })),
          zoomIn: (group) => updateGroup(group, (g) => ({ zoom: clampZoom(g.zoom * ZOOM_STEP) })),
          zoomOut: (group) => updateGroup(group, (g) => ({ zoom: clampZoom(g.zoom / ZOOM_STEP) })),
          resetZoom: (group) => updateGroup(group, () => ({ zoom: 100 })),

          setHeadings: (headings, group) => updateGroup(group, () => ({ headings })),
          setActiveHeadingId: (id, group) => {
            if (get().groups[groupId(group)].activeHeadingId !== id) updateGroup(group, () => ({ activeHeadingId: id }));
          },

          openFind: (query, group) => updateFind(group, (f) => ({ open: true, query: query ?? f.query, focusNonce: f.focusNonce + 1 })),
          closeFind: (group) => updateFind(group, () => ({ open: false, request: null })),
          setFindQuery: (query, group) => updateFind(group, () => ({ query })),
          requestFindAt: (path, line, column, query, group) => updateFind(group, (f) => ({
            open: true, query, request: { path, line, column, nonce: (f.request?.nonce ?? 0) + 1 },
          })),
          clearFindRequest: (group) => updateFind(group, () => ({ request: null })),

          toggleEditMode: () => set((state) => ({ editMode: !state.editMode })),
          setEditMode: (editMode) => set({ editMode }),
          setSaveAllPromptOpen: (open) => set({ saveAllPromptOpen: open }),
          setTheme: (theme) => set({ theme }),
          setSettings: (settings) => set((state) => ({ settings: { ...state.settings, ...settings } })),
          setSearchOptions: (options) => set((state) => ({
            settings: { ...state.settings, searchOptions: { ...state.settings.searchOptions, ...options } },
          })),
        };
      },
      {
        name,
        version: 1,
        storage: createJSONStorage(() => storage ?? NO_STORAGE),
        partialize: (state) => ({
          groups: Object.fromEntries(Object.values(state.groups).map((g) => [g.id, {
            id: g.id,
            zoom: g.zoom,
            activeTabId: g.activeTabId,
            // Session restore: tab identity and which one was active (documents are re-read on start)
            tabs: g.tabs.map((t) => ({ id: t.id, path: t.path, title: t.title, isDirty: false, isPreview: t.isPreview === true })),
          }])),
          focusedGroup: state.focusedGroup,
          scroll: state.scroll,
          editMode: state.editMode,
          settings: state.settings,
        }),
        merge: (persistedState, current) => {
          const persisted = (persistedState ?? fromLegacy(legacy?.() ?? null)) as Partial<ReaderState> | null;
          const groups: Record<string, DocumentGroup> = {};
          for (const [id, raw] of Object.entries(persisted?.groups ?? {})) {
            const saved = raw as Partial<DocumentGroup>;
            const tabs = normalizeTabs(saved.tabs);
            groups[id] = {
              ...newGroup(id, typeof saved.zoom === 'number' ? clampZoom(saved.zoom) : 100),
              tabs,
              activeTabId: tabs.some((t) => t.id === saved.activeTabId) ? saved.activeTabId as string : tabs[0]?.id ?? null,
            };
          }
          if (Object.keys(groups).length === 0) groups[MAIN_GROUP] = newGroup(MAIN_GROUP);
          const focusedGroup = persisted?.focusedGroup && groups[persisted.focusedGroup] ? persisted.focusedGroup : Object.keys(groups)[0];
          const settings = { ...DEFAULT_READER_SETTINGS, ...persisted?.settings };
          return {
            ...current,
            groups,
            focusedGroup,
            scroll: persisted?.scroll ?? {},
            editMode: persisted?.editMode === true,
            settings: { ...settings, searchOptions: { ...DEFAULT_SEARCH_OPTIONS, ...settings.searchOptions } },
            // Documents are not saved: they are re-read from disk on start
            documents: {},
            sessionRestored: false,
          };
        },
      },
    ),
  );

  // Record every tab activation in its group (clicks, opens, closes, shortcuts)
  // for back/forward, except the switches made by back/forward themselves.
  store.subscribe((state, prev) => {
    if (isNavigating) return;
    for (const group of Object.values(state.groups)) {
      const before = prev.groups[group.id];
      if (!group.activeTabId || before?.activeTabId === group.activeTabId) continue;
      if (group.navHistory[group.navIndex] === group.activeTabId) continue;
      const history = [...group.navHistory.slice(0, group.navIndex + 1), group.activeTabId].slice(-MAX_NAV_HISTORY);
      store.setState((s) => ({ groups: { ...s.groups, [group.id]: { ...s.groups[group.id], navHistory: history, navIndex: history.length - 1 } } }));
    }
  });

  return store;
}

const NO_STORAGE: StateStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

function mapTabs(groups: Record<string, DocumentGroup>, update: (tab: Tab) => Tab): Record<string, DocumentGroup> {
  return Object.fromEntries(Object.entries(groups).map(([id, g]) => [id, { ...g, tabs: g.tabs.map(update) }]));
}

/** An app's old saved tabs, scroll positions, zoom and settings as the reader saves them. */
function fromLegacy(legacy: LegacyReaderState | null): Partial<ReaderState> | null {
  if (!legacy) return null;
  const tabs = normalizeTabs(legacy.tabs);
  return {
    groups: {
      [MAIN_GROUP]: {
        ...newGroup(MAIN_GROUP, typeof legacy.zoom === 'number' ? clampZoom(legacy.zoom) : 100),
        tabs,
        activeTabId: tabs.some((t) => t.id === legacy.activeTabId) ? legacy.activeTabId as string : tabs[0]?.id ?? null,
      },
    },
    focusedGroup: MAIN_GROUP,
    scroll: Object.fromEntries(Object.entries(legacy.scrollPositions ?? {}).map(([path, position]) => [scrollKey(MAIN_GROUP, path), position])),
    editMode: legacy.editMode === true,
    settings: { ...DEFAULT_READER_SETTINGS, ...legacy.settings },
  };
}
