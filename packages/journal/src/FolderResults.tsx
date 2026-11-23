import { useMemo, useState, type MouseEvent } from 'react';
import { Filter, Folder, MapPin } from 'lucide-react';
import { formatAge } from '@lambda-house/ui';
import { SessionTree } from './SessionTree';
import { directoryTree, homePath, shortPath, within, type DirectoryNode, type Session } from './sessions';

/** Folders listed before the person is asked to narrow the search. */
const MAX_FOLDERS = 40;
/** Folders whose sessions are shown without a click. */
const OPEN_FOLDERS = 4;
const tilde = (path: string) => homePath(path) || 'Unknown folder';

/**
 * Search results by folder: the folder's path set into a line on top, its
 * sessions under it (subagents under their parents), the newest folder first.
 */
export function FolderResults({ all, matches, selected, open, menu, directory, narrow }: {
  all: Session[]; matches: Session[]; selected: string;
  open: (key: string, event: MouseEvent) => void;
  menu: (key: string, event: MouseEvent) => void;
  directory: string;
  narrow: (directory: string) => void;
}) {
  const folders = useMemo(() => {
    const by = new Map<string, Session[]>();
    for (const s of matches) by.set(s.cwd, [...(by.get(s.cwd) ?? []), s]);
    return [...by.entries()]
      .map(([path, sessions]) => ({ path, sessions, latest: Math.max(...sessions.map((s) => s.modified)) }))
      .sort((a, b) => b.latest - a.latest);
  }, [matches]);
  const [toggled, setToggled] = useState<Set<string>>(new Set());
  const flip = (path: string) => setToggled((old) => {
    const next = new Set(old);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    return next;
  });
  return (
    <div className="ss-results">
      {folders.slice(0, MAX_FOLDERS).map((f, i) => {
        const shown = (i < OPEN_FOLDERS) !== toggled.has(f.path);
        return (
          <section key={f.path} className="ss-dir" aria-label={`Folder ${f.path}`}>
            <header className="ss-dir-head">
              <button type="button" className="ss-dir-toggle" aria-expanded={shown} title={f.path} onClick={() => flip(f.path)}>
                <span className="ss-dir-path">{shortPath(tilde(f.path))}</span>
              </button>
              <span className="ss-dir-rule" />
              <small>{f.sessions.length} · {formatAge(f.latest)}</small>
              {directory !== f.path && f.path && (
                <button type="button" className="ss-dir-start" title="Search only this folder" aria-label={`Search only ${f.path}`} onClick={() => narrow(f.path)}>
                  <Filter size={11} />
                </button>
              )}
            </header>
            {shown && <SessionTree all={all} matches={f.sessions} selected={selected} open={open} menu={menu} />}
          </section>
        );
      })}
      {folders.length > MAX_FOLDERS && <p className="ss-more">{folders.length - MAX_FOLDERS} more folders: narrow the search to see them.</p>}
    </div>
  );
}

/** Every recorded location as a tree, with the sessions in and below each; choosing one narrows the list to it. */
export function DirectoryMap({ sessions, directory, current, select }: { sessions: Session[]; directory: string; current: string; select: (directory: string) => void }) {
  const root = useMemo(() => directoryTree(sessions), [sessions]);
  const render = (node: DirectoryNode, depth: number) => (
    <div key={node.path}>
      {node.children.size ? (
        <details open={depth < 2 || (!!directory && within(directory, node.path))}>
          <summary>
            <Folder size={12} />
            <button className={directory === node.path ? 'selected' : ''} onClick={(e) => { e.preventDefault(); select(node.path); }} title={node.path}>{node.name}</button>
            <span>{node.sessions.size}</span>
          </summary>
          <div className="sc-directory-children">{[...node.children.values()].sort((a, b) => a.name.localeCompare(b.name)).map((n) => render(n, depth + 1))}</div>
        </details>
      ) : (
        <div className="sc-directory-leaf">
          <Folder size={12} />
          <button className={directory === node.path ? 'selected' : ''} title={node.path} onClick={() => select(node.path)}>{node.name}</button>
          <span>{node.sessions.size}</span>
        </div>
      )}
    </div>
  );
  return (
    <details className="sc-directory-map">
      <summary><MapPin size={13} /><span title={directory || 'All recorded locations'}>{directory.split(/[\\/]/).filter(Boolean).pop() || 'All locations'}</span><small>Directory map</small></summary>
      <div className="sc-directory-actions">
        <button onClick={() => select('')}>All locations</button>
        <button onClick={() => select(current)} disabled={!current}>Current directory</button>
      </div>
      <p title={directory}>{directory || 'All recorded locations'} · counts include descendants</p>
      <div className="sc-directory-tree">{render(root, 0)}</div>
    </details>
  );
}
