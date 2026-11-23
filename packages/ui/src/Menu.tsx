import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { cx } from './cx';

export type MenuItem =
  | {
      label: ReactNode; onSelect: () => void; icon?: ReactNode; disabled?: boolean; key?: string;
      /** The item is pointed at or focused (true), or no longer (false): to preview what it does. */
      onHover?: (on: boolean) => void;
    }
  | 'separator';

export interface MenuProps {
  items: MenuItem[];
  /** Where the menu opens, in viewport pixels: its top and its left or right edge. */
  at: { top: number; left?: number; right?: number };
  onClose: () => void;
  /** Names the menu for screen readers. */
  label?: string;
  /** Presses on this element (the menu's trigger) don't close the menu: the trigger toggles it. */
  anchorRef?: RefObject<HTMLElement | null>;
  /** Long items wrap instead of staying on one line. */
  wrap?: boolean;
  /** Which enabled item takes the focus first (the one Enter should choose). */
  focusIndex?: number;
  className?: string;
}

/** Keeps a menu this far from the window edges. */
const EDGE = 4;

/**
 * A popup menu (role=menu) at a fixed position. It is drawn where it is
 * rendered (position: fixed lets it out of scrolling lists), so it stays in
 * its owner's DOM. The first enabled item (or `focusIndex`) takes the focus;
 * arrows, Home and End move it. Escape, Tab, a
 * press outside, leaving the window or resizing it close the menu; choosing
 * an item closes it, then runs the item.
 */
export function Menu({ items, at, onClose, label, anchorRef, wrap = false, focusIndex = 0, className }: MenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState(at);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Stay inside the window
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const box = menu.getBoundingClientRect();
    const next = { ...at };
    if (box.bottom > window.innerHeight - EDGE) next.top = Math.max(EDGE, window.innerHeight - EDGE - box.height);
    if (at.left !== undefined && box.right > window.innerWidth - EDGE) next.left = Math.max(EDGE, window.innerWidth - EDGE - box.width);
    setPosition(next);
  }, [at.top, at.left, at.right]);

  // An item takes the focus; the focus goes back where it was on close
  // The item focused on opening is not "pointed at": it previews nothing
  const openingFocus = useRef(false);
  useEffect(() => {
    const previous = document.activeElement;
    const enabled = menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)');
    openingFocus.current = true;
    enabled?.[Math.min(focusIndex, enabled.length - 1)]?.focus();
    openingFocus.current = false;
    return () => {
      const inside = menuRef.current?.contains(document.activeElement) || document.activeElement === document.body;
      if (inside && previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);

  useEffect(() => {
    const close = () => onCloseRef.current();
    const handlePointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || anchorRef?.current?.contains(target)) return;
      close();
    };
    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
    };
    window.addEventListener('mousedown', handlePointerDown, true);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown, true);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('blur', close);
      window.removeEventListener('resize', close);
    };
  }, [anchorRef]);

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Tab') { e.preventDefault(); onClose(); return; }
    const enabled = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []);
    if (!enabled.length) return;
    const index = enabled.indexOf(document.activeElement as HTMLButtonElement);
    let next = -1;
    if (e.key === 'ArrowDown') next = (index + 1) % enabled.length;
    else if (e.key === 'ArrowUp') next = (index - 1 + enabled.length) % enabled.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = enabled.length - 1;
    if (next === -1) return;
    e.preventDefault();
    enabled[next].focus();
  };

  return (
    <div
      ref={menuRef}
      className={cx('ui-menu', 'ui-menu--fixed', wrap && 'ui-menu--wrap', className)}
      style={{ top: position.top, left: position.left, right: position.left === undefined ? position.right : undefined }}
      role="menu"
      aria-label={label}
      onKeyDown={handleKeyDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, i) =>
        item === 'separator' ? (
          <div key={`separator-${i}`} className="ui-menu__separator" role="separator" />
        ) : (
          <button
            key={item.key ?? (typeof item.label === 'string' ? item.label : i)}
            type="button"
            role="menuitem"
            className="ui-menu__item"
            disabled={item.disabled}
            onClick={() => { item.onHover?.(false); onClose(); item.onSelect(); }}
            onMouseEnter={item.onHover && (() => item.onHover?.(true))}
            onMouseLeave={item.onHover && (() => item.onHover?.(false))}
            onFocus={item.onHover && (() => { if (!openingFocus.current) item.onHover?.(true); })}
            onBlur={item.onHover && (() => item.onHover?.(false))}
          >
            {item.icon && <span className="ui-menu__icon" aria-hidden="true">{item.icon}</span>}
            <span className="ui-menu__label">{item.label}</span>
          </button>
        )
      )}
    </div>
  );
}
