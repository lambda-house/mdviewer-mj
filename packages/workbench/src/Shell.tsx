import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Segmented, cx } from '@lambda-house/ui';
import { StatusBar } from './StatusBar';
import { NO_DRAG, topRowProps, type TitleBar } from './titleBar';

/** A surface of the window: Documents, Sessions (shared UI spec §5.1). */
export interface ShellSurface {
  id: string;
  label: string;
  icon?: ReactNode;
  /** Stays mounted once it has been shown (the default), so returning finds it as it was; false: only while shown. */
  keepMounted?: boolean;
  render: () => ReactNode;
}

export interface ShellProps {
  surfaces: ShellSurface[];
  active: string;
  onActivate: (surface: string) => void;
  /** After the surface switch: the main menu. */
  menu?: ReactNode;
  /** At the right end, on every surface: settings, theme. */
  end?: ReactNode;
  /** The window's status bar (spec §5.6): what surfaces put there with ShellStatus. Without it, none. */
  status?: { pinned: boolean; onPinnedChange: (pinned: boolean) => void };
  /** Whether the top bar is the window's title bar (macOS's overlay title bar): then its empty space drags the window. Native by default. */
  titleBar?: TitleBar;
  className?: string;
}

interface Targets {
  views: HTMLElement | null; start: HTMLElement | null; end: HTMLElement | null;
  statusStart: HTMLElement | null; statusEnd: HTMLElement | null;
  /** A ShellStatus is shown: the status bar is drawn while one is. */
  showStatus: (shown: boolean) => void;
}

const SurfaceContext = createContext<{ shown: boolean; targets: Targets } | null>(null);

type Slot = 'views' | 'start' | 'end' | 'statusStart' | 'statusEnd';

/**
 * The window: one top bar for every surface (the switch between surfaces, the
 * main menu, the shown surface's view switch and tools, then what every surface has),
 * and the surfaces under it. A surface puts its tools into the bar with
 * ShellTools, from anywhere in its tree.
 */
export function Shell({ surfaces, active, onActivate, menu, end, status, titleBar = 'native', className }: ShellProps) {
  const [statusItems, setStatusItems] = useState(0);
  const showStatus = useCallback((shown: boolean) => setStatusItems((n) => n + (shown ? 1 : -1)), []);
  const [targets, setTargets] = useState<Targets>({ views: null, start: null, end: null, statusStart: null, statusEnd: null, showStatus });
  const visited = useRef(new Set<string>());
  visited.current.add(active);

  // Ctrl+wheel zooms a pane (LayoutView), never the whole window
  useEffect(() => {
    const keep = (e: WheelEvent) => { if (e.ctrlKey || e.metaKey) e.preventDefault(); };
    window.addEventListener('wheel', keep, { passive: false });
    return () => window.removeEventListener('wheel', keep);
  }, []);

  const slotRef = (slot: Slot) => (element: HTMLElement | null) => setTargets((t) => (t[slot] === element ? t : { ...t, [slot]: element }));
  const viewsRef = useCallback(slotRef('views'), []);
  const startRef = useCallback(slotRef('start'), []);
  const endRef = useCallback(slotRef('end'), []);
  const statusStartRef = useCallback(slotRef('statusStart'), []);
  const statusEndRef = useCallback(slotRef('statusEnd'), []);
  // Under a title bar, only the bar's own empty space drags: whatever goes into it (menus that open in
  // place, hover controls, popovers, a tool group's gaps) is never a drag, without each knowing of it
  const noDrag = titleBar === 'overlay' ? NO_DRAG : {};

  return (
    <div className={cx('wb-shell', className)}>
      <header className="wb-topbar" {...topRowProps(titleBar)}>
        <div className="wb-topbar__group" {...noDrag}>
          {surfaces.length > 1 && (
            <Segmented
              label="Workspace"
              value={active}
              onChange={onActivate}
              options={surfaces.map((surface) => ({ value: surface.id, label: surface.label, icon: surface.icon }))}
            />
          )}
          {menu}
        </div>
        <div className="wb-topbar__tools" ref={viewsRef} {...noDrag} />
        <div className="wb-topbar__tools" ref={startRef} {...noDrag} />
        <div className="wb-topbar__spacer" />
        <div className="wb-topbar__tools" ref={endRef} {...noDrag} />
        {end && <div className="wb-topbar__group" {...noDrag}>{end}</div>}
      </header>
      {surfaces.map((surface) => {
        const shown = surface.id === active;
        if (!shown && (surface.keepMounted === false || !visited.current.has(surface.id))) return null;
        return (
          <div key={surface.id} className="wb-surface" hidden={!shown}>
            <SurfaceContext.Provider value={{ shown, targets }}>{surface.render()}</SurfaceContext.Provider>
          </div>
        );
      })}
      {status && <StatusBar pinned={status.pinned} onPinnedChange={status.onPinnedChange} empty={statusItems === 0} startRef={statusStartRef} endRef={statusEndRef} />}
    </div>
  );
}

