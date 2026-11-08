import { invoke } from '@tauri-apps/api/core';
export interface Usage { input: number; cached: number; cacheWrite: number; output: number; reasoning: number }
export interface SessionEvent { seq: number; at: string; kind: string; text: string; tool: string | null }
export interface Session {
  id: string; provider: 'codex' | 'claude'; parentId: string | null; forkedFrom?: string | null; origin?: 'human' | 'subagent' | 'automation' | 'unknown'; directories?: string[]; name: string; cwd: string;
  title: string; model: string; effort: string; started: string; updated: string; modified: number;
  status: string; usage: Usage; usageKnown: boolean; models: Record<string, Usage>;
  tools: Record<string, number>; tickets: string[]; memoryRefs: string[]; events: SessionEvent[];
  eventCount: number; malformedLines: number; source: string; turnId: string;
}
export interface Snapshot { sessions: Session[]; errors: string[]; scannedFiles: number; pendingFiles: number; indexedAt: number; cachePath?: string | null; restoredFiles?: number; bytesRead?: number; currentDirectory?: string }
export interface Connections { jiraSite: string; jiraEmail: string; jiraToken: string; memoryUrl: string; memoryToken: string }
export interface ConnectionStatus { jiraSite: string; jiraReady: boolean; memoryUrl: string; memoryReady: boolean }
export interface MemoryItem { key: string; title: string; provider: string; scope: string; path: string; modified: number; description: string }
export interface MemoryCatalog { entries: MemoryItem[]; notes: string[] }
export interface MemoryDocument { title: string; content: string; provenance: string; note: string }
export const sessionApi = {
  memoryAccess: () => invoke<boolean>('session_memory_access'),
  enableMemories: () => invoke<boolean>('enable_session_memories'),
  memories: (session?: Session) => invoke<MemoryCatalog>('session_memories', { provider: session?.provider, id: session?.id }),
  readMemory: (key: string, session?: Session, openInDocuments = false) => invoke<MemoryDocument>('read_session_memory', { key, provider: session?.provider, id: session?.id, openInDocuments }),
  openMemoryWindow: (key: string, session?: Session) => invoke<void>('open_session_memory_window', { key, provider: session?.provider, id: session?.id }),
  access: () => invoke<boolean>('session_access'),
  enable: () => invoke<boolean>('enable_sessions'),
  disable: () => invoke<void>('disable_sessions'),
  events: (provider: string, id: string, before: number) => invoke<SessionEvent[]>('session_events', { provider, id, before }),
  detail: (provider: string, id: string) => invoke<Session>('session_details', { provider, id }),
  snapshot: () => invoke<Snapshot>('sessions_snapshot'),
  connections: () => invoke<ConnectionStatus>('session_connections'),
  configure: (connections: Connections) => invoke<void>('configure_session_connections', { connections }),
  context: (provider: string, key: string) => invoke<unknown>('session_context', { provider, key }),
  control: (action: string, id: string, turnId?: string, text?: string) => invoke<unknown>('session_control', { action, id, turnId, text }),
};
export function sessionKey(s: Session): string { return `${s.provider}:${s.id}`; }
export function totalTokens(u: Usage): number { return u.input + u.output; }
export function sumUsage(sessions: Session[]): Usage {
  return sessions.reduce((sum, s) => ({ input: sum.input + s.usage.input, cached: sum.cached + s.usage.cached,
    cacheWrite: sum.cacheWrite + s.usage.cacheWrite, output: sum.output + s.usage.output, reasoning: sum.reasoning + s.usage.reasoning }),
  { input: 0, cached: 0, cacheWrite: 0, output: 0, reasoning: 0 });
}
export function matchesSession(s: Session, query: string): boolean {
  return !query.trim() || [s.title,s.cwd,s.id,s.name,s.model,...s.tickets,...Object.keys(s.tools)].join(' ').toLowerCase().includes(query.toLowerCase().trim());
}
export function family(sessions: Session[], selected: Session): Session[] {
  const ids = new Set([selected.id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const s of sessions) if (s.provider === selected.provider && s.parentId && ids.has(s.parentId) && !ids.has(s.id)) { ids.add(s.id); changed = true; }
  }
  return sessions.filter(s => s.provider === selected.provider && ids.has(s.id));
}
export const compact = (n: number): string => Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n);
export const shellQuote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;
export function resumeCommand(s: Session): string {
  return `cd ${shellQuote(s.cwd)} && ${s.provider === 'codex' ? 'codex resume' : 'claude --resume'} ${shellQuote(s.parentId && s.provider === 'claude' ? s.parentId : s.id)}`;
}

