import { useCallback, useMemo } from 'react';
import { File as FileIcon, FileQuestion, FileSearch, FileText, Files, History, Upload } from 'lucide-react';
import { EmptyState, Kbd } from '@lambda-house/ui';
import { LayoutView, matchesQuery, usePaneTypes, type Layout, type PaletteProvider, type PaneZoom, type Plugin } from '@lambda-house/workbench';
import { allTabs, folderOf } from '@lambda-house/reader';
import { useStore, panelShown, PANEL_MIN_WIDTH, PANEL_MAX_WIDTH, type FileNode, type ZoomPanel } from './store';
import { useReader } from './reader';
import { defaultDocumentsLayout } from './store/documentsLayout';
import { registry } from './workbench';
import { openPath } from './readerHost';
import { errorText, openFolder } from './opening';
import Toolbar from './components/Toolbar';
import UpdateBanner from './components/UpdateBanner';
import FilePanel from './components/FilePanel';
import SearchPanel from './components/SearchPanel';
import HistoryPanel from './components/HistoryPanel';
import { appSettingsTabs } from './components/SettingsTabs';

// MDViewer's own part of the window, as a plugin: the Documents surface (its
// tools, the update banner, and the layout of the left panel, the document
// groups and the contents), the left panel's panes (Files, Search and
// History take turns there), the Folders and Updates tabs, the files of the
// opened folders in the palette. The document groups, the contents and the
// open tabs in the palette are the reader's (readerPlugin).

/** An empty document group: how to open a document here. */
export const NO_DOCUMENT = (
  <EmptyState
    size="lg"
    icon={<FileQuestion size={64} />}
    title="No Document Open"
    hint={<><Kbd>Ctrl</Kbd>+<Kbd>P</Kbd> to quick open a file</>}
  >
    Select a markdown file from the sidebar, or drop one on this window
  </EmptyState>
);

/** A panel's zoom, kept in the store (Files and Contents keep theirs when the left panel switches). */
export const zoomOf = (panel: ZoomPanel): PaneZoom => ({
  get: () => useStore.getState().panelZoom[panel],
  step: (_, direction) => useStore.getState().zoomPanel(panel, direction),
  subscribe: useStore.subscribe,
});

/** Files shown when the query is empty are none; with a query, at most this many. */
const MAX_FILES = 50;

/** The files of the opened folders, depth first. */
function treeFiles(nodes: FileNode[], out: FileNode[] = []): FileNode[] {
  for (const node of nodes) {
    if (node.type === 'file') out.push(node);
    else if (node.children) treeFiles(node.children, out);
  }
  return out;
}

/** Bring up the documents. */
export const showDocuments = () => useStore.getState().setSurface('documents');

/** The palette's files: those of the opened folders that match, and aren't open in a tab (the reader lists those). */
export const filesProvider: PaletteProvider = {
  id: 'mdviewer:files',
  order: 20,
  useResults: (query) => {
    const tree = useStore((s) => s.files);
    const tabs = useReader((s) => s.groups);
    const files = useMemo(() => treeFiles(tree), [tree]);
    if (!query.trim()) return { items: [] };
    const open = new Set(allTabs({ groups: tabs }).map((tab) => tab.path));
    return {
      items: files
        .filter((file) => !open.has(file.path) && matchesQuery(query, file.name, file.displayPath))
        .slice(0, MAX_FILES)
        .map((file) => ({
          id: `file:${file.path}`,
          group: 'Files',
          label: file.name,
          hint: folderOf(file.displayPath),
          icon: <FileIcon size={14} />,
          run: () => {
            showDocuments();
            openPath(file.path).catch((error) => alert(`Could not open ${file.path}:\n${errorText(error)}`));
          },
        })),
    };
  },
};

/** The Documents surface, on the workbench layout the store keeps (store/documentsLayout.ts). */
function Documents() {
  const root = useStore((s) => s.documentsLayout);
  const setDocumentsLayout = useStore((s) => s.setDocumentsLayout);
  const agentVisible = useStore((s) => s.agentVisible);
  const toggleAgentVisible = useStore((s) => s.toggleAgentVisible);
  const toggleHistoryVisible = useStore((s) => s.toggleHistoryVisible);
  const setSearchVisible = useStore((s) => s.setSearchVisible);
  const openSearch = useStore((s) => s.openSearch);
  const dropTarget = useStore((s) => s.dropTarget);
  const shows = (pane: Parameters<typeof panelShown>[1]) => panelShown({ documentsLayout: root }, pane);
  const searchVisible = shows('search');

  // Its handles and pane menus change the layout in the store, which takes only layouts MDViewer can draw
  const layout = useMemo<Layout>(() => ({ version: 1, root }), [root]);
  const apply = useCallback((next: Layout) => setDocumentsLayout(next.root), [setDocumentsLayout]);
  const reset = useCallback(() => setDocumentsLayout(defaultDocumentsLayout()), [setDocumentsLayout]);
  const paneTypes = usePaneTypes(registry, 'documents');

  return (
    <>
      <Toolbar
        onAddDirectory={openFolder}
        filePanelVisible={shows('files')}
        onToggleFilePanel={() => useStore.getState().togglePanel('files')}
        historyVisible={shows('history')}
        onToggleHistory={toggleHistoryVisible}
        agentVisible={agentVisible}
        onToggleAgent={toggleAgentVisible}
        searchVisible={searchVisible}
        onToggleSearch={() => (searchVisible ? setSearchVisible(false) : openSearch())}
      />

      <UpdateBanner />

      <div className="main-content">
        <LayoutView layout={layout} onChange={apply} paneTypes={paneTypes} onReset={reset} />
      </div>

      {dropTarget && (
        <div className="drop-overlay" aria-hidden="true">
          <div className="drop-overlay-inner">
            <Upload size={40} />
            <span className="drop-overlay-title">Drop to open</span>
            <span className="drop-overlay-hint">
              Markdown and text files open in a tab, folders are added to the file tree
            </span>
          </div>
        </div>
      )}
    </>
  );
}

export const documentsPlugin: Plugin = {
  id: 'mdviewer',
  name: 'MDViewer',
  description: 'The Documents surface: folders, search, history, workspaces.',
  required: true,
  setup(api) {
    // Mounted only while shown
    api.contribute('workbench:surface', { id: 'documents', label: 'Documents', icon: <FileText size={13} />, keepMounted: false, order: 10, render: () => <Documents /> });
    const left = { collapsible: true, switchable: true, singleton: true, min: { w: PANEL_MIN_WIDTH }, max: { w: PANEL_MAX_WIDTH } };
    api.contribute('workbench:pane-type', { view: 'documents', type: { type: 'files', label: 'file panel', title: 'Files', icon: <Files size={14} />, ...left, zoom: zoomOf('files'), render: () => <FilePanel onAddDirectory={openFolder} /> } });
    api.contribute('workbench:pane-type', { view: 'documents', type: { type: 'search', label: 'search panel', title: 'Search', icon: <FileSearch size={14} />, ...left, render: () => <SearchPanel /> } });
    api.contribute('workbench:pane-type', { view: 'documents', type: { type: 'history', label: 'history panel', title: 'History', icon: <History size={14} />, ...left, render: () => <HistoryPanel /> } });
    for (const tab of appSettingsTabs()) api.contribute('workbench:settings-tab', tab);
    api.contribute('workbench:palette-provider', filesProvider);
  },
};
