import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, ChevronRight, History, MessageSquareText, RefreshCw, Settings2, Shield, X } from 'lucide-react';
import { Button, formatAge } from '@lambda-house/ui';
import { LayoutView, ShellStatus, ShellTools, StatusItem, useSurfaceShown, type Command, type Layout, type PaneType, type PaneZoom } from '@lambda-house/workbench';
import { errorText, useJournal, useJournalContext, type Journal } from './host';
import { AgentAccess } from './AgentAccess';
import { ConnectionsDialog } from './ConnectionsDialog';
import { JournalDetail, Metric } from './JournalDetail';
import { JournalList } from './JournalList';
import { MemoryBrowser } from './MemoryBrowser';
import { compact, filterSessions, NO_FILTERS, origin, sessionKey, sumUsage, totalTokens } from './sessions';
import { DETAIL_PANE, detailPanes, LIST_PANE, listPanes } from './store';

/** How often the snapshot is asked for while the journal is shown (ms), unless the app says otherwise. */
export const REFRESH_INTERVAL = 5000;
/** While files are still being indexed, the next snapshot comes sooner (ms). */
const PENDING_INTERVAL = 150;

const inflight = new WeakSet<object>();

/**
 * Ask the backend for a new snapshot, unless one is on its way. The journal
 * does it every few seconds while shown; an app that reads the snapshot
 * elsewhere too (Agent MCR's Live and palette) can ask sooner. With the
 * host's `snapshotSince` only a snapshot that shows something new comes
 * across, and the one held stays, so nothing renders again.
 */
export async function refreshJournal({ store, host }: Journal): Promise<void> {
  if (inflight.has(store)) return;
  inflight.add(store);
  store.getState().setBusy(true);
  try {
    if (host.snapshotSince) {
      const answer = await host.snapshotSince(store.getState().stamp);
      if (answer.snapshot) store.getState().receive(answer.snapshot, answer.stamp);
      else store.getState().setError('');
    } else {
      store.getState().receive(await host.snapshot());
    }
  } catch (e) {
    store.getState().setError(errorText(e));
  } finally {
    inflight.delete(store);
    store.getState().setBusy(false);
  }
}

export interface JournalViewProps {
  /** Shown: only then is the index asked for and details loaded. By default, while its surface (or view) is. */
  active?: boolean;
  /** Tools in the top bar besides the summary: a refresh button, and dialogs for memories and agent access (an app without them in its settings). */
  tools?: { refresh?: boolean; memories?: boolean; agentAccess?: boolean };
  /** How often the snapshot is asked for while active (ms): REFRESH_INTERVAL by default; seldom where it only names sessions (Agent MCR's Live). */
  refreshInterval?: number;
}

/**
 * The journal (shared UI spec §6.2): a layout of `journal-list` and
 * `journal-detail` panes over one snapshot of the backend's index, which is
 * asked for every few seconds while shown. Before session access is granted
 * it asks for it and reads nothing. Its summary (and the tools) go into the
 * window's top bar.
 */
