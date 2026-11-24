import { FileText } from 'lucide-react';
import { useStore } from 'zustand';
import { matchesQuery, type PaletteProvider } from '@lambda-house/workbench';
import { allTabs, focusedGroupOf } from './store';
import type { Reader } from './host';

/** The folder a path is in, as shown next to a name. */
export const folderOf = (path: string) => path.replace(/[\\/][^\\/]*$/, '');

/**
 * The open tabs in the palette, first (shared UI spec §5.5): choosing one
 * shows it, after `show` brings up the surface the documents are on.
 */
export function openTabsProvider(reader: Reader, show?: () => void): PaletteProvider {
  return {
    id: 'reader:open-tabs',
    order: 10,
    useResults: (query) => {
      const state = useStore(reader.store);
      const current = focusedGroupOf(state).activeTabId;
      return {
        items: allTabs(state)
          .filter((tab) => matchesQuery(query, tab.title, tab.path))
          .map((tab) => ({
            id: `tab:${tab.id}`,
            group: 'Open tabs',
            label: tab.title,
            hint: tab.id === current ? 'Current' : folderOf(tab.path),
            icon: <FileText size={14} />,
            run: () => {
              show?.();
              reader.store.getState().setActiveTab(tab.id);
            },
          })),
      };
    },
  };
}
