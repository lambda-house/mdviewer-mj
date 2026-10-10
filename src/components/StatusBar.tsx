import React, { useCallback, useEffect, useRef, useMemo } from 'react';
import { FileText, Clock, Hash, Pin } from 'lucide-react';
import { useStore } from '../store';
import clsx from 'clsx';

// ============================================================
// Utility Functions
// ============================================================

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function calculateReadingTime(text: string): string {
  const wordsPerMinute = 200;
  const words = text.trim().split(/\s+/).length;
  const minutes = Math.ceil(words / wordsPerMinute);
  return minutes === 1 ? '1 min read' : `${minutes} min read`;
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diffMs = now - timestamp;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins} min ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  
  return new Date(timestamp).toLocaleDateString();
}

function truncatePath(path: string, maxLength: number = 50): string {
  if (path.length <= maxLength) return path;
  
  const parts = path.split('/');
  if (parts.length <= 3) return path;
  
  const first = parts[0] || parts[1]; // Handle leading /
  const last = parts.slice(-2).join('/');
  
  return `${first}/.../${last}`;
}

/**
 * Repaint the panels area. WebKitGTK (notably with the Linux rendering
 * workarounds from main.rs) can leave stale scrollbar pixels behind when the
 * area resizes - e.g. a horizontal scrollbar drawn above a status bar that
 * was just unpinned - until something scrolls. A one-frame, invisible opacity
 * change makes it repaint everything.
 */
function repaintMainContent(): void {
  const el = document.querySelector<HTMLElement>('.main-content');
  if (!el) return;
  el.style.opacity = '0.999';
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      el.style.opacity = '';
    });
  });
}

// ============================================================
// Status Bar Component
// ============================================================

const StatusBar: React.FC = () => {
  const activeTab = useStore((s) => s.tabs.find((t) => t.id === s.activeTabId) ?? null);
  const documents = useStore((s) => s.documents);
  const statusBarVisible = useStore((s) => s.statusBarVisible);
  const statusBarPinned = useStore((s) => s.statusBarPinned);
  const setStatusBarVisible = useStore((s) => s.setStatusBarVisible);
  const setStatusBarPinned = useStore((s) => s.setStatusBarPinned);
  
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusBarRef = useRef<HTMLElement>(null);
  
  // Hysteresis thresholds to prevent flicker
  const SHOW_THRESHOLD = 40;  // px from bottom to show
  const HIDE_THRESHOLD = 80;  // Must move this far up to hide
  
  // Get active document
  const activeDocument = activeTab ? documents[activeTab.path] : null;
  
  // Calculate stats (memoized to prevent recalculation)
  const stats = useMemo(() => {
    const content = activeDocument?.content || '';
    const wordCount = countWords(content);
    const readingTime = calculateReadingTime(content);
    const fileSize = new Blob([content]).size;
    const lastModified = activeDocument?.lastModified || Date.now();
    
    return { wordCount, readingTime, fileSize, lastModified };
  }, [activeDocument?.content, activeDocument?.lastModified]);
  
  // Handle mouse movement with hysteresis
  const handleMouseMove = useCallback((e: MouseEvent) => {
    const windowHeight = window.innerHeight;
    const distanceFromBottom = windowHeight - e.clientY;

    // Clear any pending hide timeout
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
    
    // Show when near bottom
    if (distanceFromBottom <= SHOW_THRESHOLD) {
      setStatusBarVisible(true);
    }
    // Hide when moved far enough up (hysteresis)
    else if (distanceFromBottom > HIDE_THRESHOLD && !statusBarPinned) {
      // Delay hide slightly for smoother experience
      hideTimeoutRef.current = setTimeout(() => {
        setStatusBarVisible(false);
      }, 300);
    }
  }, [setStatusBarVisible, statusBarPinned]);
  
  // Keep visible when hovering over status bar itself
  const handleStatusBarMouseEnter = useCallback(() => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
  }, []);
  
  const handleStatusBarMouseLeave = useCallback(() => {
    if (!statusBarPinned) {
      hideTimeoutRef.current = setTimeout(() => {
        setStatusBarVisible(false);
      }, 2000);
    }
  }, [statusBarPinned, setStatusBarVisible]);
  
  // Toggle pin
  const handleTogglePin = useCallback(() => {
    setStatusBarPinned(!statusBarPinned);
    if (!statusBarPinned) {
      setStatusBarVisible(true);
    }
  }, [statusBarPinned, setStatusBarPinned, setStatusBarVisible]);
  
  // Track mouse position
  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
      }
    };
  }, [handleMouseMove]);
  
  // Escape to hide
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && statusBarVisible && !statusBarPinned) {
        setStatusBarVisible(false);
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [statusBarVisible, statusBarPinned, setStatusBarVisible]);
  
  // Pinning/unpinning resizes the panels area (the pinned bar has its own row)
  const pinnedRef = useRef(statusBarPinned);
  useEffect(() => {
    if (pinnedRef.current === statusBarPinned) return;
    pinnedRef.current = statusBarPinned;
    requestAnimationFrame(repaintMainContent);
  }, [statusBarPinned]);

  const isVisible = statusBarVisible || statusBarPinned;
  
  return (
    <footer
      ref={statusBarRef}
      className={clsx('status-bar', isVisible && 'visible', statusBarPinned && 'pinned')}
      onMouseEnter={handleStatusBarMouseEnter}
      onMouseLeave={handleStatusBarMouseLeave}
      // Clear what the sliding bar may have left behind once it settled
      onTransitionEnd={(e) => {
        if (e.target === e.currentTarget && e.propertyName === 'transform') repaintMainContent();
      }}
    >
      {activeDocument && activeTab ? (
        <>
          <div className="status-bar-item">
            <FileText size={12} aria-hidden="true" />
            <span title={activeTab.path}>{truncatePath(activeTab.path)}</span>
          </div>
          
          <div className="status-bar-separator" />
          
          <div className="status-bar-item">
            <span>{formatFileSize(stats.fileSize)}</span>
          </div>
          
          <div className="status-bar-separator" />
          
          <div className="status-bar-item">
            <Clock size={12} aria-hidden="true" />
            <span>{formatRelativeTime(stats.lastModified)}</span>
          </div>
          
          <div className="status-bar-spacer" />
          
          <div className="status-bar-item">
            <Hash size={12} aria-hidden="true" />
            <span>{stats.wordCount.toLocaleString()} words</span>
          </div>
          
          <div className="status-bar-separator" />
          
          <div className="status-bar-item">
            <span>{stats.readingTime}</span>
          </div>
          
          <div className="status-bar-separator" />
          
          <button 
            className={clsx('status-bar-pin', statusBarPinned && 'active')}
            onClick={handleTogglePin}
            title={statusBarPinned ? 'Unpin status bar' : 'Pin status bar'}
            aria-pressed={statusBarPinned}
          >
            <Pin size={12} />
          </button>
        </>
      ) : (
        <div className="status-bar-item">
          <span>No document open</span>
        </div>
      )}
    </footer>
  );
};

export default StatusBar;
