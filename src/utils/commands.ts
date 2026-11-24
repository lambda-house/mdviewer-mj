import { createMenuStore, type Command as WorkbenchCommand, type MenuItem as WorkbenchMenuItem, type Submenu as WorkbenchSubmenu } from '@lambda-house/workbench';
import { useMemo } from 'react';
import { focusedGroupOf, readerCommands, selectedText, type ReaderState } from '@lambda-house/reader';
import { journalCommands } from '@lambda-house/journal';
import { layoutCommands, zoomCommands } from '@lambda-house/workbench';
import { useStore, panelShown, type AppState } from '../store';
import { useReader } from '../reader';
import { reader } from '../readerHost';
import { journal } from '../journal';
import { openFiles, openFolder } from '../opening';

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

/** The main menu, top to bottom: MDViewer's commands, the reader's, the journal's and the workbench's. */
export function buildMenu(): MenuItem[] {
  const state = useStore.getState;
  const documents = useReader.getState;
  const setTheme = (theme: AppState['theme']) => {
    if (state().theme !== theme) state().toggleTheme();
  };
  /** Commands that act on what the Documents surface shows: they wait while the Journal is shown. */
  const onDocuments = (command: Command): Command => ({ ...command, surface: 'documents' });
  const doc = readerCommands(reader);
  const journalCmd = journalCommands(journal);
  const [splitPaneRight, splitPaneDown, closePane, focusNext, focusPrevious, resetLayout] = layoutCommands();
  // Zoom acts on the focused pane; before any pane had the focus, on the document
  const [zoomIn, zoomOut, resetZoom] = zoomCommands({
    get: () => focusedGroupOf(documents()).zoom,
    step: (direction) => (direction === 0 ? documents().resetZoom() : direction > 0 ? documents().zoomIn() : documents().zoomOut()),
  });

  return [
    {
      id: 'file.open',
      label: 'Open File…',
      shortcut: { mod: true, key: 'o' },
      run: () => { void openFiles(); },
    },
    { id: 'file.openFolder', label: 'Open Folder…', run: () => { void openFolder(); } },
    'separator',
    onDocuments(doc.save),
    {
      label: 'Export As',
      items: [onDocuments(doc.exportMarkdown), onDocuments(doc.exportHtml)],
    },
    doc.saveAll,
    'separator',
    {
      label: 'View',
      items: [
        onDocuments({
          id: 'view.filePanel',
          label: 'File Panel',
          shortcut: { mod: true, key: 'b' },
          checked: (s) => panelShown(s, 'files'),
          run: () => state().togglePanel('files'),
        }),
        onDocuments({
          id: 'view.history',
          label: 'History',
          shortcut: { mod: true, key: 'h' },
          checked: (s) => panelShown(s, 'history'),
          run: () => state().toggleHistoryVisible(),
        }),
        onDocuments({
          id: 'view.agentFiles',
          label: 'Show Global Agent Files',
          shortcut: { mod: true, shift: true, key: 'a' },
          checked: (s) => s.agentVisible,
          run: () => state().toggleAgentVisible(),
        }),
        onDocuments({
          id: 'view.toc',
          label: 'Table of Contents',
          shortcut: { mod: true, shift: true, key: 'o' },
          checked: (s) => panelShown(s, 'contents'),
          run: () => state().toggleTocVisible(),
        }),
        {
          id: 'view.pinStatusBar',
          label: 'Pin Status Bar',
          checked: (s) => s.statusBarPinned,
          run: () => state().setStatusBarPinned(!state().statusBarPinned),
        },
        'separator',
        onDocuments(doc.splitRight),
        onDocuments(doc.splitDown),
        splitPaneRight,
        splitPaneDown,
        closePane,
        focusNext,
        focusPrevious,
        resetLayout,
        'separator',
        zoomIn,
        zoomOut,
        resetZoom,
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
      items: [onDocuments(doc.editDocument)],
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
        onDocuments(doc.find),
        onDocuments({
          id: 'search.searchFiles',
          label: 'Search in Tabs and Folders…',
          shortcut: { mod: true, shift: true, key: 'f' },
          run: () => state().openSearch(selectedText()),
        }),
        onDocuments({
          id: 'search.filterFiles',
          label: 'Filter Files…',
          shortcut: { mod: true, key: 'p' },
          run: () => document.querySelector<HTMLInputElement>('.toolbar-search input')?.focus(),
        }),
      ],
    },
    {
      label: 'Tabs',
      items: [
        onDocuments(doc.nextTab),
        onDocuments(doc.previousTab),
        onDocuments(doc.back),
        onDocuments(doc.forward),
        'separator',
        onDocuments(doc.closeTab),
        onDocuments(doc.closeAllTabs),
        onDocuments(doc.reopenClosedTab),
      ],
    },
    {
      label: 'Journal',
      items: [{ ...journalCmd.refresh, surface: 'journal' }, { ...journalCmd.newList, surface: 'journal' }],
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
