import React, { useState, useCallback } from 'react';
import {
  Menu,
  FolderPlus,
  Search,
  Edit3,
  Download,
  PanelLeft,
  Minus,
  Plus,
  List,
  Moon,
  Sun,
  Settings,
  History,
  Bot,
  FileSearch,
} from 'lucide-react';
import { useStore, MIN_ZOOM, MAX_ZOOM } from '../store';
import { saveFile } from '../utils/tauri';
import { escapeHtml, loadRemoteImages } from '../utils/markdown';
import clsx from 'clsx';
import WorkspaceMenu from './WorkspaceMenu';

// ============================================================
// Zoom Control Component
// ============================================================

// The slider is logarithmic: 50%..1600% is 5 doublings, so a linear slider
// would squeeze everything below 200% into the first few pixels.
const SLIDER_STEPS = 1000;
const zoomToSlider = (zoom: number) =>
  Math.round((Math.log(zoom / MIN_ZOOM) / Math.log(MAX_ZOOM / MIN_ZOOM)) * SLIDER_STEPS);
const sliderToZoom = (value: number) =>
  MIN_ZOOM * Math.pow(MAX_ZOOM / MIN_ZOOM, value / SLIDER_STEPS);

const ZoomControl: React.FC = () => {
  const zoom = useStore((s) => s.zoom);
  const setZoom = useStore((s) => s.setZoom);
  const zoomIn = useStore((s) => s.zoomIn);
  const zoomOut = useStore((s) => s.zoomOut);
  const resetZoom = useStore((s) => s.resetZoom);
  const [isExpanded, setIsExpanded] = useState(false);

  const handleSliderChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setZoom(sliderToZoom(parseInt(e.target.value, 10)));
  }, [setZoom]);

  return (
    <div
      className={clsx('zoom-control', isExpanded ? 'expanded' : 'collapsed')}
      onMouseEnter={() => setIsExpanded(true)}
      onMouseLeave={() => setIsExpanded(false)}
      onClick={() => !isExpanded && setIsExpanded(true)}
    >
      {isExpanded ? (
        <>
          <button
            className={clsx('zoom-reset-button', zoom === 100 && 'disabled')}
            onClick={zoom !== 100 ? resetZoom : undefined}
            title="Reset to 100%"
          >
            100%
          </button>
          <button className="zoom-button" onClick={zoomOut} title={`Zoom out (${zoom}%)`}>
            <Minus size={12} />
          </button>
          <input
            type="range"
            className="zoom-slider"
            min="0"
            max={SLIDER_STEPS}
            step="1"
            value={zoomToSlider(zoom)}
            onChange={handleSliderChange}
            title={`${zoom}%`}
          />
          <button className="zoom-button" onClick={zoomIn} title={`Zoom in (${zoom}%)`}>
            <Plus size={12} />
          </button>
          <span className="zoom-value">{zoom}%</span>
        </>
      ) : (
        <span className="zoom-value">{zoom}%</span>
      )}
    </div>
  );
};

// ============================================================
// Toolbar Component
// ============================================================

interface ToolbarProps {
  onAddDirectory?: () => void;
  filePanelVisible?: boolean;
  onToggleFilePanel?: () => void;
  historyVisible?: boolean;
  onToggleHistory?: () => void;
  agentVisible?: boolean;
  onToggleAgent?: () => void;
  searchVisible?: boolean;
  onToggleSearch?: () => void;
}

/** Export palette per theme (the app's own variables are not in the file). */
const EXPORT_PALETTE = {
  dark: `
      --surface-bg: #1e1e1e;
      --surface-elevated: #252526;
      --surface-overlay: #2d2d30;
      --border-default: #3c3c3c;
      --border-subtle: #2d2d30;
      --text-primary: #cccccc;
      --text-secondary: #858585;
      --text-accent: #4fc1ff;
      --selected-bg: #094771;`,
  light: `
      --surface-bg: #ffffff;
      --surface-elevated: #f3f3f3;
      --surface-overlay: #f7f7f7;
      --border-default: #d0d0d0;
      --border-subtle: #e4e4e4;
      --text-primary: #1f1f1f;
      --text-secondary: #6a6a6a;
      --text-accent: #005fb8;
      --selected-bg: #cce4f7;`,
};

