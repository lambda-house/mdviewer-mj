import { useMemo, useState } from 'react';
import { FileText, File as FileIcon } from 'lucide-react';
import { Palette, commandItems, matchesQuery, useMenu, type PaletteItem } from '@lambda-house/workbench';
import { useStore, type FileNode } from '../store';
import { appMenu } from '../utils/commands';
import { useReader } from '../reader';
import { allTabs, focusedGroupOf } from '@lambda-house/reader';

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

/** The folder a path is in, as shown next to a name. */
const folderOf = (path: string) => path.replace(/[\\/][^\\/]*$/, '');

/** The palette's content: subscribes to the whole store, so it exists only while open. */
function PaletteContent({ openFile }: { openFile: (path: string) => void }) {
  const state = useStore();
  const reader = useReader((s) => s);
  const openTabs = allTabs(reader);
  const currentTab = focusedGroupOf(reader).activeTabId;
  const menu = useMenu(appMenu);
  const [query, setQuery] = useState('');

  const files = useMemo(() => treeFiles(state.files), [state.files]);

  const items = useMemo<PaletteItem[]>(() => {
    const tabs = openTabs
      .filter((tab) => matchesQuery(query, tab.title, tab.path))
      .map((tab) => ({
        id: `tab:${tab.id}`,
        group: 'Open tabs',
        label: tab.title,
        hint: tab.id === currentTab ? 'Current' : folderOf(tab.path),
        icon: <FileText size={14} />,
        run: () => reader.setActiveTab(tab.id),
      }));
    const open = new Set(openTabs.map((tab) => tab.path));
    const found = query.trim()
      ? files
        .filter((file) => !open.has(file.path) && matchesQuery(query, file.name, file.displayPath))
        .slice(0, MAX_FILES)
        .map((file) => ({
          id: `file:${file.path}`,
          group: 'Files',
          label: file.name,
          hint: folderOf(file.displayPath),
          icon: <FileIcon size={14} />,
          run: () => openFile(file.path),
        }))
      : [];
    return [...tabs, ...found, ...commandItems(menu, { ...state, reader }, query)];
  }, [state, reader, menu, files, query, openFile]);

  return (
    <Palette
      open
      onClose={() => state.setPaletteOpen(false)}
      query={query}
      onQueryChange={setQuery}
      items={items}
      groups={['Open tabs', 'Files', 'Commands']}
      placeholder="Search commands, open tabs and files…"
    />
  );
}

/** The command palette (Ctrl+Shift+P, ⇧⌘P): commands, open tabs and the files of the opened folders. */
export default function CommandPalette({ openFile }: { openFile: (path: string) => void }) {
  const open = useStore((s) => s.paletteOpen);
  return open ? <PaletteContent openFile={openFile} /> : null;
}
