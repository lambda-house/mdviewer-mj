import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  Folder,
  FolderOpen,
  FileText,
  FileCode,
  BookOpen,
  ChevronRight,
  FolderPlus,
  RefreshCw,
  ExternalLink,
  X,
} from 'lucide-react';
import { useStore, type FileNode } from '../store';
import { filterFiles, getFileKind } from '../utils/files';
import { readFile, scanDirectories, isTauri, openInExplorer, appendToHistory } from '../utils/tauri';
import clsx from 'clsx';
import PanelZoomBadge from './PanelZoomBadge';
import { useSmoothWheelScroll } from '../hooks/useSmoothWheelScroll';

// ============================================================
// Tree Node Component
// ============================================================

/**
 * Compact folders (like VS Code): a directory whose only child is another
 * directory is shown as one row "a/b/c". Returns the chain, deepest last.
 */
function compactChain(node: FileNode): FileNode[] {
  const chain = [node];
  let current = node;
  while (
    current.type === 'directory' &&
    current.children?.length === 1 &&
    current.children[0].type === 'directory'
  ) {
    current = current.children[0];
    chain.push(current);
  }
  return chain;
}

/**
 * A path-like label that wraps at its separators when the panel is narrow
 * (instead of being cut off with an ellipsis).
 */
const WrappingPath: React.FC<{ parts: string[]; separator?: string }> = ({ parts, separator = '/' }) => (
  <>
    {parts.map((part, i) => (
      <React.Fragment key={i}>
        {i > 0 && <>{separator}<wbr /></>}
        {part}
      </React.Fragment>
    ))}
  </>
);

function FileIcon({ path }: { path: string }) {
  const { kind } = getFileKind(path);
  if (kind === 'code') return <FileCode size={16} />;
  if (kind === 'fb2') return <BookOpen size={16} />;
  return <FileText size={16} />;
}

interface TreeNodeProps {
  node: FileNode;
  level: number;
}

