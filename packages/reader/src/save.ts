import type { Reader } from './host';
import { flushEditorChanges } from './editorRegistry';
import { activeTabOf, allTabs, focusedGroupOf } from './store';

/**
 * Write a document's current text to disk and mark it saved.
 * Pending editor changes are flushed first.
 */
export async function saveDocumentToDisk(reader: Reader, path: string): Promise<{ success: boolean; error?: string }> {
  flushEditorChanges();

  const doc = reader.store.getState().documents[path];
  if (!doc) return { success: false, error: 'Document is not open' };
  if (!doc.isDirty) return { success: true };

  const content = doc.content;
  try {
    await reader.host.writeFile(path, content);
    reader.store.getState().saveDocument(path, content);
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Save the document shown in a group (the focused one by default); failures are shown to the person. */
export async function saveActiveDocument(reader: Reader, group?: string): Promise<void> {
  const state = reader.store.getState();
  const path = activeTabOf(group ? state.groups[group] : focusedGroupOf(state))?.path;
  if (!path) return;

  const result = await saveDocumentToDisk(reader, path);
  if (!result.success) {
    alert(`Could not save ${path}:\n${result.error}`);
  }
}

/** Ask whether to save every modified document (SaveAllDialog does the asking). */
export function requestSaveAll(reader: Reader): void {
  flushEditorChanges();

  const state = reader.store.getState();
  if (allTabs(state).some((t) => t.isDirty)) state.setSaveAllPromptOpen(true);
}

/** Save every modified document; the ones that failed are shown to the person. */
export async function saveAllDocuments(reader: Reader): Promise<void> {
  flushEditorChanges();

  const errors: string[] = [];
  const paths = [...new Set(allTabs(reader.store.getState()).filter((t) => t.isDirty).map((t) => t.path))];
  for (const path of paths) {
    // Closed while the others were being written
    if (!reader.store.getState().documents[path]) continue;
    const result = await saveDocumentToDisk(reader, path);
    if (!result.success) errors.push(`${path}: ${result.error}`);
  }

  if (errors.length > 0) {
    alert(`Could not save:\n${errors.join('\n')}`);
  }
}
