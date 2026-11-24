import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Segmented, cx } from '@lambda-house/ui';
import { StatusBar } from './StatusBar';

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
export function Shell({ surfaces, active, onActivate, menu, end, status, className }: ShellProps) {
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

  return (
    <div className={cx('wb-shell', className)}>
      <header className="wb-topbar">
        <div className="wb-topbar__group">
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
        <div className="wb-topbar__tools" ref={viewsRef} />
        <div className="wb-topbar__tools" ref={startRef} />
        <div className="wb-topbar__spacer" />
        <div className="wb-topbar__tools" ref={endRef} />
        {end && <div className="wb-topbar__group">{end}</div>}
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
 * start or end, while it is shown. Outside a Shell (a test) it renders in place.
 */
export function ShellStatus({ side = 'start', children }: { side?: 'start' | 'end'; children: ReactNode }) {
  const surface = useContext(SurfaceContext);
  const target = surface?.shown ? surface.targets[side === 'start' ? 'statusStart' : 'statusEnd'] : null;
  const showStatus = surface?.targets.showStatus;
  useEffect(() => {
    if (!target || !showStatus) return;
    showStatus(true);
    return () => showStatus(false);
  }, [target, showStatus]);
  if (!surface) return <>{children}</>;
  return target ? createPortal(children, target) : null;
}
