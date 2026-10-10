import React, { useEffect, useRef, useCallback, useState, useLayoutEffect } from 'react';
import { FileText, X, Pin, ArrowLeft, ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react';
import { useStore, canNavigateBack, canNavigateForward } from '../store';
import { openInExplorer } from '../utils/tauri';
import clsx from 'clsx';

// ============================================================
// Tuning
// ============================================================

/** Fraction of the visible strip scrolled by one [<] / [>] click. */
const SCROLL_PAGE_FRACTION = 0.8;
/** Pixels per wheel "line" when deltaMode is DOM_DELTA_LINE. */
const WHEEL_LINE_PX = 40;

// ============================================================
// Tab Component
// ============================================================

interface TabProps {
  id: string;
  title: string;
  path: string;
  isActive: boolean;
  isDirty: boolean;
  isPreview: boolean;
  onActivate: () => void;
  onClose: () => void;
  onPin: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

const Tab: React.FC<TabProps> = ({
  id,
  title,
  path,
  isActive,
  isDirty,
  isPreview,
  onActivate,
  onClose,
  onPin,
  onContextMenu,
}) => {
  const handleClose = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onClose();
  }, [onClose]);

  const handlePin = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onPin();
  }, [onPin]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 1) { // Middle click
      e.preventDefault();
      onClose();
    }
  }, [onClose]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onActivate();
    }
  }, [onActivate]);

  return (
    <div
      className={clsx('tab', isActive && 'active', isPreview && 'preview')}
      data-tab-id={id}
      onClick={onActivate}
      onDoubleClick={isPreview ? onPin : undefined}
      onMouseDown={handleMouseDown}
      onKeyDown={handleKeyDown}
      onContextMenu={onContextMenu}
      role="tab"
      aria-selected={isActive}
      tabIndex={0}
      title={isPreview ? `${path}\n(preview - double-click or pin to keep open)` : path}
    >
      <FileText size={14} className="tab-icon" aria-hidden="true" />
      {isDirty && (
        <span className="tab-dirty" title="Unsaved changes" aria-label="Unsaved changes" />
      )}
      <span className="tab-title">{title}</span>
      {isPreview && (
        <button
          className="tab-action tab-pin"
          onClick={handlePin}
          title="Keep open"
          aria-label={`Keep ${title} open`}
          type="button"
        >
          <Pin size={12} />
        </button>
      )}
      <button
        className="tab-action tab-close"
        onClick={handleClose}
        title="Close tab"
        aria-label={`Close ${title}`}
        type="button"
      >
        <X size={14} />
      </button>
    </div>
  );
};

// ============================================================
// Tab Context Menu
// ============================================================

interface TabContextMenuProps {
  tabId: string;
  x: number;
  y: number;
  onClose: () => void;
}

const TabContextMenu: React.FC<TabContextMenuProps> = ({ tabId, x, y, onClose }) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });

  const tabs = useStore((s) => s.tabs);
  const closeDocument = useStore((s) => s.closeDocument);
  const closeOtherTabs = useStore((s) => s.closeOtherTabs);
  const closeTabsToLeft = useStore((s) => s.closeTabsToLeft);
  const closeTabsToRight = useStore((s) => s.closeTabsToRight);
  const closeAllTabs = useStore((s) => s.closeAllTabs);
  const pinTab = useStore((s) => s.pinTab);

  const index = tabs.findIndex((t) => t.id === tabId);
  const tab = tabs[index];

  // Keep the menu inside the window
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const rect = menu.getBoundingClientRect();
    setPosition({
      left: Math.max(4, Math.min(x, window.innerWidth - rect.width - 4)),
      top: Math.max(4, Math.min(y, window.innerHeight - rect.height - 4)),
    });
  }, [x, y]);

  // Dismiss on outside click, Escape, blur or resize
  useEffect(() => {
    const handlePointerDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) onClose();
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', handlePointerDown, true);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('blur', onClose);
    window.addEventListener('resize', onClose);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown, true);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('blur', onClose);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  if (!tab) return null;

  const run = (action: () => { success: boolean; error?: string } | void) => () => {
    onClose();
    const result = action();
    if (result && !result.success && result.error) {
      alert(result.error);
    }
  };

  const items: Array<{ label: string; action: () => void; disabled?: boolean } | 'separator'> = [
    { label: 'Close', action: run(() => closeDocument(tabId)) },
    { label: 'Close Others', action: run(() => closeOtherTabs(tabId)), disabled: tabs.length <= 1 },
    { label: 'Close to the Left', action: run(() => closeTabsToLeft(tabId)), disabled: index <= 0 },
    { label: 'Close to the Right', action: run(() => closeTabsToRight(tabId)), disabled: index >= tabs.length - 1 },
    { label: 'Close All', action: run(closeAllTabs) },
    'separator',
    { label: 'Keep Open', action: run(() => pinTab(tabId)), disabled: !tab.isPreview },
    { label: 'Copy Path', action: run(() => { navigator.clipboard?.writeText(tab.path).catch(() => {}); }) },
    {
      label: 'Reveal in File Manager',
      action: run(() => {
        openInExplorer(tab.path).catch((error) => console.error('Failed to open in explorer:', error));
      }),
    },
  ];

  return (
    <div
      ref={menuRef}
      className="context-menu"
      style={{ left: position.left, top: position.top }}
      role="menu"
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, i) =>
        item === 'separator' ? (
          <div key={`sep-${i}`} className="context-menu-separator" role="separator" />
        ) : (
          <button
            key={item.label}
            className="context-menu-item"
            onClick={item.action}
            disabled={item.disabled}
            role="menuitem"
            type="button"
          >
            {item.label}
          </button>
        )
      )}
    </div>
  );
};

