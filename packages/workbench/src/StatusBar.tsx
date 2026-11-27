import { useCallback, useEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import { Pin } from 'lucide-react';
import { cx } from '@lambda-house/ui';

// The window's one status bar (shared UI spec §5.6). It shows what the shown
// surface, view and panes put into it (ShellStatus, StatusItem). Unpinned it
// slides in over the bottom edge when the pointer comes near and goes again;
// pinned it takes its own row.

/** How near the bottom edge the pointer brings the bar in, and how far up it must go to take it away (px). */
const SHOW_WITHIN = 40;
const HIDE_BEYOND = 80;

/**
 * Repaint the shown surface. WebKitGTK can leave stale scrollbar pixels
 * behind when the area resizes (a scrollbar drawn above a bar that was just
 * unpinned) until something scrolls; a one-frame opacity change repaints it.
 */
function repaintSurface(): void {
  const element = document.querySelector<HTMLElement>('.wb-surface:not([hidden])');
  if (!element) return;
  element.style.opacity = '0.999';
  requestAnimationFrame(() => requestAnimationFrame(() => { element.style.opacity = ''; }));
}

export interface StatusBarProps {
  pinned: boolean;
  onPinnedChange: (pinned: boolean) => void;
  /** Nothing is shown in it: it isn't drawn. */
  empty: boolean;
  startRef: Ref<HTMLDivElement>;
  endRef: Ref<HTMLDivElement>;
}

export function StatusBar({ pinned, onPinnedChange, empty, startRef, endRef }: StatusBarProps) {
  const [visible, setVisible] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = () => { if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; } };

  const onMouseMove = useCallback((e: MouseEvent) => {
    clear();
    const fromBottom = window.innerHeight - e.clientY;
    if (fromBottom <= SHOW_WITHIN) setVisible(true);
    else if (fromBottom > HIDE_BEYOND && !pinned) hideTimer.current = setTimeout(() => setVisible(false), 300);
  }, [pinned]);

  useEffect(() => {
    window.addEventListener('mousemove', onMouseMove);
    return () => { window.removeEventListener('mousemove', onMouseMove); clear(); };
  }, [onMouseMove]);

  // Escape takes the unpinned bar away
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape' && visible && !pinned) setVisible(false); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [visible, pinned]);

  // Pinning resizes the surface above it (the pinned bar has its own row)
  const wasPinned = useRef(pinned);
  useEffect(() => {
    if (wasPinned.current === pinned) return;
    wasPinned.current = pinned;
    if (pinned) setVisible(true);
    requestAnimationFrame(repaintSurface);
  }, [pinned]);

  return (
    <footer
      className={cx('wb-status', (visible || pinned) && 'is-visible', pinned && 'is-pinned', empty && 'is-empty')}
      onMouseEnter={clear}
      onMouseLeave={() => { if (!pinned) hideTimer.current = setTimeout(() => setVisible(false), 2000); }}
      // Clear what the sliding bar may have left behind once it settled
      onTransitionEnd={(e) => { if (e.target === e.currentTarget && e.propertyName === 'transform') repaintSurface(); }}
    >
      <div className="wb-status__side" ref={startRef} />
      <div className="wb-status__spacer" />
      <div className="wb-status__side" ref={endRef} />
      <span className="wb-status__separator" />
      <button
        type="button"
        className={cx('wb-status__pin', pinned && 'is-active')}
        onClick={() => onPinnedChange(!pinned)}
        title={pinned ? 'Unpin status bar' : 'Pin status bar'}
        aria-pressed={pinned}
      >
        <Pin size={12} />
      </button>
    </footer>
  );
}

/** One thing in the status bar: an icon and a text, a button when it does something. */
export function StatusItem({ icon, title, onClick, children }: { icon?: ReactNode; title?: string; onClick?: () => void; children: ReactNode }) {
  const content = <>{icon && <span className="wb-status__icon" aria-hidden="true">{icon}</span>}<span className="wb-status__text">{children}</span></>;
  return onClick
    ? <button type="button" className="wb-status__item wb-status__item--button" title={title} onClick={onClick}>{content}</button>
    : <div className="wb-status__item" title={title}>{content}</div>;
}
