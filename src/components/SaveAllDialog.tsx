import React, { useCallback } from 'react';
import { useStore } from '../store';
import { saveAllDocuments } from '../utils/save';
import ConfirmDialog from './ConfirmDialog';

/**
 * Asks before Save All writes every modified document (`requestSaveAll`).
 */
const SaveAllDialog: React.FC = () => {
  const open = useStore((s) => s.saveAllPromptOpen);
  const setOpen = useStore((s) => s.setSaveAllPromptOpen);
  const tabs = useStore((s) => s.tabs);

  const handleConfirm = useCallback(() => {
    setOpen(false);
    saveAllDocuments();
  }, [setOpen]);

  const handleCancel = useCallback(() => setOpen(false), [setOpen]);

  if (!open) return null;

  const modified = tabs.filter((t) => t.isDirty);

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
};

export default SaveAllDialog;
