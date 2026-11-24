import { useCallback, useMemo, type ReactNode } from 'react';
import { LayoutView, type Layout, type PaneType } from '@lambda-house/workbench';
import { useReader, useReaderContext } from './host';
import { DocumentPanel } from './DocumentPanel';
import { DocumentStatus } from './DocumentStatus';

/**
 * The document groups side by side (or above each other), as the store
 * arranges them: each a DocumentPanel with its own tabs, zoom, find and
 * contents. A group is kept alive while it moves (a split, a close of
 * another), so its scroll and editor stay. The focused one (`is-focused`)
 * is the one commands act on; the line on the pane with the window's focus
 * is the workbench's.
 */
export function DocumentGroups({ empty }: { empty?: ReactNode }) {
  const { store } = useReaderContext();
  const root = useReader((s) => s.layout);
  const focused = useReader((s) => s.focusedGroup);

  const layout = useMemo<Layout>(() => ({ version: 1, root }), [root]);
  const paneTypes = useMemo<Record<string, PaneType>>(() => ({
    documents: {
      type: 'documents', label: 'documents', title: 'Documents', keepAlive: true, min: { w: 200 },
      // A group zooms itself (Ctrl+wheel over it), splits into a new group and closes as the store does
      zoom: {
        get: ({ pane }) => store.getState().groups[pane.key]?.zoom ?? 100,
        step: ({ pane }, direction) => {
          const state = store.getState();
          if (direction === 0) state.resetZoom(pane.key);
          else if (direction > 0) state.zoomIn(pane.key);
          else state.zoomOut(pane.key);
        },
        subscribe: store.subscribe,
      },
      split: ({ pane }, dir) => { store.getState().splitGroup(pane.key, dir); },
      closable: () => Object.keys(store.getState().groups).length > 1,
      close: ({ pane }) => {
        const result = store.getState().closeGroup(pane.key);
        if (!result.success && result.error) window.alert(result.error);
      },
      render: ({ pane }) => <DocumentPanel group={pane.key} empty={empty} />,
    },
  }), [empty, store]);
  const onChange = useCallback((next: Layout) => store.getState().setLayout(next.root), [store]);
  const onFocusLeaf = useCallback((id: string) => store.getState().focusGroup(id), [store]);

  return (
    <>
    <DocumentStatus />
    <LayoutView
      className="reader-groups"
      layout={layout}
      onChange={onChange}
      paneTypes={paneTypes}
      focusedLeaf={focused}
      onFocusLeaf={onFocusLeaf}
    />
    </>
  );
}
