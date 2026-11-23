import { invoke } from '@tauri-apps/api/core';
import { createJournalStore, type Journal, type JournalHost } from '@lambda-house/journal';
import { isTauri, openExternal } from './utils/tauri';
import { documentWindowPath } from './utils/documentWindow';

// MDViewer's journal (@lambda-house/journal): its store, kept in localStorage
// under `mdviewer-journal` (the layout, each list's filters, each pane's
// session), and its host, the backend's session index (sessions.rs,
// session_memory.rs, session_commands.rs, session_analysis_commands.rs).
// MDViewer has every optional part: remote context, Codex control, agent access.

export const JOURNAL_STORAGE = 'mdviewer-journal';

export const journalHost: JournalHost = {
  appName: 'MDViewer',
  get available() { return isTauri(); },

  access: () => invoke<boolean>('session_access'),
  enable: () => invoke<boolean>('enable_sessions'),
  disable: () => invoke<void>('disable_sessions'),
  snapshot: () => invoke('sessions_snapshot'),
  detail: (provider, id) => invoke('session_details', { provider, id }),
  events: (provider, id, before) => invoke('session_events', { provider, id, before }),

  memoryAccess: () => invoke<boolean>('session_memory_access'),
  enableMemories: () => invoke<boolean>('enable_session_memories'),
  memories: (session) => invoke('session_memories', { provider: session?.provider, id: session?.id }),
  readMemory: (key, session) => invoke('read_session_memory', { key, provider: session?.provider, id: session?.id, openInDocuments: false }),
  openMemoryWindow: (key, session) => invoke<void>('open_session_memory_window', { key, provider: session?.provider, id: session?.id }),

  analysis: {
    status: () => invoke('analysis_access'),
    enable: (grant) => invoke<boolean>('enable_analysis', { grant }),
    revoke: () => invoke<void>('revoke_analysis'),
    query: (name, args) => invoke('run_session_analysis', { name, arguments: args }),
  },

  connections: () => invoke('session_connections'),
  configure: (connections) => invoke<void>('configure_session_connections', { connections }),
  context: (provider, key) => invoke('session_context', { provider, key }),
  openExternal,
  control: (action, id, turnId, text) => invoke('session_control', { action, id, turnId, text }),
};

/** Not in tests that run without a DOM; a memory window has no journal and keeps nothing. */
const storage = typeof localStorage === 'undefined' || documentWindowPath ? null : localStorage;

export const journal: Journal = {
  store: createJournalStore({ storage, name: JOURNAL_STORAGE }),
  host: journalHost,
};
