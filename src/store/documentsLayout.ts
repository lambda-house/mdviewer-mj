import { findPaneOfType, leaves, normalize, placePane, setCollapsed, setPane, type LayoutNode, type Leaf, type PaneRef } from '@lambda-house/workbench';

// The Documents view as a workbench layout (shared UI spec §5.3–5.4): a left
// panel (Files, Search or History, which take turns in one place), the
// document groups, the contents. These pure functions keep MDViewer's rules
// for it; the store holds the layout and saves it.

export const PANEL_MIN_WIDTH = 200;
export const PANEL_MAX_WIDTH = 400;
export const TOC_MIN_WIDTH = 180;
export const TOC_MAX_WIDTH = 320;
export const PANEL_WIDTH = 280;
export const TOC_WIDTH = 220;

/** The panes that take turns on the left. */
export const LEFT_PANES = ['files', 'search', 'history'] as const;
export type LeftPane = (typeof LEFT_PANES)[number];
export type DocumentsPane = LeftPane | 'contents';

/** The document groups' leaf. */
export const DOCUMENTS_LEAF = 'main';

const isLeft = (type: string | undefined): type is LeftPane => LEFT_PANES.includes(type as LeftPane);
const clamp = (n: number, min: number, max: number) => Math.round(Math.max(min, Math.min(max, n)));

/** What a panel shown over Files (Search, History) gives back when it is hidden. */
interface Back { pane: PaneRef; collapsed: boolean }
const backOf = (pane: PaneRef | null): Back | undefined => (pane?.state as { back?: Back } | undefined)?.back;

export function defaultDocumentsLayout({ panelWidth = PANEL_WIDTH, filePanelVisible = true, tocWidth = TOC_WIDTH, tocVisible = true }: {
  panelWidth?: number; filePanelVisible?: boolean; tocWidth?: number; tocVisible?: boolean;
} = {}): LayoutNode {
  return {
    kind: 'split', id: 'documents', dir: 'row',
    children: [
      { kind: 'leaf', id: 'left', pane: { type: 'files', key: 'files' }, collapsed: !filePanelVisible },
      { kind: 'leaf', id: DOCUMENTS_LEAF, pane: { type: 'documents', key: 'main' } },
      { kind: 'leaf', id: 'right', pane: { type: 'contents', key: 'contents' }, collapsed: !tocVisible },
    ],
    sizes: [
      { px: clamp(panelWidth, PANEL_MIN_WIDTH, PANEL_MAX_WIDTH) },
      { fr: 1 },
      { px: clamp(tocWidth, TOC_MIN_WIDTH, TOC_MAX_WIDTH) },
    ],
  };
}

/** A layout MDViewer can draw: one document groups pane, the others each at most once, nothing it doesn't know. */
export function isDocumentsLayout(value: unknown): value is LayoutNode {
  try {
    const all = leaves(normalize(value as LayoutNode));
    const types = all.map((leaf) => leaf.pane?.type);
    const ids = all.map((leaf) => leaf.id);
    return types.filter((t) => t === 'documents').length === 1
      && new Set(ids).size === ids.length
      && types.every((t) => t === 'documents' || t === 'contents' || isLeft(t))
      && new Set(types).size === types.length;
  } catch {
    return false;
  }
}

/** The leaf of a pane type, and whether it shows (not collapsed). */
export const documentsPaneLeaf = (layout: LayoutNode, type: DocumentsPane): Leaf | undefined => findPaneOfType(layout, type);
export const isPaneShown = (layout: LayoutNode, type: DocumentsPane): boolean => {
  const leaf = findPaneOfType(layout, type);
  return !!leaf && !leaf.collapsed;
};

let counter = 0;
const newLeafId = (type: string) => `${type}-${Date.now().toString(36)}${(++counter).toString(36)}`;

/**
 * Show a pane. One in the layout is shown again. Search and History take
 * the place of the left panel (Files comes back when they are hidden); Files
 * comes back from under them. A pane not in the layout returns to its side.
 */
export function showPane(layout: LayoutNode, type: DocumentsPane): LayoutNode {
  const leaf = findPaneOfType(layout, type);
  if (leaf) return setCollapsed(layout, leaf.id, false);
  if (type === 'contents') {
    return placePane(layout, DOCUMENTS_LEAF, 'after', { kind: 'leaf', id: newLeafId(type), pane: { type, key: type } }, { px: TOC_WIDTH });
  }
  const slot = leaves(layout).find((l) => isLeft(l.pane?.type));
  if (!slot?.pane) {
    return placePane(layout, DOCUMENTS_LEAF, 'before', { kind: 'leaf', id: newLeafId(type), pane: { type, key: type } }, { px: PANEL_WIDTH });
  }
  // Under the shown panel: take it back (Files from under Search)
  for (let back = backOf(slot.pane); back; back = backOf(back.pane)) {
    if (back.pane.type === type) return setCollapsed(setPane(layout, slot.id, back.pane), slot.id, false);
  }
  const pane: PaneRef = { type, key: type, state: { back: { pane: slot.pane, collapsed: !!slot.collapsed } } };
  return setCollapsed(setPane(layout, slot.id, pane), slot.id, false);
}

/** Hide a pane: Search and History give their place back to what was there (Files, as it was); the others collapse. */
export function hidePane(layout: LayoutNode, type: DocumentsPane): LayoutNode {
  const leaf = findPaneOfType(layout, type);
  if (!leaf || leaf.collapsed) return layout;
  if (type === 'search' || type === 'history') {
    for (let back = backOf(leaf.pane); back; back = backOf(back.pane)) {
      if (back.pane.type === 'files') return setCollapsed(setPane(layout, leaf.id, back.pane), leaf.id, back.collapsed);
    }
  }
  return setCollapsed(layout, leaf.id, true);
}

export const togglePane = (layout: LayoutNode, type: DocumentsPane): LayoutNode =>
  isPaneShown(layout, type) ? hidePane(layout, type) : showPane(layout, type);

/** What the app saved before the layout: widths and which panels showed. */
export function documentsLayoutFrom(saved: { panelWidth?: unknown; filePanelVisible?: unknown; tocWidth?: unknown; tocVisible?: unknown }): LayoutNode {
  return defaultDocumentsLayout({
    panelWidth: typeof saved.panelWidth === 'number' ? saved.panelWidth : undefined,
    filePanelVisible: saved.filePanelVisible !== false,
    tocWidth: typeof saved.tocWidth === 'number' ? saved.tocWidth : undefined,
    tocVisible: saved.tocVisible !== false,
  });
}
