import { useMemo } from 'react';
import { Clock, FileText, Hash } from 'lucide-react';
import { ShellStatus, StatusItem } from '@lambda-house/workbench';
import { useReader } from './host';
import { activeTabOf, focusedGroupOf } from './store';

// The focused group's document in the window's status bar (shared UI spec
// §5.6): its path, size and age at the start, its words and reading time at the end.

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const countWords = (text: string): number => text.trim().split(/\s+/).filter(Boolean).length;

function readingTime(text: string): string {
  const minutes = Math.ceil(text.trim().split(/\s+/).length / 200);
  return minutes === 1 ? '1 min read' : `${minutes} min read`;
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  if (days < 7) return `${days} day${days > 1 ? 's' : ''} ago`;
  return new Date(timestamp).toLocaleDateString();
}

/** A long path as its first and last two parts, either separator. */
export function truncatePath(path: string, maxLength = 50): string {
  if (path.length <= maxLength) return path;
  const parts = path.split(/[\\/]/);
  if (parts.length <= 3) return path;
  const separator = path.includes('\\') ? '\\' : '/';
  return `${parts[0] || parts[1]}${separator}...${separator}${parts.slice(-2).join(separator)}`;
}

export function DocumentStatus() {
  const tab = useReader((s) => activeTabOf(focusedGroupOf(s)));
  const document = useReader((s) => (tab ? s.documents[tab.path] : undefined));
  const stats = useMemo(() => {
    const content = document?.content ?? '';
    return { words: countWords(content), reading: readingTime(content), size: new Blob([content]).size, modified: document?.lastModified ?? Date.now() };
  }, [document?.content, document?.lastModified]);

  if (!tab || !document) {
    return <ShellStatus id="reader:document"><StatusItem>No document open</StatusItem></ShellStatus>;
  }
  return (
    <>
      <ShellStatus id="reader:document">
        <StatusItem icon={<FileText size={12} />} title={tab.path}>{truncatePath(tab.path)}</StatusItem>
        <StatusItem>{formatFileSize(stats.size)}</StatusItem>
        <StatusItem icon={<Clock size={12} />}>{formatRelativeTime(stats.modified)}</StatusItem>
      </ShellStatus>
      <ShellStatus id="reader:words" side="end">
        <StatusItem icon={<Hash size={12} />}>{stats.words.toLocaleString()} words</StatusItem>
        <StatusItem>{stats.reading}</StatusItem>
      </ShellStatus>
    </>
  );
}
