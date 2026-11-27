import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Layers, Check, Trash2, ChevronDown } from 'lucide-react';
import { ACTION_BUTTON_FIRST, Button, Dialog, Menu, type MenuItem } from '@lambda-house/ui';
import { useStore } from '../store';
import { useReader } from '../reader';
import { allTabs, type RestoredDocument } from '@lambda-house/reader';
import { readFile, scanDirectories } from '../utils/tauri';
import clsx from 'clsx';

/**
 * Switch to a saved workspace: the current one is saved first, then its
 * folders are rescanned and its tabs re-read (tabs whose file is gone are
 * dropped, like on startup).
 */
async function switchWorkspace(name: string): Promise<void> {
  const state = useStore.getState();
  if (state.activeWorkspace === name) return;

  if (allTabs(useReader.getState()).some((t) => t.isDirty) &&
      !window.confirm('Some tabs have unsaved changes, which will be lost. Switch anyway?')) {
    return;
  }

  if (state.activeWorkspace) state.saveWorkspace(state.activeWorkspace);

  const workspace = state.loadWorkspace(name);
  if (!workspace) return;

  scanDirectories(workspace.directories)
    .then((files) => useStore.getState().setFiles(files))
    .catch((error) => console.error('Failed to scan workspace directories:', error));

  const documents = await Promise.all(
    workspace.tabs.map(async (path): Promise<RestoredDocument | null> => {
      try {
        return { path, content: await readFile(path) };
      } catch (error) {
        console.warn(`Dropping workspace tab (cannot read ${path}):`, error);
        return null;
      }
    })
  );
  // Another switch happened meanwhile - its restore wins
  if (useStore.getState().activeWorkspace !== name) return;
  useReader.getState().restoreSession(documents.filter((d): d is RestoredDocument => d !== null));
}

/** Below the trigger: where the menu opens. */
function below(element: HTMLElement | null) {
  const box = element?.getBoundingClientRect();
  return box ? { top: box.bottom + 2, left: box.left } : { top: 0, left: 0 };
}

/**
 * Toolbar menu for saved workspaces (named sets of open folders and tabs):
 * the shared Menu, with the saved ones to switch to, then saving, detaching,
 * saving under a new name and deleting one (each of those two in a dialog).
 */
