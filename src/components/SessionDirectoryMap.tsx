import { useMemo } from 'react';
import { Folder, MapPin } from 'lucide-react';
import { directoryTree, within, type DirectoryNode, type Session } from '../utils/sessions';
export default function SessionDirectoryMap({ sessions, directory, current, select }: {sessions: Session[]; directory:string; current:string; select:(directory:string)=>void}) {
  const root=useMemo(() => directoryTree(sessions),[sessions]);
  const render=(node:DirectoryNode,depth:number):JSX.Element => <div key={node.path}>
    {node.children.size ? <details open={depth<2 || (!!directory && within(directory,node.path))}>
      <summary><Folder size={12}/><button className={directory===node.path ? 'selected' : ''} onClick={e=>{e.preventDefault();select(node.path);}} title={node.path}>{node.name}</button><span>{node.sessions.size}</span></summary>
      <div className="sc-directory-children">{[...node.children.values()].sort((a,b)=>a.name.localeCompare(b.name)).map(n=>render(n,depth+1))}</div>
    </details> : <div className="sc-directory-leaf"><Folder size={12}/><button className={directory===node.path ? 'selected' : ''} title={node.path} onClick={()=>select(node.path)}>{node.name}</button><span>{node.sessions.size}</span></div>}
  </div>;
  return <details className="sc-directory-map"><summary><MapPin size={13}/><span title={directory || 'All recorded locations'}>{directory.split('/').filter(Boolean).pop() || 'All locations'}</span><small>Directory map</small></summary><div className="sc-directory-actions"><button onClick={()=>select('')}>All locations</button><button onClick={()=>select(current)} disabled={!current}>Current directory</button></div><p title={directory}>{directory || 'All recorded locations'} · counts include descendants</p><div className="sc-directory-tree">{render(root,0)}</div></details>;
}
