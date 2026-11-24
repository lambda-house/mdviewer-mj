import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { Bot, ChevronDown, ChevronRight, Folder, Search } from 'lucide-react';
import { cx, formatAge } from '@lambda-house/ui';
import { activeTabOf, focusedGroupOf, useReader, useReaderContext } from '@lambda-house/reader';
import { enableAgents, useAgents, type Agents } from './agents';
import { AGENT_SECTIONS, agentEntryMatches, agentFolders, type AgentEntry, type AgentKind } from './entries';

/** Kinds whose entries show their description (a skill is what it says it does). */
const DESCRIBED: AgentKind[] = ['rule', 'memory', 'skill', 'agent', 'command'];

/** Session folders shown open before the person chooses. */
const OPEN_FOLDERS = 4;

function AgentItem({ agents, entry, active, showGroup }: { agents: Agents; entry: AgentEntry; active: boolean; showGroup?: boolean }) {
  const reader = useReaderContext();

  // A click opens it for a look (the preview tab), a double-click in a tab of its own
  const open = useCallback(async (preview: boolean) => {
    try {
      const content = await reader.host.readFile(entry.path);
      const { reloadDocument, openDocument } = reader.store.getState();
      reloadDocument(entry.path, content);
      openDocument(entry.path, content, { preview });
      agents.host.opened?.(entry.path, preview);
    } catch (error) {
      console.error('Failed to open agent file:', error);
    }
  }, [agents, reader, entry.path]);

  const status = entry.isNew ? 'New' : entry.unread ? 'Changed' : null;

  return (
    <div
      className={cx('agent-item', active && 'selected', entry.unread && 'unread')}
      onClick={() => open(true)}
      onDoubleClick={() => open(false)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open(true);
        }
      }}
      role="treeitem"
      tabIndex={0}
      title={entry.path}
    >
      <div className="agent-item-row">
        <span className="agent-item-dot" aria-hidden="true" />
        <span className="agent-item-title">{entry.title}</span>
        {status && <span className="agent-item-status">{status}</span>}
        <span className="agent-item-age">{formatAge(entry.modified)}</span>
      </div>
      {showGroup && <div className="agent-item-group">{entry.group}</div>}
      {entry.description && DESCRIBED.includes(entry.kind) && (
        <div className="agent-item-description">{entry.description}</div>
      )}
    </div>
  );
}

export interface AgentListProps {
  agents: Agents;
  /** Which documents it lists; all by default (MDViewer's Files: the agents' own, as a project's are in its folder). */
  only?: (entry: AgentEntry) => boolean;
  /** What the list calls them: "agent documents" by default. */
  noun?: string;
  /** What reading them covers, in the introduction before it is on (each app reads other folders). */
  about: ReactNode;
  /** Each session folder's documents under it, the rest under "All folders" (Agent MCR); a folder's name as shown. */
  folders?: { label: (path: string) => ReactNode };
  /** The tree around the sections: by default a plain one in the panel the list is part of; a pane of its own scrolls and zooms it (AgentPane). */
  frame?: (sections: ReactNode) => ReactNode;
}

const plainTree = (sections: ReactNode) => <div className="agent-panel-content" role="tree">{sections}</div>;

/**
 * The agents' documents: what changed since you read them, then by kind
 * (instructions, rules, memory, plans, skills, agents, commands), grouped by
 * what they belong to, with a filter. Before reading them is on, what it
 * covers and the button that asks.
 */