/** Whether the surface this is drawn in is shown (true outside a Shell). */
export function useSurfaceShown(): boolean {
  return useContext(SurfaceContext)?.shown ?? true;
}

/**
 * A surface's tools in the top bar: after the main menu (`start`) or before the end. Shown only while the surface is.
 * Outside a Shell (a surface on its own, in a test) they render in place.
 */
export function ShellTools({ side = 'start', children }: { side?: 'start' | 'end'; children: ReactNode }) {
  const surface = useContext(SurfaceContext);
  if (!surface) return <>{children}</>;
  const target = surface.shown ? surface.targets[side] : null;
  return target ? createPortal(children, target) : null;
}

/** A view of a surface (shared UI spec §5.2): Live, Journal, Board. */
export interface ShellView {
  id: string;
  label: ReactNode;
  icon?: ReactNode;
  /** The switch option's tooltip. */
  title?: string;
  /**
   * Stays mounted, hidden, while another view is shown: once it has been
   * shown (true), or from the start ('always': something else reads what it
   * keeps up to date). By default only while shown.
   */
  keepMounted?: boolean | 'always';
  render: () => ReactNode;
}

export interface ShellViewsProps {
  views: ShellView[];
  /** The shown view; the app keeps it (it may switch views itself). */
  value: string;
  onChange: (view: string) => void;
  /** Names the switch ("Sessions view"). */
  label: string;
  className?: string;
}

/**
 * A surface's views: the switch between them in the top bar, after the main
 * menu (none with one view), and the shown view under it. A view's
 * ShellTools are in the bar only while that view is shown.
 */
export function ShellViews({ views, value, onChange, label, className }: ShellViewsProps) {
  const surface = useContext(SurfaceContext);
  const visited = useRef(new Set<string>());
  visited.current.add(value);
  const target = surface?.shown ? surface.targets.views : null;
  const switcher = views.length > 1 && (
    <Segmented label={label} value={value} onChange={onChange} options={views.map((view) => ({ value: view.id, label: view.label, icon: view.icon, title: view.title }))} />
  );
  return (
    <>
      {switcher && (surface ? target && createPortal(switcher, target) : switcher)}
      {views.map((view) => {
        const shown = view.id === value;
        const kept = view.keepMounted === 'always' || (view.keepMounted && visited.current.has(view.id));
        if (!shown && !kept) return null;
        return (
          <div key={view.id} className={cx('wb-view', className)} data-view={view.id} hidden={!shown}>
            <SurfaceContext.Provider value={surface && { ...surface, shown: surface.shown && shown }}>{view.render()}</SurfaceContext.Provider>
          </div>
        );
      })}
    </>
  );
}

/**
 * What a surface, view or pane shows in the status bar (StatusItem), at its
 * start or end, while it is shown. The bar sorts them by `order` (lower
 * first, 100 by default; the same order keeps the order they came in).
 * Outside a Shell (a test) it renders in place.
 */
export function ShellStatus({ id, order = 100, side = 'start', children }: { id: string; order?: number; side?: 'start' | 'end'; children: ReactNode }) {
  const surface = useContext(SurfaceContext);
  const target = surface?.shown ? surface.targets[side === 'start' ? 'statusStart' : 'statusEnd'] : null;
  const showStatus = surface?.targets.showStatus;
  // Its own place in the bar's side, among the others by order
  const [slot] = useState(() => (typeof document === 'undefined' ? null : document.createElement('div')));
  useLayoutEffect(() => {
    if (!target || !slot) return;
    slot.className = 'wb-status__slot';
    slot.dataset.status = id;
    slot.dataset.order = String(order);
    const after = [...target.children].find((other) => other !== slot && Number((other as HTMLElement).dataset.order) > order);
    target.insertBefore(slot, after ?? null);
    return () => slot.remove();
  }, [target, slot, id, order]);
  useEffect(() => {
    if (!target || !showStatus) return;
    showStatus(true);
    return () => showStatus(false);
  }, [target, showStatus]);
  if (!surface) return <>{children}</>;
  return target && slot ? createPortal(children, slot) : null;
}
