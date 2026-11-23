import { createMenuStore, type Command as WorkbenchCommand, type MenuItem as WorkbenchMenuItem, type Submenu as WorkbenchSubmenu } from '@lambda-house/workbench';
import { useMemo } from 'react';
import {
  activeTabOf, allTabs, canNavigateBack, canNavigateForward, exportActiveDocument, focusedGroupOf, requestSaveAll, saveActiveDocument,
  type ReaderState,
} from '@lambda-house/reader';
import { useStore, type AppState } from '../store';
import { useReader } from '../reader';
import { reader } from '../readerHost';

// The app's commands in one place: the main menu shows them (MainMenu.tsx)
// and the keyboard handler in App.tsx runs them, so a command, its place in
// the menu and its shortcut are defined once.

// ============================================================
// Commands: the types and helpers are the workbench's
// ============================================================

/** What a command's `enabled` and `checked` read: the app's state and the reader's. */
export type CommandContext = AppState & { reader: ReaderState };

export type Command = WorkbenchCommand<CommandContext>;
export type Submenu = WorkbenchSubmenu<CommandContext>;
export type MenuItem = WorkbenchMenuItem<CommandContext>;
export type { Shortcut } from '@lambda-house/workbench';
export { commandForKey, formatShortcut, isSubmenu, menuCommands } from '@lambda-house/workbench';

/** The menu App builds, for the command palette. */
export const appMenu = createMenuStore<CommandContext>();

/** The command context now (the native menu, the palette). */
export const commandContext = (): CommandContext => ({ ...useStore.getState(), reader: useReader.getState() });

/** The command context as a hook, for the main menu while it is open: re-renders on changes in either store. */
export function useCommandContext(): CommandContext {
  const app = useStore();
  const readerState = useReader((s) => s);
  return useMemo(() => ({ ...app, reader: readerState }), [app, readerState]);
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

/** The focused document group's: its shown tab, whether it has one, whether it has several. */
const activeTab = (s: CommandContext) => activeTabOf(focusedGroupOf(s.reader));
const hasDocument = (s: CommandContext) => activeTab(s) !== null;
const hasSeveralTabs = (s: CommandContext) => focusedGroupOf(s.reader).tabs.length > 1;

/** The main menu, top to bottom. */
export function buildMenu(actions: MenuActions): MenuItem[] {
  const state = useStore.getState;
  const documents = useReader.getState;
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
      run: () => { saveActiveDocument(reader); },
    },
    {
      label: 'Export As',
      items: [
        {
          id: 'file.exportMarkdown',
          label: 'Markdown…',
          enabled: hasDocument,
          run: () => { exportActiveDocument(reader, 'markdown'); },
        },
        {
          id: 'file.exportHtml',
          label: 'HTML…',
          enabled: hasDocument,
          run: () => { exportActiveDocument(reader, 'html'); },
        },
      ],
    },
    {
      id: 'file.saveAll',
      label: 'Save All…',
      shortcut: { mod: true, shift: true, key: 's' },
      enabled: (s) => allTabs(s.reader).some((t) => t.isDirty),
      run: () => requestSaveAll(reader),
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
          id: 'view.splitRight',
          label: 'Split Document Right',
          shortcut: { mod: true, key: '\\' },
          run: () => { documents().splitGroup(undefined, 'row'); },
        },
        {
          id: 'view.splitDown',
          label: 'Split Document Down',
          run: () => { documents().splitGroup(undefined, 'col'); },
        },
        {
          id: 'view.closeGroup',
          label: 'Close Document Group',
          enabled: (s) => Object.keys(s.reader.groups).length > 1,
          run: () => {
            const result = documents().closeGroup(documents().focusedGroup);
            if (!result.success && result.error) alert(result.error);
          },
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
          run: () => documents().zoomIn(),
        },
        {
          id: 'view.zoomOut',
          label: 'Zoom Out',
          shortcut: { mod: true, key: '-' },
          run: () => documents().zoomOut(),
        },
        {
          id: 'view.resetZoom',
          label: 'Reset Zoom',
          shortcut: { mod: true, key: '0' },
          enabled: (s) => focusedGroupOf(s.reader).zoom !== 100,
          run: () => documents().resetZoom(),
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
          checked: (s) => s.reader.editMode,
          run: () => documents().toggleEditMode(),
        },
      ],
    },
    {
      label: 'Search',
      items: [
        {
          id: 'app.commandPalette',
          label: 'Command Palette…',
          shortcut: { mod: true, shift: true, key: 'p' },
          palette: false,
          run: () => state().setPaletteOpen(true),
        },
        {
          id: 'search.find',
          label: 'Find in Document…',
          shortcut: { mod: true, key: 'f' },
          enabled: hasDocument,
          run: () => documents().openFind(getSelectedText()),
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
          run: () => documents().activateNextTab(),
        },
        {
          id: 'tabs.previous',
          label: 'Previous Tab',
          shortcut: { ctrl: true, shift: true, key: 'Tab' },
          enabled: hasSeveralTabs,
          run: () => documents().activatePrevTab(),
        },
        {
          id: 'tabs.back',
          label: 'Back',
          shortcut: { alt: true, key: 'ArrowLeft' },
          enabled: (s) => canNavigateBack(focusedGroupOf(s.reader)),
          run: () => documents().navigateBack(),
        },
        {
          id: 'tabs.forward',
          label: 'Forward',
          shortcut: { alt: true, key: 'ArrowRight' },
          enabled: (s) => canNavigateForward(focusedGroupOf(s.reader)),
          run: () => documents().navigateForward(),
        },
        'separator',
        {
          id: 'tabs.close',
          label: 'Close Tab',
          shortcut: { mod: true, key: 'w' },
          enabled: hasDocument,
          run: () => {
            const tabId = focusedGroupOf(documents()).activeTabId;
            if (tabId) documents().closeDocument(tabId);
          },
        },
        {
          id: 'tabs.closeAll',
          // Unsaved ones are kept
          label: 'Close All Tabs',
          shortcut: { mod: true, shift: true, key: 'w' },
          enabled: (s) => focusedGroupOf(s.reader).tabs.length > 0,
          run: () => {
            const result = documents().closeAllTabs();
            if (!result.success && result.error) alert(result.error);
          },
        },
        {
          id: 'tabs.reopen',
          label: 'Reopen Closed Tab',
          shortcut: { mod: true, shift: true, key: 't' },
          enabled: (s) => s.reader.recentlyClosed.length > 0,
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
