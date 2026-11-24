// The layout tree of a view (shared UI spec §5.3): splits with two or more
// children, each child sized in pixels (side panels) or in fractions of what
// the pixel ones leave (the content). Leaves hold a pane, or nothing. All
// functions are pure: they return a new tree and never change the one given.

export type Size = { px: number } | { fr: number };

/** What a leaf shows: a pane type and the key of its instance. */
export interface PaneRef {
  type: string;
  key: string;
  state?: unknown;
}

export interface Leaf {
  kind: 'leaf';
  id: string;
  pane: PaneRef | null;
  /** Takes no room; its handle shows a grip to bring it back. */
  collapsed?: boolean;
}

export interface Split {
  kind: 'split';
  id: string;
  /** row: children side by side; col: one above the other. */
  dir: 'row' | 'col';
  children: LayoutNode[];
  sizes: Size[];
}

export type LayoutNode = Leaf | Split;

export interface Layout {
  version: 1;
  root: LayoutNode;
}

/** Limits of a child along its split's direction. */
export interface Limits {
  min: number;
  max?: number;
  collapsible?: boolean;
}

/** Dragged below this fraction of its minimum, a collapsible pane collapses. */
export const COLLAPSE_FRACTION = 0.5;

export const isPx = (size: Size): size is { px: number } => 'px' in size;

// ============================================================
// Reading
// ============================================================

export function leaves(node: LayoutNode): Leaf[] {
  return node.kind === 'leaf' ? [node] : node.children.flatMap(leaves);
}

export function findLeaf(node: LayoutNode, id: string): Leaf | undefined {
  return leaves(node).find((leaf) => leaf.id === id);
}

export function findSplit(node: LayoutNode, id: string): Split | undefined {
  if (node.kind === 'leaf') return undefined;
  if (node.id === id) return node;
  for (const child of node.children) {
    const found = findSplit(child, id);
    if (found) return found;
  }
  return undefined;
}

/** The split that holds a node, and the node's place in it. */
export function parentOf(node: LayoutNode, id: string): { split: Split; index: number } | undefined {
  if (node.kind === 'leaf') return undefined;
  const index = node.children.findIndex((child) => child.id === id);
  if (index !== -1) return { split: node, index };
  for (const child of node.children) {
    const found = parentOf(child, id);
    if (found) return found;
  }
  return undefined;
}

/** The leaf showing a pane with this key. */
export function findPane(node: LayoutNode, key: string): Leaf | undefined {
  return leaves(node).find((leaf) => leaf.pane?.key === key);
}

/** The leaf showing a pane of this type (the first one). */
export function findPaneOfType(node: LayoutNode, type: string): Leaf | undefined {
  return leaves(node).find((leaf) => leaf.pane?.type === type);
}

/**
 * Put a pane into the layout beside a leaf, in the row of the top split
 * (a side panel), with its own size; the layout keeps the order given by
 * `side`. When the root is a leaf it becomes a row of both.
 */
export function placePane(root: LayoutNode, beside: string, side: 'before' | 'after', leaf: Leaf, size: Size, splitId = 'root'): LayoutNode {
  if (root.kind === 'leaf') {
    const children = side === 'before' ? [leaf, root] : [root, leaf];
    const sizes: Size[] = side === 'before' ? [size, { fr: 1 }] : [{ fr: 1 }, size];
    return normalize({ kind: 'split', id: splitId, dir: 'row', children, sizes });
  }
  // The top-level child that holds `beside`
  const index = root.children.findIndex((child) => child.id === beside || (child.kind === 'split' && !!findLeaf(child, beside)));
  if (index === -1) return root;
  const children = [...root.children];
  const sizes = [...root.sizes];
  const at = side === 'before' ? index : index + 1;
  children.splice(at, 0, leaf);
  sizes.splice(at, 0, size);
  return normalize({ ...root, children, sizes });
}

/** The smallest room a node needs along `dir`: a sum along its own direction, the largest child across it. */
export function minAlong(node: LayoutNode, dir: 'row' | 'col', limitsOf: (leaf: Leaf, dir: 'row' | 'col') => Limits, handle = 4): number {
  if (node.kind === 'leaf') return node.collapsed ? 0 : limitsOf(node, dir).min;
  const mins = node.children.map((child) => minAlong(child, dir, limitsOf, handle));
  return node.dir === dir
    ? mins.reduce((a, b) => a + b, 0) + handle * (node.children.length - 1)
    : Math.max(0, ...mins);
}

