import { useStore, canNavigateBack, canNavigateForward, type AppState } from '../store';
import { PLATFORM } from './platform';
import { saveActiveDocument, requestSaveAll } from './save';
import { exportActiveDocument } from './export';

// The app's commands in one place: the main menu shows them (MainMenu.tsx)
// and the keyboard handler in App.tsx runs them, so a command, its place in
// the menu and its shortcut are defined once.

// ============================================================
// Keyboard Shortcuts
// ============================================================

export interface Shortcut {
  /** `KeyboardEvent.key`; letters in lower case. */
  key: string;
  /** Ctrl, or Cmd on macOS. */
  mod?: boolean;
  /** Ctrl, on macOS too: the system keeps Cmd+Tab for itself. */
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
}

/**
 * The key a press stands for. On a layout without Latin letters (Cyrillic,
 * Greek) that is the letter on the physical key, so Ctrl+S saves there too.
 */
function pressedKey(e: KeyboardEvent): string {
  if (e.key.length === 1 && e.key.charCodeAt(0) > 127) {
    const letter = /^Key([A-Z])$/.exec(e.code);
    if (letter) return letter[1].toLowerCase();
  }
  return e.key.toLowerCase();
}

/** Whether a key press is this shortcut. Ctrl and Cmd both count as the modifier. */
function matchesShortcut(e: KeyboardEvent, shortcut: Shortcut): boolean {
  if (pressedKey(e) !== shortcut.key.toLowerCase()) return false;
  if ((e.metaKey || e.ctrlKey) !== Boolean(shortcut.mod || shortcut.ctrl)) return false;
  if (e.altKey !== Boolean(shortcut.alt)) return false;
  // Shift is part of typing a symbol or a digit ("+" is Shift+= on a US
  // keyboard, digits need Shift on AZERTY): it only tells letters and named
  // keys apart
  const shiftCounts = shortcut.key.length > 1 || /[a-z]/i.test(shortcut.key);
  return !shiftCounts || e.shiftKey === Boolean(shortcut.shift);
}

const KEY_NAMES: Record<string, string> = { ArrowLeft: 'Left', ArrowRight: 'Right' };
const MAC_KEY_NAMES: Record<string, string> = { ArrowLeft: '←', ArrowRight: '→' };

/** A shortcut as the platform writes it: "Ctrl+Shift+S", or "⇧⌘S" on macOS. */
export function formatShortcut(shortcut: Shortcut): string {
  const isMac = PLATFORM === 'macos';
  const key = (isMac ? MAC_KEY_NAMES : KEY_NAMES)[shortcut.key]
    ?? (shortcut.key.length === 1 ? shortcut.key.toUpperCase() : shortcut.key);

  const parts = isMac
    // The order of macOS menus: Control, Option, Shift, Command
    ? [shortcut.ctrl && '⌃', shortcut.alt && '⌥', shortcut.shift && '⇧', shortcut.mod && '⌘', key]
    : [(shortcut.mod || shortcut.ctrl) && 'Ctrl', shortcut.alt && 'Alt', shortcut.shift && 'Shift', key];
  return parts.filter(Boolean).join(isMac ? '' : '+');
}

// ============================================================
// Commands
// ============================================================

export interface Command {
  id: string;
  label: string;
  shortcut?: Shortcut;
  /** Other keys that run the command; the menu shows only `shortcut`. */
  aliases?: Shortcut[];
  /**
   * Whether the menu offers the command now (default: always). `run` is safe
   * to call either way: a shortcut runs it without asking.
   */
  enabled?: (state: AppState) => boolean;
  /** A toggle: whether it is on now (the menu shows a check mark). */
  checked?: (state: AppState) => boolean;
  run: () => void;
}

export interface Submenu {
  label: string;
  items: Array<Command | 'separator'>;
}

export type MenuItem = Command | Submenu | 'separator';

export function isSubmenu(item: MenuItem): item is Submenu {
  return item !== 'separator' && 'items' in item;
}

