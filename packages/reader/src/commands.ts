import type { Command } from '@lambda-house/workbench';
import type { Reader } from './host';
import { activeTabOf, allTabs, canNavigateBack, canNavigateForward, focusedGroupOf } from './store';
import { requestSaveAll, saveActiveDocument } from './save';
import { exportActiveDocument } from './export';

// The reader's commands (shared UI spec §5.5): an app puts them into its
// menu where it likes, under these ids (the native menu runs `file.*` by
// id). They act on the focused document group and read the reader's own
// store, so they need nothing from the app.

/** Single-line selected text, to seed find (undefined keeps the old query). */
export function selectedText(): string | undefined {
  const text = window.getSelection()?.toString().trim();
  return text && !text.includes('\n') && text.length <= 200 ? text : undefined;
}

export interface ReaderCommands {
  save: Command;
  exportMarkdown: Command;
  exportHtml: Command;
  saveAll: Command;
  editDocument: Command;
  find: Command;
  nextTab: Command;
  previousTab: Command;
  back: Command;
  forward: Command;
  closeTab: Command;
  closeAllTabs: Command;
  splitRight: Command;
  splitDown: Command;
}

export function readerCommands(reader: Reader): ReaderCommands {
  const state = () => reader.store.getState();
  const group = () => focusedGroupOf(state());
  const hasDocument = () => activeTabOf(group()) !== null;
  const hasSeveralTabs = () => group().tabs.length > 1;
  return {
    save: {
      id: 'file.save', label: 'Save File', shortcut: { mod: true, key: 's' },
      enabled: () => activeTabOf(group())?.isDirty === true,
      run: () => { void saveActiveDocument(reader); },
    },
    exportMarkdown: { id: 'file.exportMarkdown', label: 'Markdown…', enabled: hasDocument, run: () => { void exportActiveDocument(reader, 'markdown'); } },
    exportHtml: { id: 'file.exportHtml', label: 'HTML…', enabled: hasDocument, run: () => { void exportActiveDocument(reader, 'html'); } },
    saveAll: {
      id: 'file.saveAll', label: 'Save All…', shortcut: { mod: true, shift: true, key: 's' },
      enabled: () => allTabs(state()).some((t) => t.isDirty),
      run: () => requestSaveAll(reader),
    },
    editDocument: {
      id: 'edit.editDocument', label: 'Edit Document', shortcut: { mod: true, key: 'e' },
      checked: () => state().editMode,
      run: () => state().toggleEditMode(),
    },
    find: {
      id: 'search.find', label: 'Find in Document…', shortcut: { mod: true, key: 'f' },
      enabled: hasDocument,
      run: () => state().openFind(selectedText()),
    },
    nextTab: { id: 'tabs.next', label: 'Next Tab', shortcut: { ctrl: true, key: 'Tab' }, enabled: hasSeveralTabs, run: () => state().activateNextTab() },
    previousTab: { id: 'tabs.previous', label: 'Previous Tab', shortcut: { ctrl: true, shift: true, key: 'Tab' }, enabled: hasSeveralTabs, run: () => state().activatePrevTab() },
    back: { id: 'tabs.back', label: 'Back', shortcut: { alt: true, key: 'ArrowLeft' }, enabled: () => canNavigateBack(group()), run: () => state().navigateBack() },
    forward: { id: 'tabs.forward', label: 'Forward', shortcut: { alt: true, key: 'ArrowRight' }, enabled: () => canNavigateForward(group()), run: () => state().navigateForward() },
    closeTab: {
      id: 'tabs.close', label: 'Close Tab', shortcut: { mod: true, key: 'w' },
      enabled: hasDocument,
      run: () => {
        const tabId = group().activeTabId;
        if (tabId) state().closeDocument(tabId);
      },
    },
    // The document's own split, whatever pane has the focus (a click in a file list leaves it there)
    splitRight: { id: 'view.splitRight', label: 'Split Document Right', shortcut: { mod: true, key: '\\' }, run: () => { state().splitGroup(undefined, 'row'); } },
    splitDown: { id: 'view.splitDown', label: 'Split Document Down', run: () => { state().splitGroup(undefined, 'col'); } },
    closeAllTabs: {
      // Unsaved ones are kept
      id: 'tabs.closeAll', label: 'Close All Tabs', shortcut: { mod: true, shift: true, key: 'w' },
      enabled: () => group().tabs.length > 0,
      run: () => {
        const result = state().closeAllTabs();
        if (!result.success && result.error) window.alert(result.error);
      },
    },
  };
}
