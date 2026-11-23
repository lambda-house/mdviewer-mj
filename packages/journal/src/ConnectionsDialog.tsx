import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@lambda-house/ui';
import { errorText, useJournalContext } from './host';
import type { Connections } from './sessions';

/** Jira and TEOB memory credentials; the backend keeps them in process memory only. Needs the host's connections. */
export function ConnectionsDialog({ close }: { close: () => void }) {
  const { host } = useJournalContext();
  const [form, setForm] = useState<Connections>({ jiraSite: 'https://teob.atlassian.net', jiraEmail: '', jiraToken: '', memoryUrl: 'https://mcp.memory.teob.cc/mcp', memoryToken: '' });
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    host.connections?.().then((s) => {
      setForm((f) => ({ ...f, jiraSite: s.jiraSite || f.jiraSite, memoryUrl: s.memoryUrl || f.memoryUrl }));
      setMessage(`Jira: ${s.jiraReady ? 'credentials set' : 'not configured'} · TEOB: ${s.memoryReady ? 'credentials set' : 'not configured'}`);
    }).catch((e) => setMessage(errorText(e)));
  }, [host]);
  const field = (key: keyof Connections, title: string, secret = false) => <label>{title}<input type={secret ? 'password' : 'text'} autoComplete="off" value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} /></label>;
  const save = async () => {
    setSaving(true);
    try { await host.configure?.(form); setForm((f) => ({ ...f, jiraToken: '', memoryToken: '' })); setMessage('Connections saved. Open a ticket or memory run to verify access.'); }
    catch (e) { setMessage(errorText(e)); }
    finally { setSaving(false); }
  };
  return <div className="sc-dialog-backdrop"><section className="sc-dialog" role="dialog" aria-modal="true" aria-label="Connections"><header><h2>Connections</h2><button onClick={close} aria-label="Close connections"><X size={18} /></button></header>
    <p>Credentials stay in desktop process memory until you close the app or revoke session access. Saving replaces both connections.</p>
    <h3>Atlassian</h3>{field('jiraSite', 'Jira site')}{field('jiraEmail', 'Account email')}{field('jiraToken', 'API token', true)}
    <h3>TEOB memory</h3>{field('memoryUrl', 'Memory MCP endpoint')}{field('memoryToken', 'Access token', true)}
    <p role="status">{message}</p><Button variant="primary" disabled={saving} onClick={() => void save()}>Save connections</Button>
  </section></div>;
}
