import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { Reader, ReaderHost } from '@lambda-house/reader';
import type { AgentEntry, AgentWorkspace, ReadSnapshot } from './entries';

/**
 * What the agent documents need from the app (shared UI spec §6.3). The app
 * answers with its backend, which decides what may be read: the person turns
 * reading them on in a native dialog, and the backend lists only the agents'
 * fixed places and the folders it adds (MDViewer's opened folders, Agent
 * MCR's session folders).
 */
export interface AgentHost {
  /** Whether there is a backend to ask: not in a plain browser, not in a reader window. */
  available: boolean;
  /** Scan the agents' documents (and watch them, where the backend can). */
  workspace(): Promise<AgentWorkspace>;
  /** Changes to them as they happen, in bursts, one per file event. Returns how to stop listening. */
  onChange(handler: () => void): Promise<() => void>;
  /** Ask the person, then turn reading them on; whether it is on now. */
  enable(): Promise<boolean>;
  disable(): Promise<void>;
  /** Keep a copy of each as read now (for "what changed since you read it"). */
  markRead(paths: string[]): Promise<void>;
  /** The copy kept when a document was last read; null when it never was. */
  readSnapshot(path: string): Promise<ReadSnapshot | null>;
  /** A document opened from the list (MDViewer logs one opened for a look in its history). */
  opened?(path: string, preview: boolean): void;
}

export interface AgentsState {
  /** Whether reading the agents' documents is on; null until the backend has answered. */
  enabled: boolean | null;
  entries: AgentEntry[];
  /** The session folders the last scan looked through, most recent first. */
  folders: string[];
  /** Whether the backend reports changes as they happen (else they are polled). */
  watching: boolean;
}

export type AgentsStore = StoreApi<AgentsState>;

/** The agent documents of an app: what was scanned last, and the backend. */
export interface Agents {
  store: AgentsStore;
  host: AgentHost;
}

/** The store is not saved: the backend is asked again on every start. */
export function createAgents(host: AgentHost): Agents {
  return {
    host,
    store: createStore<AgentsState>()(() => ({ enabled: null, entries: [], folders: [], watching: false })),
  };
}

/** The agents' state a component reads, re-rendering when the selected part changes. */
export function useAgents<T>(agents: Agents, selector: (state: AgentsState) => T): T {
  return useStore(agents.store, selector);
}

const inflight = new WeakMap<AgentsStore, Promise<boolean>>();

/**
 * Scan the agents' documents again, unless a scan is on its way. Open
 * documents that changed on disk (and have no unsaved edits) are reloaded,
 * so a memory an agent just wrote shows its new text. Resolves to whether
 * reading them is on.
 */
export function refreshAgents(agents: Agents, reader: Reader): Promise<boolean> {
  const { store, host } = agents;
  const running = inflight.get(store);
  if (running) return running;
  const scan = (async () => {
    const before = new Map(store.getState().entries.map((e) => [e.path, e.modified]));
    const workspace = await host.workspace();
    store.setState({ enabled: workspace.enabled, entries: workspace.entries, folders: workspace.folders ?? [], watching: workspace.watching });
    const { documents, reloadDocument } = reader.store.getState();
    const changedOpen = workspace.entries.filter((e) => documents[e.path] && before.has(e.path) && before.get(e.path) !== e.modified);
    await Promise.all(changedOpen.map(async (entry) => {
      try {
        reloadDocument(entry.path, await reader.host.readFile(entry.path));
      } catch (error) {
        console.error('Failed to reload agent file:', error);
      }
    }));
    return workspace.enabled;
  })().finally(() => inflight.delete(store));
  inflight.set(store, scan);
  return scan;
}

/** Ask the person, and scan once reading is on. */
export async function enableAgents(agents: Agents, reader: Reader): Promise<void> {
  if (await agents.host.enable()) await refreshAgents(agents, reader);
}

/** Stop reading the agents' documents: nothing scanned is kept. */
export async function disableAgents({ store, host }: Agents): Promise<void> {
  await host.disable();
  store.setState({ enabled: false, entries: [], folders: [] });
}

/** Mark documents as read now, and clear their "changed" marks right away. */
export async function markAgentsRead({ store, host }: Agents, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  await host.markRead(paths);
  const done = new Set(paths);
  store.setState((s) => ({ entries: s.entries.map((e) => (done.has(e.path) ? { ...e, unread: false, isNew: false } : e)) }));
}

/**
 * "Changed since you read it" for the reader (its host's `changes`): the
 * agents' documents are the ones whose reads are kept.
 */
export function agentChanges(agents: Agents): NonNullable<ReaderHost['changes']> {
  return {
    useIsTracked: (path) => useStore(agents.store, (s) => s.entries.some((e) => e.path === path)),
    readSnapshot: (path) => agents.host.readSnapshot(path),
    markRead: (paths) => markAgentsRead(agents, paths),
  };
}
