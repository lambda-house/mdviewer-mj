import React, { useCallback, useEffect, useState } from 'react';
import { Download, ExternalLink, Folder, FolderOpen, FolderPlus, Trash2 } from 'lucide-react';
import { Button, SettingRow } from '@lambda-house/ui';
import { SettingsSection, SettingsToggle, type SettingsTab } from '@lambda-house/workbench';
import { useStore } from '../store';
import { checkForUpdate, getAppVersion, isTauri, openInExplorer, pickDirectory, scanDirectories } from '../utils/tauri';

// MDViewer's own tabs in the workbench's Settings dialog: the folders of the
// file tree, and updates. The reader, the journal and the workbench bring theirs.

const Folders: React.FC = () => {
  const directories = useStore((s) => s.directories);
  const autoRefresh = useStore((s) => s.autoRefresh);
  const showTextFiles = useStore((s) => s.showTextFiles);
  const { addDirectory, removeDirectory, setFiles, setAutoRefresh, setShowTextFiles } = useStore.getState();

  const add = useCallback(async () => {
    if (!isTauri()) {
      alert('Directory picking requires the Tauri desktop app.');
      return;
    }
    const path = await pickDirectory();
    if (!path) return;
    addDirectory(path);
    setFiles(await scanDirectories(useStore.getState().directories));
  }, [addDirectory, setFiles]);

  const remove = useCallback(async (dir: string) => {
    removeDirectory(dir);
    const left = useStore.getState().directories;
    setFiles(left.length > 0 && isTauri() ? await scanDirectories(left) : []);
  }, [removeDirectory, setFiles]);

  return (
    <>
      <SettingsSection title="Folders" description="Folders whose Markdown files the file tree lists.">
        <div className="settings-directory-list">
          {directories.length === 0 ? (
            <div className="settings-directory-empty">No directories added yet.</div>
          ) : directories.map((dir) => (
            <div key={dir} className="settings-directory-item">
              <Folder size={16} className="settings-directory-icon" />
              <span className="settings-directory-path" title={dir}>{dir}</span>
              <button className="settings-directory-action" onClick={() => void openInExplorer(dir).catch(console.error)} title="Open in file explorer" aria-label={`Open ${dir} in file explorer`}><ExternalLink size={16} /></button>
              <button className="settings-directory-remove" onClick={() => void remove(dir)} title="Remove directory" aria-label={`Remove ${dir}`}><Trash2 size={16} /></button>
            </div>
          ))}
        </div>
        <button className="settings-add-btn" onClick={() => void add()}><FolderPlus size={16} /><span>Add Directory</span></button>
      </SettingsSection>
      <SettingsSection title="File tree">
        <div className="settings-card">
          <SettingRow label="Auto-refresh" description="Update the file list and open documents when files change on disk" control={<SettingsToggle label="Auto-refresh" checked={autoRefresh} onChange={setAutoRefresh} />} />
          <SettingRow label="Show text files" description="List code, txt, fb2 and other text files in the file tree, not only markdown" control={<SettingsToggle label="Show text files" checked={showTextFiles} onChange={setShowTextFiles} />} />
        </div>
      </SettingsSection>
    </>
  );
};

const Updates: React.FC = () => {
  const checkUpdatesOnStart = useStore((s) => s.checkUpdatesOnStart);
  const { setCheckUpdatesOnStart, setAvailableUpdate } = useStore.getState();
  const [status, setStatus] = useState('');
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => { getAppVersion().then(setVersion).catch(() => {}); }, []);
  const check = async () => {
    setStatus('Checking…');
    try {
      const update = await checkForUpdate();
      setAvailableUpdate(update);
      setStatus(update ? `Version ${update.version} is available, see the bar above` : 'You have the latest version');
    } catch (error) {
      const message = error && typeof error === 'object' && 'message' in error ? String(error.message) : String(error);
      setStatus(`Could not check: ${message}`);
    }
  };
  return (
    <SettingsSection title="Updates" description={version ? `You have MDViewer ${version}.` : undefined}>
      <div className="settings-card">
        <SettingRow
          label="Check for updates on start"
          description={status || 'Look for a new version on GitHub when the app starts. Updates install only when you click Install'}
          control={<SettingsToggle label="Check for updates on start" checked={checkUpdatesOnStart} onChange={setCheckUpdatesOnStart} />}
        />
        <SettingRow
          label="Look now"
          control={<Button variant="secondary" size="sm" disabled={!isTauri() || status === 'Checking…'} onClick={() => void check()}>Check now</Button>}
        />
      </div>
    </SettingsSection>
  );
};

export function appSettingsTabs(): SettingsTab[] {
  return [
    { id: 'folders', label: 'Folders', icon: <FolderOpen size={15} />, group: 'Documents', order: 41, render: () => <Folders /> },
    { id: 'updates', label: 'Updates', icon: <Download size={15} />, group: 'Application', order: 90, render: () => <Updates /> },
  ];
}
