import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, CheckCheck, ChevronDown, ChevronRight, EyeOff, RefreshCw, Search, X } from 'lucide-react';
import clsx from 'clsx';
import { useStore } from '../store';
import {
  appendToHistory,
  disableAgentWorkspace,
  enableAgentWorkspace,
  readFile,
  type AgentEntry,
  type AgentKind,
} from '../utils/tauri';
import {
  AGENT_SECTIONS,
  agentEntryMatches,
  formatAge,
  markAgentFilesRead,
  refreshAgentWorkspace,
} from '../utils/agent';
import { getFileName } from '../utils/files';

// ============================================================
// Agent Panel: instructions, rules, memory, plans and skills of coding agents
// ============================================================

/** Kinds whose entries show their description (a skill is what it says it does). */
const DESCRIBED: AgentKind[] = ['rule', 'memory', 'skill', 'agent', 'command'];

const AgentItem: React.FC<{ entry: AgentEntry; active: boolean; showGroup?: boolean }> = ({
  entry,
  active,
  showGroup,
}) => {
  const openDocument = useStore((s) => s.openDocument);
  const reloadDocument = useStore((s) => s.reloadDocument);

  // Single click opens the preview tab, double-click a permanent tab
  const open = useCallback(async (preview: boolean) => {
    try {
      const content = await readFile(entry.path);
      reloadDocument(entry.path, content);
      openDocument(entry.path, content, { preview });
      if (preview) {
        appendToHistory(entry.path, getFileName(entry.path)).catch((error) => {
          console.error('Failed to log to history:', error);
        });
      }
    } catch (error) {
      console.error('Failed to open agent file:', error);
    }
  }, [entry.path, openDocument, reloadDocument]);

  const status = entry.isNew ? 'New' : entry.unread ? 'Changed' : null;

  return (
    <div
      className={clsx('agent-item', active && 'selected', entry.unread && 'unread')}
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
};

const AgentPanel: React.FC = () => {
  const entries = useStore((s) => s.agentEntries);
  const setAgentEntries = useStore((s) => s.setAgentEntries);
  const setAgentVisible = useStore((s) => s.setAgentVisible);
  const activePath = useStore((s) => s.tabs.find((t) => t.id === s.activeTabId)?.path ?? null);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [rootCollapsed, setRootCollapsed] = useState(true);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({ plan: true, command: true });

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setEnabled(await refreshAgentWorkspace());
    } catch (error) {
      console.error('Failed to list agent files:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!rootCollapsed) refresh();
  }, [rootCollapsed, refresh]);

  const handleEnable = useCallback(async () => {
    try {
      if (await enableAgentWorkspace()) await refresh();
    } catch (error) {
      console.error('Failed to turn on the agent workspace:', error);
    }
  }, [refresh]);

  const handleDisable = useCallback(async () => {
    await disableAgentWorkspace();
    setAgentEntries([]);
    setEnabled(false);
  }, [setAgentEntries]);

  const globalEntries = useMemo(() => entries.filter((e) => e.scope !== 'project'), [entries]);
  const visible = useMemo(() => globalEntries.filter((e) => agentEntryMatches(e, query)), [globalEntries, query]);
  const changed = useMemo(() => visible.filter((e) => e.unread && !e.isNew), [visible]);

  const handleMarkAllRead = useCallback(() => {
    markAgentFilesRead(globalEntries.filter((e) => e.unread).map((e) => e.path)).catch((error) => {
      console.error('Failed to save read state:', error);
    });
  }, [globalEntries]);

  const toggleSection = (key: string) => setCollapsed((c) => ({ ...c, [key]: !c[key] }));

  const renderSection = (key: string, label: string, items: AgentEntry[], flat = false) => {
    if (items.length === 0) return null;
    // A filter opens every section that has matches
    const isCollapsed = !query && collapsed[key];
    const groups = new Map<string, AgentEntry[]>();
    for (const item of items) {
      const group = flat ? '' : item.group;
      groups.set(group, [...(groups.get(group) ?? []), item]);
    }
    const unread = items.filter((e) => e.unread).length;
    return (
      <section className="agent-section" key={key}>
        <button type="button" className="agent-section-header" onClick={() => toggleSection(key)}>
          {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          <span className="agent-section-title">{label}</span>
          <span className="agent-section-count">
            {unread > 0 && !flat ? `${unread} new · ` : ''}{items.length}
          </span>
        </button>
        {!isCollapsed && [...groups.entries()].map(([group, groupItems]) => (
          <div className="agent-group" key={group || 'all'}>
            {group && <div className="agent-group-title" title={group}>{group}</div>}
            {groupItems.map((entry) => (
              <AgentItem key={entry.path} entry={entry} active={entry.path === activePath} showGroup={flat} />
            ))}
          </div>
        ))}
      </section>
    );
  };

  return (
    <section className="directory-section global-agent-section" aria-label="Global agent files">
      <div className="directory-section-header">
        <button type="button" className="global-agent-root-toggle" aria-expanded={!rootCollapsed}
          onClick={() => setRootCollapsed((value) => !value)}>
          <span className={clsx('directory-section-expand', !rootCollapsed && 'expanded')}>
            <ChevronRight size={14} />
          </span>
          <Bot size={14} className="directory-section-icon" />
          <span className="global-agent-root-title">Global agent files</span>
          {globalEntries.some((e) => e.unread) && <span className="agent-section-count">Changed</span>}
        </button>
        {!rootCollapsed && enabled && (
          <div className="agent-panel-actions">
            <button
              className="agent-panel-action"
              onClick={handleMarkAllRead}
              title="Mark everything as read"
              disabled={!globalEntries.some((e) => e.unread)}
            >
              <CheckCheck size={14} />
            </button>
            <button
              className={clsx('agent-panel-action', loading && 'spinning')}
              onClick={refresh}
              title="Refresh"
              disabled={loading}
            >
              <RefreshCw size={14} />
            </button>
            <button className="agent-panel-action" onClick={handleDisable} title="Turn off global agent access">
              <EyeOff size={14} />
            </button>
          </div>
        )}
        <button type="button" className="directory-section-action" onClick={() => setAgentVisible(false)}
          title="Hide global agent files (show again with the toolbar button)" aria-label="Hide global agent files">
          <X size={14} />
        </button>
      </div>

      {!rootCollapsed && enabled === null && <p className="agent-panel-empty">Loading agent files…</p>}
      {!rootCollapsed && enabled === false && (
        <div className="agent-panel-intro">
          <Bot size={32} aria-hidden="true" />
          <p>
            See what your coding agents read and write: <code>CLAUDE.md</code> and <code>AGENTS.md</code>,
            rules, memory, plans, skills and commands from your agent folders, with what changed since you last looked.
          </p>
          <p className="agent-panel-intro-detail">
            Covers Claude Code, Codex and Gemini CLI. Use Files → Agents for agent files in folders you open.
            Settings, keys and transcripts are never read.
          </p>
          <button type="button" className="agent-panel-enable" onClick={handleEnable}>
            Show agent files
          </button>
        </div>
      )}

      {!rootCollapsed && enabled && (
        <>
          <div className="agent-panel-filter">
            <Search size={13} className="agent-panel-filter-icon" aria-hidden="true" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter skills, memory, plans…"
              aria-label="Filter agent files"
            />
          </div>
          <div className="agent-panel-content" role="tree">
            {renderSection('changed', 'Changed since you read them', changed, true)}
            {AGENT_SECTIONS.map(({ kind, label }) =>
              renderSection(kind, label, visible.filter((e) => e.kind === kind)))}
            {visible.length === 0 && (
              <p className="agent-panel-empty">
                {globalEntries.length === 0 ? 'No global agent files found yet.' : 'Nothing matches the filter.'}
              </p>
            )}
          </div>
        </>
      )}
    </section>
  );
};

export default AgentPanel;