// ============================================================
// Keeping the tree in shape
// ============================================================

const round = (n: number) => Math.round(n * 10000) / 10000;

/** A child split's sizes, re-expressed for its parent's room `outer`. */
function spread(outer: Size, inner: Size[]): Size[] {
  const fr = inner.filter((s) => !isPx(s)).reduce((sum, s) => sum + (s as { fr: number }).fr, 0) || 1;
  if (!isPx(outer)) return inner.map((s) => (isPx(s) ? s : { fr: round(((s as { fr: number }).fr / fr) * outer.fr) }));
  const px = inner.filter(isPx).reduce((sum, s) => sum + s.px, 0);
  const left = Math.max(0, outer.px - px);
  return inner.map((s) => (isPx(s) ? s : { px: Math.round(((s as { fr: number }).fr / fr) * left) }));
}

/**
 * The tree's invariants: a split has two or more children and a size for
 * each; a child split runs across its parent (same-direction nesting is
 * flattened); every split has a fractional child that takes the rest.
 */
export function normalize(node: LayoutNode): LayoutNode {
  if (node.kind === 'leaf') return node;
  const children: LayoutNode[] = [];
  const sizes: Size[] = [];
  node.children.forEach((raw, i) => {
    const child = normalize(raw);
    const size = node.sizes[i] ?? { fr: 1 };
    if (child.kind === 'split' && child.dir === node.dir) {
      children.push(...child.children);
      sizes.push(...spread(size, child.sizes));
    } else {
      children.push(child);
      sizes.push(size);
    }
  });
  if (children.length === 1) return children[0];
  if (!sizes.some((s) => !isPx(s))) {
    // Someone has to take the rest: the last child that is shown
    let last = children.length - 1;
    while (last > 0 && children[last].kind === 'leaf' && (children[last] as Leaf).collapsed) last--;
    sizes[last] = { fr: 1 };
  }
  return { ...node, children, sizes };
}

/** Replace one node, by id, and keep the tree in shape. */
function replace(root: LayoutNode, id: string, fn: (node: LayoutNode) => LayoutNode): LayoutNode {
  const walk = (node: LayoutNode): LayoutNode => {
    if (node.id === id) return fn(node);
    if (node.kind === 'leaf') return node;
    const children = node.children.map(walk);
    return children.every((c, i) => c === node.children[i]) ? node : { ...node, children };
  };
  const next = walk(root);
  return next === root ? root : normalize(next);
}

/** Change one split's children and sizes. */
function editSplit(root: LayoutNode, id: string, fn: (split: Split) => Split): LayoutNode {
  return replace(root, id, (node) => (node.kind === 'split' ? fn(node) : node));
}

// ============================================================
// Operations
// ============================================================

/**
 * Put `fresh` beside a leaf. When the leaf's split already runs in `dir` the
 * two share the leaf's room there; otherwise the leaf becomes a split of both.
 */
export function splitLeaf(root: LayoutNode, leafId: string, dir: 'row' | 'col', side: 'before' | 'after', fresh: Leaf, splitId: string): LayoutNode {
  const place = parentOf(root, leafId);
  if (place && place.split.dir === dir) {
    return editSplit(root, place.split.id, (split) => {
      const size = split.sizes[place.index];
      const half: Size = isPx(size) ? { px: Math.round(size.px / 2) } : { fr: round(size.fr / 2) };
      const children = [...split.children];
      const sizes = [...split.sizes];
      const at = side === 'before' ? place.index : place.index + 1;
      sizes[place.index] = half;
      children.splice(at, 0, fresh);
      sizes.splice(at, 0, { ...half });
      return { ...split, children, sizes };
    });
  }
  return replace(root, leafId, (leaf) => ({
    kind: 'split',
    id: splitId,
    dir,
    children: side === 'before' ? [fresh, leaf] : [leaf, fresh],
    sizes: [{ fr: 1 }, { fr: 1 }],
  }));
}

