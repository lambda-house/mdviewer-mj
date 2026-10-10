import React, { useCallback, useEffect, useState } from 'react';
import { X, Folder, Trash2, FolderPlus, Settings, ExternalLink, Code, Plus, Palette } from 'lucide-react';
import { useStore } from '../store';
import { pickDirectory, scanDirectories, isTauri, openInExplorer } from '../utils/tauri';

type SettingsCategory = 'directories' | 'general' | 'appearance' | 'highlighting';

const SettingsModal: React.FC = () => {
  const settingsOpen = useStore((s) => s.settingsOpen);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);
  const directories = useStore((s) => s.directories);
  const addDirectory = useStore((s) => s.addDirectory);
  const removeDirectory = useStore((s) => s.removeDirectory);
  const setFiles = useStore((s) => s.setFiles);
  const autoRefresh = useStore((s) => s.autoRefresh);
  const setAutoRefresh = useStore((s) => s.setAutoRefresh);
  const smoothScroll = useStore((s) => s.smoothScroll);
  const showTextFiles = useStore((s) => s.showTextFiles);
  const setShowTextFiles = useStore((s) => s.setShowTextFiles);
  const setSmoothScroll = useStore((s) => s.setSmoothScroll);
  const loadRemoteImages = useStore((s) => s.loadRemoteImages);
  const setLoadRemoteImages = useStore((s) => s.setLoadRemoteImages);
  const languageAliases = useStore((s) => s.languageAliases);
  const setLanguageAlias = useStore((s) => s.setLanguageAlias);
  const removeLanguageAlias = useStore((s) => s.removeLanguageAlias);
  const markdownTextColor = useStore((s) => s.markdownTextColor);
  const markdownTextColorLight = useStore((s) => s.markdownTextColorLight);
  const setMarkdownTextColorLight = useStore((s) => s.setMarkdownTextColorLight);
  const setMarkdownTextColor = useStore((s) => s.setMarkdownTextColor);

  const [activeCategory, setActiveCategory] = useState<SettingsCategory>('directories');
  const [newAliasKey, setNewAliasKey] = useState('');
  const [newAliasValue, setNewAliasValue] = useState('');

  const handleClose = useCallback(() => {
    setSettingsOpen(false);
  }, [setSettingsOpen]);

  const handleAddDirectory = useCallback(async () => {
    if (!isTauri()) {
      alert('Directory picking requires the Tauri desktop app.');
      return;
    }

    const path = await pickDirectory();
    if (path) {
      addDirectory(path);
      // Rescan all directories to update the file tree
      const { directories: allDirs } = useStore.getState();
      const updatedDirs = allDirs.includes(path) ? allDirs : [...allDirs, path];
      const files = await scanDirectories(updatedDirs);
      setFiles(files);
    }
  }, [addDirectory, setFiles]);

  const handleRemoveDirectory = useCallback(async (dir: string) => {
    removeDirectory(dir);
    // Rescan remaining directories
    const { directories: remainingDirs } = useStore.getState();
    const filteredDirs = remainingDirs.filter(d => d !== dir);
    if (filteredDirs.length > 0 && isTauri()) {
      const files = await scanDirectories(filteredDirs);
      setFiles(files);
    } else {
      setFiles([]);
    }
  }, [removeDirectory, setFiles]);

  const handleOpenInExplorer = useCallback(async (dir: string) => {
    try {
      await openInExplorer(dir);
    } catch (error) {
      console.error('Failed to open in explorer:', error);
    }
  }, []);

  const handleAddAlias = useCallback(() => {
    if (newAliasKey.trim() && newAliasValue.trim()) {
      setLanguageAlias(newAliasKey.trim(), newAliasValue.trim());
      setNewAliasKey('');
      setNewAliasValue('');
    }
  }, [newAliasKey, newAliasValue, setLanguageAlias]);

  // Handle Escape key to close modal
  useEffect(() => {
    if (!settingsOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [settingsOpen, handleClose]);

  if (!settingsOpen) {
    return null;
  }

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>Settings</h2>
          <button
            className="settings-close"
            onClick={handleClose}
            title="Close (Escape)"
          >
            <X size={20} />
          </button>
        </div>

        <div className="settings-content">
          <div className="settings-sidebar">
            <button
              className={`settings-nav-item ${activeCategory === 'general' ? 'active' : ''}`}
              onClick={() => setActiveCategory('general')}
            >
              <Settings size={16} />
              <span>General</span>
            </button>
            <button
              className={`settings-nav-item ${activeCategory === 'appearance' ? 'active' : ''}`}
              onClick={() => setActiveCategory('appearance')}
            >
              <Palette size={16} />
              <span>Appearance</span>
            </button>
            <button
              className={`settings-nav-item ${activeCategory === 'directories' ? 'active' : ''}`}
              onClick={() => setActiveCategory('directories')}
            >
              <Folder size={16} />
              <span>Directories</span>
            </button>
            <button
              className={`settings-nav-item ${activeCategory === 'highlighting' ? 'active' : ''}`}
              onClick={() => setActiveCategory('highlighting')}
            >
              <Code size={16} />
              <span>Highlighting</span>
            </button>
          </div>

          <div className="settings-main">
            {activeCategory === 'general' && (
              <div className="settings-section">
                <h3>General Settings</h3>
                <p className="settings-section-description">
                  Configure application behavior.
                </p>

                <div className="settings-option">
                  <div className="settings-option-info">
                    <span className="settings-option-label">Auto-refresh</span>
                    <span className="settings-option-description">
                      Automatically refresh file list when files change on disk
                    </span>
                  </div>
                  <label className="settings-toggle">
                    <input
                      type="checkbox"
                      checked={autoRefresh}
                      onChange={(e) => setAutoRefresh(e.target.checked)}
                    />
                    <span className="settings-toggle-slider" />
                  </label>
                </div>

                <div className="settings-option">
                  <div className="settings-option-info">
                    <span className="settings-option-label">Show text files</span>
                    <span className="settings-option-description">
                      List code, txt, fb2 and other text files in the file tree, not only markdown
                    </span>
                  </div>
                  <label className="settings-toggle">
                    <input
                      type="checkbox"
                      checked={showTextFiles}
                      onChange={(e) => setShowTextFiles(e.target.checked)}
                    />
                    <span className="settings-toggle-slider" />
                  </label>
                </div>

                <div className="settings-option">
                  <div className="settings-option-info">
                    <span className="settings-option-label">Smooth scrolling</span>
                    <span className="settings-option-description">
                      Animate mouse wheel scrolling instead of jumping line by line
                    </span>
                  </div>
                  <label className="settings-toggle">
                    <input
                      type="checkbox"
                      checked={smoothScroll}
                      onChange={(e) => setSmoothScroll(e.target.checked)}
                    />
                    <span className="settings-toggle-slider" />
                  </label>
                </div>

                <div className="settings-option">
                  <div className="settings-option-info">
                    <span className="settings-option-label">Load remote images</span>
                    <span className="settings-option-description">
                      Show images from the web without asking. Loading them tells their server when you read a document
                    </span>
                  </div>
                  <label className="settings-toggle">
                    <input
                      type="checkbox"
                      checked={loadRemoteImages}
                      onChange={(e) => setLoadRemoteImages(e.target.checked)}
                    />
                    <span className="settings-toggle-slider" />
                  </label>
                </div>
              </div>
            )}

            {activeCategory === 'appearance' && (
              <div className="settings-section">
                <h3>Appearance</h3>
                <p className="settings-section-description">
                  Customize the look of rendered markdown content.
                </p>

                <div className="settings-option">
                  <div className="settings-option-info">
                    <span className="settings-option-label">Markdown text color (dark theme)</span>
                    <span className="settings-option-description">
                      Primary text color for rendered markdown in the dark theme
                    </span>
                  </div>
                  <input
                    type="color"
                    value={markdownTextColor}
                    onChange={(e) => setMarkdownTextColor(e.target.value)}
                    className="settings-color-input"
                  />
                </div>

                <div className="settings-option">
                  <div className="settings-option-info">
                    <span className="settings-option-label">Markdown text color (light theme)</span>
                    <span className="settings-option-description">
                      Primary text color for rendered markdown in the light theme
                    </span>
                  </div>
                  <input
                    type="color"
                    value={markdownTextColorLight}
                    onChange={(e) => setMarkdownTextColorLight(e.target.value)}
                    className="settings-color-input"
                  />
                </div>
              </div>
            )}

            {activeCategory === 'directories' && (
              <div className="settings-section">
                <h3>Watched Directories</h3>
                <p className="settings-section-description">
                  Add directories containing markdown files to browse.
                </p>

                <div className="settings-directory-list">
                  {directories.length === 0 ? (
                    <div className="settings-directory-empty">
                      No directories added yet.
                    </div>
                  ) : (
                    directories.map((dir) => (
                      <div key={dir} className="settings-directory-item">
                        <Folder size={16} className="settings-directory-icon" />
                        <span className="settings-directory-path" title={dir}>
                          {dir}
                        </span>
                        <button
                          className="settings-directory-action"
                          onClick={() => handleOpenInExplorer(dir)}
                          title="Open in file explorer"
                        >
                          <ExternalLink size={16} />
                        </button>
                        <button
                          className="settings-directory-remove"
                          onClick={() => handleRemoveDirectory(dir)}
                          title="Remove directory"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    ))
                  )}
                </div>

                <button className="settings-add-btn" onClick={handleAddDirectory}>
                  <FolderPlus size={16} />
                  <span>Add Directory</span>
                </button>
              </div>
            )}

            {activeCategory === 'highlighting' && (
              <div className="settings-section">
                <h3>Language Aliases</h3>
                <p className="settings-section-description">
                  Map code block language identifiers to syntax highlighters.
                  For example, "sc" can be mapped to "scala".
                </p>

                <div className="settings-alias-list">
                  {Object.entries(languageAliases).length === 0 ? (
                    <div className="settings-alias-empty">
                      No aliases configured.
                    </div>
                  ) : (
                    Object.entries(languageAliases)
                      .sort(([a], [b]) => a.localeCompare(b))
                      .map(([alias, lang]) => (
                        <div key={alias} className="settings-alias-item">
                          <code className="settings-alias-key">{alias}</code>
                          <span className="settings-alias-arrow">&rarr;</span>
                          <code className="settings-alias-value">{lang}</code>
                          <button
                            className="settings-alias-remove"
                            onClick={() => removeLanguageAlias(alias)}
                            title="Remove alias"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ))
                  )}
                </div>

                <div className="settings-alias-add">
                  <input
                    type="text"
                    className="settings-alias-input"
                    placeholder="Alias (e.g., sc)"
                    value={newAliasKey}
                    onChange={(e) => setNewAliasKey(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddAlias()}
                  />
                  <span className="settings-alias-arrow">&rarr;</span>
                  <input
                    type="text"
                    className="settings-alias-input"
                    placeholder="Language (e.g., scala)"
                    value={newAliasValue}
                    onChange={(e) => setNewAliasValue(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddAlias()}
                  />
                  <button
                    className="settings-alias-add-btn"
                    onClick={handleAddAlias}
                    disabled={!newAliasKey.trim() || !newAliasValue.trim()}
                    title="Add alias"
                  >
                    <Plus size={16} />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
