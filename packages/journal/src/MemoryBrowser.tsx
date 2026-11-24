import { useCallback, useEffect, useState } from 'react';
import { ArrowUpRight, BookOpen, RefreshCw } from 'lucide-react';
import { Button, Segmented, formatAge } from '@lambda-house/ui';
import { errorText, useJournalContext } from './host';
import type { MemoryCatalog, MemoryDocument, Session } from './sessions';

/**
 * Agent memories: user-wide ones, or with a session also its project's and
 * its own. Reading them needs its own grant. A Markdown file opens in a reader
 * window; anything else (a transcript's compaction summary) is shown here.
 */
export function MemoryBrowser({ session }: { session?: Session }) {
  const { host } = useJournalContext();
  const [enabled, setEnabled] = useState(false);
  const [catalog, setCatalog] = useState<MemoryCatalog>({ entries: [], notes: [] });
  const [scope, setScope] = useState(session ? 'session' : 'user');
  const [document, setDocument] = useState<MemoryDocument | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setBusy(true);
    try { setCatalog(await host.memories(session)); setError(''); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }, [host, session?.id, session?.provider]);
  useEffect(() => {
    let cancelled = false;
    host.memoryAccess().then((value) => { if (!cancelled) setEnabled(value); }).catch((e) => { if (!cancelled) setError(errorText(e)); });
    return () => { cancelled = true; };
  }, [host]);
  useEffect(() => { setDocument(null); if (enabled) void load(); }, [enabled, load]);
  return (
    <section className="sc-memory-browser">
      <div className="sc-section-row"><h3><BookOpen size={16} /> Agent memories</h3>{enabled && <Button variant="ghost" size="xs" icon={<RefreshCw size={14} />} disabled={busy} onClick={() => void load()} title="Refresh memories" aria-label="Refresh memories" />}</div>
      {!enabled ? <>
        <p className="sc-note">Read user-wide memories and instructions, project-shared files, and session-linked memory. Source files stay unchanged.</p>
        <Button variant="primary" onClick={async () => { try { setEnabled(await host.enableMemories()); } catch (e) { setError(errorText(e)); } }}>Enable memory access</Button>
      </> : <>
        {session && <Segmented
          className="sc-memory-scopes"
          kind="choice"
          label="Memory scope"
          value={scope}
          onChange={(next) => { setScope(next); setDocument(null); }}
          options={[{ value: 'user', label: 'User scope' }, { value: 'project', label: 'Shared project' }, { value: 'session', label: 'This session' }]}
        />}
        <p className="sc-note">{scope === 'user' ? 'Current user-wide memory and instructions, shared across sessions.' : scope === 'project' ? 'Current project files associated with this session’s directories; shared with other sessions.' : 'Memories explicitly linked to this thread, plus recorded memory calls and compaction summaries.'}</p>
        {busy && <p role="status">Reading memory sources…</p>}
        <div className="sc-memory-list">{catalog.entries.filter((e) => e.scope === scope).map((e) => {
          const opensDocument = e.key === e.path && /\.md$/i.test(e.path);
          return <button key={e.key} disabled={busy} title={opensDocument ? `Open ${e.title} in a new window` : `Read ${e.title}`} onClick={async () => {
            setBusy(true); setDocument(null);
            try {
              // The backend validates the memory catalog before creating the reader.
              if (opensDocument) await host.openMemoryWindow(e.key, session);
              else setDocument(await host.readMemory(e.key, session));
              setError('');
            } catch (err) { setError(errorText(err)); } finally { setBusy(false); }
          }}><strong>{e.title}</strong><span>{e.provider} · {formatAge(e.modified)}</span><small>{e.description}</small>{opensDocument && <span className="sc-memory-open">Open in new window <ArrowUpRight size={12} /></span>}</button>;
        })}</div>
        {!busy && !catalog.entries.some((e) => e.scope === scope) && <p>No memory found for this scope.</p>}
        {catalog.notes.map((note, i) => <p className="sc-note" key={i}>{note}</p>)}
        {document && <article className="sc-memory-document"><h3>{document.title}</h3><p className="sc-note">{document.provenance}</p><p className="sc-note">{document.note}</p><pre>{document.content || 'No recorded memory content found.'}</pre></article>}
      </>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
