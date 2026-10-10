import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { useStore, type FileNode } from '../store';

/**
 * Check if running inside Tauri environment
 * Tauri 2.0 uses __TAURI_INTERNALS__ instead of __TAURI__
 */
export const isTauri = (): boolean => '__TAURI_INTERNALS__' in window;

/**
 * Open native directory picker dialog
 * @returns Selected directory path or null if cancelled
 */
export async function pickDirectory(): Promise<string | null> {
  if (!isTauri()) {
    console.warn('pickDirectory called outside Tauri environment');
    return null;
  }

  const result = await open({
    directory: true,
    multiple: false,
    title: 'Select Directory',
  });

  return result as string | null;
}

/**
 * Scan directories for files using Tauri backend. Lists markdown files, plus
 * other text files when the "show text files" setting is on.
 * @param paths Array of directory paths to scan
 * @returns Array of FileNode trees
 */
export async function scanDirectories(paths: string[]): Promise<FileNode[]> {
  if (!isTauri()) {
    console.warn('scanDirectories called outside Tauri environment');
    return [];
  }

  return invoke<FileNode[]>('scan_directories', {
    paths,
    includeTextFiles: useStore.getState().showTextFiles,
  });
}

/**
 * Read file contents using Tauri backend
 * @param path File path to read
 * @returns File contents as string
 */
export async function readFile(path: string): Promise<string> {
  if (!isTauri()) {
    console.warn('readFile called outside Tauri environment');
    return `# File Not Available\n\nFile reading requires the Tauri desktop app.`;
  }

  return invoke<string>('read_file', { path });
}

/**
 * Save file using native save dialog
 * @param defaultName Default file name
 * @param content File content to save
 * @param filters File type filters
 * @returns Saved file path or null if cancelled
 */
export async function saveFile(
  defaultName: string,
  content: string,
  filters?: { name: string; extensions: string[] }[]
): Promise<string | null> {
  if (!isTauri()) {
    // Fallback for browser: use download link
    const blob = new Blob([content], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = defaultName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return defaultName;
  }

  try {
    const filePath = await save({
      defaultPath: defaultName,
      filters: filters || [{ name: 'HTML', extensions: ['html'] }],
      title: 'Export HTML',
    });

    if (filePath) {
      await invoke('write_file', { path: filePath, content });
      return filePath;
    }

    return null;
  } catch (error) {
    // Handle Tauri AppError structure: {code, message, details}
    const message = extractErrorMessage(error);
    throw new Error(message);
  }
}

/**
 * Extract error message from various error formats
 */
function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'object' && error !== null) {
    const obj = error as Record<string, unknown>;
    // Tauri AppError format
    if (typeof obj.message === 'string') {
      return obj.details ? `${obj.message}: ${obj.details}` : obj.message;
    }
    return JSON.stringify(error);
  }
  return String(error);
}

/**
 * Open a path in the system's default file explorer
 * @param path Directory or file path to open
 */
export async function openInExplorer(path: string): Promise<void> {
  if (!isTauri()) {
    console.warn('openInExplorer called outside Tauri environment');
    return;
  }

  return invoke('open_in_explorer', { path });
}

/**
 * Start watching directories for changes
 * @param paths Array of directory paths to watch
 */
export async function startWatching(paths: string[]): Promise<void> {
  if (!isTauri()) {
    console.warn('startWatching called outside Tauri environment');
    return;
  }

  return invoke('start_watching', { paths });
}

/**
 * Stop watching directories
 */
export async function stopWatching(): Promise<void> {
  if (!isTauri()) {
    console.warn('stopWatching called outside Tauri environment');
    return;
  }

  return invoke('stop_watching');
}

/**
 * Get the path to the history file
 * @returns Path to history.md
 */
export async function getHistoryPath(): Promise<string> {
  if (!isTauri()) {
    console.warn('getHistoryPath called outside Tauri environment');
    return '';
  }

  return invoke<string>('get_history_path');
}

/**
 * Read history file contents
 * @returns History markdown content
 */
export async function readHistory(): Promise<string> {
  if (!isTauri()) {
    console.warn('readHistory called outside Tauri environment');
    return '# History\n\nHistory requires the Tauri desktop app.';
  }

  return invoke<string>('read_history');
}

/**
 * Append an entry to the history file
 * @param filePath Full path to the file
 * @param fileName Display name of the file
 */
export async function appendToHistory(filePath: string, fileName: string): Promise<void> {
  if (!isTauri()) {
    console.warn('appendToHistory called outside Tauri environment');
    return;
  }

  return invoke('append_to_history', { filePath, fileName });
}

/**
 * Clear the history file
 */
export async function clearHistory(): Promise<void> {
  if (!isTauri()) {
    console.warn('clearHistory called outside Tauri environment');
    return;
  }

  return invoke('clear_history');
}

/**
 * File/directory metadata for a path
 */
export interface PathInfo {
  size: number;
  modified?: number;
  isReadOnly: boolean;
  isDirectory: boolean;
}

/**
 * Get metadata for a path (used to tell dropped files from dropped folders)
 * @param path File or directory path
 */
export async function getFileInfo(path: string): Promise<PathInfo> {
  if (!isTauri()) {
    throw new Error('getFileInfo requires the Tauri desktop app');
  }

  return invoke<PathInfo>('get_file_info', { path });
}

/** Payload of a native drag & drop event. */
export type DropHandler = (paths: string[]) => void;

/**
 * Listen for files/folders dropped onto the window.
 *
 * Uses Tauri's native drag & drop events rather than the HTML5 API, because
 * only the native event carries real file system paths.
 *
 * @returns unlisten function (no-op outside Tauri)
 */
export async function onFileDrop(handlers: {
  onDrop: DropHandler;
  onEnter?: () => void;
  onLeave?: () => void;
}): Promise<() => void> {
  if (!isTauri()) {
    return () => {};
  }

  const { getCurrentWebview } = await import('@tauri-apps/api/webview');

  return getCurrentWebview().onDragDropEvent((event) => {
    const payload = event.payload;
    if (payload.type === 'enter' || payload.type === 'over') {
      handlers.onEnter?.();
    } else if (payload.type === 'leave') {
      handlers.onLeave?.();
    } else if (payload.type === 'drop') {
      handlers.onLeave?.();
      handlers.onDrop(payload.paths);
    }
  });
}

/**
 * Files/folders the app was launched with ("Open with", `mdviewer file.md`).
 * Returns them once - later calls get an empty list.
 */
export async function takeLaunchPaths(): Promise<string[]> {
  if (!isTauri()) return [];

  return invoke<string[]>('take_launch_paths');
}

/**
 * Listen for paths forwarded by a second launch while this instance is running.
 * @returns unlisten function (no-op outside Tauri)
 */
export async function onOpenPaths(handler: (paths: string[]) => void): Promise<() => void> {
  if (!isTauri()) {
    return () => {};
  }

  const { listen } = await import('@tauri-apps/api/event');
  return listen<string[]>('open-paths', (event) => handler(event.payload));
}

/**
 * Write a document back to disk. The backend keeps the file's encoding (and
 * refuses files in an unknown non-UTF-8 encoding) and leaves a .backup copy.
 */
export async function writeFile(path: string, content: string): Promise<void> {
  if (!isTauri()) {
    throw new Error('Saving requires the Tauri desktop app');
  }

  try {
    await invoke('write_file', { path, content });
  } catch (error) {
    throw new Error(extractErrorMessage(error));
  }
}
