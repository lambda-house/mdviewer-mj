import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { Activity, ArrowLeft, ArrowUpRight, Bot, Copy, History, Link2, Play, Square, Terminal, X, Zap } from 'lucide-react';
import { Button, Tabs } from '@lambda-house/ui';
import { Pane } from '@lambda-house/workbench';
import { errorText, useJournal, useJournalContext } from './host';
import { MemoryBrowser } from './MemoryBrowser';
import { SessionTree } from './SessionTree';
import { compact, family, origin, resumeCommand, sessionKey, sumUsage, totalTokens, type Session, type SessionEvent } from './sessions';
import { DETAIL_TABS, detailPanes, newDetail, type DetailTab } from './store';

const label = (s: Session) => s.title || s.name || s.id;
const date = (s: string) => s ? new Date(s).toLocaleString() : 'Unknown';
const isMod = (event: MouseEvent) => event.metaKey || event.ctrlKey;

export function Metric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return <div className="sc-metric"><span>{label}</span><strong>{value}</strong><small>{hint}</small></div>;
}

function ContextResult({ value }: { value: unknown }) {
  const v = value as { fields?: { summary?: string; status?: { name?: string }; assignee?: { displayName?: string } }; result?: { content?: { text?: string }[] } };
  if (v?.fields) return <><h3>{v.fields.summary}</h3><p>{v.fields.status?.name} · {v.fields.assignee?.displayName || 'Unassigned'}</p><details><summary>Full issue details</summary><pre>{JSON.stringify(value, null, 2)}</pre></details></>;
  return <pre>{v?.result?.content?.map((c) => c.text).filter(Boolean).join('\n') || JSON.stringify(value, null, 2)}</pre>;
}

/**
 * One `journal-detail` pane: its pane header (Resume, close, the pane menu),
 * its session's heading and tabs. It loads only its own session, and only
 * while shown (`active`); a session's details load when it is chosen. Linked
 * Work's lookups, Direct and Resume are there only when the host has them.
 */
