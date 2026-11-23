// What the journal knows of a recorded session (Codex, Claude Code), and the
// pure helpers over it: accounting, hierarchy, locations, filters, names.
// The app's backend indexes the transcripts; these types are its answers.

export interface Usage { input: number; cached: number; cacheWrite: number; output: number; reasoning: number }

/** What a session's context holds; `toolBytes` is the size of tool output, not tokens. */
export interface ContextStats {
  now: number; first: number; peak: number; window: number; compactions: number; toolBytes: Record<string, number>; skills: Record<string, number>;
  /** Lifetime in seconds of the prompt cache last written (Claude: 300 or 3600); 0 or missing when unrecorded */
  cacheTtl?: number;
  /** When the cache was last refreshed (ms): the latest response of the main conversation */
  cacheAt?: number;
  /** Requests sent after the cache had expired, and their input not served from it */
  coldWakeups?: number; coldTokens?: number;
}

export interface SessionEvent { seq: number; at: string; kind: string; text: string; tool: string | null }

export interface Session {
  id: string; provider: 'codex' | 'claude'; parentId: string | null; forkedFrom?: string | null; origin?: 'human' | 'subagent' | 'automation' | 'unknown'; directories?: string[]; name: string; cwd: string;
  title: string; model: string; effort: string; started: string; updated: string; modified: number;
  status: string; usage: Usage; usageKnown: boolean; models: Record<string, Usage>;
  tools: Record<string, number>; tickets: string[]; memoryRefs: string[]; events: SessionEvent[];
  eventCount: number; malformedLines: number; source: string; turnId: string;
  context?: ContextStats;
}

export interface Snapshot { sessions: Session[]; errors: string[]; scannedFiles: number; pendingFiles: number; indexedAt: number; cachePath?: string | null; restoredFiles?: number; bytesRead?: number; currentDirectory?: string }

export const EMPTY_SNAPSHOT: Snapshot = { sessions: [], errors: [], scannedFiles: 0, pendingFiles: 0, indexedAt: 0 };

export interface MemoryItem { key: string; title: string; provider: string; scope: string; path: string; modified: number; description: string }
export interface MemoryCatalog { entries: MemoryItem[]; notes: string[] }
export interface MemoryDocument { title: string; content: string; provenance: string; note: string }

/** Credentials for remote context (Jira, TEOB memory); they stay in the backend's process memory. */
export interface Connections { jiraSite: string; jiraEmail: string; jiraToken: string; memoryUrl: string; memoryToken: string }
export interface ConnectionStatus { jiraSite: string; jiraReady: boolean; memoryUrl: string; memoryReady: boolean }

// ============================================================
// Accounting
// ============================================================

export function sessionKey(s: Pick<Session, 'provider' | 'id'>): string { return `${s.provider}:${s.id}`; }

/** Cached and cache-write input are part of input, reasoning part of output: never added again. */
export function totalTokens(u: Usage): number { return u.input + u.output; }

export function sumUsage(sessions: Session[]): Usage {
  return sessions.reduce((sum, s) => ({ input: sum.input + s.usage.input, cached: sum.cached + s.usage.cached,
    cacheWrite: sum.cacheWrite + s.usage.cacheWrite, output: sum.output + s.usage.output, reasoning: sum.reasoning + s.usage.reasoning }),
  { input: 0, cached: 0, cacheWrite: 0, output: 0, reasoning: 0 });
}

export const compact = (n: number): string => Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n);

/**
 * The context limit a session's size is measured against. Codex records it.
 * Claude Code does not: its size is taken as 200K, or 1M once the session has
 * held more than 200K (only the long-context window can), and marked `assumed`.
 */
export function contextWindow(s: Pick<Session, 'provider' | 'context'>): { size: number; assumed: boolean } | null {
  const c = s.context;
  if (!c) return null;
  if (c.window > 0) return { size: c.window, assumed: false };
  if (s.provider !== 'claude' || c.now <= 0) return null;
  return { size: Math.max(c.peak, c.now) > 200_000 ? 1_000_000 : 200_000, assumed: true };
}

/** A warm cache with less than this share of its lifetime left is cooling. */
export const COOLING_SHARE = 0.2;
/**
 * Codex records no cache lifetime and its provider promises none. In local
 * transcripts about nine in ten requests sent within an hour of the one
 * before were still served from the cache, so that long it is taken for warm.
 */
export const CODEX_CACHE_S = 3600;
export interface CacheState {
  warm: boolean; cooling: boolean; ttl: number; until: number;
  /** The lifetime is not recorded (Codex): warm is likely, and past it the state is unknown, not cold */
  assumed: boolean;
}
/**
 * Whether the session's prompt cache is still alive: a message to a warm
 * session reads its context at the cached price, one to a cold session pays
 * for all of it again. Null when the transcript has no response to go by.
 */
