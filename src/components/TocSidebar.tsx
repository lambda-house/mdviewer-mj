import React, { useCallback, useRef } from 'react';
import { X, List } from 'lucide-react';
import { useStore, type Heading } from '../store';
import clsx from 'clsx';
import PanelZoomBadge from './PanelZoomBadge';
import { useSmoothWheelScroll } from '../hooks/useSmoothWheelScroll';

// ============================================================
// TOC Item Component
// ============================================================

interface TocItemProps {
  heading: Heading;
  isActive: boolean;
  onClick: () => void;
}

const TocItem: React.FC<TocItemProps> = ({ heading, isActive, onClick }) => {
  const handleClick = useCallback(() => {
    onClick();
    
    // Scroll to heading
    const element = document.getElementById(heading.id);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [heading.id, onClick]);
  
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleClick();
    }
  }, [handleClick]);
  
  return (
    <a
      className={clsx('toc-item', `level-${heading.level}`, isActive && 'active')}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="link"
      aria-current={isActive ? 'location' : undefined}
      title={heading.text}
    >
      {heading.text}
    </a>
  );
};

// ============================================================
// TOC Sidebar Component
// ============================================================

interface TocSidebarProps {
  headings: Heading[];
  width: number;
  isVisible: boolean;
  onToggle: () => void;
}

const TocSidebar: React.FC<TocSidebarProps> = ({
  headings,
  width,
  isVisible,
  onToggle,
}) => {
  const activeHeadingId = useStore((s) => s.activeHeadingId);
  const zoom = useStore((s) => s.panelZoom.toc);
  const smoothScroll = useStore((s) => s.smoothScroll);
  const listRef = useRef<HTMLElement>(null);
  useSmoothWheelScroll(listRef, smoothScroll, isVisible && headings.length > 0);
  
  const handleItemClick = useCallback(() => {
    // Active heading will be updated by scroll handler
  }, []);
  
  if (!isVisible) {
    return null;
  }
  
  return (
    <aside
      className={clsx('toc-sidebar', !isVisible && 'collapsed')}
      style={{ width: isVisible ? width : 0 }}
      data-zoom-panel="toc"
    >
      <div className="toc-header">
        <span className="toc-title">Contents</span>
        <PanelZoomBadge panel="toc" />
        <button
          className="file-panel-action"
          onClick={onToggle}
          title="Close Table of Contents"
          aria-label="Close Table of Contents"
        >
          <X size={16} />
        </button>
      </div>
      
      {headings.length > 0 ? (
        <nav ref={listRef} className="toc-list" role="navigation" aria-label="Table of Contents">
          <div className="panel-zoom" style={{ zoom: zoom / 100 }}>
            {headings.map((heading, index) => (
              <TocItem
                key={`${heading.id}-${index}`}
                heading={heading}
                isActive={activeHeadingId === heading.id}
                onClick={handleItemClick}
              />
            ))}
          </div>
        </nav>
      ) : (
        <div className="toc-empty">
          <List size={24} style={{ marginBottom: 8, opacity: 0.5 }} />
          <p>No headings found</p>
        </div>
      )}
    </aside>
  );
};

export default TocSidebar;
