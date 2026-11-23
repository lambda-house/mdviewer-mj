import { describe, expect, it } from 'vitest';
import {
  closeLeaf, findLeaf, joinLeaves, leaves, minAlong, normalize, resizeAt, setCollapsed, splitLeaf, swapPanes, toggleAt,
  type Leaf, type LayoutNode, type Limits, type Split,
} from './layout';

const leaf = (id: string, collapsed = false): Leaf => ({ kind: 'leaf', id, pane: { type: id, key: id }, collapsed });
const fresh = (id: string): Leaf => ({ kind: 'leaf', id, pane: null });
const ids = (node: LayoutNode) => leaves(node).map((l) => l.id);
const asSplit = (node: LayoutNode) => node as Split;

// MDViewer's Documents view: Files | document | Contents
const documents = (): Split => ({
  kind: 'split', id: 'root', dir: 'row',
  children: [leaf('files'), leaf('doc'), leaf('toc')],
  sizes: [{ px: 280 }, { fr: 1 }, { px: 220 }],
});
const panel: Limits = { min: 200, max: 400, collapsible: true };
const content: Limits = { min: 300 };
const toc: Limits = { min: 180, max: 320, collapsible: true };

describe('normalize', () => {
  it('flattens a split nested in the same direction, keeping its share of the room', () => {
    const nested: Split = {
      kind: 'split', id: 'root', dir: 'row',
      children: [leaf('a'), { kind: 'split', id: 'inner', dir: 'row', children: [leaf('b'), leaf('c')], sizes: [{ fr: 1 }, { fr: 3 }] }],
      sizes: [{ px: 200 }, { fr: 2 }],
    };
    expect(normalize(nested)).toEqual({ ...nested, children: [leaf('a'), leaf('b'), leaf('c')], sizes: [{ px: 200 }, { fr: 0.5 }, { fr: 1.5 }] });
  });

  it('replaces a split of one by its child, and keeps one child that takes the rest', () => {
    const lone: Split = { kind: 'split', id: 's', dir: 'col', children: [leaf('a')], sizes: [{ fr: 1 }] };
    expect(normalize(lone)).toEqual(leaf('a'));
    const allPx: Split = { kind: 'split', id: 's', dir: 'row', children: [leaf('a'), leaf('b', true)], sizes: [{ px: 100 }, { px: 100 }] };
    expect(asSplit(normalize(allPx)).sizes).toEqual([{ fr: 1 }, { px: 100 }]);
  });
});

describe('splitLeaf, closeLeaf, joinLeaves, swapPanes', () => {
  it('splits across into a new split, along into the same split', () => {
    const across = splitLeaf(documents(), 'doc', 'col', 'after', fresh('term'), 's1');
    const middle = asSplit(across).children[1] as Split;
    expect(middle).toMatchObject({ kind: 'split', id: 's1', dir: 'col', sizes: [{ fr: 1 }, { fr: 1 }] });
    expect(ids(middle)).toEqual(['doc', 'term']);
    expect(asSplit(across).sizes[1]).toEqual({ fr: 1 });

    const along = asSplit(splitLeaf(documents(), 'doc', 'row', 'before', fresh('doc2'), 's2'));
    expect(ids(along)).toEqual(['files', 'doc2', 'doc', 'toc']);
    expect(along.sizes).toEqual([{ px: 280 }, { fr: 0.5 }, { fr: 0.5 }, { px: 220 }]);
  });

  it('closes a leaf: its room goes to the one before, a split of one disappears, the last leaf empties', () => {
    const two = splitLeaf(documents(), 'doc', 'col', 'after', fresh('term'), 's1');
    const closed = asSplit(closeLeaf(two, 'term'));
    expect(closed.children[1]).toEqual(leaf('doc'));
    expect(asSplit(closeLeaf(documents(), 'files')).sizes).toEqual([{ fr: 1 }, { px: 220 }]);
    const pair: Split = { kind: 'split', id: 'p', dir: 'row', children: [leaf('a'), leaf('b')], sizes: [{ fr: 1 }, { fr: 3 }] };
    expect(closeLeaf(pair, 'a')).toEqual(leaf('b'));
    expect(closeLeaf(leaf('only'), 'only')).toEqual({ ...leaf('only'), pane: null });
  });

  it('joins only neighbours in one split', () => {
    const joined = asSplit(joinLeaves(documents(), 'doc', 'toc'));
    expect(ids(joined)).toEqual(['files', 'doc']);
    expect(joinLeaves(documents(), 'files', 'toc')).toEqual(documents());
  });

  it('swaps panes anywhere in the tree', () => {
    const swapped = swapPanes(documents(), 'files', 'toc');
    expect(findLeaf(swapped, 'files')?.pane?.key).toBe('toc');
    expect(findLeaf(swapped, 'toc')?.pane?.key).toBe('files');
  });
});

describe('resizeAt', () => {
  const limits = [panel, content, toc];
  const measured = [280, 900, 220];

  it('moves room between a side panel and the content, within the limits', () => {
    expect(asSplit(resizeAt(documents(), 'root', 0, 50, measured, limits)).sizes[0]).toEqual({ px: 330 });
    expect(asSplit(resizeAt(documents(), 'root', 0, 500, measured, limits)).sizes[0]).toEqual({ px: 400 });
    expect(asSplit(resizeAt(documents(), 'root', 1, -60, measured, limits)).sizes[2]).toEqual({ px: 280 });
    expect(asSplit(resizeAt(documents(), 'root', 0, -60, measured, limits)).sizes[0]).toEqual({ px: 220 });
  });

  it('collapses a panel dragged below half its minimum and brings it back when dragged out', () => {
    const hidden = resizeAt(documents(), 'root', 0, -190, measured, limits);
    expect(findLeaf(hidden, 'files')?.collapsed).toBe(true);
    expect(asSplit(hidden).sizes[0]).toEqual({ px: 280 });
    expect(resizeAt(hidden, 'root', 0, 60, [0, 1180, 220], limits)).toBe(hidden);
    const back = resizeAt(hidden, 'root', 0, 250, [0, 1180, 220], limits);
    expect(findLeaf(back, 'files')?.collapsed).toBe(false);
    expect(asSplit(back).sizes[0]).toEqual({ px: 250 });
  });

  it('shares fractions between two fractional children by their new widths', () => {
    const pair: Split = { kind: 'split', id: 'p', dir: 'col', children: [leaf('a'), leaf('b')], sizes: [{ fr: 1 }, { fr: 1 }] };
    expect(asSplit(resizeAt(pair, 'p', 0, 100, [300, 300], [{ min: 80 }, { min: 80 }])).sizes).toEqual([{ fr: 1.3333 }, { fr: 0.6667 }]);
  });
});

describe('toggleAt and minAlong', () => {
  it('hides the side panel beside a handle, and shows a collapsed one', () => {
    const limits = [panel, content, toc];
    const hidden = toggleAt(documents(), 'root', 1, limits);
    expect(findLeaf(hidden, 'toc')?.collapsed).toBe(true);
    expect(findLeaf(toggleAt(hidden, 'root', 1, limits), 'toc')?.collapsed).toBe(false);
  });

  it('adds minimums along a split and takes the largest across', () => {
    const limitsOf = (l: Leaf) => (l.id === 'files' ? panel : l.id === 'toc' ? toc : content);
    expect(minAlong(documents(), 'row', limitsOf)).toBe(200 + 300 + 180 + 8);
    expect(minAlong(setCollapsed(documents(), 'files', true), 'row', limitsOf)).toBe(300 + 180 + 8);
    expect(minAlong(documents(), 'col', limitsOf)).toBe(300);
  });
});