export function origin(s: Session): string { return s.origin || (s.parentId ? 'subagent' : 'unknown'); }
export function within(path: string, directory: string): boolean {
  const root = directory.replace(/\/+$/, '');
  return !root || path === root || path.startsWith(root + '/');
}
export function sessionDirectories(s: Session): string[] { return [...new Set([s.cwd, ...(s.directories || [])].filter(Boolean))]; }
export interface ActivityWindow { activeSince?: number; inactiveSince?: number; activeMinutes?: number; inactiveMinutes?: number; now?: number }
export function matchesActivity(s: Session, filter: ActivityWindow): boolean {
  return (!filter.activeSince || s.modified >= filter.activeSince)
    && (!filter.inactiveSince || s.modified <= filter.inactiveSince)
    && (!filter.activeMinutes || (filter.now ?? Date.now()) - s.modified <= filter.activeMinutes * 60_000)
    && (!filter.inactiveMinutes || (filter.now ?? Date.now()) - s.modified >= filter.inactiveMinutes * 60_000);
}
export interface SessionNode { session: Session; children: SessionNode[]; contextOnly: boolean; missingParent: boolean }
/** Keep ancestors of matches visible, but do not include them in filtered totals. Cycles cannot recurse indefinitely. */
export function sessionTree(all: Session[], matches: Session[]): SessionNode[] {
  const byKey = new Map(all.map(s => [sessionKey(s), s]));
  const matched = new Set(matches.map(sessionKey)); const included = new Set(matched);
  for (const s of matches) {
    let cursor: Session | undefined = s; const visited = new Set<string>();
    while (cursor?.parentId) {
      const key = `${cursor.provider}:${cursor.parentId}`;
      if (visited.has(key)) break; visited.add(key); cursor = byKey.get(key);
      if (cursor) included.add(key);
    }
  }
  const children = new Map<string, Session[]>(); const roots: Session[] = [];
  for (const key of included) {
    const s = byKey.get(key); if (!s) continue;
    const parent = s.parentId ? `${s.provider}:${s.parentId}` : '';
    if (parent && included.has(parent) && parent !== key) children.set(parent, [...(children.get(parent) || []), s]);
    else roots.push(s);
  }
  const visited = new Set<string>();
  const walk = (s: Session): SessionNode | null => {
    const key = sessionKey(s); if (visited.has(key)) return null; visited.add(key);
    return { session: s, contextOnly: !matched.has(key), missingParent: !!s.parentId && !byKey.has(`${s.provider}:${s.parentId}`),
      children: (children.get(key) || []).sort((a,b) => b.modified-a.modified).map(walk).filter((n): n is SessionNode => n !== null) };
  };
  const result = roots.sort((a,b) => b.modified-a.modified).map(walk).filter((n): n is SessionNode => n !== null);
  for (const key of included) if (!visited.has(key)) { const s=byKey.get(key); if (s) { const node=walk(s); if (node) result.push(node); } }
  return result;
}
export interface DirectoryNode { path: string; name: string; sessions: Set<string>; children: Map<string, DirectoryNode> }
export function directoryTree(sessions: Session[]): DirectoryNode {
  const root: DirectoryNode = { path: '/', name: 'All recorded locations', sessions: new Set(), children: new Map() };
  for (const s of sessions) for (const path of sessionDirectories(s)) {
    let node=root; node.sessions.add(sessionKey(s));
    for (const part of path.split('/').filter(Boolean)) {
      let child=node.children.get(part);
      if (!child) {child={path:(node.path === '/' ? '' : node.path)+'/'+part,name:part,sessions:new Set(),children:new Map()};node.children.set(part,child);}
      child.sessions.add(sessionKey(s));node=child;
    }
  }
  return root;
}