export function cacheState(s: Pick<Session, 'context'> & { provider?: string }, now: number): CacheState | null {
  const c = s.context;
  if (!c?.cacheAt) return null;
  const assumed = !c.cacheTtl;
  if (assumed && s.provider !== 'codex') return null;
  const ttl = c.cacheTtl || CODEX_CACHE_S;
  const until = c.cacheAt + ttl * 1000;
  return { warm: now < until, cooling: now < until && until - now < COOLING_SHARE * ttl * 1000, ttl, until, assumed };
}

// ============================================================
// Hierarchy
// ============================================================

/** A session and its descendants (subagents of subagents), whatever the order; cycles end. */
export function family(sessions: Session[], selected: Session): Session[] {
  const ids = new Set([selected.id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const s of sessions) if (s.provider === selected.provider && s.parentId && ids.has(s.parentId) && !ids.has(s.id)) { ids.add(s.id); changed = true; }
  }
  return sessions.filter(s => s.provider === selected.provider && ids.has(s.id));
}

/** Who started it: a person, a parent agent, an automation. Human forks are not child agents. */
export function origin(s: Session): string { return s.origin || (s.parentId ? 'subagent' : 'unknown'); }

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

// ============================================================
// Locations
// ============================================================

/** Whether `path` is `directory` or inside it, on path boundaries; Windows paths compare without case. */
export function within(path: string, directory: string): boolean {
  if (/^(?:[A-Za-z]:[\\/]|[\\/]{2})/.test(directory)) {
    path = path.replace(/\\/g, '/').toLowerCase();
    directory = directory.replace(/\\/g, '/').toLowerCase();
  }
  const root = directory.replace(/[\\/]+$/, '');
  return !root || path === root || (path.startsWith(root) && /^[\\/]/.test(path.slice(root.length)));
}

/** Every directory the session worked in: its current one and earlier ones (worktrees), once each. */
export function sessionDirectories(s: Session): string[] { return [...new Set([s.cwd, ...(s.directories || [])].filter(Boolean))]; }

export interface DirectoryNode { path: string; name: string; sessions: Set<string>; children: Map<string, DirectoryNode> }

/** Every recorded location as a tree; a directory counts the sessions in it and below it. */
export function directoryTree(sessions: Session[]): DirectoryNode {
  const root: DirectoryNode = { path: '/', name: 'All recorded locations', sessions: new Set(), children: new Map() };
  for (const s of sessions) for (const path of sessionDirectories(s)) {
    let node=root; node.sessions.add(sessionKey(s));
    for (const match of path.matchAll(/[^\\/]+/g)) {
      const part = match[0];
      let child=node.children.get(part);
      const end = match.index + part.length;
      const prefix = /^[A-Za-z]:$/.test(part) && end === 2 ? path.slice(0, end + 1) : path.slice(0, end);
      if (!child) {child={path:prefix,name:part,sessions:new Set(),children:new Map()};node.children.set(part,child);}
      child.sessions.add(sessionKey(s));node=child;
    }
  }
  return root;
}

/** The last part of a path, either separator. */
export function basename(path: string): string {
  return path.split(/[\\/]+/).filter(Boolean).pop() || path;
}

/** A path under the home directory as `~/…` (macOS, Linux, Windows). */
export function homePath(path: string): string {
  return path.replace(/^\/(?:Users|home)\/[^/]+/, '~')
    .replace(/^[A-Za-z]:[\\/]Users[\\/][^\\/]+/i, '~');
}

/** A long path cut to its last two parts, for a narrow line. */
export function shortPath(path: string): string {
  const parts = path.split(/[\\/]/);
  const separator = path.includes('\\') ? '\\' : '/';
  return parts.length > 3 ? `…${separator}${parts.slice(-2).join(separator)}` : path;
}

// ============================================================
// Filters
// ============================================================

export function matchesSession(s: Session, query: string): boolean {
  return !query.trim() || [s.title,s.cwd,s.id,s.name,s.model,...s.tickets,...Object.keys(s.tools)].join(' ').toLowerCase().includes(query.toLowerCase().trim());
}

export interface ActivityWindow { activeSince?: number; inactiveSince?: number; activeMinutes?: number; inactiveMinutes?: number; now?: number }

/** Last recorded activity against the window; every bound is inclusive. */
export function matchesActivity(s: Session, filter: ActivityWindow): boolean {
  return (!filter.activeSince || s.modified >= filter.activeSince)
    && (!filter.inactiveSince || s.modified <= filter.inactiveSince)
    && (!filter.activeMinutes || (filter.now ?? Date.now()) - s.modified <= filter.activeMinutes * 60_000)
    && (!filter.inactiveMinutes || (filter.now ?? Date.now()) - s.modified >= filter.inactiveMinutes * 60_000);
}

