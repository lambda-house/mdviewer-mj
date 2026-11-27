import { useCallback } from 'react';
import { ConfirmDialog } from '@lambda-house/ui';
import { useReader, useReaderContext } from './host';
import { saveAllDocuments } from './save';
import { allTabs } from './store';

/**
 * Asks before Save All writes every modified document (`requestSaveAll`).
 */
export function SaveAllDialog() {
  const reader = useReaderContext();
  const open = useReader((s) => s.saveAllPromptOpen);
  const tabs = useReader(allTabs);

  const handleConfirm = useCallback(() => {
    reader.store.getState().setSaveAllPromptOpen(false);
    saveAllDocuments(reader);
  }, [reader]);

  const handleCancel = useCallback(() => reader.store.getState().setSaveAllPromptOpen(false), [reader]);

  if (!open) return null;

  // A document open in two groups is one file
  const modified = tabs.filter((t, i) => t.isDirty && tabs.findIndex((o) => o.path === t.path) === i);

  return (
    <ConfirmDialog
      title="Save All Files?"
      confirmLabel="Save All"
      onConfirm={handleConfirm}
      onCancel={handleCancel}
    >
      <p>
        {modified.length === 1 ? '1 file has' : `${modified.length} files have`} unsaved changes:
      </p>
      <ul className="modal-file-list">
        {modified.map((tab) => (
          <li key={tab.id} title={tab.path}>{tab.title}</li>
        ))}
      </ul>
    </ConfirmDialog>
  );
}

/** "Close anyway?" for a document with unsaved changes (`closeDocument`). Render it once. */
export function CloseDocumentDialog() {
  const reader = useReaderContext();
  const tab = useReader((s) => (s.pendingCloseTabId ? allTabs(s).find((t) => t.id === s.pendingCloseTabId) ?? null : null));
  if (!tab) return null;
  return (
    <ConfirmDialog
      title="Unsaved Changes"
      confirmLabel="Close Without Saving"
      destructive
      onConfirm={() => reader.store.getState().confirmCloseDocument()}
      onCancel={() => reader.store.getState().cancelCloseDocument()}
    >
      <p>"{tab.title}" has unsaved changes. Do you want to close it anyway?</p>
    </ConfirmDialog>
  );
}
