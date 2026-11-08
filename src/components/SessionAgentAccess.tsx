import { useCallback, useEffect, useState } from 'react';
import { Copy, Shield, X } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { sessionKey, shellQuote, type Session, type SessionEvent } from '../utils/sessions';
interface Grant { enabled: boolean; directory: string; session: string; excerpts: boolean }
interface Status { grant: Grant; socket: string | null; executable: string; error: string | null; clients: string[]; recentQueries: { at: string; client: string; tool: string; ok: boolean; elapsedMs: number; cohort?: unknown; session?: string }[] }
export const analysisApi = {
  status: () => invoke<Status>('analysis_access'),
  enable: (grant: Grant) => invoke<boolean>('enable_analysis', { grant }),
  revoke: () => invoke<void>('revoke_analysis'),
  query: (name: string, args: Record<string, unknown>) => invoke<Record<string, unknown>>('run_session_analysis', { name, arguments: args }),
};
const message = (e: unknown) => e instanceof Error ? e.message : String(e);
export default function SessionAgentAccess({ close, directory, selected, inspect }: { close: () => void; directory: string; selected?: Session; inspect: (session: string, event: SessionEvent) => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [scope, setScope] = useState(selected ? 'session' : directory ? 'directory' : 'all');
  const [excerpts, setExcerpts] = useState(false);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [evidence, setEvidence] = useState('');
  const refresh = useCallback(async () => { try { setStatus(await analysisApi.status()); } catch (e) { setError(message(e)); } }, []);
  useEffect(() => { void refresh(); const timer = setInterval(() => void refresh(), 3000); return () => clearInterval(timer); }, [refresh]);
  const action = async (f: () => Promise<unknown>) => { setBusy(true); setError(''); try { await f(); await refresh(); } catch (e) { setError(message(e)); } finally { setBusy(false); } };
  const command = status ? `${shellQuote(status.executable)} --mcp` : '';
  const cohort = selected ? { session: sessionKey(selected) } : directory ? { directory } : {};
  const evidenceRows = ((result?.data as { evidence?: { id: string; session: string; event: SessionEvent }[] } | undefined)?.evidence ?? []).filter(row => row.event);
  return <div className="sc-dialog-backdrop"><section className="sc-dialog sc-analysis-dialog" role="dialog" aria-modal="true" aria-label="Agent access">
    <header><h2><Shield size={18}/> Agent access</h2><button aria-label="Close agent access" onClick={close}><X size={18}/></button></header>
    <p>Let local agents query this app’s SQLite index through MCP. Access ends when you revoke it or close MDViewer.</p>
    <div className="sc-analysis-state"><strong>{status?.grant.enabled ? 'Sharing enabled' : 'Sharing disabled'}</strong><span>{status?.clients.length ?? 0} connected clients</span></div>
    {status?.grant.enabled ? <><p className="sc-note">Shared: {status.grant.session || status.grant.directory || 'All sessions'} · excerpts {status.grant.excerpts ? 'enabled' : 'disabled'}</p><button disabled={busy} onClick={() => void action(async () => { await analysisApi.revoke(); setResult(null); })}>Revoke agent access</button></> : <>
      <label>Share scope<select aria-label="Share scope" value={scope} onChange={e => setScope(e.target.value)}>
        {selected && <option value="session">Selected session</option>}{directory && <option value="directory">Current directory and descendants</option>}<option value="all">All indexed sessions</option>
      </select></label>
      <label className="sc-analysis-check"><input type="checkbox" checked={excerpts} onChange={e => setExcerpts(e.target.checked)}/> Allow detailed transcript excerpts</label>
      <p className="sc-note">Directory sharing includes sessions whose entire recorded directory history is within the directory. Metadata includes paths, models, usage and ticket mentions.</p>
      <button className="sc-primary" disabled={busy || !status} onClick={() => void action(() => analysisApi.enable({ enabled: true, directory: scope === 'directory' ? directory : '', session: scope === 'session' && selected ? sessionKey(selected) : '', excerpts }))}>Enable agent access</button>
    </>}
    <h3>Connect a local MCP client</h3><p>Use the app executable as the command and <code>--mcp</code> as its argument. Keep this app open.</p>
    <div className="sc-command"><code>{command}</code><button aria-label="Copy MCP command" disabled={!command} onClick={() => void action(() => navigator.clipboard.writeText(command))}><Copy size={15}/></button></div>
    {status?.socket && <p className="sc-note">Private local socket: {status.socket}</p>}
    {status?.grant.enabled && <><h3>Check the shared view</h3><p className="sc-note">These checks use the same query layer as MCP. Tool and skill checks use {selected ? 'the selected session' : directory || 'all shared sessions'}.</p>
      <div className="sc-analysis-actions">{[['analysis_status','Index status'],['analyze_tools','Tool activity'],['analyze_skills','Skill observations']].map(([name,label]) => <button key={name} disabled={busy} onClick={() => void action(async () => setResult(await analysisApi.query(name, { cohort })))}>{label}</button>)}</div>
      <label>Evidence ID<input aria-label="Evidence ID" placeholder="Paste an evidence ID from an agent’s answer" value={evidence} onChange={e => setEvidence(e.target.value)}/></label>
      <button disabled={busy || !evidence.trim()} onClick={() => void action(async () => setResult(await analysisApi.query('get_evidence', { evidenceIds: [evidence.trim()] })))}>Resolve evidence</button>
      {evidenceRows.map(row => <button key={row.id} onClick={() => inspect(row.session, row.event)}>Open event {row.event.seq} in session</button>)}
    </>}
    {error && <p role="alert">{error}</p>}{status?.error && <p role="alert">{status.error}</p>}
    {result && <pre className="sc-analysis-result">{JSON.stringify(result, null, 2)}</pre>}
    <h3>Connected clients</h3><p>{status?.clients.join(', ') || 'None'}</p>
    <h3>Recent queries</h3><div className="sc-analysis-audit">{status?.recentQueries.slice().reverse().map((q,i) => <div key={`${q.at}-${i}`}><time>{new Date(q.at).toLocaleTimeString()}</time><strong>{q.tool}</strong><span>{q.client || 'Unknown client'} · {q.ok ? 'OK' : 'Failed'} · {q.elapsedMs} ms</span><small>{q.session || JSON.stringify(q.cohort || {})}</small></div>)}</div>
  </section></div>;
}
