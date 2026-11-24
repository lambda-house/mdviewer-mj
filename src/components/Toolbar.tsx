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
import { ShellTools, useCommandTitle } from '@lambda-house/workbench';
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
  // The tooltips name the keys of the menu's commands
  const titles = {
    files: useCommandTitle('view.filePanel', 'Files'),
    search: useCommandTitle('search.searchFiles', 'Search in tabs and folders'),
    history: useCommandTitle('view.history', 'History'),
    agent: useCommandTitle('view.agentFiles', agentVisible && filePanelVisible ? 'Hide global agent files' : 'Show global agent files'),
    contents: useCommandTitle('view.toc', 'Contents'),
  };

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
          title={titles.files}
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
          title={titles.search}
        >
          <FileSearch size={16} />
        </button>
        <button
          className={clsx('wb-tool', historyVisible && 'active')}
          onClick={onToggleHistory}
          title={titles.history}
        >
          <History size={16} />
        </button>
        <button
          className={clsx('wb-tool', agentVisible && filePanelVisible && 'active')}
          onClick={onToggleAgent}
          title={titles.agent}
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
          title={titles.contents}
        >
          <List size={16} />
        </button>
      </div>
    </ShellTools>
    </>
  );
};

export default Toolbar;