/** What a list shows: its search and filters, as the fields hold them. */
export interface SessionFilters {
  query: string;
  /** 'all', 'codex', 'claude' */
  provider: string;
  /** 'all' or an origin */
  role: string;
  /** 'all', 'working', 'recent', 'roots', or a status */
  activity: string;
  /** Sessions that worked in this directory or below it; '' for all */
  directory: string;
  /** datetime-local values, '' for none */
  activeSince: string;
  inactiveSince: string;
  /** minutes, '' for none */
  activeMinutes: string;
  inactiveMinutes: string;
}

export const NO_FILTERS: SessionFilters = {
  query: '', provider: 'all', role: 'all', activity: 'all', directory: '',
  activeSince: '', inactiveSince: '', activeMinutes: '', inactiveMinutes: '',
};

/** How many filters (besides the search and the folder) narrow the list. */
export function filtersOn(f: SessionFilters): number {
  return [f.provider !== 'all', f.role !== 'all', f.activity !== 'all', !!(f.activeSince || f.inactiveSince || f.activeMinutes || f.inactiveMinutes)].filter(Boolean).length;
}

export function filterSessions(sessions: Session[], f: SessionFilters, now = Date.now()): Session[] {
  const window: ActivityWindow = {
    activeSince: Date.parse(f.activeSince), inactiveSince: Date.parse(f.inactiveSince),
    activeMinutes: Number(f.activeMinutes), inactiveMinutes: Number(f.inactiveMinutes), now,
  };
  return sessions.filter(s =>
    (f.provider === 'all' || s.provider === f.provider)
    && (f.role === 'all' || origin(s) === f.role)
    && (!f.directory || sessionDirectories(s).some(path => within(path, f.directory)))
    && matchesActivity(s, window)
    && (f.activity === 'all' || (f.activity === 'recent' ? now - s.modified < 86_400_000 : f.activity === 'roots' ? !s.parentId : s.status === f.activity))
    && matchesSession(s, f.query));
}

// ============================================================
// Names and commands
// ============================================================

const SYSTEM_TITLE_RE =
  /^(?:#\s*AGENTS\.md\s+instructions|<(?:INSTRUCTIONS|environment_context|user_instructions|system)>|<!--)/i;

/** A root session's name for a person: its title without injected instructions, else its first request, ticket or project. */
export function formatSessionTitle(s: Session): string {
  const raw = (s.title || '').trim();
  const afterTag = raw
    .replace(/^[\s\S]*?<\/(?:INSTRUCTIONS|environment_context|user_instructions)>\s*/i, '')
    .trim();
  const candidate = SYSTEM_TITLE_RE.test(raw) ? afterTag : raw;

  if (candidate && !SYSTEM_TITLE_RE.test(candidate)) {
    return candidate.replace(/\s+/g, ' ');
  }

  const userEvent = s.events?.find(
    (e) => e.kind === 'user' && e.text.trim() && !SYSTEM_TITLE_RE.test(e.text.trim()),
  );
  if (userEvent) {
    return userEvent.text.trim().replace(/\s+/g, ' ');
  }

  const project = s.cwd ? basename(s.cwd) : '';
  const ticket = s.tickets?.[0];
  const meaningfulName =
    s.name && s.name !== 'root' && !/^[0-9a-f-]{8,}$/i.test(s.name) ? s.name : '';

  if (ticket && project) return `${ticket} · ${project}`;
  if (meaningfulName && project) return `${project} · ${meaningfulName}`;
  if (project) return `${project} session`;
  return s.name || s.id;
}

/** The name a list row shows: a root session's cleaned title, a subagent's own. */
export function sessionTitle(s: Session): string {
  return s.parentId ? s.title || s.name || s.id : formatSessionTitle(s);
}

/** What a row no longer says itself, for its tooltip. */
export function sessionTooltip(node: SessionNode, title = sessionTitle(node.session)): string {
  const s = node.session;
  return [
    title, s.cwd, s.model || 'Model unreported',
    `${origin(s) === 'human' ? 'Human session' : origin(s)} · ${s.usageKnown ? `${compact(totalTokens(s.usage))} tokens` : 'usage unknown'}`,
    s.status === 'working' || s.status === 'interrupted' ? `${s.status} (inferred from the transcript)` : '',
    node.contextOnly ? 'Parent shown for context · excluded from totals' : '',
    node.missingParent ? `Parent not indexed: ${s.parentId}` : '',
  ].filter(Boolean).join('\n');
}

export const shellQuote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

/** The command that resumes a session in a terminal; a Claude subagent resumes its parent. */
export function resumeCommand(s: Session): string {
  return `cd ${shellQuote(s.cwd)} && ${s.provider === 'codex' ? 'codex resume' : 'claude --resume'} ${shellQuote(s.parentId && s.provider === 'claude' ? s.parentId : s.id)}`;
}
