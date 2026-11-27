import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from 'lucide-react';
import { cx } from './cx';

/** Distance from a collapsed handle (px) at which its grip shows. */
const REVEAL_DISTANCE = 24;
/** A double-click right after a click opened the panel must not close it again. */
const DOUBLE_CLICK_GUARD_MS = 500;
/** Arrow keys move a handle this far (px); with Shift, four times as far. */
export const HANDLE_STEP = 16;

export interface SplitHandleProps {
  /** vertical: a line between columns (col-resize); horizontal: between rows. */
  orientation: 'vertical' | 'horizontal';
  /** How far the pointer moved since the drag started (px, right or down is positive). */
  onDrag: (delta: number) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  /** Arrow keys: move by `delta` px. */
  onStep?: (delta: number) => void;
  /** Double-click, Enter or Space; a click on a collapsed handle. Hides or shows the panel next to it. */
  onToggle?: () => void;
  /** A panel next to it is collapsed: the handle sits at its edge and shows a grip toward it. */
  collapsed?: 'before' | 'after' | null;
  /** Names what it separates, for the tooltip and screen readers ("file panel"). */
  label: string;
}

/**
 * A separator between two panes. Drag to resize; double-click (or Enter)
 * hides or shows the panel next to it; a click on a collapsed one shows it.
 * A collapsed panel's handle shows a grip when the pointer comes near.
 */
export function SplitHandle({ orientation, onDrag, onDragStart, onDragEnd, onStep, onToggle, collapsed = null, label }: SplitHandleProps) {
  const [dragging, setDragging] = useState(false);
  const [near, setNear] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef({ start: 0, moved: false });
  const openedByClickAt = useRef(0);
  const vertical = orientation === 'vertical';

  const latest = useRef({ onDrag, onDragEnd });
  latest.current = { onDrag, onDragEnd };

  const handleMouseDown = useCallback((e: ReactMouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    drag.current = { start: vertical ? e.clientX : e.clientY, moved: false };
    onDragStart?.();
    setDragging(true);
  }, [vertical, onDragStart]);

  useEffect(() => {
    if (!dragging) return;
    const move = (e: MouseEvent) => {
      const delta = (vertical ? e.clientX : e.clientY) - drag.current.start;
      if (delta !== 0) drag.current.moved = true;
      latest.current.onDrag(delta);
    };
    const up = () => { setDragging(false); latest.current.onDragEnd?.(); };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    // Keep the resize cursor while dragging over other elements
    document.body.style.cursor = vertical ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
    return () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [dragging, vertical]);

  // Collapsed: reveal the grip while the pointer is near the handle
  useEffect(() => {
    if (!collapsed) { setNear(false); return; }
    const move = (e: MouseEvent) => {
      const box = ref.current?.getBoundingClientRect();
      if (!box) return;
      const distance = vertical
        ? Math.max(box.left - e.clientX, e.clientX - box.right, 0)
        : Math.max(box.top - e.clientY, e.clientY - box.bottom, 0);
      const isNear = distance <= REVEAL_DISTANCE;
      setNear((prev) => (prev === isNear ? prev : isNear));
    };
    const leave = () => setNear(false);
    document.addEventListener('mousemove', move);
    document.documentElement.addEventListener('mouseleave', leave);
    return () => {
      document.removeEventListener('mousemove', move);
      document.documentElement.removeEventListener('mouseleave', leave);
    };
  }, [collapsed, vertical]);

  const handleClick = useCallback(() => {
    if (!collapsed || drag.current.moved) return;
    openedByClickAt.current = Date.now();
    onToggle?.();
  }, [collapsed, onToggle]);

  const handleDoubleClick = useCallback(() => {
    if (Date.now() - openedByClickAt.current < DOUBLE_CLICK_GUARD_MS) return;
    onToggle?.();
  }, [onToggle]);

  const handleKeyDown = useCallback((e: ReactKeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onToggle?.();
      return;
    }
    const back = vertical ? 'ArrowLeft' : 'ArrowUp';
    const forward = vertical ? 'ArrowRight' : 'ArrowDown';
    if ((e.key === back || e.key === forward) && onStep) {
      e.preventDefault();
      onStep((e.key === forward ? 1 : -1) * HANDLE_STEP * (e.shiftKey ? 4 : 1));
    }
  }, [vertical, onToggle, onStep]);

  const Grip = vertical
    ? (collapsed === 'before' ? ChevronRight : ChevronLeft)
    : (collapsed === 'before' ? ChevronDown : ChevronUp);

  return (
    <div
      ref={ref}
      className={cx(
        'ui-split-handle',
        `ui-split-handle--${orientation}`,
        collapsed && `ui-split-handle--collapsed-${collapsed}`,
        dragging && 'is-active',
        collapsed && (near || dragging) && 'is-revealed',
      )}
      onMouseDown={handleMouseDown}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
      role="separator"
      aria-orientation={orientation}
      aria-label={`${label}: drag to resize, ${collapsed ? 'click to show' : 'double-click to hide'}`}
      aria-expanded={!collapsed}
      title={collapsed ? `Click or drag to show ${label}` : `Drag to resize, double-click to hide ${label}`}
      tabIndex={0}
    >
      {collapsed && (
        <span className="ui-split-handle__grip" aria-hidden="true">
          <Grip size={12} />
        </span>
      )}
    </div>
  );
}