export function AgentList({ agents, only, noun = 'agent documents', about, folders, frame = plainTree }: AgentListProps) {
  const reader = useReaderContext();
  const enabled = useAgents(agents, (s) => s.enabled);
  const all = useAgents(agents, (s) => s.entries);
  const sessionFolders = useAgents(agents, (s) => s.folders);
  const activePath = useReader((s) => activeTabOf(focusedGroupOf(s))?.path ?? null);
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({ plan: true, command: true });

  const entries = useMemo(() => (only ? all.filter(only) : all), [all, only]);
  const visible = useMemo(() => entries.filter((e) => agentEntryMatches(e, query)), [entries, query]);
  const changed = useMemo(() => visible.filter((e) => e.unread && !e.isNew), [visible]);
  const grouped = useMemo(() => (folders ? agentFolders(visible, sessionFolders) : { folders: [], user: visible }), [folders, visible, sessionFolders]);

  const enable = useCallback(async () => {
    try {
      await enableAgents(agents, reader);
    } catch (error) {
      console.error('Failed to turn on the agent workspace:', error);
    }
  }, [agents, reader]);

  const toggleSection = (key: string, open: boolean) => setCollapsed((c) => ({ ...c, [key]: open }));

  const item = (entry: AgentEntry, showGroup?: boolean) => (
    <AgentItem key={entry.path} agents={agents} entry={entry} active={entry.path === activePath} showGroup={showGroup} />
  );

  const renderSection = (key: string, label: string, items: AgentEntry[], flat = false) => {
    if (items.length === 0) return null;
    // A filter opens every section that has matches
    const isCollapsed = !query && collapsed[key];
    const groups = new Map<string, AgentEntry[]>();
    for (const entry of items) {
      const group = flat ? '' : entry.group;
      groups.set(group, [...(groups.get(group) ?? []), entry]);
    }
    const unread = items.filter((e) => e.unread).length;
    return (
      <section className="agent-section" key={key}>
        <button type="button" className="agent-section-header" aria-expanded={!isCollapsed} onClick={() => toggleSection(key, !isCollapsed)}>
          {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          <span className="agent-section-title">{label}</span>
          <span className="agent-section-count">
            {unread > 0 && !flat ? `${unread} new · ` : ''}{items.length}
          </span>
        </button>
        {!isCollapsed && [...groups.entries()].map(([group, groupItems]) => (
          <div className="agent-group" key={group || 'all'}>
            {group && <div className="agent-group-title" title={group}>{group}</div>}
            {groupItems.map((entry) => item(entry, flat))}
          </div>
        ))}
      </section>
    );
  };

  // A session folder: its documents by kind, under the kind's name
  const renderFolder = (path: string, items: AgentEntry[], index: number) => {
    const key = `folder:${path}`;
    const isCollapsed = !query && (collapsed[key] ?? index >= OPEN_FOLDERS);
    const unread = items.filter((e) => e.unread).length;
    return (
      <section className="agent-folder" key={key} aria-label={`Agent documents in ${path}`}>
        <button type="button" className="agent-folder-header" aria-expanded={!isCollapsed} onClick={() => toggleSection(key, !isCollapsed)}>
          <span className={cx('agent-folder-expand', !isCollapsed && 'expanded')}><ChevronRight size={14} /></span>
          <Folder size={14} className="agent-folder-icon" />
          <span className="agent-folder-path" title={path}>{folders!.label(path)}</span>
          <span className="agent-section-count">{unread > 0 ? `${unread} new · ` : ''}{items.length}</span>
        </button>
        {!isCollapsed && AGENT_SECTIONS.map(({ kind, label }) => {
          const ofKind = items.filter((e) => e.kind === kind);
          return ofKind.length === 0 ? null : (
            <div className="agent-group" key={kind}>
              <div className="agent-group-title">{label}</div>
              {ofKind.map((entry) => item(entry))}
            </div>
          );
        })}
      </section>
    );
  };

  if (enabled === null) return <p className="agent-panel-empty">Loading {noun}…</p>;
  if (enabled === false) {
    return (
      <div className="agent-panel-intro">
        <Bot size={32} aria-hidden="true" />
        <p>
          See what your coding agents read and write: <code>CLAUDE.md</code> and <code>AGENTS.md</code>,
          rules, memory, plans, skills and commands, with what changed since you last looked.
        </p>
        <p className="agent-panel-intro-detail">
          {about} Settings, keys and transcripts are never read.
        </p>
        <button type="button" className="agent-panel-enable" onClick={enable}>
          Show {noun}
        </button>
      </div>
    );
  }
  return (
    <>
      <div className="agent-panel-filter">
        <Search size={13} className="agent-panel-filter-icon" aria-hidden="true" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter memory, plans, skills…"
          aria-label={`Filter ${noun}`}
        />
      </div>
      {frame(<>
        {renderSection('changed', 'Changed since you read them', changed, true)}
        {grouped.folders.map((f, index) => renderFolder(f.path, f.entries, index))}
        {folders && grouped.user.length > 0 && <div className="agent-user-title">All folders</div>}
        {AGENT_SECTIONS.map(({ kind, label }) => renderSection(kind, label, grouped.user.filter((e) => e.kind === kind)))}
        {visible.length === 0 && (
          <p className="agent-panel-empty">
            {entries.length === 0 ? `No ${noun} found yet.` : 'Nothing matches the filter.'}
          </p>
        )}
      </>)}
    </>
  );
}