// ============================================================
// Tab Bar Component
// ============================================================

const TabBar: React.FC = () => {
  const tabs = useStore((s) => s.tabs);
  const activeTabId = useStore((s) => s.activeTabId);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const closeDocument = useStore((s) => s.closeDocument);
  const pinTab = useStore((s) => s.pinTab);
  const navigateBack = useStore((s) => s.navigateBack);
  const navigateForward = useStore((s) => s.navigateForward);
  const canGoBack = useStore(canNavigateBack);
  const canGoForward = useStore(canNavigateForward);

  const hasTabs = tabs.length > 0;
  const stripRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState({ left: false, right: false });
  const [menu, setMenu] = useState<{ tabId: string; x: number; y: number } | null>(null);

  const updateOverflow = useCallback(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const left = strip.scrollLeft > 0;
    const right = strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 1;
    setOverflow((prev) => (prev.left === left && prev.right === right ? prev : { left, right }));
  }, []);

  // Track overflow as the strip resizes or tabs come and go
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    updateOverflow();
    const observer = new ResizeObserver(updateOverflow);
    observer.observe(strip);
    return () => observer.disconnect();
  }, [updateOverflow, tabs.length]);

  // Bring the active tab into view when it changes - but only then, so
  // scrolling the strip by hand never switches or jumps back
  useEffect(() => {
    if (!activeTabId) return;
    const el = stripRef.current?.querySelector<HTMLElement>(`[data-tab-id="${activeTabId}"]`);
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    updateOverflow();
  }, [activeTabId, updateOverflow]);

  // Vertical mouse wheel scrolls the strip horizontally (native listener:
  // React's onWheel is passive and cannot preventDefault)
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) return; // zoom
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (delta === 0) return;
      e.preventDefault();
      strip.scrollLeft += e.deltaMode === 1 ? delta * WHEEL_LINE_PX : delta;
    };
    strip.addEventListener('wheel', handleWheel, { passive: false });
    return () => strip.removeEventListener('wheel', handleWheel);
  }, [hasTabs]);

  const scrollByPage = useCallback((direction: -1 | 1) => {
    const strip = stripRef.current;
    if (!strip) return;
    strip.scrollBy({ left: direction * strip.clientWidth * SCROLL_PAGE_FRACTION, behavior: 'smooth' });
  }, []);

  const handleContextMenu = useCallback((tabId: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    setMenu({ tabId, x: e.clientX, y: e.clientY });
  }, []);

  const closeMenu = useCallback(() => setMenu(null), []);

  if (!hasTabs) {
    return null;
  }

  return (
    <div className="tab-bar">
      <div className="tab-bar-nav">
        <button
          className="tab-bar-button"
          onClick={navigateBack}
          disabled={!canGoBack}
          title="Back (Alt+Left)"
          aria-label="Back to previous tab"
          type="button"
        >
          <ArrowLeft size={14} />
        </button>
        <button
          className="tab-bar-button"
          onClick={navigateForward}
          disabled={!canGoForward}
          title="Forward (Alt+Right)"
          aria-label="Forward to next tab"
          type="button"
        >
          <ArrowRight size={14} />
        </button>
      </div>

      {(overflow.left || overflow.right) && (
        <button
          className="tab-bar-button tab-scroll-button"
          onClick={() => scrollByPage(-1)}
          disabled={!overflow.left}
          title="Scroll tabs left"
          aria-label="Scroll tabs left"
          type="button"
        >
          <ChevronLeft size={14} />
        </button>
      )}

      <div
        ref={stripRef}
        className="tab-strip"
        role="tablist"
        aria-label="Open documents"
        onScroll={updateOverflow}
      >
        {tabs.map((tab) => (
          <Tab
            key={tab.id}
            id={tab.id}
            title={tab.title}
            path={tab.path}
            isActive={tab.id === activeTabId}
            isDirty={tab.isDirty}
            isPreview={tab.isPreview === true}
            onActivate={() => setActiveTab(tab.id)}
            onClose={() => closeDocument(tab.id)}
            onPin={() => pinTab(tab.id)}
            onContextMenu={handleContextMenu(tab.id)}
          />
        ))}
      </div>

      {(overflow.left || overflow.right) && (
        <button
          className="tab-bar-button tab-scroll-button"
          onClick={() => scrollByPage(1)}
          disabled={!overflow.right}
          title="Scroll tabs right"
          aria-label="Scroll tabs right"
          type="button"
        >
          <ChevronRight size={14} />
        </button>
      )}

      {menu && <TabContextMenu tabId={menu.tabId} x={menu.x} y={menu.y} onClose={closeMenu} />}
    </div>
  );
};

export default TabBar;