// Generate complete HTML document for export, in the current theme.
// `content` is serialized DOM (already HTML); `title` is a file name.
function generateExportHtml(title: string, content: string, theme: 'dark' | 'light'): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    :root {${EXPORT_PALETTE[theme]}
      color-scheme: ${theme};
      --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      --font-mono: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
    }

    body {
      font-family: var(--font-sans);
      font-size: 14px;
      line-height: 1.7;
      color: var(--text-primary);
      background-color: var(--surface-bg);
      max-width: 800px;
      margin: 0 auto;
      padding: 32px 48px;
      -webkit-font-smoothing: antialiased;
    }

    h1, h2, h3, h4, h5, h6 {
      margin-top: 1.5em;
      margin-bottom: 0.5em;
      font-weight: 600;
      line-height: 1.3;
    }

    h1 { font-size: 32px; padding-bottom: 0.3em; border-bottom: 1px solid var(--border-subtle); }
    h2 { font-size: 24px; padding-bottom: 0.3em; border-bottom: 1px solid var(--border-subtle); }
    h3 { font-size: 18px; }
    h4 { font-size: 16px; }

    h1:first-child, h2:first-child, h3:first-child { margin-top: 0; }

    p { margin: 1em 0; }

    a { color: var(--text-accent); text-decoration: none; }
    a:hover { text-decoration: underline; }

    code {
      font-family: var(--font-mono);
      font-size: 0.9em;
      padding: 0.2em 0.4em;
      background: var(--surface-overlay);
      border-radius: 3px;
    }

    pre {
      margin: 1em 0;
      padding: 16px;
      background: var(--surface-overlay);
      border-radius: 6px;
      overflow-x: auto;
    }

    pre code {
      padding: 0;
      background: none;
      font-size: 12px;
      line-height: 1.6;
    }

    blockquote {
      margin: 1em 0;
      padding: 0.5em 1em;
      border-left: 4px solid #007acc;
      background: var(--surface-elevated);
      color: var(--text-secondary);
    }

    ul, ol { margin: 1em 0; padding-left: 2em; }
    li { margin: 0.5em 0; }

    table { width: 100%; margin: 1em 0; border-collapse: collapse; }
    th, td { padding: 10px 16px; border: 1px solid var(--border-default); text-align: left; }
    th { background: var(--surface-elevated); font-weight: 600; }
    tr:nth-child(even) { background: var(--surface-elevated); }

    img { max-width: 100%; height: auto; border-radius: 6px; }
    hr { margin: 2em 0; border: none; border-top: 1px solid var(--border-default); }

    .code-block-wrapper { position: relative; margin: 1em 0; }
    .code-block-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 16px;
      background: #3c3c3c;
      border-radius: 6px 6px 0 0;
      border-bottom: 1px solid var(--border-subtle);
    }
    .code-block-language {
      font-size: 11px;
      font-weight: 500;
      text-transform: uppercase;
      color: var(--text-secondary);
    }
    .code-block-copy { display: none; }
    .code-block-wrapper pre { margin: 0; border-radius: 0 0 6px 6px; }

    /* Mermaid diagrams */
    .mermaid-container {
      margin: 1em 0;
      background: var(--surface-overlay);
      border-radius: 6px;
      padding: 16px;
      overflow-x: auto;
    }
    .mermaid-viewport {
      display: flex;
      justify-content: center;
    }
    .mermaid-content {
      display: flex;
      justify-content: center;
    }
    .mermaid-content svg {
      max-width: 100%;
      height: auto;
    }
    .mermaid-controls,
    .mermaid-hint,
    .mermaid-raw { display: none; }
    /* Shiki output carries both themes as CSS variables */
    .shiki span {
      color: var(--shiki-${theme});
      font-style: var(--shiki-${theme}-font-style);
      font-weight: var(--shiki-${theme}-font-weight);
      text-decoration: var(--shiki-${theme}-text-decoration);
    }
  </style>
</head>
<body>
  <article class="markdown-body">
    ${content}
  </article>
