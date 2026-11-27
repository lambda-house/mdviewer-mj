// "Changed since you read it": which lines of a document changed since a
// saved copy, and the rendered blocks that hold them. The app keeps the copies
// (ReaderHost.changes); this is the comparing and the marking.

/** Ages are formatted by the ui package; the reader's own name for it stays. */
export { formatAge } from '@lambda-house/ui';

// ============================================================
// What changed since the last read
// ============================================================

/** Above this many cells the middle part is taken as changed as a whole. */
const MAX_DIFF_CELLS = 4_000_000;

export interface LineChanges {
  /** Lines (0-based, in the new text) that are new or changed. */
  changed: Set<number>;
  /** Lines of the new text before which old lines were removed. */
  removedBefore: Set<number>;
}

/** Line diff of two texts: common start and end, then an LCS of the rest. */
export function diffLines(oldText: string, newText: string): LineChanges {
  const a = oldText.split('\n');
  const b = newText.split('\n');
  const changes: LineChanges = { changed: new Set(), removedBefore: new Set() };

  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const n = endA - start;
  const m = endB - start;
  if (n === 0 && m === 0) return changes;

  if (n === 0 || m === 0 || (n + 1) * (m + 1) > MAX_DIFF_CELLS) {
    for (let j = start; j < endB; j++) changes.changed.add(j);
    if (n > 0 && m === 0 && a.slice(start, endA).some((l) => l.trim())) changes.removedBefore.add(start);
    return changes;
  }

  // lcs[i][j]: LCS length of a[start+i..endA) and b[start+j..endB)
  const width = m + 1;
  const lcs = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * width + j] = a[start + i] === b[start + j]
        ? lcs[(i + 1) * width + j + 1] + 1
        : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
    }
  }
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[start + i] === b[start + j]) {
      i++;
      j++;
    } else if (i < n && (j === m || lcs[(i + 1) * width + j] >= lcs[i * width + j + 1])) {
      if (a[start + i].trim()) changes.removedBefore.add(start + j);
      i++;
    } else {
      changes.changed.add(start + j);
      j++;
    }
  }
  // A replaced line is a change, not a removal next to an addition
  for (const line of changes.removedBefore) {
    if (changes.changed.has(line)) changes.removedBefore.delete(line);
  }
  return changes;
}

/** Diff of two texts, ignoring blank lines (they only move blocks apart). */
export function diffContent(oldText: string, newText: string): LineChanges {
  const changes = diffLines(oldText, newText);
  const lines = newText.split('\n');
  for (const line of changes.changed) {
    if (!lines[line]?.trim()) changes.changed.delete(line);
  }
  return changes;
}

export const CHANGED_CLASS = 'changed-since-read';

/**
 * Mark the rendered blocks (`data-line`) that hold changed lines. A block
 * covers the lines up to the next block's first line; when nested blocks are
 * both marked only the innermost keeps the mark. Returns the marked blocks in
 * document order.
 */
export function markChangedBlocks(root: HTMLElement, changes: LineChanges): HTMLElement[] {
  root.querySelectorAll(`.${CHANGED_CLASS}`).forEach((el) => el.classList.remove(CHANGED_CLASS));
  const lines = [...changes.changed, ...changes.removedBefore];
  if (lines.length === 0) return [];

  const blocks = Array.from(root.querySelectorAll<HTMLElement>('[data-line]'));
  const starts = blocks.map((el) => Number(el.dataset.line));
  const marked: HTMLElement[] = [];
  blocks.forEach((el, index) => {
    const from = starts[index];
    let to = Infinity;
    for (let k = index + 1; k < starts.length; k++) {
      if (starts[k] > from) {
        to = starts[k];
        break;
      }
    }
    if (lines.some((line) => line >= from && line < to)) marked.push(el);
  });
  const innermost = marked.filter((el) => !marked.some((other) => other !== el && el.contains(other)));
  innermost.forEach((el) => el.classList.add(CHANGED_CLASS));
  return innermost;
}
