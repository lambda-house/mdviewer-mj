import { useStore } from '../store';
import { getAgentWorkspace, markRead, readFile, type AgentEntry, type AgentKind } from './tauri';

// ============================================================
// Agent workspace: refresh and read state
// ============================================================

export const AGENT_SECTIONS: { kind: AgentKind; label: string }[] = [
  { kind: 'instructions', label: 'Instructions' },
  { kind: 'rule', label: 'Rules' },
  { kind: 'memory', label: 'Memory' },
  { kind: 'plan', label: 'Plans' },
  { kind: 'skill', label: 'Skills' },
  { kind: 'agent', label: 'Agents' },
  { kind: 'command', label: 'Commands' },
];

let refreshing: Promise<boolean> | null = null;
let watching = false;

/** Whether the backend reports changes as they happen (else poll). */
export function agentFilesWatched(): boolean {
  return watching;
}

/**
 * Scan the agent files again. Open documents that changed on disk (and have
 * no unsaved edits) are reloaded, so a memory file an agent just wrote shows
 * its new text. Resolves to whether the workspace is on.
 */
export function refreshAgentWorkspace(): Promise<boolean> {
  if (!refreshing) {
    refreshing = (async () => {
      const { agentEntries: previous, documents, reloadDocument, setAgentEntries } = useStore.getState();
      const workspace = await getAgentWorkspace();
      watching = workspace.watching;
      const before = new Map(previous.map((e) => [e.path, e.modified]));
      setAgentEntries(workspace.entries);
      const changedOpen = workspace.entries.filter(
        (e) => documents[e.path] && before.has(e.path) && before.get(e.path) !== e.modified
      );
      await Promise.all(changedOpen.map(async (entry) => {
        try {
          reloadDocument(entry.path, await readFile(entry.path));
        } catch (error) {
          console.error('Failed to reload agent file:', error);
        }
      }));
      return workspace.enabled;
    })().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

export function isAgentDocument(path: string): boolean {
  return useStore.getState().agentEntries.some((e) => e.path === path);
}

/** Mark files as read now, and clear their "changed" dots right away. */
export async function markAgentFilesRead(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  await markRead(paths);
  const done = new Set(paths);
  const { agentEntries, setAgentEntries } = useStore.getState();
  setAgentEntries(agentEntries.map((e) => (done.has(e.path) ? { ...e, unread: false, isNew: false } : e)));
}

export function agentEntryMatches(entry: AgentEntry, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return entry.title.toLowerCase().includes(q)
    || (entry.description?.toLowerCase().includes(q) ?? false)
    || entry.group.toLowerCase().includes(q)
    || entry.path.toLowerCase().includes(q);
}

/** "5 min ago", "yesterday", "12 Mar". */
export function formatAge(ms: number, now = Date.now()): string {
  const minutes = Math.round((now - ms) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

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

/** Leaving a document counts as having read it (agent files only). */
export function markLeftDocumentRead(path: string): void {
  if (!isAgentDocument(path)) return;
  markAgentFilesRead([path]).catch((error) => console.error('Failed to save read state:', error));
}