const TreeNode: React.FC<TreeNodeProps> = ({ node: chainTop, level }) => {
  const chain = useMemo(() => compactChain(chainTop), [chainTop]);
  // The row acts as the deepest directory of the chain
  const node = chain[chain.length - 1];
  const chainPaths = chain.map((n) => n.path);

  // Per-node selectors: expanding or selecting one node must not re-render
  // every other node in the tree.
  const isExpandedInStore = useStore((s) => s.expandedPaths.includes(node.path));
  const isSelected = useStore((s) => s.selectedPath !== null && chainPaths.includes(s.selectedPath));
  const rowRef = useRef<HTMLDivElement>(null);

  // Bring the row into view when it becomes selected (reveal, tab switch)
  useEffect(() => {
    if (isSelected) rowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [isSelected]);
  const toggleExpanded = useStore((s) => s.toggleExpanded);
  const setSelectedPath = useStore((s) => s.setSelectedPath);
  const openDocument = useStore((s) => s.openDocument);

  const isExpanded = node.isExpanded || isExpandedInStore;
  const isDirectory = node.type === 'directory';

  // Single click opens the preview tab, double-click a permanent tab (the
  // click before it already opened the preview, which then gets pinned)
  const openFile = useCallback(async (preview: boolean) => {
    setSelectedPath(node.path);
    try {
      const content = await readFile(node.path);
      const result = openDocument(node.path, content, { preview });

      if (!result.success && result.error) {
        alert(result.error);
      } else if (preview) {
        // Log to history on successful open (a double-click's own click
        // already logged it)
        appendToHistory(node.path, node.name).catch((err) => {
          console.error('Failed to log to history:', err);
        });
      }
    } catch (error) {
      console.error('Failed to read file:', error);
      alert(`Failed to read file: ${error}`);
    }
  }, [node.path, node.name, setSelectedPath, openDocument]);

  const handleClick = useCallback(async () => {
    if (isDirectory) {
      toggleExpanded(node.path);
    } else {
      await openFile(true);
    }
  }, [isDirectory, node.path, toggleExpanded, openFile]);

  const handleDoubleClick = useCallback(() => {
    if (!isDirectory) {
      openFile(false);
    }
  }, [isDirectory, openFile]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleClick();
    }
  }, [handleClick]);

  const handleOpenInExplorer = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await openInExplorer(node.path);
    } catch (error) {
      console.error('Failed to open in explorer:', error);
    }
  }, [node.path]);

  return (
    <div className="tree-node">
      <div
        ref={rowRef}
        className={clsx('tree-node-content', isSelected && 'selected')}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        role="treeitem"
        aria-expanded={isDirectory ? isExpanded : undefined}
        aria-selected={isSelected}
        style={{ paddingLeft: `${12 + level * 16}px` }}
      >
        {isDirectory ? (
          <span className={clsx('tree-node-expand', isExpanded && 'expanded')}>
            <ChevronRight size={14} />
          </span>
        ) : (
          <span className="tree-node-indent" />
        )}

        <span className={clsx('tree-node-icon', isDirectory ? 'folder' : 'file')}>
          {isDirectory ? (
            isExpanded ? <FolderOpen size={16} /> : <Folder size={16} />
          ) : (
            <FileIcon path={node.path} />
          )}
        </span>

        <span className={clsx('tree-node-name', chain.length > 1 && 'compact')} title={node.path}>
          {chain.length > 1
            ? <WrappingPath parts={chain.map((n) => n.name)} />
            : node.displayPath || node.name}
        </span>

        <button
          className="tree-node-action"
          onClick={handleOpenInExplorer}
          title={isDirectory ? "Open in file explorer" : "Open file location"}
        >
          <ExternalLink size={14} />
        </button>
      </div>
      
      {isDirectory && node.children && (
        <div className={clsx('tree-node-children', isExpanded && 'expanded')}>
          {node.children.map((child) => (
            <MemoTreeNode key={child.id} node={child} level={level + 1} />
          ))}
        </div>
      )}
    </div>
  );
};

// Rows only re-render when their node changed - rescans keep unchanged nodes
// (see reuseUnchangedNodes), so a refresh does not re-render the whole tree
const MemoTreeNode = React.memo(TreeNode);

// ============================================================
// Directory Section Component
// ============================================================

interface DirectorySectionProps {
  dirPath: string;
  rootNode: FileNode | undefined;
  filterQuery: string;
}

const DirectorySection: React.FC<DirectorySectionProps> = ({ dirPath, rootNode, filterQuery }) => {
  const removeDirectory = useStore((s) => s.removeDirectory);
  const [isCollapsed, setIsCollapsed] = useState(false);

  const handleRemove = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    removeDirectory(dirPath);
  }, [dirPath, removeDirectory]);

  const handleOpenInExplorer = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await openInExplorer(dirPath);
    } catch (error) {
      console.error('Failed to open in explorer:', error);
    }
  }, [dirPath]);

  const toggleCollapse = useCallback(() => {
    setIsCollapsed((prev) => !prev);
  }, []);

  // Get children to display (skip the root directory node itself)
  const filteredChildren = useMemo(() => {
    const children = rootNode?.children || [];
    return filterQuery ? filterFiles(children, filterQuery) : children;
  }, [rootNode, filterQuery]);

  return (
    <div className="directory-section">
      <div className="directory-section-header" onClick={toggleCollapse}>
        <span className={clsx('directory-section-expand', !isCollapsed && 'expanded')}>
          <ChevronRight size={14} />
        </span>
        <Folder size={14} className="directory-section-icon" />
        <span className="directory-section-path" title={dirPath}>
          <WrappingPath
            parts={dirPath.split(/[/\\]/)}
            separator={dirPath.includes('\\') && !dirPath.includes('/') ? '\\' : '/'}
          />
        </span>
        <button
          className="directory-section-action"
          onClick={handleOpenInExplorer}
          title="Open in file explorer"
        >
          <ExternalLink size={14} />
        </button>
        <button
          className="directory-section-action directory-section-remove"
          onClick={handleRemove}
          title="Remove directory"
        >
          <X size={14} />
        </button>
      </div>
      {!isCollapsed && filteredChildren.length > 0 && (
        <div className="directory-section-content">
          {filteredChildren.map((node) => (
            <MemoTreeNode key={node.id} node={node} level={0} />
          ))}
        </div>
      )}
    </div>
  );
};