/** What the commands need from the app shell (App.tsx); the rest is in the store. */
export interface MenuActions {
  openFile: () => void;
  openFolder: () => void;
  reopenClosedTab: () => void;
}

/** Single-line selected text, to seed find/search (undefined keeps the old query). */
function getSelectedText(): string | undefined {
  const text = window.getSelection()?.toString().trim();
  return text && !text.includes('\n') && text.length <= 200 ? text : undefined;
}

const activeTab = (state: AppState) => state.tabs.find((t) => t.id === state.activeTabId);
const hasDocument = (state: AppState) => activeTab(state) !== undefined;
const hasSeveralTabs = (state: AppState) => state.tabs.length > 1;

/** The main menu, top to bottom. */
export function buildMenu(actions: MenuActions): MenuItem[] {
  const state = useStore.getState;
  const setTheme = (theme: AppState['theme']) => {
    if (state().theme !== theme) state().toggleTheme();
  };

  return [
    {
      id: 'file.open',
      label: 'Open File…',
      shortcut: { mod: true, key: 'o' },
      run: actions.openFile,
    },
    { id: 'file.openFolder', label: 'Open Folder…', run: actions.openFolder },
    'separator',
    {
      id: 'file.save',
      label: 'Save File',
      shortcut: { mod: true, key: 's' },
      enabled: (s) => activeTab(s)?.isDirty === true,
      run: () => { saveActiveDocument(); },
    },
    {
      label: 'Export As',
      items: [
        {
          id: 'file.exportMarkdown',
          label: 'Markdown…',
          enabled: hasDocument,
          run: () => { exportActiveDocument('markdown'); },
        },
        {
          id: 'file.exportHtml',
          label: 'HTML…',
          enabled: hasDocument,
          run: () => { exportActiveDocument('html'); },
        },
      ],
    },
    {
      id: 'file.saveAll',
      label: 'Save All…',
      shortcut: { mod: true, shift: true, key: 's' },
      enabled: (s) => s.tabs.some((t) => t.isDirty),
      run: requestSaveAll,
    },
    'separator',
    {
      label: 'View',
      items: [
        {
          id: 'view.filePanel',
          label: 'File Panel',
          shortcut: { mod: true, key: 'b' },
          checked: (s) => s.filePanelVisible,
          run: () => state().setFilePanelVisible(!state().filePanelVisible),
        },
        {
          id: 'view.history',
          label: 'History',
          shortcut: { mod: true, key: 'h' },
          checked: (s) => s.historyVisible,
          run: () => state().toggleHistoryVisible(),
        },
        {
          id: 'view.agentFiles',
          label: 'Show Global Agent Files',
          shortcut: { mod: true, shift: true, key: 'a' },
          checked: (s) => s.agentVisible,
          run: () => state().toggleAgentVisible(),
        },
        {
          id: 'view.toc',
          label: 'Table of Contents',
          shortcut: { mod: true, shift: true, key: 'o' },
          checked: (s) => s.tocVisible,
          run: () => state().toggleTocVisible(),
        },
        {
          id: 'view.pinStatusBar',
          label: 'Pin Status Bar',
          checked: (s) => s.statusBarPinned,
          run: () => {
            const pinned = !state().statusBarPinned;
            state().setStatusBarPinned(pinned);
            if (pinned) state().setStatusBarVisible(true);
          },
        },
        'separator',
        {
          id: 'view.zoomIn',
          label: 'Zoom In',
          shortcut: { mod: true, key: '+' },
          aliases: [{ mod: true, key: '=' }],
          run: () => state().zoomIn(),
        },
        {
          id: 'view.zoomOut',
          label: 'Zoom Out',
          shortcut: { mod: true, key: '-' },
          run: () => state().zoomOut(),
        },
        {
          id: 'view.resetZoom',
          label: 'Reset Zoom',
          shortcut: { mod: true, key: '0' },
          enabled: (s) => s.zoom !== 100,
          run: () => state().resetZoom(),
        },
        'separator',
        {
          id: 'view.darkTheme',
          label: 'Dark Theme',
          checked: (s) => s.theme === 'dark',
          run: () => setTheme('dark'),
        },
        {
          id: 'view.lightTheme',
          label: 'Light Theme',
          checked: (s) => s.theme === 'light',
          run: () => setTheme('light'),
        },
      ],
    },
    {
      label: 'Edit',
      items: [
        {
          id: 'edit.editDocument',
          label: 'Edit Document',
          shortcut: { mod: true, key: 'e' },
          checked: (s) => s.editMode,
          run: () => state().toggleEditMode(),
        },
      ],
    },
    {
      label: 'Search',
      items: [
        {
          id: 'search.find',
          label: 'Find in Document…',
          shortcut: { mod: true, key: 'f' },
          enabled: hasDocument,
          run: () => state().openFind(getSelectedText()),
        },
        {
          id: 'search.searchFiles',
          label: 'Search in Tabs and Folders…',
          shortcut: { mod: true, shift: true, key: 'f' },
          run: () => state().openSearch(getSelectedText()),
        },
        {
          id: 'search.filterFiles',
          label: 'Filter Files…',
          shortcut: { mod: true, key: 'p' },
          run: () => document.querySelector<HTMLInputElement>('.toolbar-search input')?.focus(),
        },
      ],
    },
    {
      label: 'Tabs',
      items: [
        {
          id: 'tabs.next',
          label: 'Next Tab',
          shortcut: { ctrl: true, key: 'Tab' },
          enabled: hasSeveralTabs,
          run: () => state().activateNextTab(),
        },
        {
          id: 'tabs.previous',
          label: 'Previous Tab',
          shortcut: { ctrl: true, shift: true, key: 'Tab' },
          enabled: hasSeveralTabs,
          run: () => state().activatePrevTab(),
        },
        {
          id: 'tabs.back',
          label: 'Back',
          shortcut: { alt: true, key: 'ArrowLeft' },
          enabled: canNavigateBack,
          run: () => state().navigateBack(),
        },
        {
          id: 'tabs.forward',
          label: 'Forward',
          shortcut: { alt: true, key: 'ArrowRight' },
          enabled: canNavigateForward,
          run: () => state().navigateForward(),
        },
        'separator',
        {
          id: 'tabs.close',
          label: 'Close Tab',
          shortcut: { mod: true, key: 'w' },
          enabled: hasDocument,
          run: () => {
            const tabId = state().activeTabId;
            if (tabId) state().closeDocument(tabId);
          },
        },
        {
          id: 'tabs.closeAll',
          // Unsaved ones are kept
          label: 'Close All Tabs',
          shortcut: { mod: true, shift: true, key: 'w' },
          enabled: (s) => s.tabs.length > 0,
          run: () => {
            const result = state().closeAllTabs();
            if (!result.success && result.error) alert(result.error);
          },
        },
        {
          id: 'tabs.reopen',
          label: 'Reopen Closed Tab',
          shortcut: { mod: true, shift: true, key: 't' },
          enabled: (s) => s.recentlyClosed.length > 0,
          run: actions.reopenClosedTab,
        },
      ],
    },
    'separator',
    {
      id: 'app.settings',
      label: 'Settings…',
      shortcut: { mod: true, key: ',' },
      run: () => state().setSettingsOpen(true),
    },
  ];
}

/** Every command of a menu, the ones in submenus included. */
export function menuCommands(items: MenuItem[]): Command[] {
  return items.flatMap((item) => {
    if (item === 'separator') return [];
    return isSubmenu(item) ? menuCommands(item.items) : [item];
  });
}

/** The command a key press runs, if any. */
export function commandForKey(commands: Command[], e: KeyboardEvent): Command | undefined {
  // The webview's autofill sends keydown events without a key
  if (!e.key) return undefined;

  return commands.find((command) =>
    [command.shortcut, ...(command.aliases ?? [])].some((shortcut) => shortcut && matchesShortcut(e, shortcut))
  );
}
