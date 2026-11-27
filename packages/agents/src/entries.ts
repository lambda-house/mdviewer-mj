// The documents coding agents read and write, as the backend lists them
// (MDViewer's and Agent MCR's src-tauri/src/agent.rs), and the pure helpers
// the list uses.

/** What a document is to the agent that reads it. */
export type AgentKind = 'instructions' | 'rule' | 'memory' | 'plan' | 'skill' | 'agent' | 'command';

/** A Markdown file a coding agent reads or writes. */
export interface AgentEntry {
  path: string;
  kind: AgentKind;
  title: string;
  description: string | null;
  /** What it belongs to: an agent ("Claude Code"), a project folder or a plugin. */
  group: string;
  scope: 'user' | 'project' | 'plugin';
  /** Last change, ms since the epoch. */
  modified: number;
  /** Changed since the person last read it. */
  unread: boolean;
  /** Never read. */
  isNew: boolean;
  /** The session folder it belongs to, from a backend that knows sessions (Agent MCR); null for the agents' own files. */
  folder?: string | null;
}

/** One scan of the agents' documents. */
export interface AgentWorkspace {
  /** Whether the person allowed reading them. */
  enabled: boolean;
  entries: AgentEntry[];
  /** The session folders that were looked through, most recent first (a backend that knows sessions). */
  folders?: string[];
  /** Changes arrive as events; otherwise poll. */
  watching: boolean;
}

/** The copy of a document kept when it was last read ("what changed since you read it"). */
export interface ReadSnapshot {
  path: string;
  content: string;
  readAt: number;
}

/** The kinds in the order the list shows them, with their headings. */
export const AGENT_SECTIONS: { kind: AgentKind; label: string }[] = [
  { kind: 'instructions', label: 'Instructions' },
  { kind: 'rule', label: 'Rules' },
  { kind: 'memory', label: 'Memory' },
  { kind: 'plan', label: 'Plans' },
  { kind: 'skill', label: 'Skills' },
  { kind: 'agent', label: 'Agents' },
  { kind: 'command', label: 'Commands' },
];

/** Whether an entry matches the list's filter: its title, description, group or path. */
export function agentEntryMatches(entry: AgentEntry, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return entry.title.toLowerCase().includes(q)
    || (entry.description?.toLowerCase().includes(q) ?? false)
    || entry.group.toLowerCase().includes(q)
    || entry.path.toLowerCase().includes(q);
}

export interface AgentFolder { path: string; entries: AgentEntry[] }

/**
 * Agent documents by the session folder they belong to, in the order the
 * backend gave the folders (most recent session first). A memory about a
 * subfolder goes to the nearest session folder above it. `user` holds the
 * rest: the agents' own files and memories of folders no session works in.
 */
export function agentFolders(entries: AgentEntry[], folders: string[]): { folders: AgentFolder[]; user: AgentEntry[] } {
  const byPath = new Map<string, AgentEntry[]>(folders.map((f) => [f, []]));
  const user: AgentEntry[] = [];
  for (const entry of entries) {
    const home = entry.folder == null ? undefined : folders
      .filter((f) => entry.folder === f || entry.folder!.startsWith(`${f}/`))
      .sort((a, b) => b.length - a.length)[0];
    if (home) byPath.get(home)!.push(entry);
    else user.push(entry);
  }
  return { folders: folders.map((path) => ({ path, entries: byPath.get(path)! })).filter((f) => f.entries.length > 0), user };
}
