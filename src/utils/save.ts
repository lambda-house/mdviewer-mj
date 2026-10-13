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

/** Ask whether to save every modified document (SaveAllDialog does the asking). */
export function requestSaveAll(): void {
  flushEditorChanges();

  const state = useStore.getState();
  if (state.tabs.some((t) => t.isDirty)) state.setSaveAllPromptOpen(true);
}

/** Save every modified document; the ones that failed are shown to the user. */
export async function saveAllDocuments(): Promise<void> {
  flushEditorChanges();

  const errors: string[] = [];
  for (const tab of useStore.getState().tabs.filter((t) => t.isDirty)) {
    // Closed while the others were being written
    if (!useStore.getState().documents[tab.path]) continue;
    const result = await saveDocumentToDisk(tab.path);
    if (!result.success) errors.push(`${tab.path}: ${result.error}`);
  }

  if (errors.length > 0) {
    alert(`Could not save:\n${errors.join('\n')}`);
  }
}
