import React, { useCallback } from 'react';
import {
  FolderPlus,
  Search,
  PanelLeft,
  List,
  History,
  Bot,
  FileSearch,
} from 'lucide-react';
import { useStore, panelShown } from '../store';
import { DocumentTools, DocumentZoom } from '@lambda-house/reader';
import clsx from 'clsx';
import { ShellTools } from '@lambda-house/workbench';
import WorkspaceMenu from './WorkspaceMenu';

// ============================================================
// Toolbar Component
// ============================================================

// The Documents surface's tools in the window's top bar (the workbench Shell):
// after the main menu, and at the right before the palette, settings and theme (the Workbench's).
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
  const tocVisible = useStore((s) => panelShown(s, 'contents'));
  const toggleTocVisible = useStore((s) => s.toggleTocVisible);
  const filterQuery = useStore((s) => s.filterQuery);
  const setFilterQuery = useStore((s) => s.setFilterQuery);

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setFilterQuery(e.target.value);
  }, [setFilterQuery]);

  const handleToggleToc = useCallback(() => {
    toggleTocVisible();
  }, [toggleTocVisible]);

  return (
    <>
    <ShellTools>
      <div className="wb-tool-group">
        <button
          className={clsx('wb-tool', filePanelVisible && 'active')}
          onClick={onToggleFilePanel}
          title="Toggle Files Panel"
        >
          <PanelLeft size={16} />
        </button>
      </div>

      <div className="wb-tool-group">
        <button
          className="wb-tool"
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
      
      <div className="wb-tool-separator" />
      
      {/* Center Section */}
      <div className="wb-tool-group">
        <DocumentTools />
        <button
          className={clsx('wb-tool', searchVisible && 'active')}
          onClick={onToggleSearch}
          title="Search in tabs / folders (Ctrl+Shift+F)"
        >
          <FileSearch size={16} />
        </button>
        <button
          className={clsx('wb-tool', historyVisible && 'active')}
          onClick={onToggleHistory}
          title="Toggle History"
        >
          <History size={16} />
        </button>
        <button
          className={clsx('wb-tool', agentVisible && filePanelVisible && 'active')}
          onClick={onToggleAgent}
          title={agentVisible && filePanelVisible
            ? 'Hide global agent files (Ctrl+Shift+A)' : 'Show global agent files (Ctrl+Shift+A)'}
        >
          <Bot size={16} />
        </button>
      </div>
    </ShellTools>

    <ShellTools side="end">
      <div className="wb-tool-group">
        <DocumentZoom />
      </div>
      
      <div className="wb-tool-separator" />
      
      <div className="wb-tool-group">
        <button
          className={clsx('wb-tool', tocVisible && 'active')}
          onClick={handleToggleToc}
          title="Toggle Table of Contents"
        >
          <List size={16} />
        </button>
      </div>
    </ShellTools>
    </>
  );
};

export default Toolbar;