export function JournalView({ active: activeProp, tools = {}, refreshInterval = REFRESH_INTERVAL }: JournalViewProps) {
  const surfaceShown = useSurfaceShown();
  const active = activeProp ?? surfaceShown;
  const { store, host } = useJournalContext();
  const enabled = useJournal((s) => s.enabled);
  const snapshot = useJournal((s) => s.snapshot);
  const busy = useJournal((s) => s.busy);
  const error = useJournal((s) => s.error);
  const root = useJournal((s) => s.layout);
  const focused = useJournal((s) => s.focused);
  const listFilters = useJournal((s) => s.lists[s.lastList]) ?? NO_FILTERS;
  const shownKey = useJournal((s) => s.details[s.lastDetail]?.session ?? '');
  const [dialog, setDialog] = useState<'connections' | 'memories' | 'agentAccess' | null>(null);

  const refresh = useCallback(() => refreshJournal({ store, host }), [store, host]);

  useEffect(() => {
    let current = true;
    if (!host.available) store.getState().setEnabled(false);
    else host.access().then((value) => { if (current) store.getState().setEnabled(value); }).catch((e) => store.getState().setError(errorText(e)));
    return () => { current = false; };
  }, [store, host]);
  useEffect(() => {
    if (!enabled || !active) return;
    void refresh();
    const timer = setInterval(() => { if (!document.hidden) void refresh(); }, refreshInterval);
    return () => clearInterval(timer);
  }, [enabled, active, refresh, refreshInterval]);
  useEffect(() => {
    if (!enabled || !active || !snapshot.pendingFiles) return;
    const timer = setTimeout(() => { if (!document.hidden) void refresh(); }, PENDING_INTERVAL);
    return () => clearTimeout(timer);
  }, [enabled, active, snapshot.indexedAt, snapshot.pendingFiles, refresh]);

  const layout = useMemo<Layout>(() => ({ version: 1, root }), [root]);
  const paneTypes = useMemo<Record<string, PaneType>>(() => {
    // Each pane has its own zoom: Ctrl + wheel over it, the zoom commands while it has the focus
    const zoom: PaneZoom = {
      get: ({ pane }) => store.getState().zoom[pane.key] ?? 100,
      step: ({ pane }, direction) => store.getState().zoomPane(pane.key, direction),
      subscribe: store.subscribe,
    };
    return {
    // Split and close go through the store, which keeps a list and a detail pane
    [LIST_PANE]: {
      type: LIST_PANE, label: 'session list', title: 'Sessions', icon: <History size={14} />, collapsible: true, min: { w: 240 }, zoom,
      split: ({ pane }, dir) => { store.getState().splitPane(pane.key, dir); },
      closable: () => listPanes(store.getState()).length > 1,
      close: ({ pane }) => store.getState().closePane(pane.key),
      render: ({ pane }) => <JournalList pane={pane.key} />,
    },
    [DETAIL_PANE]: {
      type: DETAIL_PANE, label: 'session', title: 'Session', icon: <MessageSquareText size={14} />, min: { w: 320 }, zoom,
      split: ({ pane }, dir) => { store.getState().splitPane(pane.key, dir); },
      closable: () => detailPanes(store.getState()).length > 1,
      close: ({ pane }) => store.getState().closePane(pane.key),
      render: ({ pane }) => <JournalDetail pane={pane.key} active={active} />,
    },
    };
  }, [active, store]);
  const onChange = useCallback((next: Layout) => store.getState().setLayout(next.root), [store]);
  const onFocusLeaf = useCallback((id: string) => store.getState().focus(id), [store]);

  // The summary counts the list used last
  const filtered = useMemo(() => filterSessions(snapshot.sessions, listFilters), [snapshot.sessions, listFilters]);
  const usage = sumUsage(filtered);
  const working = filtered.filter((s) => s.status === 'working').length;
  const shown = snapshot.sessions.find((s) => sessionKey(s) === shownKey);

  const enable = async () => {
    try { store.getState().setEnabled(await host.enable()); } catch (e) { store.getState().setError(errorText(e)); }
  };
  const revoke = async () => {
    try { await host.disable(); store.getState().forget(); } catch (e) { store.getState().setError(errorText(e)); }
  };

  return (
    <section className="session-cockpit journal">
      {/* Its tools are in the window's top bar, outside the cockpit; .sc-bar gives them the cockpit's type */}
      <ShellTools side="end"><div className="sc-bar">
        {enabled && (tools.refresh || host.connections || tools.memories || (tools.agentAccess && host.analysis)) && <div className="sc-top-actions">
          {tools.refresh && <Button variant="ghost" size="sm" icon={<RefreshCw size={14} />} onClick={() => void refresh()} disabled={busy} aria-label="Refresh sessions" title={busy ? 'Indexing transcripts…' : `Refresh · updated ${formatAge(snapshot.indexedAt)}`} />}
          {host.connections && <Button variant="ghost" size="sm" icon={<Settings2 size={14} />} onClick={() => setDialog('connections')}>Connections</Button>}
          {tools.memories && <Button variant="ghost" size="sm" onClick={() => setDialog('memories')}>User memories</Button>}
          {tools.agentAccess && host.analysis && <Button variant="ghost" size="sm" onClick={() => setDialog('agentAccess')}>Agent access</Button>}
        </div>}
        {enabled && <details className="sc-summary">
          <summary><span className="sc-summary-working">{working} working</span><span> · {filtered.length.toLocaleString()} sessions</span><ChevronRight size={12} /></summary>
          <div className="sc-summary-popover">
            <Metric label="Observed working" value={String(working)} hint="Recent transcript activity; not process liveness" />
            <Metric label="Sessions & agents" value={filtered.length.toLocaleString()} hint={`${filtered.filter((s) => origin(s) === 'human').length} human · ${filtered.filter((s) => origin(s) === 'subagent').length} subagents`} />
            <Metric label="Recorded tokens" value={compact(totalTokens(usage))} hint={`${compact(usage.input)} input · ${compact(usage.output)} output · lifetime usage of matching sessions`} />
            <Metric label="Cached input" value={compact(usage.cached)} hint={`${usage.input ? Math.round(usage.cached / usage.input * 100) : 0}% of input · included in token total`} />
            {snapshot.pendingFiles > 0 && <p>History is still indexing; totals are partial.</p>}
          </div>
        </details>}
      </div></ShellTools>
      {error && <div className="sc-banner" role="alert">{error}</div>}
      {!enabled ? (
        <div className="sc-welcome">
          <div className="sc-logo"><Bot size={36} /></div>
          <p className="sc-eyebrow">YOUR AGENTIC LANDSCAPE</p>
          <h1>See the work.<br />Follow every agent.</h1>
          <p>Codex and Claude sessions, their agents, models, tokens, tools and linked work. One view across all recorded workspaces on this machine.</p>
          <Button variant="primary" disabled={!host.available || enabled === null} onClick={() => void enable()}><Shield size={16} />{host.available ? 'Enable session access' : 'Open the desktop app to connect local sessions'}</Button>
          <small>Local transcripts · no transcript edits{host.context ? ' · remote connections on demand' : ''}</small>
        </div>
      ) : <>
        <LayoutView
          className="journal-layout"
          layout={layout}
          onChange={onChange}
          paneTypes={paneTypes}
          focusedLeaf={focused}
          onFocusLeaf={onFocusLeaf}
          onReset={() => store.getState().resetLayout()}
        />
        {/* The index's state and access, in the window's status bar */}
        <ShellStatus>
          <StatusItem icon={<i className="sc-local-dot" />} title={snapshot.cachePath || 'No persistent cache'}>
            {snapshot.cachePath ? 'SQLite index' : 'In-memory index'} · {snapshot.restoredFiles || 0} restored · {snapshot.pendingFiles ? `${snapshot.pendingFiles} files still indexing · totals partial` : 'history indexed'} · {compact(snapshot.bytesRead || 0)} bytes read this scan · {snapshot.errors.length} warnings
          </StatusItem>
        </ShellStatus>
        <ShellStatus side="end"><StatusItem onClick={() => void revoke()}>Revoke session access</StatusItem></ShellStatus>
        {snapshot.errors.length > 0 && <details className="sc-errors"><summary>Index warnings</summary>{snapshot.errors.map((e, i) => <p key={i}>{e}</p>)}</details>}
      </>}
      {dialog === 'agentAccess' && (
        <AgentAccess
          close={() => setDialog(null)}
          directory={listFilters.directory}
          selected={shown}
          inspect={(key, event) => { store.getState().inspect(key, event); setDialog(null); }}
        />
      )}
      {dialog === 'connections' && <ConnectionsDialog close={() => setDialog(null)} />}
      {dialog === 'memories' && (
        <div className="sc-dialog-backdrop">
          <section className="sc-dialog sc-memory-dialog" role="dialog" aria-modal="true" aria-label="User memories">
            <header><h2>User memories</h2><button onClick={() => setDialog(null)} aria-label="Close user memories"><X size={18} /></button></header>
            <MemoryBrowser />
          </section>
        </div>
      )}
    </section>
  );
}

/** The journal's commands (shared UI spec §5.5), for the app's menu. */
export function journalCommands(journal: Journal): { refresh: Command; newList: Command } {
  const enabled = () => journal.store.getState().enabled === true;
  return {
    refresh: { id: 'journal.refresh', label: 'Refresh Sessions', enabled, run: () => { void refreshJournal(journal); } },
    newList: {
      id: 'journal.newList', label: 'New Session List', enabled,
      run: () => {
        const state = journal.store.getState();
        state.splitPane(state.lastList, 'col');
      },
    },
  };
}
