import { createContext, useContext, type ReactNode } from 'react';
import { useStore } from 'zustand';
import type { ReaderState, ReaderStore } from './store';

/**
 * What the reader needs from the app (shared UI spec §6.1). The app answers
 * with its backend; the security rules stay there: the reader asks, the
 * backend decides (the access list, the confirmation for a link outside what
 * was opened, serving only images).
 */
export interface ReaderHost {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  /** The save dialog; writes `content` where the person chooses (or nowhere). */
  saveAs(defaultName: string, content: string, filters: { name: string; extensions: string[] }[], title: string): Promise<void>;
  /** Open a document in a tab, as the app does it (it reads the file, keeps its history). */
  openPath(path: string, options?: { preview?: boolean }): Promise<void>;
  /** May a linked local file open? The backend asks the person when it is outside what they opened. */
  followLocalLink(path: string): Promise<'open' | 'revealed' | 'cancelled'>;
  openExternal(url: string): Promise<void>;
  /** Show the file in the system's file manager; without it the tab menu has no such item. */
  revealInFolder?(path: string): Promise<void>;
  /** "Changed since you read it", for documents whose reads the app tracks (agent documents). */
  changes?: {
    /** A hook: whether reads of `path` are tracked; re-renders when that changes. */
    useIsTracked(path: string): boolean;
    readSnapshot(path: string): Promise<{ content: string; readAt: number } | null>;
    markRead(paths: string[]): Promise<void>;
  };
}

/** A reader: its store and its host. Each app makes one and passes it to ReaderProvider. */
export interface Reader {
  store: ReaderStore;
  host: ReaderHost;
}

const ReaderContext = createContext<Reader | null>(null);

export function ReaderProvider({ reader, children }: { reader: Reader; children: ReactNode }) {
  return <ReaderContext.Provider value={reader}>{children}</ReaderContext.Provider>;
}

export function useReaderContext(): Reader {
  const reader = useContext(ReaderContext);
  if (!reader) throw new Error('A reader component needs a ReaderProvider above it');
  return reader;
}

/** The reader state a component reads, re-rendering when the selected part changes. */
export function useReader<T>(selector: (state: ReaderState) => T): T {
  return useStore(useReaderContext().store, selector);
}
