import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Segmented, cx } from '@lambda-house/ui';

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
  className?: string;
}

interface Targets { start: HTMLElement | null; end: HTMLElement | null }

const SurfaceContext = createContext<{ shown: boolean; targets: Targets } | null>(null);

/**
 * The window: one top bar for every surface (the switch between surfaces, the
 * main menu, then the shown surface's tools, then what every surface has),
 * and the surfaces under it. A surface puts its tools into the bar with
 * ShellTools, from anywhere in its tree.
 */
export function Shell({ surfaces, active, onActivate, menu, end, className }: ShellProps) {
  const [targets, setTargets] = useState<Targets>({ start: null, end: null });
  const visited = useRef(new Set<string>());
  visited.current.add(active);

  const startRef = useCallback((element: HTMLElement | null) => setTargets((t) => (t.start === element ? t : { ...t, start: element })), []);
  const endRef = useCallback((element: HTMLElement | null) => setTargets((t) => (t.end === element ? t : { ...t, end: element })), []);

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
    </div>
  );
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
