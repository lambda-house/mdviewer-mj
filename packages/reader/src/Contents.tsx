import { useCallback, useRef, type KeyboardEvent } from 'react';
import { List, X } from 'lucide-react';
import clsx from 'clsx';
import { Button, EmptyState, useSmoothWheelScroll } from '@lambda-house/ui';
import { Pane, usePaneZoom } from '@lambda-house/workbench';
import { useReader } from './host';
import { focusedGroupOf } from './store';
import type { Heading } from './types';

// The contents pane (shared UI spec §6.1): the focused document group's
// headings. A click scrolls to the heading in that group; the pane's zoom is
// the one its pane type keeps (usePaneZoom).

/** The contents pane's smallest, largest and first width (px). */
export const CONTENTS_MIN_WIDTH = 180;
export const CONTENTS_MAX_WIDTH = 320;
export const CONTENTS_WIDTH = 220;

function ContentsItem({ heading, isActive, group }: { heading: Heading; isActive: boolean; group: string }) {
  const handleClick = useCallback(() => {
    // Scroll to the heading in its group (another group can show the same ids)
    const element = document.querySelector(`.document-panel[data-group="${CSS.escape(group)}"] [id="${CSS.escape(heading.id)}"]`);
    element?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [heading.id, group]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
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
}

export interface ContentsProps {
  /** Its close button hides the pane, as the app hides it; without it there is no button. */
  onClose?: () => void;
}

/** The headings of the focused document group. */
export function Contents({ onClose }: ContentsProps) {
  const group = useReader((s) => focusedGroupOf(s).id);
  const headings = useReader((s) => focusedGroupOf(s).headings);
  const activeHeadingId = useReader((s) => focusedGroupOf(s).activeHeadingId);
  const smoothScroll = useReader((s) => s.settings.smoothScroll);
  const zoom = usePaneZoom();
  const listRef = useRef<HTMLElement>(null);
  useSmoothWheelScroll(listRef, smoothScroll, headings.length > 0);

  return (
    <Pane
      as="aside"
      className="toc-sidebar"
      title="Contents"
      tools={onClose && (
        <Button variant="ghost" size="xs" icon={<X size={16} />} onClick={onClose} title="Close Table of Contents" aria-label="Close Table of Contents" />
      )}
    >
      {headings.length > 0 ? (
        <nav ref={listRef} className="toc-list" role="navigation" aria-label="Table of Contents">
          <div className="panel-zoom" style={{ zoom: zoom / 100 }}>
            {headings.map((heading, index) => (
              <ContentsItem key={`${heading.id}-${index}`} heading={heading} isActive={activeHeadingId === heading.id} group={group} />
            ))}
          </div>
        </nav>
      ) : (
        <EmptyState icon={<List size={24} />}>No headings found</EmptyState>
      )}
    </Pane>
  );
}