/** Take a leaf out; its room goes to the neighbour before it (after it, if it was first). The last leaf just empties. */
export function closeLeaf(root: LayoutNode, leafId: string): LayoutNode {
  const place = parentOf(root, leafId);
  if (!place) return root.kind === 'leaf' && root.id === leafId ? { ...root, pane: null, collapsed: false } : root;
  return editSplit(root, place.split.id, (split) => {
    const children = split.children.filter((_, i) => i !== place.index);
    const sizes = split.sizes.filter((_, i) => i !== place.index);
    const gone = split.sizes[place.index];
    const heir = place.index > 0 ? place.index - 1 : 0;
    const kept = sizes[heir];
    if (isPx(gone) && isPx(kept)) sizes[heir] = { px: kept.px + gone.px };
    else if (!isPx(gone) && !isPx(kept)) sizes[heir] = { fr: round(kept.fr + gone.fr) };
    return { ...split, children, sizes };
  });
}

/** Join two leaves next to each other in one split: `remove` goes, `keep` takes its room. */
export function joinLeaves(root: LayoutNode, keepId: string, removeId: string): LayoutNode {
  const keep = parentOf(root, keepId);
  const gone = parentOf(root, removeId);
  if (!keep || !gone || keep.split.id !== gone.split.id || Math.abs(keep.index - gone.index) !== 1) return root;
  return editSplit(root, keep.split.id, (split) => {
    const a = split.sizes[keep.index], b = split.sizes[gone.index];
    const merged: Size = isPx(a) && isPx(b) ? { px: a.px + b.px } : !isPx(a) && !isPx(b) ? { fr: round(a.fr + b.fr) } : a;
    const sizes = [...split.sizes];
    sizes[keep.index] = merged;
    return {
      ...split,
      children: split.children.filter((_, i) => i !== gone.index),
      sizes: sizes.filter((_, i) => i !== gone.index),
    };
  });
}

/** Exchange the panes of two leaves (anywhere in the tree). */
export function swapPanes(root: LayoutNode, aId: string, bId: string): LayoutNode {
  const a = findLeaf(root, aId), b = findLeaf(root, bId);
  if (!a || !b || a === b) return root;
  return setPane(setPane(root, aId, b.pane), bId, a.pane);
}

export function setPane(root: LayoutNode, leafId: string, pane: PaneRef | null): LayoutNode {
  return replace(root, leafId, (node) => (node.kind === 'leaf' ? { ...node, pane } : node));
}

export function setCollapsed(root: LayoutNode, leafId: string, collapsed: boolean): LayoutNode {
  return replace(root, leafId, (node) => (node.kind === 'leaf' && Boolean(node.collapsed) !== collapsed ? { ...node, collapsed } : node));
}

/** Set one child's size in its split. */
export function setSize(root: LayoutNode, nodeId: string, size: Size): LayoutNode {
  const place = parentOf(root, nodeId);
  if (!place) return root;
  return editSplit(root, place.split.id, (split) => {
    const sizes = [...split.sizes];
    sizes[place.index] = size;
    return { ...split, sizes };
  });
}

const clamp = (n: number, limits: Limits) => Math.min(limits.max ?? Infinity, Math.max(limits.min, n));

/**
 * Move the handle between children `divider` and `divider + 1` of a split by
 * `delta` px, from sizes `measured` at the drag's start. Room moves between
 * the two within their limits; a collapsible pane dragged below half its
 * minimum collapses, and dragging its handle back out shows it again.
 */