const WorkspaceMenu: React.FC = () => {
  const workspaces = useStore((s) => s.workspaces);
  const activeWorkspace = useStore((s) => s.activeWorkspace);
  const saveWorkspace = useStore((s) => s.saveWorkspace);
  const deleteWorkspace = useStore((s) => s.deleteWorkspace);
  const closeWorkspace = useStore((s) => s.closeWorkspace);

  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const [dialog, setDialog] = useState<'save' | 'delete' | null>(null);
  const [newName, setNewName] = useState('');
  const anchor = useRef<HTMLButtonElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);

  // The name field takes the focus (after the dialog gave it to its first control)
  useEffect(() => {
    if (dialog === 'save') nameInput.current?.focus();
  }, [dialog]);

  const handleSwitch = useCallback((name: string) => {
    switchWorkspace(name).catch((error) => {
      console.error('Failed to switch workspace:', error);
      alert(`Failed to open workspace "${name}": ${error}`);
    });
  }, []);

  const closeDialog = useCallback(() => {
    setDialog(null);
    setNewName('');
  }, []);

  const handleSaveAs = useCallback(() => {
    const name = newName.trim();
    if (!name) return;
    if (workspaces.some((w) => w.name === name) &&
        !window.confirm(`Replace the saved workspace "${name}" with the current folders and tabs?`)) {
      return;
    }
    const result = saveWorkspace(name);
    if (!result.success) {
      alert(result.error);
      return;
    }
    closeDialog();
  }, [newName, workspaces, saveWorkspace, closeDialog]);

  const handleDelete = useCallback((name: string) => {
    if (window.confirm(`Delete the saved workspace "${name}"? Open folders and tabs are not affected.`)) {
      deleteWorkspace(name);
    }
  }, [deleteWorkspace]);

  const meta = (workspace: { directories: string[]; tabs: string[] }) =>
    `${workspace.directories.length} folder(s), ${workspace.tabs.length} tab(s)`;

  const items: MenuItem[] = [
    ...(workspaces.length === 0
      ? [{ key: 'none', label: 'No saved workspaces', disabled: true, onSelect: () => {} }]
      : workspaces.map((workspace) => ({
          key: `workspace:${workspace.name}`,
          // The current one has the check; the others keep its room, so the names line up
          icon: workspace.name === activeWorkspace ? <Check size={14} /> : <span />,
          label: (
            <span className="workspace-item">
              <span className="workspace-item-name">{workspace.name}</span>
              <span className="workspace-item-meta">{meta(workspace)}</span>
            </span>
          ),
          title: workspace.directories.join('\n') || 'No folders',
          onSelect: () => handleSwitch(workspace.name),
        }))),
    'separator',
    ...(activeWorkspace
      ? [
          { key: 'save', label: `Save "${activeWorkspace}"`, onSelect: () => { saveWorkspace(activeWorkspace); } },
          { key: 'detach', label: 'Detach from workspace', title: 'Keep the current folders and tabs, but stop saving them to the workspace', onSelect: closeWorkspace },
        ]
      : []),
    { key: 'save-as', label: 'Save current as…', onSelect: () => setDialog('save') },
    ...(workspaces.length > 0 ? [{ key: 'delete', label: 'Delete a workspace…', onSelect: () => setDialog('delete') }] : []),
  ];

  const saveButton = <Button key="save" variant="primary" size="sm" onClick={handleSaveAs} disabled={!newName.trim()}>Save</Button>;
  const cancelButton = <Button key="cancel" variant="secondary" size="sm" onClick={closeDialog}>Cancel</Button>;

  return (
    <div className="workspace-menu">
      <button
        ref={anchor}
        className={clsx('wb-tool workspace-menu-button', at && 'active')}
        onClick={() => setAt((open) => (open ? null : below(anchor.current)))}
        title={activeWorkspace ? `Workspace: ${activeWorkspace}` : 'Workspaces'}
        aria-label={activeWorkspace ? `Workspace: ${activeWorkspace}` : 'Workspaces'}
        aria-haspopup="menu"
        aria-expanded={!!at}
        type="button"
      >
        <Layers size={16} />
        {activeWorkspace && <span className="workspace-menu-name">{activeWorkspace}</span>}
        <ChevronDown size={12} />
      </button>

      {at && <Menu label="Workspaces" at={at} anchorRef={anchor} onClose={() => setAt(null)} items={items} />}

      <Dialog
        open={dialog === 'save'}
        onClose={closeDialog}
        title="Save as a workspace"
        footer={ACTION_BUTTON_FIRST ? [saveButton, cancelButton] : [cancelButton, saveButton]}
      >
        <p className="workspace-dialog-text">The open folders and tabs, under a name to come back to.</p>
        <input
          ref={nameInput}
          className="workspace-name-input"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSaveAs();
          }}
          placeholder="Name"
          aria-label="New workspace name"
        />
      </Dialog>

      <Dialog open={dialog === 'delete'} onClose={closeDialog} title="Delete a workspace">
        {workspaces.length === 0 ? (
          <p className="workspace-dialog-text">No saved workspaces.</p>
        ) : (
          <ul className="workspace-delete-list">
            {workspaces.map((workspace) => (
              <li key={workspace.name} title={workspace.directories.join('\n') || 'No folders'}>
                <span className="workspace-item">
                  <span className="workspace-item-name">{workspace.name}</span>
                  <span className="workspace-item-meta">{meta(workspace)}</span>
                </span>
                <Button variant="ghost" size="xs" icon={<Trash2 size={13} />} onClick={() => handleDelete(workspace.name)} aria-label={`Delete workspace ${workspace.name}`} title="Delete workspace" />
              </li>
            ))}
          </ul>
        )}
        <p className="workspace-dialog-text">Open folders and tabs are not affected.</p>
      </Dialog>
    </div>
  );
};

export default WorkspaceMenu;