</body>
</html>`;
}

const Toolbar: React.FC<ToolbarProps> = ({
  onAddDirectory,
  filePanelVisible,
  onToggleFilePanel,
  historyVisible,
  onToggleHistory,
  agentVisible,
  onToggleAgent,
  searchVisible,
  onToggleSearch,
}) => {
  const tocVisible = useStore((s) => s.tocVisible);
  const toggleTocVisible = useStore((s) => s.toggleTocVisible);
  const filterQuery = useStore((s) => s.filterQuery);
  const setFilterQuery = useStore((s) => s.setFilterQuery);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);
  const activeTab = useStore((s) => s.tabs.find((t) => t.id === s.activeTabId) ?? null);
  const theme = useStore((s) => s.theme);
  const editMode = useStore((s) => s.editMode);
  const toggleEditMode = useStore((s) => s.toggleEditMode);
  const toggleTheme = useStore((s) => s.toggleTheme);
  const [isExporting, setIsExporting] = useState(false);

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setFilterQuery(e.target.value);
  }, [setFilterQuery]);

  const handleToggleToc = useCallback(() => {
    toggleTocVisible();
  }, [toggleTocVisible]);


  const handleOpenSettings = useCallback(() => {
    setSettingsOpen(true);
  }, [setSettingsOpen]);

  const handleExportHtml = useCallback(async () => {
    if (!activeTab || isExporting) return;

    // Get rendered HTML from the actual DOM (includes syntax highlighting & mermaid).
    // Scoped to the document panel: the history panel is a .markdown-body too.
    const markdownBody = document.querySelector('.document-panel .markdown-body');
    if (!markdownBody) {
      alert('No document content to export');
      return;
    }

    setIsExporting(true);
    try {
      const fileName = activeTab.title.replace(/\.md$/i, '') + '.html';
      // The exported page shows the remote images that are still placeholders here
      const exported = markdownBody.cloneNode(true) as HTMLElement;
      loadRemoteImages(exported);
      const htmlContent = generateExportHtml(activeTab.title, exported.innerHTML, theme);

      const savedPath = await saveFile(fileName, htmlContent, [
        { name: 'HTML', extensions: ['html', 'htm'] }
      ]);

      if (savedPath) {
        console.log('Exported to:', savedPath);
      }
    } catch (error) {
      console.error('Failed to export HTML:', error);
      // Handle various error formats including Tauri AppError
      let message: string;
      if (error instanceof Error) {
        message = error.message;
      } else if (typeof error === 'object' && error !== null) {
        const obj = error as Record<string, unknown>;
        if (typeof obj.message === 'string') {
          message = obj.details ? `${obj.message}: ${obj.details}` : obj.message;
        } else {
          message = JSON.stringify(error);
        }
      } else {
        message = String(error);
      }
      alert(`Failed to export HTML: ${message}`);
    } finally {
      setIsExporting(false);
    }
  }, [activeTab, isExporting, theme]);
  
  return (
    <header className="toolbar">
      {/* Left Section */}
      <div className="toolbar-group">
        <button className="toolbar-button" title="Menu">
          <Menu size={16} />
        </button>
        <button
          className={clsx('toolbar-button', filePanelVisible && 'active')}
          onClick={onToggleFilePanel}
          title="Toggle Files Panel"
        >
          <PanelLeft size={16} />
        </button>
      </div>

      <div className="toolbar-group">
        <button
          className="toolbar-button"
          onClick={onAddDirectory}
          title="Add Directory"
        >
          <FolderPlus size={16} />
        </button>
        <WorkspaceMenu />
      </div>
      
      <div className="toolbar-search">
        <Search size={13} className="toolbar-search-icon" />
        <input
          type="text"
          placeholder="Search files..."
          value={filterQuery}
          onChange={handleSearchChange}
        />
      </div>
      
      <div className="toolbar-separator" />
      
      {/* Center Section */}
      <div className="toolbar-group">
        <button
          className={clsx('toolbar-button', editMode && 'active')}
          onClick={toggleEditMode}
          title={editMode ? 'Close editor (Ctrl+E)' : 'Edit document (Ctrl+E)'}
        >
          <Edit3 size={16} />
        </button>
        <button
          className={clsx('toolbar-button', isExporting && 'active')}
          onClick={handleExportHtml}
          disabled={!activeTab || isExporting}
          title={activeTab ? 'Export as HTML' : 'No document to export'}
        >
          <Download size={16} />
        </button>
        <button
          className={clsx('toolbar-button', searchVisible && 'active')}
          onClick={onToggleSearch}
          title="Search in tabs / folders (Ctrl+Shift+F)"
        >
          <FileSearch size={16} />
        </button>
        <button
          className={clsx('toolbar-button', historyVisible && 'active')}
          onClick={onToggleHistory}
          title="Toggle History"
        >
          <History size={16} />
        </button>
        <button
          className={clsx('toolbar-button', agentVisible && 'active')}
          onClick={onToggleAgent}
          title="Agent files: instructions, memory, skills (Ctrl+Shift+A)"
        >
          <Bot size={16} />
        </button>
      </div>
      
      <div className="toolbar-spacer" />
      
      {/* Right Section */}
      <div className="toolbar-group">
        <ZoomControl />
      </div>
      
      <div className="toolbar-separator" />
      
      <div className="toolbar-group">
        <button
          className={clsx('toolbar-button', tocVisible && 'active')}
          onClick={handleToggleToc}
          title="Toggle Table of Contents"
        >
          <List size={16} />
        </button>
        <button
          className="toolbar-button"
          onClick={handleOpenSettings}
          title="Settings"
        >
          <Settings size={16} />
        </button>
        <button
          className="toolbar-button"
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        >
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </div>
    </header>
  );
};

export default Toolbar;