const MemoDirectorySection = React.memo(DirectorySection);

// ============================================================
// Empty State Component
// ============================================================

interface EmptyStateProps {
  onAddDirectory: () => void;
}

const EmptyState: React.FC<EmptyStateProps> = ({ onAddDirectory }) => (
  <div className="file-panel-empty">
    <FolderPlus size={48} className="file-panel-empty-icon" />
    <p className="file-panel-empty-text">
      No directories added yet.<br />
      Add a directory to get started.
    </p>
    <button className="file-panel-empty-button" onClick={onAddDirectory}>
      Add Directory
    </button>
  </div>
);

// ============================================================
// File Panel Component
// ============================================================

interface FilePanelProps {
  width: number;
  onAddDirectory?: () => void;
}

const FilePanel: React.FC<FilePanelProps> = ({ width, onAddDirectory }) => {
  const files = useStore((s) => s.files);
  // Deferred: typing in the filter box stays responsive while the (possibly
  // large) filtered tree renders in the background, interruptibly
  const filterQuery = useDeferredValue(useStore((s) => s.filterQuery));
  const directories = useStore((s) => s.directories);
  const setFiles = useStore((s) => s.setFiles);
  const zoom = useStore((s) => s.panelZoom.files);
  const smoothScroll = useStore((s) => s.smoothScroll);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const treeRef = useRef<HTMLElement>(null);

  const isEmpty = directories.length === 0;
  useSmoothWheelScroll(treeRef, smoothScroll, !isEmpty);

  // Create a map of directory path to its root FileNode
  const dirToFileNode = new Map<string, FileNode>();
  for (const node of files) {
    dirToFileNode.set(node.path, node);
  }

  const handleAddDirectory = useCallback(() => {
    onAddDirectory?.();
  }, [onAddDirectory]);

  const handleRefresh = useCallback(async () => {
    if (!isTauri() || directories.length === 0 || isRefreshing) return;

    setIsRefreshing(true);
    try {
      const files = await scanDirectories(directories);
      setFiles(files);
    } catch (error) {
      console.error('Failed to refresh directories:', error);
    } finally {
      setIsRefreshing(false);
    }
  }, [directories, setFiles, isRefreshing]);

  return (
    <aside className="file-panel" style={{ width }} data-zoom-panel="files">
      <div className="file-panel-header">
        <span className="file-panel-title">Files</span>
        <div className="file-panel-actions">
          <PanelZoomBadge panel="files" />
          <button
            className="file-panel-action"
            onClick={handleAddDirectory}
            title="Add Directory"
          >
            <FolderPlus size={16} />
          </button>
          <button
            className={clsx('file-panel-action', isRefreshing && 'spinning')}
            onClick={handleRefresh}
            title="Refresh"
            disabled={isRefreshing}
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      {isEmpty ? (
        <EmptyState onAddDirectory={handleAddDirectory} />
      ) : (
        <nav ref={treeRef} className="file-tree" role="tree" aria-label="File navigation">
          <div className="panel-zoom" style={{ zoom: zoom / 100 }}>
            {directories.map((dirPath) => (
              <MemoDirectorySection
                key={dirPath}
                dirPath={dirPath}
                rootNode={dirToFileNode.get(dirPath)}
                filterQuery={filterQuery}
              />
            ))}
          </div>
        </nav>
      )}
    </aside>
  );
};

export default FilePanel;
