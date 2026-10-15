import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Layers, Check, Trash2, ChevronDown } from 'lucide-react';
import { useStore, type RestoredDocument } from '../store';
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

  if (state.tabs.some((t) => t.isDirty) &&
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
  useStore.getState().restoreSession(documents.filter((d): d is RestoredDocument => d !== null));
}

/**
 * Toolbar menu for saved workspaces (named sets of open folders and tabs).
 */
const WorkspaceMenu: React.FC = () => {
  const workspaces = useStore((s) => s.workspaces);
  const activeWorkspace = useStore((s) => s.activeWorkspace);
  const saveWorkspace = useStore((s) => s.saveWorkspace);
  const deleteWorkspace = useStore((s) => s.deleteWorkspace);
  const closeWorkspace = useStore((s) => s.closeWorkspace);

  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  // Dismiss on outside click / Escape
  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', handlePointerDown, true);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown, true);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const handleSwitch = useCallback((name: string) => {
    setOpen(false);
    switchWorkspace(name).catch((error) => {
      console.error('Failed to switch workspace:', error);
      alert(`Failed to open workspace "${name}": ${error}`);
    });
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
    setNewName('');
    setOpen(false);
  }, [newName, workspaces, saveWorkspace]);

  const handleDelete = useCallback((e: React.MouseEvent, name: string) => {
    e.stopPropagation();
    if (window.confirm(`Delete the saved workspace "${name}"? Open folders and tabs are not affected.`)) {
      deleteWorkspace(name);
    }
  }, [deleteWorkspace]);

  return (
    <div className="workspace-menu" ref={rootRef}>
      <button
        className={clsx('toolbar-button workspace-menu-button', open && 'active')}
        onClick={() => setOpen((v) => !v)}
        title={activeWorkspace ? `Workspace: ${activeWorkspace}` : 'Workspaces'}
        aria-label={activeWorkspace ? `Workspace: ${activeWorkspace}` : 'Workspaces'}
        aria-haspopup="menu"
        aria-expanded={open}
        type="button"
      >
        <Layers size={16} />
        {activeWorkspace && <span className="workspace-menu-name">{activeWorkspace}</span>}
        <ChevronDown size={12} />
      </button>

      {open && (
        <div className="context-menu workspace-dropdown" role="menu">
          {workspaces.length === 0 ? (
            <div className="workspace-empty">No saved workspaces. Name the current folders and tabs below to save one.</div>
          ) : (
            workspaces.map((workspace) => (
              <div
                key={workspace.name}
                className={clsx('context-menu-item workspace-item', workspace.name === activeWorkspace && 'current')}
                onClick={() => handleSwitch(workspace.name)}
                role="menuitemradio"
                aria-checked={workspace.name === activeWorkspace}
                title={workspace.directories.join('\n') || 'No folders'}
              >
                <span className="workspace-item-check">
                  {workspace.name === activeWorkspace && <Check size={12} />}
                </span>
                <span className="workspace-item-name">{workspace.name}</span>
                <span className="workspace-item-meta">
                  {workspace.directories.length} folder(s), {workspace.tabs.length} tab(s)
                </span>
                <button
                  className="workspace-item-delete"
                  onClick={(e) => handleDelete(e, workspace.name)}
                  title="Delete workspace"
                  aria-label={`Delete workspace ${workspace.name}`}
                  type="button"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))
          )}

          <div className="context-menu-separator" role="separator" />

          {activeWorkspace && (
            <>
              <button
                className="context-menu-item"
                onClick={() => {
                  saveWorkspace(activeWorkspace);
                  setOpen(false);
                }}
                role="menuitem"
                type="button"
              >
                Save "{activeWorkspace}"
              </button>
              <button
                className="context-menu-item"
                onClick={() => {
                  closeWorkspace();
                  setOpen(false);
                }}
                title="Keep the current folders and tabs, but stop saving them to the workspace"
                role="menuitem"
                type="button"
              >
                Detach from workspace
              </button>
            </>
          )}

          <div className="workspace-save-as">
            <input
              className="find-input workspace-save-input"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveAs();
              }}
              placeholder="Save current as…"
              aria-label="New workspace name"
            />
            <button className="workspace-save-button" onClick={handleSaveAs} disabled={!newName.trim()} type="button">
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default WorkspaceMenu;
