import { createContext, useContext, useMemo, type ComponentType, type MouseEvent, type ReactNode } from 'react';
import { useStore } from 'zustand';
import type { JournalState, JournalStore } from './store';
import type {
  ConnectionStatus, Connections, JournalUpdate, MemoryCatalog, MemoryDocument, Session, SessionEvent, SessionNode, Snapshot,
} from './sessions';

/** What local agents may read through the app's MCP socket. */
export interface AnalysisGrant { enabled: boolean; directory: string; session: string; excerpts: boolean }

export interface AnalysisStatus {
  grant: AnalysisGrant;
  socket: string | null;
  executable: string;
  error: string | null;
  clients: string[];
  recentQueries: { at: string; client: string; tool: string; ok: boolean; elapsedMs: number; cohort?: unknown; session?: string }[];
}

/**
 * What the journal needs from the app (shared UI spec §6.2): its backend's
 * session index. The rules stay in the backend: transcripts are read only
 * after access is granted, memories need their own grant, credentials stay in
 * its process memory. A method only one app has is optional, and the journal
 * shows nothing for it when it is missing.
 */
export interface JournalHost {
  /** The app's name, in what the journal says ("close MDViewer"). */
  appName: string;
  /** Whether there is a backend to index sessions (not in a plain browser). */
  available: boolean;

  access(): Promise<boolean>;
  enable(): Promise<boolean>;
  /** Revoke session access: the backend forgets its index. */
  disable(): Promise<void>;
  snapshot(): Promise<Snapshot>;
  /**
   * The same scan for a holder of a snapshot: `snapshot` is null when what it
   * shows has the `stamp` held (empty: none held yet). The whole snapshot is
   * megabytes; without this the journal asks for it whole each time.
   */
  snapshotSince?(stamp: string): Promise<{ stamp: string; snapshot: Snapshot | null }>;
  /**
   * Better still: only what changed since the `stamp` held, as a delta
   * (`applyJournalUpdate`), or the whole snapshot when the backend no longer
   * knows that stamp. Preferred over `snapshotSince` when the host has it.
   */
  journalSince?(stamp: string): Promise<JournalUpdate>;
  /** A session with its latest events. */
  detail(provider: string, id: string): Promise<Session>;
  /** The page of events before `before` (a sequence number). */
  events(provider: string, id: string, before: number): Promise<SessionEvent[]>;

  memoryAccess(): Promise<boolean>;
  enableMemories(): Promise<boolean>;
  memories(session?: Session): Promise<MemoryCatalog>;
  readMemory(key: string, session?: Session): Promise<MemoryDocument>;
  /** Open a Markdown memory in a reader window; the backend checks it against its catalog first. */
  openMemoryWindow(key: string, session?: Session): Promise<void>;

  /** Agent access: local agents query the index through MCP. */
  analysis?: {
    status(): Promise<AnalysisStatus>;
    enable(grant: AnalysisGrant): Promise<boolean>;
    revoke(): Promise<void>;
    query(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>>;
  };

  /** Remote context (Jira, TEOB memory): with these, Linked Work loads tickets and runs, and the tools have Connections. */
  connections?(): Promise<ConnectionStatus>;
  configure?(connections: Connections): Promise<void>;
  context?(provider: 'jira' | 'memory', key: string): Promise<unknown>;
  /** Open a web page (a ticket) in the browser. */
  openExternal?(url: string): Promise<void>;
  /** Direct a running Codex session through its existing daemon: inspect, steer, interrupt. */
  control?(action: 'inspect' | 'steer' | 'interrupt', id: string, turnId?: string, text?: string): Promise<unknown>;
  /** Continue a session in a terminal the app hosts (Agent MCR's Live). */
  resume?(session: Session): Promise<void>;
}

/** What a session row in a list gets; the app may draw its own (Agent MCR draws a running session as its Live row). */
export interface SessionRowProps {
  session: Session;
  node: SessionNode;
  /** The name to show: a root session's cleaned title. */
  title: string;
  /** What the row leaves out. */
  tooltip: string;
  selected: boolean;
  /** Show it (Mod+click: beside the shown one). */
  onOpen: (event: MouseEvent) => void;
  /** The row's menu (Open, Open to the side). */
  onMenu: (event: MouseEvent) => void;
}

/** A journal: its store and its host. Each app makes one and passes it to JournalProvider. */
export interface Journal {
  store: JournalStore;
  host: JournalHost;
}

interface Context extends Journal {
  Row?: ComponentType<SessionRowProps>;
}

const JournalContext = createContext<Context | null>(null);

/** `row` draws the session rows; the journal's own row by default. */
export function JournalProvider({ journal, row, children }: { journal: Journal; row?: ComponentType<SessionRowProps>; children: ReactNode }) {
  const value = useMemo(() => ({ ...journal, Row: row }), [journal, row]);
  return <JournalContext.Provider value={value}>{children}</JournalContext.Provider>;
}

export function useJournalContext(): Context {
  const journal = useContext(JournalContext);
  if (!journal) throw new Error('A journal component needs a JournalProvider above it');
  return journal;
}

/** The journal state a component reads, re-rendering when the selected part changes. */
export function useJournal<T>(selector: (state: JournalState) => T): T {
  return useStore(useJournalContext().store, selector);
}

export const errorText = (e: unknown): string => e instanceof Error ? e.message : String(e);
