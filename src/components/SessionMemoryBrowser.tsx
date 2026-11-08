import { useCallback, useEffect, useState } from 'react';
import { ArrowUpRight, BookOpen, RefreshCw } from 'lucide-react';
import { sessionApi, type MemoryCatalog, type MemoryDocument, type Session } from '../utils/sessions';
import { formatAge } from '../utils/agent';
export default function SessionMemoryBrowser({ session }: { session?: Session }) {
  const [enabled,setEnabled]=useState(false);const [catalog,setCatalog]=useState<MemoryCatalog>({entries:[],notes:[]});
  const [scope,setScope]=useState(session ? 'session' : 'user');const [document,setDocument]=useState<MemoryDocument|null>(null);
  const [error,setError]=useState('');const [busy,setBusy]=useState(false);
  const load=useCallback(async()=>{setBusy(true);try {setCatalog(await sessionApi.memories(session));setError('');}catch(e){setError(String(e));}finally{setBusy(false);}},[session?.id,session?.provider]);
  useEffect(()=>{let cancelled=false;sessionApi.memoryAccess().then(value=>{if(!cancelled)setEnabled(value);}).catch(e=>{if(!cancelled)setError(String(e));});return()=>{cancelled=true;};},[]);
  useEffect(()=>{setDocument(null);if(enabled)void load();},[enabled,load]);
  return <section className="sc-memory-browser"><div className="sc-section-row"><h3><BookOpen size={16}/> Agent memories</h3>{enabled && <button disabled={busy} onClick={()=>void load()} title="Refresh memories"><RefreshCw size={14}/></button>}</div>
    {!enabled ? <><p className="sc-note">Read user-wide memories and instructions, project-shared files, and session-linked memory. Source files stay unchanged.</p><button className="sc-primary" onClick={async()=>{try{setEnabled(await sessionApi.enableMemories());}catch(e){setError(String(e));}}}>Enable memory access</button></> : <>
      <nav className="sc-memory-scopes" aria-label="Memory scope">{(session ? ['user','project','session'] : ['user']).map(s=><button key={s} disabled={busy} className={scope===s?'active':''} onClick={()=>{setScope(s);setDocument(null);}}>{s==='user'?'User scope':s==='project'?'Shared project':'This session'}</button>)}</nav>
      <p className="sc-note">{scope==='user'?'Current user-wide memory and instructions, shared across sessions.':scope==='project'?'Current project files associated with this session’s directories; shared with other sessions.':'Memories explicitly linked to this thread, plus recorded memory calls and compaction summaries.'}</p>
      {busy && <p role="status">Reading memory sources…</p>}
      <div className="sc-memory-list">{catalog.entries.filter(e=>e.scope===scope).map(e=>{
        const opensDocument = e.key === e.path && /\.md$/i.test(e.path);
        return <button key={e.key} disabled={busy} title={opensDocument ? `Open ${e.title} in a new window` : `Read ${e.title}`} onClick={async()=>{
          setBusy(true);setDocument(null);
          try {
            // The desktop validates the memory catalog before creating the reader.
            if (opensDocument) await sessionApi.openMemoryWindow(e.key,session);
            else setDocument(await sessionApi.readMemory(e.key,session));
            setError('');
          } catch(e) {setError(String(e));} finally {setBusy(false);}
        }}><strong>{e.title}</strong><span>{e.provider} · {formatAge(e.modified)}</span><small>{e.description}</small>{opensDocument && <span className="sc-memory-open">Open in new window <ArrowUpRight size={12}/></span>}</button>;
      })}</div>
      {!busy && !catalog.entries.some(e=>e.scope===scope) && <p>No memory found for this scope.</p>}
      {catalog.notes.map((note,i)=><p className="sc-note" key={i}>{note}</p>)}
      {document && <article className="sc-memory-document"><h3>{document.title}</h3><p className="sc-note">{document.provenance}</p><p className="sc-note">{document.note}</p><pre>{document.content || 'No recorded memory content found.'}</pre></article>}
    </>}{error && <p role="alert">{error}</p>}</section>;
}