export function JournalDetail({ pane, active }: { pane: string; active: boolean }) {
  const { store, host } = useJournalContext();
  const state = useJournal((s) => s.details[pane]) ?? newDetail();
  const evidence = useJournal((s) => s.evidence[pane]);
  const sessions = useJournal((s) => s.snapshot.sessions);
  const several = useJournal((s) => detailPanes(s).length > 1);
  const selected = state.session;

  const [detail, setDetail] = useState<Session | null>(null);
  const [olderEvents, setOlderEvents] = useState<SessionEvent[] | null>(null);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [context, setContext] = useState<unknown>(null);
  const [contextTitle, setContextTitle] = useState('');
  const [contextError, setContextError] = useState('');
  const [contextBusy, setContextBusy] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [controlMessage, setControlMessage] = useState('');
  const [controlBusy, setControlBusy] = useState(false);
  const version = useRef(0);

  const set = (update: Partial<typeof state>) => store.getState().setDetail(pane, update);
  const fail = (e: unknown) => store.getState().setError(errorText(e));

  useEffect(() => {
    setContext(null); setContextError(''); setContextTitle(''); setControlMessage(''); setInstruction(''); setOlderEvents(null);
    version.current++;
    setContextBusy(false);
  }, [selected]);

  // The full session (its latest events) while shown, again with every snapshot
  useEffect(() => {
    if (!active) return;
    const summary = sessions.find((s) => sessionKey(s) === selected);
    if (!summary) { setDetail(null); return; }
    let cancelled = false;
    host.detail(summary.provider, summary.id)
      .then((s) => { if (!cancelled) setDetail({ ...s, status: summary.status }); })
      .catch((e) => { if (!cancelled) fail(e); });
    return () => { cancelled = true; };
  }, [selected, sessions, active, host]);

  const chosen = detail && sessionKey(detail) === selected ? detail : sessions.find((s) => sessionKey(s) === selected);
  const closeButton = several && <Button variant="ghost" size="xs" icon={<X size={16} />} aria-label="Close session pane" title="Close this pane" onClick={() => store.getState().closePane(pane)} />;
  if (!chosen) {
    return <Pane className="sc-detail" title="Session" tools={closeButton}><div className="sc-empty"><Bot size={32} /><h2>Select a session</h2><p>Inspect its activity, agents and linked work.</p></div></Pane>;
  }

  const events = evidence?.session === selected ? [evidence.event] : olderEvents ?? chosen.events ?? [];
  const descendants = family(sessions, chosen);
  const openHere = (key: string, event: MouseEvent) => { if (isMod(event)) store.getState().show(key, { side: true }); else set({ session: key }); };
  const tabs = DETAIL_TABS.filter((t) => t !== 'direct' || host.control);
  const tab: DetailTab = tabs.includes(state.tab) ? state.tab : 'activity';

  const loadContext = async (provider: 'jira' | 'memory', key: string) => {
    if (!host.context) return;
    const v = ++version.current;
    setContextBusy(true); setContext(null); setContextError(''); setContextTitle(`${provider === 'jira' ? 'Jira issue' : 'TEOB memory run'} · ${key}`);
    try { const value = await host.context(provider, key); if (version.current === v) setContext(value); }
    catch (e) { if (version.current === v) setContextError(errorText(e)); }
    finally { if (version.current === v) setContextBusy(false); }
  };
  const openTicket = async (key: string) => {
    const v = ++version.current;
    setContextTitle(`Jira issue · ${key}`); setContextError(''); setContext(null); setContextBusy(false);
    try {
      const { jiraSite } = await host.connections!();
      if (!jiraSite) throw new Error('Set your Jira site in Connections first.');
      await host.openExternal!(`${jiraSite.replace(/\/$/, '')}/browse/${encodeURIComponent(key)}`);
    } catch (e) { if (version.current === v) setContextError(errorText(e)); }
  };
  const control = async (action: 'inspect' | 'steer' | 'interrupt') => {
    if (!host.control) return;
    setControlBusy(true); setControlMessage('');
    try {
      const result = await host.control(action, chosen.id, chosen.turnId, instruction);
      setControlMessage(action === 'inspect' ? JSON.stringify(result, null, 2) : `${action === 'steer' ? 'Instruction accepted' : 'Interrupt accepted'} by Codex. Refresh to see subsequent activity.`);
    } catch (e) { setControlMessage(errorText(e)); }
    finally { setControlBusy(false); }
  };
  const earlier = async () => {
    const v = version.current;
    setHistoryBusy(true);
    try { const page = await host.events(chosen.provider, chosen.id, events[0].seq - 1); if (version.current === v) setOlderEvents(page); }
    catch (e) { fail(e); }
    finally { setHistoryBusy(false); }
  };

  const resume = !chosen.parentId && host.resume && (
    <Button variant="ghost" size="sm" icon={<Play size={12} />} title="Continue this session in a hosted terminal, in its folder" onClick={() => void host.resume!(chosen).catch(fail)}>Resume in Live</Button>
  );

  return (
    <Pane className="sc-detail" title="Session" tools={<>{resume}{closeButton}</>}>
      <div className="sc-detail-heading">
        <div className="sc-session-meta"><span className={`sc-provider ${chosen.provider}`}>{chosen.provider}</span><span className={`sc-status ${chosen.status}`}>{chosen.status}</span><span>{origin(chosen) === 'human' ? 'Human session' : origin(chosen)} · {chosen.name}</span></div>
        <h2 title={label(chosen)}>{label(chosen)}</h2>
        <p title={chosen.cwd}>{chosen.cwd}</p>
        <div className="sc-detail-info">
          <span><Zap size={14} />{chosen.model || 'Unknown model'} {chosen.effort && `· ${chosen.effort}`}</span>
          <span>{compact(totalTokens(chosen.usage))} recorded tokens</span>
          <span>{chosen.eventCount.toLocaleString()} events</span>
        </div>
      </div>
      <div className="sc-tabs">
        <Tabs label="Session details" value={tab} onChange={(t) => set({ tab: t })} tabs={tabs.map((t) => ({ value: t, label: t.replace(/\b\w/g, (c) => c.toUpperCase()), count: t === 'agents' ? descendants.length - 1 : undefined }))} />
      </div>
      <div className="sc-detail-content">
        {tab === 'activity' && <>
          {evidence?.session === selected && <Button variant="ghost" size="sm" icon={<ArrowLeft size={14} />} onClick={() => store.getState().clearEvidence(pane)}>Back to activity</Button>}
          <div className="sc-section-row">
            <h3>Activity <span className="sc-activity-count">{events.length} / {chosen.eventCount} · {olderEvents ? 'earlier' : 'latest'} · newest first</span></h3>
            <select title="Message previews are capped at 12,000 characters" aria-label="Event type" value={state.eventFilter} onChange={(e) => set({ eventFilter: e.target.value })}>{['all', 'user', 'assistant', 'tool', 'result', 'error'].map((t) => <option key={t}>{t}</option>)}</select>
          </div>
          <div className="sc-history-actions">
            {olderEvents && <Button variant="ghost" size="sm" icon={<ArrowLeft size={14} />} onClick={() => setOlderEvents(null)}>Back to latest</Button>}
            {events[0]?.seq > 1 && <Button variant="ghost" size="sm" icon={<History size={14} />} disabled={historyBusy} onClick={() => void earlier()}>{historyBusy ? 'Loading earlier activity…' : 'Earlier activity'}</Button>}
          </div>
          {[...events].reverse().filter((e) => state.eventFilter === 'all' || e.kind === state.eventFilter).map((e, i) => (
            <article className={`sc-event ${e.kind}`} key={`${chosen.id}-${e.at}-${i}`}>
              <div className="sc-event-dot" />
              <header><strong>{e.tool || e.kind}</strong><time>{date(e.at)}</time></header>
              {e.kind === 'tool' || e.kind === 'result'
                ? <details><summary>{e.text.slice(0, 180)}</summary><pre>{e.text}</pre></details>
                : e.text.length > 400 ? <details className="sc-message"><summary>{e.text.slice(0, 240)}</summary><p>{e.text}</p></details> : <p>{e.text}</p>}
            </article>
          ))}
        </>}
        {tab === 'agents' && <>
          <h3>Session hierarchy</h3>
          {chosen.parentId && <p>Parent: <button className="sc-text-button" onClick={(e) => openHere(`${chosen.provider}:${chosen.parentId}`, e)}>{chosen.parentId}</button></p>}
          {chosen.forkedFrom && <p>Forked from <button className="sc-text-button" onClick={(e) => openHere(`${chosen.provider}:${chosen.forkedFrom}`, e)}>{chosen.forkedFrom}</button></p>}
          <p className="sc-note">This session and descendants: {compact(totalTokens(sumUsage(descendants)))} tokens. Ancestors appear for context and are excluded from this total.</p>
          <SessionTree all={sessions} matches={descendants} selected={selected} open={openHere} menu={(key, e) => { e.preventDefault(); store.getState().show(key, { side: true }); }} />
        </>}
        {tab === 'memories' && <MemoryBrowser key={sessionKey(chosen)} session={chosen} />}
        {tab === 'usage' && <>
          <h3>Recorded usage</h3>
          <p className="sc-note">Lifetime of this session. Cached and cache-write input are included in input; reasoning is included in output. Token counts are not a monetary bill. Missing telemetry is shown as unknown.</p>
          {!chosen.usageKnown ? <p>No usage reported in this transcript.</p> : <>
            <div className="sc-usage-grid">{Object.entries(chosen.usage).map(([k, v]) => <Metric key={k} label={k.replace('cacheWrite', 'cache write')} value={v.toLocaleString()} hint="tokens" />)}</div>
            <h3>By model</h3>
            <table><thead><tr><th>Model</th><th>Input</th><th>Cached</th><th>Output</th></tr></thead><tbody>{Object.entries(chosen.models).map(([m, u]) => <tr key={m}><td>{m || 'Unattributed'}</td><td>{compact(u.input)}</td><td>{compact(u.cached)}</td><td>{compact(u.output)}</td></tr>)}</tbody></table>
          </>}
          <h3>Tools used</h3>
          {Object.entries(chosen.tools).sort((a, b) => b[1] - a[1]).map(([tool, count]) => <div className="sc-tool-row" key={tool}><code>{tool}</code><span>{count}</span></div>)}
          <details className="sc-provenance">
            <summary>Source & accounting provenance</summary>
            <p>{chosen.source}</p>
            <p>Started {date(chosen.started)} · updated {date(chosen.updated)}</p>
            <p>{chosen.provider === 'codex' ? 'Unique response usage records for this thread; older transcripts fall back to cumulative usage differences.' : 'Unique message IDs; repeated usage fragments are counted by positive increments.'}</p>
            <p>Skipped malformed records: {chosen.malformedLines}</p>
          </details>
        </>}
        {tab === 'linked work' && (host.context ? <>
          <h3>Atlassian tickets</h3>
          <p className="sc-note">Mentions extracted from messages and tool activity. A mention is evidence of a reference, not an assignment.</p>
          <div className="sc-ticket-list">{chosen.tickets.map((key) => <div key={key}>
            <Button variant="ghost" size="sm" icon={<Link2 size={14} />} onClick={() => void loadContext('jira', key)} disabled={contextBusy}>{key}</Button>
            {host.connections && host.openExternal && <Button variant="ghost" size="sm" icon={<ArrowUpRight size={14} />} title={`Open ${key} in Jira`} aria-label={`Open ${key} in Jira`} onClick={() => void openTicket(key)} />}
          </div>)}</div>
          {!chosen.tickets.length && <p>No ticket mentions found.</p>}
          <h3>TEOB memory</h3>
          <p>Look up the memory run whose identifier matches this session.</p>
          <Button variant="ghost" size="sm" icon={<Activity size={14} />} onClick={() => void loadContext('memory', chosen.id)} disabled={contextBusy}>Load memory run</Button>
          <h4>Memory tools observed</h4>
          {chosen.memoryRefs.length ? chosen.memoryRefs.map((r) => <code className="sc-memory-ref" key={r}>{r}</code>) : <p className="sc-note">No named TEOB memory calls observed. Calls through shell wrappers may not be identifiable.</p>}
          {contextTitle && <div className="sc-context"><h3>{contextTitle}</h3>{contextBusy && <p>Fetching…</p>}{contextError && <p role="alert">{contextError}</p>}{context !== null && <ContextResult value={context} />}</div>}
        </> : <>
          <h3>Ticket mentions</h3>
          <p className="sc-note">Keys found in messages and tool activity. A mention is evidence of a reference, not an assignment.</p>
          <div className="sc-ticket-list">{chosen.tickets.map((key) => <code key={key}>{key}</code>)}</div>
          {!chosen.tickets.length && <p>No ticket mentions found.</p>}
          <h3>Memory tools observed</h3>
          {chosen.memoryRefs.length ? chosen.memoryRefs.map((r) => <code className="sc-memory-ref" key={r}>{r}</code>) : <p className="sc-note">No named memory calls observed. Calls through shell wrappers may not be identifiable.</p>}
        </>)}
        {tab === 'direct' && host.control && <>
          <h3>Direct the session</h3>
          <p className="sc-note">Observed activity does not guarantee that an agent is still running. Codex controls connect to its existing local daemon and require the observed turn to still be current.</p>
          {chosen.provider === 'codex' ? <>
            <Button variant="ghost" size="sm" icon={<Activity size={14} />} disabled={controlBusy} onClick={() => void control('inspect')}>Inspect live Codex state</Button>
            <label className="sc-instruction">Instruction<textarea placeholder="Give this agent a specific correction or next constraint…" value={instruction} onChange={(e) => setInstruction(e.target.value)} /></label>
            <div className="sc-control-actions">
              <Button variant="primary" disabled={controlBusy || !chosen.turnId || !instruction.trim()} onClick={() => void control('steer')}>Send steering instruction</Button>
              <Button variant="ghost" icon={<Square size={14} />} disabled={controlBusy || !chosen.turnId} onClick={() => void control('interrupt')}>Interrupt turn</Button>
            </div>
          </> : <p>Live steering is not connected for externally launched Claude sessions. Continue in its existing terminal. Resume only after the original instance has stopped.</p>}
          {controlMessage && <pre className="sc-control-result" role="status">{controlMessage}</pre>}
          <h3>Resume in your terminal</h3>
          <p className="sc-note">This copies a command; it does not launch another agent. Avoid resuming while the original instance is working.</p>
          <div className="sc-command"><Terminal size={16} /><code>{resumeCommand(chosen)}</code><Button variant="ghost" size="xs" icon={<Copy size={14} />} aria-label="Copy resume command" title="Copy resume command" onClick={() => void navigator.clipboard.writeText(resumeCommand(chosen)).then(() => setControlMessage('Resume command copied.')).catch((e) => setControlMessage(errorText(e)))} /></div>
        </>}
      </div>
    </Pane>
  );
}
