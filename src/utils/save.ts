import { useStore } from '../store';
import { writeFile } from './tauri';
import { flushEditorChanges } from './editorRegistry';

/**
 * Write a document's current text to disk and mark it saved.
 * Pending editor changes are flushed first.
 */
export async function saveDocumentToDisk(path: string): Promise<{ success: boolean; error?: string }> {
  flushEditorChanges();

  const doc = useStore.getState().documents[path];
  if (!doc) return { success: false, error: 'Document is not open' };
  if (!doc.isDirty) return { success: true };

  const content = doc.content;
  try {
    await writeFile(path, content);
    useStore.getState().saveDocument(path, content);
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Save the active tab's document; failures are shown to the user. */
export async function saveActiveDocument(): Promise<void> {
  const state = useStore.getState();
  const path = state.tabs.find((t) => t.id === state.activeTabId)?.path;
  if (!path) return;

  const result = await saveDocumentToDisk(path);
  if (!result.success) {
    alert(`Could not save ${path}:\n${result.error}`);
  }
}
