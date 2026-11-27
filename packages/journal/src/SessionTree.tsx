import { useMemo, useState, type JSX, type MouseEvent } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cx, formatAge } from '@lambda-house/ui';
import { useJournalContext, type SessionRowProps } from './host';
import { sessionKey, sessionTitle, sessionTooltip, sessionTree, type Session, type SessionNode } from './sessions';

/** A session in a list: its provider, its name and its age; the rest is in the tooltip. */
export function SessionRow({ session: s, title, tooltip, selected, onOpen, onMenu }: SessionRowProps) {
  const inferred = s.status === 'working' || s.status === 'interrupted';
  return (
    <button className={cx('sc-session', 'ss-row', selected && 'selected')} title={tooltip} onClick={onOpen} onContextMenu={onMenu}>
      <span className="ss-row-text"><strong><span className={`sc-provider ${s.provider}`}>{s.provider}</span> {title}</strong></span>
      {inferred && <small className={`sc-status ${s.status}`}>{s.status}</small>}
      <small>{s.modified ? formatAge(s.modified) : ''}</small>
    </button>
  );
}

export interface SessionTreeProps {
  all: Session[];
  matches: Session[];
  selected: string;
  open: (key: string, event: MouseEvent) => void;
  menu: (key: string, event: MouseEvent) => void;
}

/** Sessions as a tree: subagents under their parents, a matched child's parent shown for context. */
export function SessionTree({ all, matches, selected, open, menu }: SessionTreeProps) {
  const { Row = SessionRow } = useJournalContext();
  const nodes = useMemo(() => sessionTree(all, matches), [all, matches]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (key: string) => setCollapsed((old) => {
    const next = new Set(old);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });
  const render = (node: SessionNode, depth = 0): JSX.Element => {
    const s = node.session;
    const key = sessionKey(s);
    const closed = collapsed.has(key);
    const title = sessionTitle(s);
    return (
      <div className={cx('sc-tree-node', node.contextOnly && 'context-only')} key={key}>
        <div className="sc-tree-row" style={{ paddingLeft: Math.min(depth, 8) * 16 }}>
          <button className="sc-tree-toggle" aria-label={`${closed ? 'Expand' : 'Collapse'} ${title}`} aria-expanded={!closed} disabled={!node.children.length} onClick={() => toggle(key)}>
            {node.children.length ? (closed ? <ChevronRight size={14} /> : <ChevronDown size={14} />) : <span />}
          </button>
          <Row
            session={s}
            node={node}
            title={title}
            tooltip={sessionTooltip(node, title)}
            selected={selected === key}
            onOpen={(event) => open(key, event)}
            onMenu={(event) => menu(key, event)}
          />
        </div>
        {!closed && node.children.map((child) => render(child, depth + 1))}
      </div>
    );
  };
  return <div className="sc-session-tree">{nodes.map((n) => render(n))}</div>;
}
