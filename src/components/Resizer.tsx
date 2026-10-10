import React, { useCallback, useRef, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import clsx from 'clsx';

// ============================================================
// Tuning
// ============================================================

/** Distance from the window edge (px) at which a hidden panel's grip shows. */
const EDGE_REVEAL_DISTANCE = 24;
/** Dragged below this fraction of its minimum width, a panel snaps shut. */
const COLLAPSE_FRACTION = 0.5;
/** A double-click right after a click opened the panel must not close it again. */
const DOUBLE_CLICK_GUARD_MS = 500;

// ============================================================
// Resizer Component
// ============================================================

interface ResizerProps {
  /** Which side of the window the panel sits on. */
  side: 'left' | 'right';
  width: number;
  minWidth: number;
  /** False while the panel is hidden - the separator then sits at the window edge. */
  visible: boolean;
  onWidthChange: (width: number) => void;
  onVisibleChange: (visible: boolean) => void;
  label: string;
}

/**
 * Separator between a side panel and the document.
 *
 * - drag to resize; dragging the panel below half its minimum width hides it,
 *   dragging a hidden panel's separator back out shows it again
 * - double-click (or Enter) toggles the panel; a single click opens a hidden one
 * - a hidden panel keeps its separator at the window edge, and a grip appears
 *   when the cursor comes near that edge
 */
const Resizer: React.FC<ResizerProps> = ({
  side,
  width,
  minWidth,
  visible,
  onWidthChange,
  onVisibleChange,
  label,
}) => {
  const [isResizing, setIsResizing] = useState(false);
  const [nearEdge, setNearEdge] = useState(false);
  const dragRef = useRef({ startX: 0, startWidth: 0, moved: false });
  const openedByClickAt = useRef(0);

  // Latest values for the document-level drag listeners
  const latest = useRef({ visible, onWidthChange, onVisibleChange });
  latest.current = { visible, onWidthChange, onVisibleChange };

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startWidth: visible ? width : 0, moved: false };
    setIsResizing(true);
  }, [visible, width]);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const { startX, startWidth } = dragRef.current;
      const moved = e.clientX - startX;
      if (moved !== 0) dragRef.current.moved = true;
      // Width the panel would have if it followed the cursor exactly
      const wanted = startWidth + (side === 'left' ? moved : -moved);
      const shouldShow = wanted >= minWidth * COLLAPSE_FRACTION;
      const { visible: isVisible, onWidthChange: setWidth, onVisibleChange: setVisible } = latest.current;

      if (shouldShow !== isVisible) setVisible(shouldShow);
      if (shouldShow) setWidth(wanted); // the store clamps to min/max
    };

    const handleMouseUp = () => setIsResizing(false);

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    // Keep the resize cursor while dragging over other elements
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing, side, minWidth]);

  // Hidden panel: reveal the grip while the cursor is near this window edge
  useEffect(() => {
    if (visible) {
      setNearEdge(false);
      return;
    }

    const handleMouseMove = (e: MouseEvent) => {
      const distance = side === 'left' ? e.clientX : window.innerWidth - e.clientX;
      const near = distance <= EDGE_REVEAL_DISTANCE;
      setNearEdge((prev) => (prev === near ? prev : near));
    };
    const handleLeave = () => setNearEdge(false);

    document.addEventListener('mousemove', handleMouseMove);
    document.documentElement.addEventListener('mouseleave', handleLeave);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.documentElement.removeEventListener('mouseleave', handleLeave);
    };
  }, [visible, side]);

  const toggle = useCallback(() => onVisibleChange(!visible), [visible, onVisibleChange]);

  const handleClick = useCallback(() => {
    if (visible || dragRef.current.moved) return;
    openedByClickAt.current = Date.now();
    onVisibleChange(true);
  }, [visible, onVisibleChange]);

  const handleDoubleClick = useCallback(() => {
    if (Date.now() - openedByClickAt.current < DOUBLE_CLICK_GUARD_MS) return;
    toggle();
  }, [toggle]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggle();
    }
  }, [toggle]);

  const Chevron = side === 'left' ? ChevronRight : ChevronLeft;

  return (
    <div
      className={clsx(
        'resizer',
        `resizer-${side}`,
        isResizing && 'active',
        !visible && 'collapsed',
        !visible && (nearEdge || isResizing) && 'reveal'
      )}
      onMouseDown={handleMouseDown}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
      role="separator"
      aria-orientation="vertical"
      aria-label={`${label}: drag to resize, ${visible ? 'double-click to hide' : 'click to show'}`}
      aria-expanded={visible}
      title={visible ? `Drag to resize, double-click to hide ${label}` : `Click or drag to show ${label}`}
      tabIndex={0}
    >
      {!visible && (
        <span className="resizer-grip" aria-hidden="true">
          <Chevron size={12} />
        </span>
      )}
    </div>
  );
};

export default Resizer;
