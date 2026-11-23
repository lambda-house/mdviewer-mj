// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { applyScrollPosition, captureScrollPosition, sameScrollPosition } from './scrollAnchor';

/**
 * A scroll container with blocks laid out at fixed document offsets (happy-dom
 * has no layout): each rect follows the container's scrollTop.
 */
function layout(blocks: { line: number; top: number; hidden?: boolean; parent?: number }[]) {
  const container = document.createElement('div');
  let scrollTop = 0;
  Object.defineProperty(container, 'scrollTop', {
    get: () => scrollTop,
    set: (value: number) => { scrollTop = Math.max(0, value); },
  });
  Object.defineProperty(container, 'scrollHeight', { value: 10000 });
  Object.defineProperty(container, 'clientHeight', { value: 500 });
  container.getBoundingClientRect = () => new DOMRect(0, 100, 800, 500);

  const elements: HTMLElement[] = [];
  for (const block of blocks) {
    const el = document.createElement('div');
    el.dataset.line = String(block.line);
    el.getBoundingClientRect = () => block.hidden
      ? new DOMRect(0, 0, 0, 0)
      : new DOMRect(0, 100 + block.top - scrollTop, 800, 20);
    (block.parent !== undefined ? elements[block.parent] : container).appendChild(el);
    elements.push(el);
  }
  return { container, blocks };
}

describe('scroll anchors', () => {
  it('anchors to the last block starting at or above the top of the view', () => {
    const { container } = layout([{ line: 0, top: 0 }, { line: 5, top: 300 }, { line: 9, top: 700 }]);
    container.scrollTop = 450;
    expect(captureScrollPosition(container)).toEqual({ top: 450, line: 5, offset: 150 });
  });

  it('prefers a nested block on the same line and skips hidden ones', () => {
    const { container } = layout([
      { line: 0, top: 0 },
      { line: 3, top: 200 },
      { line: 3, top: 200, parent: 1 },
      { line: 4, top: 0, hidden: true },
    ]);
    container.scrollTop = 250;
    const position = captureScrollPosition(container);
    expect(position).toEqual({ top: 250, line: 3, offset: 50 });
  });

  it('keeps the anchored text in place when content above grows', () => {
    const { container, blocks } = layout([{ line: 0, top: 0 }, { line: 5, top: 300 }]);
    container.scrollTop = 320;
    const position = captureScrollPosition(container);

    blocks[1].top += 115; // a diagram above rendered
    applyScrollPosition(container, position);
    expect(container.scrollTop).toBe(435);
  });

  it('falls back to the pixel offset', () => {
    const { container } = layout([{ line: 0, top: 0 }]);
    applyScrollPosition(container, { top: 640, line: 42, offset: 10 }); // line gone
    expect(container.scrollTop).toBe(640);
    applyScrollPosition(container, 99999); // old saved offset, clamped
    expect(container.scrollTop).toBe(9500);
  });

  it('compares positions by value', () => {
    expect(sameScrollPosition({ top: 1, line: 2, offset: 3 }, { top: 1, line: 2, offset: 3 })).toBe(true);
    expect(sameScrollPosition(5, 5)).toBe(true);
    expect(sameScrollPosition(5, { top: 5, line: 0, offset: 0 })).toBe(false);
    expect(sameScrollPosition(undefined, 0)).toBe(false);
  });
});
