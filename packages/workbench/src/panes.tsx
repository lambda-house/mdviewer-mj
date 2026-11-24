import { createContext, useContext, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { ChevronDown, MoreHorizontal } from 'lucide-react';
import { Button, Menu, PaneFrame, type MenuItem, type PaneFrameProps } from '@lambda-house/ui';
import type { PaneContext } from './LayoutView';

// A pane's header parts (shared UI spec §5.4): its title, a type menu for a
// switchable pane ("FILES ▾"), its zoom badge and its menu (⋯: split, join,
// swap, close). They read the pane's context, which LayoutView gives every
// pane it draws; outside a layout they show the title alone.

const PaneContextValue = createContext<PaneContext | null>(null);

export function PaneContextProvider({ value, children }: { value: PaneContext; children: ReactNode }) {
  return <PaneContextValue.Provider value={value}>{children}</PaneContextValue.Provider>;
}

/** The pane this component is drawn in, or null outside a layout. */
export function usePane(): PaneContext | null {
  return useContext(PaneContextValue);
}

const noSubscribe = () => () => {};

/** The pane's zoom now, re-rendering when it changes; 100 for a pane that doesn't zoom. */
export function usePaneZoom(): number {
  const zoom = usePane()?.actions.zoom ?? null;
  return useSyncExternalStore(zoom?.subscribe ?? noSubscribe, () => zoom?.get() ?? 100);
}

/** Below a header element: where a menu opens. */
function below(element: HTMLElement | null) {
  const box = element?.getBoundingClientRect();
  return box ? { top: box.bottom + 2, left: box.left } : { top: 0, left: 0 };
}

/** A pane's title; a switchable pane's is a menu of the types it can turn into. */
export function PaneTitle({ children }: { children?: ReactNode }) {
  const pane = usePane();
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const title = children ?? pane?.actions.title;
  if (!pane || pane.actions.types.length === 0) return <>{title}</>;
  return (
    <>
      <button ref={anchor} type="button" className="wb-pane-type" aria-haspopup="menu" aria-expanded={open} title="Show another panel here" onClick={() => setOpen((o) => !o)}>
        {title}<ChevronDown size={12} aria-hidden="true" />
      </button>
      {open && (
        <Menu
          label="Panel type"
          at={below(anchor.current)}
          anchorRef={anchor}
          onClose={() => setOpen(false)}
          items={pane.actions.types.map((t) => ({ key: t.type, label: t.title, icon: t.icon, onSelect: () => pane.actions.setType(t.type) }))}
        />
      )}
    </>
  );
}

/** The pane's zoom while it is not 100 %; a click sets it back. */
export function PaneZoomBadge() {
  const pane = usePane();
  const zoom = usePaneZoom();
  if (!pane?.actions.zoom || zoom === 100) return null;
  return (
    <button className="wb-zoom-badge" type="button" onClick={() => pane.actions.zoom?.step(0)} title="Panel zoom (Ctrl + wheel) - click to reset to 100%">
      {zoom}%
    </button>
  );
}

/** The items of a pane's menu; pointing at one shows what it would do. */
export function paneMenuItems(pane: PaneContext): MenuItem[] {
  const { actions } = pane;
  const hover = (preview: Parameters<typeof actions.preview>[0]) => (on: boolean) => actions.preview(on ? preview : null);
  const items: MenuItem[] = [
    { key: 'split-right', label: 'Split Right', disabled: !actions.canSplit, onSelect: () => actions.split('row'), onHover: hover({ kind: 'split', dir: 'row' }) },
    { key: 'split-down', label: 'Split Down', disabled: !actions.canSplit, onSelect: () => actions.split('col'), onHover: hover({ kind: 'split', dir: 'col' }) },
  ];
  if (actions.joinable.length || actions.swappable.length) items.push('separator');
  for (const other of actions.joinable) {
    items.push({ key: `join-${other.leaf}`, label: `Join with ${other.title}`, icon: other.icon, onSelect: () => actions.join(other.leaf), onHover: hover({ kind: 'join', leaf: other.leaf }) });
  }
  for (const other of actions.swappable) {
    items.push({ key: `swap-${other.leaf}`, label: `Swap with ${other.title}`, icon: other.icon, onSelect: () => actions.swap(other.leaf), onHover: hover({ kind: 'swap', leaf: other.leaf }) });
  }
  items.push('separator', { key: 'close', label: 'Close Pane', disabled: !actions.canClose, onSelect: actions.close, onHover: hover({ kind: 'close' }) });
  return items;
}

/** The pane's menu (⋯). Nothing outside a layout. */
export function PaneMenu() {
  const pane = usePane();
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  if (!pane?.leaf) return null;
  const close = () => { setOpen(false); pane.actions.preview(null); };
  return (
    <>
      <Button ref={anchor} variant="ghost" size="xs" icon={<MoreHorizontal size={16} />} aria-label={`${pane.actions.title} pane menu`} title="Split, join, swap or close this pane" aria-haspopup="menu" aria-expanded={open} onClick={() => (open ? close() : setOpen(true))} />
      {open && <Menu label={`${pane.actions.title} pane`} at={below(anchor.current)} anchorRef={anchor} onClose={close} items={paneMenuItems(pane)} />}
    </>
  );
}

/**
 * A pane with the workbench's header: its title (a type menu when it is
 * switchable), its zoom badge, its own tools, then its menu.
 */
export function Pane({ title, tools, children, ...rest }: PaneFrameProps) {
  return (
    <PaneFrame {...rest} title={<PaneTitle>{title}</PaneTitle>} tools={<><PaneZoomBadge />{tools}<PaneMenu /></>}>
      {children}
    </PaneFrame>
  );
}
