// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { diffContent, diffLines, markChangedBlocks, CHANGED_CLASS } from './changes';

const sorted = (lines: Set<number>) => [...lines].sort((a, b) => a - b);

describe('diffLines', () => {
  it('finds nothing in equal texts', () => {
    const changes = diffLines('a\nb\nc', 'a\nb\nc');
    expect(changes.changed.size).toBe(0);
    expect(changes.removedBefore.size).toBe(0);
  });

  it('marks a replaced line, not the one after it', () => {
    const changes = diffLines('a\nb\nc\nd', 'a\nB\nc\nd');
    expect(sorted(changes.changed)).toEqual([1]);
    expect(changes.removedBefore.size).toBe(0);
  });

  it('marks added lines', () => {
    expect(sorted(diffLines('a\nc', 'a\nb1\nb2\nc').changed)).toEqual([1, 2]);
  });

  it('marks where lines were removed', () => {
    const changes = diffLines('a\nb\nc', 'a\nc');
    expect(changes.changed.size).toBe(0);
    expect(sorted(changes.removedBefore)).toEqual([1]);
  });

  it('marks text removed at the end', () => {
    expect(sorted(diffLines('a\nb', 'a').removedBefore)).toEqual([1]);
  });
});

describe('diffContent', () => {
  it('ignores added blank lines', () => {
    const changes = diffContent('# A\ntext\n# B', '# A\ntext\n\n# B');
    expect(changes.changed.size).toBe(0);
    expect(changes.removedBefore.size).toBe(0);
  });
});

describe('markChangedBlocks', () => {
  it('marks the innermost block holding a changed line', () => {
    const root = document.createElement('div');
    root.innerHTML = [
      '<h1 data-line="0">Title</h1>',
      '<ul data-line="2"><li data-line="2">one</li><li data-line="3">two</li></ul>',
      '<p data-line="5">end</p>',
    ].join('');
    const marked = markChangedBlocks(root, { changed: new Set([3]), removedBefore: new Set() });
    expect(marked.map((el) => el.textContent)).toEqual(['two']);
    expect(root.querySelectorAll(`.${CHANGED_CLASS}`)).toHaveLength(1);

    // Marking again replaces the old marks
    markChangedBlocks(root, { changed: new Set(), removedBefore: new Set([5]) });
    expect(Array.from(root.querySelectorAll(`.${CHANGED_CLASS}`), (el) => el.textContent)).toEqual(['end']);
  });
});
