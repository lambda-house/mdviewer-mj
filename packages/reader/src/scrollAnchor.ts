/**
 * Scroll positions anchored to the text: the block at the top of the view
 * (by its `data-line`) and how far into it the view starts. Diagrams and
 * highlighted code that render late change the height above the reader, so a
 * plain pixel offset would land somewhere else; an anchor keeps the same text
 * in view. `top` is the pixel offset, used when the block is gone (the file
 * changed) and for documents without `data-line` blocks.
 */
export type ScrollAnchor = { top: number; line: number; offset: number };
/** Saved by versions before anchors: a pixel offset. */
export type ScrollPosition = number | ScrollAnchor;

/** Top edge of the container's viewport, in client coordinates. */
function viewportTop(container: HTMLElement): number {
  return container.getBoundingClientRect().top + container.clientTop;
}

/** Laid-out elements only: a hidden block reports an empty rect at 0,0. */
function isRendered(rect: DOMRect): boolean {
  return rect.width > 0 || rect.height > 0;
}

export function captureScrollPosition(container: HTMLElement): ScrollPosition {
  const top = Math.max(0, Math.round(container.scrollTop));
  const viewTop = viewportTop(container);

  // Last block starting at or above the viewport's top edge. Blocks come in
  // document order, so the first one below the edge ends the search; a nested
  // block sharing its parent's line wins over the parent.
  let anchor: HTMLElement | null = null;
  let anchorTop = 0;
  for (const el of container.querySelectorAll<HTMLElement>('[data-line]')) {
    const rect = el.getBoundingClientRect();
    if (!isRendered(rect)) continue;
    if (rect.top > viewTop) break;
    anchor = el;
    anchorTop = rect.top;
  }

  if (!anchor) return top;
  return { top, line: Number(anchor.dataset.line), offset: Math.round(viewTop - anchorTop) };
}

/** Scroll so the saved position is at the top of the view again. */
export function applyScrollPosition(container: HTMLElement, position: ScrollPosition): void {
  if (typeof position === 'object') {
    const candidates = container.querySelectorAll<HTMLElement>(`[data-line="${position.line}"]`);
    // The same rule as captureScrollPosition: the last rendered block of that line
    for (let i = candidates.length - 1; i >= 0; i--) {
      const rect = candidates[i].getBoundingClientRect();
      if (!isRendered(rect)) continue;
      const delta = rect.top - viewportTop(container) + position.offset;
      if (Math.abs(delta) > 0.5) container.scrollTop += delta;
      return;
    }
  }

  const max = Math.max(0, container.scrollHeight - container.clientHeight);
  const next = Math.min(typeof position === 'number' ? position : position.top, max);
  if (Math.abs(container.scrollTop - next) > 0.5) container.scrollTop = next;
}

export function sameScrollPosition(a: ScrollPosition | undefined, b: ScrollPosition): boolean {
  if (typeof a === 'number' || typeof b === 'number' || a === undefined) return a === b;
  return a.top === b.top && a.line === b.line && a.offset === b.offset;
}
