import React, { useCallback, useRef } from 'react';
import { X, List } from 'lucide-react';
import { Button, EmptyState, PaneFrame } from '@lambda-house/ui';
import { useStore } from '../store';
import { useReader } from '../reader';
import { focusedGroupOf, type Heading } from '@lambda-house/reader';
import clsx from 'clsx';
import PanelZoomBadge from './PanelZoomBadge';
import { useSmoothWheelScroll } from '@lambda-house/ui';

// ============================================================
// TOC Item Component
// ============================================================

interface TocItemProps {
  heading: Heading;
  isActive: boolean;
  /** The document group the heading is in. */
  group: string;
}

const TocItem: React.FC<TocItemProps> = ({ heading, isActive, group }) => {
  const handleClick = useCallback(() => {
    // Scroll to the heading in its group (another group can show the same ids)
    const element = document.querySelector(`.document-panel[data-group="${CSS.escape(group)}"] [id="${CSS.escape(heading.id)}"]`);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [heading.id, group]);
  
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
  width: number;
  isVisible: boolean;
  onToggle: () => void;
}

/** The contents of the focused document group. */
const TocSidebar: React.FC<TocSidebarProps> = ({
  width,
  isVisible,
  onToggle,
}) => {
  const group = useReader((s) => focusedGroupOf(s).id);
  const headings = useReader((s) => focusedGroupOf(s).headings);
  const activeHeadingId = useReader((s) => focusedGroupOf(s).activeHeadingId);
  const zoom = useStore((s) => s.panelZoom.toc);
  const smoothScroll = useReader((s) => s.settings.smoothScroll);
  const listRef = useRef<HTMLElement>(null);
  useSmoothWheelScroll(listRef, smoothScroll, isVisible && headings.length > 0);
  
  if (!isVisible) {
    return null;
  }
  
  return (
    <PaneFrame
      as="aside"
      className={clsx('toc-sidebar', !isVisible && 'collapsed')}
      style={{ width: isVisible ? width : 0 }}
      data-zoom-panel="toc"
      title="Contents"
      tools={<>
        <PanelZoomBadge panel="toc" />
        <Button variant="ghost" size="xs" icon={<X size={16} />} onClick={onToggle} title="Close Table of Contents" aria-label="Close Table of Contents" />
      </>}
    >
      {headings.length > 0 ? (
        <nav ref={listRef} className="toc-list" role="navigation" aria-label="Table of Contents">
          <div className="panel-zoom" style={{ zoom: zoom / 100 }}>
            {headings.map((heading, index) => (
              <TocItem
                key={`${heading.id}-${index}`}
                heading={heading}
                isActive={activeHeadingId === heading.id}
                group={group}
              />
            ))}
          </div>
        </nav>
      ) : (
        <EmptyState icon={<List size={24} />}>No headings found</EmptyState>
      )}
    </PaneFrame>
  );
};

export default TocSidebar;
