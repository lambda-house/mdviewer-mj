import type { EditorState } from '@codemirror/state';

// Kept out of Editor.tsx so the app can use it without loading CodeMirror
// (the editor itself is lazy-loaded on first use).

/** Per-document editor state: undo history, cursor and scroll survive tab switches. */
export const savedEditorStates = new Map<string, EditorState>();

let flushPending: (() => void) | null = null;

/** Register the mounted editor's flush (pending debounced changes -> store). */
export function setEditorFlush(flush: (() => void) | null): void {
  flushPending = flush;
}

export function getEditorFlush(): (() => void) | null {
  return flushPending;
}

/** Push any not-yet-debounced editor changes to the store right now. */
export function flushEditorChanges(): void {
  flushPending?.();
}

/** Forget editor states of documents that are no longer open. */
export function pruneEditorStates(openPaths: string[]): void {
  const open = new Set(openPaths);
  for (const path of savedEditorStates.keys()) {
    if (!open.has(path)) savedEditorStates.delete(path);
  }
}
