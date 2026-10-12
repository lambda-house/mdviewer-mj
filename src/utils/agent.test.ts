// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { agentEntryMatches, diffContent, diffLines, formatAge, markChangedBlocks, CHANGED_CLASS } from './agent';
import type { AgentEntry } from './tauri';

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

describe('agent list helpers', () => {
  const entry: AgentEntry = {
    path: '/repo/.cursor/rules/api.mdc',
    kind: 'rule',
    title: 'api',
    description: 'Applies to src/api/**',
    group: '~/repo',
    scope: 'project',
    modified: 0,
    unread: false,
    isNew: false,
  };

  it('filters on title, description, group and path', () => {
    expect(agentEntryMatches(entry, '')).toBe(true);
    expect(agentEntryMatches(entry, 'API')).toBe(true);
    expect(agentEntryMatches(entry, 'src/api')).toBe(true);
    expect(agentEntryMatches(entry, '.cursor')).toBe(true);
    expect(agentEntryMatches(entry, 'memory')).toBe(false);
  });

  it('formats ages', () => {
    const now = Date.UTC(2026, 9, 12, 12);
    expect(formatAge(now - 20_000, now)).toBe('just now');
    expect(formatAge(now - 5 * 60_000, now)).toBe('5 min ago');
    expect(formatAge(now - 3 * 3_600_000, now)).toBe('3 h ago');
    expect(formatAge(now - 26 * 3_600_000, now)).toBe('yesterday');
    expect(formatAge(now - 3 * 86_400_000, now)).toBe('3 days ago');
  });
});
