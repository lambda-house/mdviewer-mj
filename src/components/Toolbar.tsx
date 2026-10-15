import React, { useState, useCallback } from 'react';
import {
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
import { exportActiveDocument } from '../utils/export';
import type { MenuItem } from '../utils/commands';
import clsx from 'clsx';
import MainMenu from './MainMenu';
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
  /** The main menu (see utils/commands.ts). */
  menu: MenuItem[];
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

const Toolbar: React.FC<ToolbarProps> = ({
  menu,
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
    setIsExporting(true);
    try {
      await exportActiveDocument('html');
    } finally {
      setIsExporting(false);
    }
  }, []);

  return (
    <header className="toolbar">
      {/* Left Section */}
      <div className="toolbar-group">
        <MainMenu items={menu} />
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
          title="Global agent files (Ctrl+Shift+A)"
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