export function resizeAt(root: LayoutNode, splitId: string, divider: number, delta: number, measured: number[], limits: Limits[]): LayoutNode {
  const split = findSplit(root, splitId);
  if (!split) return root;
  const i = divider, j = divider + 1;
  const a = split.children[i], b = split.children[j];
  if (!a || !b) return root;
  const collapsedA = a.kind === 'leaf' && !!a.collapsed;
  const collapsedB = b.kind === 'leaf' && !!b.collapsed;
  const total = measured[i] + measured[j];
  const wantA = measured[i] + delta, wantB = measured[j] - delta;

  // Collapse or bring back the pane whose side the handle moves into
  const toggle = (node: LayoutNode, index: number, want: number, collapsed: boolean, lim: Limits): LayoutNode | null => {
    if (node.kind !== 'leaf' || !lim.collapsible) return null;
    const show = want >= lim.min * COLLAPSE_FRACTION;
    if (!collapsed && !show) return setCollapsed(root, node.id, true);
    if (collapsed && show) {
      const shown = setCollapsed(root, node.id, false);
      const size = split.sizes[index];
      return isPx(size) ? setSize(shown, node.id, { px: Math.round(clamp(want, lim)) }) : shown;
    }
    return collapsed ? root : null;
  };
  const byA = toggle(a, i, wantA, collapsedA, limits[i]);
  if (byA && (collapsedA || delta < 0)) return byA;
  const byB = toggle(b, j, wantB, collapsedB, limits[j]);
  if (byB && (collapsedB || delta > 0)) return byB;
  if (collapsedA || collapsedB) return root;

  let widthA = clamp(wantA, limits[i]);
  let widthB = total - widthA;
  if (widthB < limits[j].min || widthB > (limits[j].max ?? Infinity)) {
    widthB = clamp(widthB, limits[j]);
    widthA = clamp(total - widthB, limits[i]);
    widthB = total - widthA;
  }
  const sa = split.sizes[i], sb = split.sizes[j];
  return editSplit(root, splitId, (s) => {
    const sizes = [...s.sizes];
    if (isPx(sa)) sizes[i] = { px: Math.round(widthA) };
    if (isPx(sb)) sizes[j] = { px: Math.round(widthB) };
    if (!isPx(sa) && !isPx(sb) && total > 0) {
      const fr = sa.fr + sb.fr;
      sizes[i] = { fr: round((fr * widthA) / total) };
      sizes[j] = { fr: round((fr * widthB) / total) };
    }
    return { ...s, sizes };
  });
}

/** The handle's double-click: show a collapsed neighbour, or hide the collapsible one. */
export function toggleAt(root: LayoutNode, splitId: string, divider: number, limits: Limits[]): LayoutNode {
  const split = findSplit(root, splitId);
  if (!split) return root;
  const pair = [divider, divider + 1].map((index) => ({ node: split.children[index], lim: limits[index] }));
  const collapsed = pair.find(({ node }) => node?.kind === 'leaf' && node.collapsed);
  if (collapsed) return setCollapsed(root, collapsed.node.id, false);
  // A pixel-sized collapsible pane first: that is the side panel
  const candidates = pair.filter(({ node, lim }) => node?.kind === 'leaf' && lim?.collapsible);
  const target = candidates.find(({ node }) => isPx(split.sizes[split.children.indexOf(node)])) ?? candidates[0];
  return target ? setCollapsed(root, target.node.id, true) : root;
}

// ============================================================
// A window too small for the panes (shared UI spec §5.3)
// ============================================================

/** The collapsible leaves in the order they give way: the outermost first; of two at one depth, the later (the right or bottom side panel). */
function givingWay(root: LayoutNode, limitsOf: (leaf: Leaf, dir: 'row' | 'col') => Limits, keep?: string): Leaf[] {
  const found: Array<{ leaf: Leaf; depth: number; index: number }> = [];
  const walk = (node: LayoutNode, depth: number) => {
    if (node.kind === 'leaf') {
      if (!node.collapsed && node.id !== keep && limitsOf(node, 'row').collapsible) found.push({ leaf: node, depth, index: found.length });
    } else {
      node.children.forEach((child) => walk(child, depth + 1));
    }
  };
  walk(root, 0);
  return found.sort((a, b) => a.depth - b.depth || b.index - a.index).map((f) => f.leaf);
}

/** Collapse leaves, in the order they give way, until the minimums fit `size`; `keep` stays. */
function collapseToFit(root: LayoutNode, size: { w: number; h: number }, limitsOf: (leaf: Leaf, dir: 'row' | 'col') => Limits, handle: number, keep?: string): LayoutNode {
  let node = root;
  for (const dir of ['row', 'col'] as const) {
    const room = dir === 'row' ? size.w : size.h;
    for (const leaf of givingWay(node, limitsOf, keep)) {
      const need = minAlong(node, dir, limitsOf, handle);
      if (need <= room) break;
      const next = setCollapsed(node, leaf.id, true);
      // Only a leaf whose minimum counts along this axis makes room
      if (minAlong(next, dir, limitsOf, handle) < need) node = next;
    }
  }
  return node;
}

