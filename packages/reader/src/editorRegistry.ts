import type { EditorState } from '@codemirror/state';

// Kept out of Editor.tsx so the app can use it without loading CodeMirror
// (the editor itself is lazy-loaded on first use).

/** Per-document editor state: undo history, cursor and scroll survive tab switches. */
export const savedEditorStates = new Map<string, EditorState>();

/** The mounted editors' flushes (one per document group that edits). */
const flushes = new Set<() => void>();

/** Register a mounted editor's flush (pending debounced changes -> store); returns its removal. */
export function registerEditorFlush(flush: () => void): () => void {
  flushes.add(flush);
  return () => { flushes.delete(flush); };
}

/** Push every editor's not-yet-debounced changes to the store right now. */
export function flushEditorChanges(): void {
  for (const flush of flushes) flush();
}

/** Forget editor states of documents that are no longer open. */
export function pruneEditorStates(openPaths: string[]): void {
  const open = new Set(openPaths);
  for (const path of savedEditorStates.keys()) {
    if (!open.has(path)) savedEditorStates.delete(path);
  }
}
