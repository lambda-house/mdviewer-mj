import { useCallback, useMemo, type ReactNode } from 'react';
import { LayoutView, type Layout, type PaneType } from '@lambda-house/workbench';
import clsx from 'clsx';
import { useReader, useReaderContext } from './host';
import { DocumentPanel } from './DocumentPanel';

/**
 * The document groups side by side (or above each other), as the store
 * arranges them: each a DocumentPanel with its own tabs, zoom, find and
 * contents. A group is kept alive while it moves (a split, a close of
 * another), so its scroll and editor stay. The focused one has a line on
 * its tabs while there are several.
 */
export function DocumentGroups({ empty }: { empty?: ReactNode }) {
  const { store } = useReaderContext();
  const root = useReader((s) => s.layout);
  const focused = useReader((s) => s.focusedGroup);
  const several = useReader((s) => Object.keys(s.groups).length > 1);

  const layout = useMemo<Layout>(() => ({ version: 1, root }), [root]);
  const paneTypes = useMemo<Record<string, PaneType>>(() => ({
    documents: {
      type: 'documents', label: 'documents', keepAlive: true, min: { w: 200 },
      render: ({ pane }) => <DocumentPanel group={pane.key} empty={empty} />,
    },
  }), [empty]);
  const onChange = useCallback((next: Layout) => store.getState().setLayout(next.root), [store]);
  const onFocusLeaf = useCallback((id: string) => store.getState().focusGroup(id), [store]);

  return (
    <LayoutView
      className={clsx('reader-groups', several && 'has-several')}
      layout={layout}
      onChange={onChange}
      paneTypes={paneTypes}
      focusedLeaf={focused}
      onFocusLeaf={onFocusLeaf}
    />
  );
}