/** Pixel-sized children give up room towards their minimums, in proportion to what they can give, while the split is too small. */
function shrinkToFit(node: LayoutNode, w: number, h: number, limitsOf: (leaf: Leaf, dir: 'row' | 'col') => Limits, handle: number): LayoutNode {
  if (node.kind === 'leaf') return node;
  const along = node.dir === 'row' ? w : h;
  const across = node.dir === 'row' ? h : w;
  const hidden = node.children.map((child) => child.kind === 'leaf' && !!child.collapsed);
  const mins = node.children.map((child, i) => (hidden[i] ? 0 : minAlong(child, node.dir, limitsOf, handle)));
  const room = along - handle * (node.children.length - 1);
  const pxOf = (size: Size, i: number) => (hidden[i] || !isPx(size) ? 0 : size.px);
  const frMins = node.sizes.reduce((sum, size, i) => sum + (isPx(size) || hidden[i] ? 0 : mins[i]), 0);
  const excess = node.sizes.reduce((sum, size, i) => sum + pxOf(size, i), 0) + frMins - room;
  let sizes = node.sizes;
  if (excess > 0) {
    const slack = node.sizes.map((size, i) => Math.max(0, pxOf(size, i) - mins[i]));
    const total = slack.reduce((a, b) => a + b, 0);
    if (total > 0) {
      const cut = Math.min(excess, total);
      sizes = node.sizes.map((size, i) => (slack[i] > 0 && isPx(size) ? { px: Math.round(size.px - (cut * slack[i]) / total) } : size));
    }
  }
  // The children's lengths as drawn: pixels as sized, the rest shared by fraction, never below a minimum
  const rest = Math.max(0, room - sizes.reduce((sum, size, i) => sum + pxOf(size, i), 0));
  const frTotal = sizes.reduce((sum, size, i) => sum + (isPx(size) || hidden[i] ? 0 : size.fr), 0);
  const lengths = sizes.map((size, i) => (hidden[i] ? 0 : isPx(size) ? size.px : Math.max(mins[i], frTotal ? (rest * size.fr) / frTotal : 0)));
  const children = node.children.map((child, i) => shrinkToFit(child, node.dir === 'row' ? lengths[i] : across, node.dir === 'row' ? across : lengths[i], limitsOf, handle));
  const same = sizes === node.sizes && children.every((child, i) => child === node.children[i]);
  return same ? node : { ...node, sizes, children };
}

/**
 * The layout as it is drawn in a window of `size` px that is smaller than
 * its panes need (shared UI spec §5.3), never saved, so a bigger window
 * brings back the stored sizes. Fraction-sized panes go down to their
 * minimums (the browser does that); collapsible leaves collapse in the order
 * they give way until the minimums fit; then pixel-sized panes shrink towards
 * their minimums. What is still too big is clipped. The same node when nothing changes.
 */
export function fitLayout(root: LayoutNode, size: { w: number; h: number }, limitsOf: (leaf: Leaf, dir: 'row' | 'col') => Limits, handle = 4): LayoutNode {
  return shrinkToFit(collapseToFit(root, size, limitsOf, handle), size.w, size.h, limitsOf, handle);
}

/**
 * Show a leaf the window has no room for (its handle's grip): the leaves
 * that give way for it collapse in the stored layout instead.
 */
export function revealLeaf(root: LayoutNode, leafId: string, size: { w: number; h: number }, limitsOf: (leaf: Leaf, dir: 'row' | 'col') => Limits, handle = 4): LayoutNode {
  const shown = setCollapsed(root, leafId, false);
  const fitted = collapseToFit(shown, size, limitsOf, handle, leafId);
  let result = shown;
  for (const leaf of leaves(fitted)) if (leaf.collapsed && !findLeaf(shown, leaf.id)?.collapsed) result = setCollapsed(result, leaf.id, true);
  return result;
}
