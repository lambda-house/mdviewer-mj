// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { findPaneOfType, leaves } from '@lambda-house/workbench';
import { useStore, panelShown } from './index';
import { defaultDocumentsLayout, documentsLayoutFrom, hidePane, isDocumentsLayout, showPane } from './documentsLayout';

const left = () => leaves(useStore.getState().documentsLayout)[0];

describe('global agent root in the left column', () => {
  beforeEach(() => {
    useStore.setState({ agentVisible: true, documentsLayout: defaultDocumentsLayout() });
  });

  it('hides and restores the root without replacing the Files panel', () => {
    useStore.getState().toggleAgentVisible();
    expect(useStore.getState().agentVisible).toBe(false);
    expect(panelShown(useStore.getState(), 'files')).toBe(true);
    useStore.getState().toggleAgentVisible();
    expect(useStore.getState().agentVisible).toBe(true);
    expect(panelShown(useStore.getState(), 'files')).toBe(true);
  });

  it('brings the root into view from History', () => {
    useStore.getState().setFilePanelVisible(false);
    useStore.getState().setHistoryVisible(true);
    useStore.getState().toggleAgentVisible();
    expect(useStore.getState().agentVisible).toBe(true);
    expect(left().pane?.type).toBe('files');
    expect(left().collapsed).toBeFalsy();
  });

  it('keeps the root visible when the left column is closed', () => {
    useStore.getState().setFilePanelVisible(false);
    expect(useStore.getState().agentVisible).toBe(true);
  });
});

describe('Files, Search and History take turns on the left', () => {
  beforeEach(() => useStore.setState({ documentsLayout: defaultDocumentsLayout() }));

  it('gives the place back to Files as it was when Search or History hides', () => {
    useStore.getState().openSearch('needle');
    expect(left().pane?.type).toBe('search');
    expect(useStore.getState().searchQuery).toBe('needle');
    useStore.getState().toggleHistoryVisible();
    expect(left().pane?.type).toBe('history');
    useStore.getState().toggleHistoryVisible();
    expect(left().pane?.type).toBe('files');
    expect(left().collapsed).toBeFalsy();
    // Files hidden before: hidden after
    useStore.getState().setFilePanelVisible(false);
    useStore.getState().setSearchVisible(true);
    expect(left().collapsed).toBeFalsy();
    useStore.getState().setSearchVisible(false);
    expect(left()).toMatchObject({ pane: { type: 'files' }, collapsed: true });
  });

  it('shows Files from under Search with the Files toggle', () => {
    useStore.getState().openSearch();
    useStore.getState().togglePanel('files');
    expect(left().pane?.type).toBe('files');
    useStore.getState().togglePanel('files');
    expect(left().collapsed).toBe(true);
  });

  it('brings back a panel its menu closed, on its side', () => {
    const layout = useStore.getState().documentsLayout;
    const withoutLeft = hidePane(layout, 'files');
    expect(findPaneOfType(withoutLeft, 'files')?.collapsed).toBe(true);
    const split = layout as Extract<typeof layout, { kind: 'split' }>;
    const closed: typeof layout = { ...split, children: split.children.slice(1), sizes: [{ fr: 1 }, { px: 220 }] };
    const shown = showPane(closed, 'history');
    expect(leaves(shown).map((l) => l.pane?.type)).toEqual(['history', 'documents', 'contents']);
  });

  it('takes over the widths and flags saved before', () => {
    const layout = documentsLayoutFrom({ panelWidth: 999, filePanelVisible: false, tocWidth: 250, tocVisible: true });
    expect((layout as { sizes: unknown[] }).sizes).toEqual([{ px: 400 }, { fr: 1 }, { px: 250 }]);
    expect(findPaneOfType(layout, 'files')?.collapsed).toBe(true);
    expect(isDocumentsLayout(layout)).toBe(true);
    expect(isDocumentsLayout({ kind: 'leaf', id: 'x', pane: { type: 'files', key: 'files' } })).toBe(false);
  });

  it('accepts only layouts it can draw', () => {
    const before = useStore.getState().documentsLayout;
    useStore.getState().setDocumentsLayout({ kind: 'leaf', id: 'main', pane: { type: 'terminal', key: 't' } });
    expect(useStore.getState().documentsLayout).toBe(before);
  });
});
