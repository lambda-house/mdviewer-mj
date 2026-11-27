import { getFileName, isViewableFile } from '@lambda-house/reader';
import { useStore } from './store';
import { openPath } from './readerHost';
import { getFileInfo, pickDirectory, pickFiles, scanDirectories } from './utils/tauri';
import { findFirstMarkdown, normalizeDirPath } from './utils/files';

// Opening files and folders: Open File, Open Folder, drops, launch paths.
// Files open in tabs (readerHost's openPath), folders join the file tree.

/** Message of an Error or of a backend error ({ code, message }). */
export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return String(error);
}

/**
 * Add directories to the tree (merging overlaps, see `addDirectory`), then
 * rescan. A newly added directory is expanded down to its first markdown
 * file, which opens in the preview tab.
 */
export async function addDirectories(dirs: string[]): Promise<void> {
  const state = useStore.getState();
  const added = dirs
    .map((dir) => ({ dir, result: state.addDirectory(dir) }))
    .filter(({ result }) => !result.containedIn)
    .map(({ dir }) => normalizeDirPath(dir));
  // A folder can already be open, and another panel may be covering Files.
  // Always bring the requested folder into view after the picker closes.
  state.showPanel('files');
  state.setFilterQuery('');
  state.revealPath(normalizeDirPath(dirs[dirs.length - 1]));
  if (added.length === 0) return;

  useStore.getState().setFiles(await scanDirectories(useStore.getState().directories));

  const root = useStore.getState().files.find((node) => node.path === added[added.length - 1]);
  const first = root && findFirstMarkdown(root);
  if (!first) return;

  useStore.getState().revealPath(first.file.path);
  try {
    await openPath(first.file.path, { preview: true });
  } catch (error) {
    console.error('Failed to open first markdown file:', error);
  }
}

/** Open Folder: the native picker, then the folder joins the tree. */
export async function openFolder(): Promise<void> {
  try {
    const dir = await pickDirectory();
    if (dir) await addDirectories([dir]);
  } catch (error) {
    console.error('Failed to open folder:', error);
    alert(`Could not open folder:\n${errorText(error)}`);
  }
}

/** Dropped, launched or picked paths: files open in tabs, folders join the tree. */
export async function openPaths(paths: string[]): Promise<void> {
  const errors: string[] = [];
  const dirs: string[] = [];

  for (const path of paths) {
    try {
      const info = await getFileInfo(path);
      if (info.isDirectory) {
        dirs.push(path);
      } else if (isViewableFile(path)) {
        await openPath(path);
      } else {
        errors.push(`${getFileName(path)} is not a markdown or text file`);
      }
    } catch (error) {
      console.error('Failed to handle dropped path:', path, error);
      errors.push(`${getFileName(path)}: ${errorText(error)}`);
    }
  }

  if (dirs.length > 0) {
    try {
      await addDirectories(dirs);
    } catch (error) {
      errors.push(`Folders: ${errorText(error)}`);
    }
  }

  if (errors.length > 0) {
    alert(`Could not open:\n${errors.join('\n')}`);
  }
}

/** Open File: the native picker; the chosen files open like dropped ones. */
export async function openFiles(): Promise<void> {
  try {
    const paths = await pickFiles();
    if (paths.length > 0) await openPaths(paths);
  } catch (error) {
    console.error('Failed to pick files:', error);
    alert(`Could not open the file dialog:\n${errorText(error)}`);
  }
}
