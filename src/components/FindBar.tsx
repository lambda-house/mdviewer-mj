import React, { useEffect, useRef, useState, useCallback } from 'react';
import { ChevronUp, ChevronDown, X, CaseSensitive, WholeWord, Regex } from 'lucide-react';
import { useStore } from '../store';
import { buildSearchRegex, iterateMatches } from '../utils/search';
import clsx from 'clsx';

// ============================================================
// Tuning
// ============================================================

/** Highlighting more matches than this gets slow and is not useful. */
const MAX_MATCHES = 5000;
/** Batch DOM changes (Shiki, Mermaid, file reloads) before re-searching. */
const RESEARCH_DELAY = 150;

/** Rendered text that is not document content. */
const SKIP_SELECTOR = 'svg, button, script, style, .mermaid-hint, .mermaid-controls';
/** Elements whose text must not run into the neighbouring block's text. */
const BLOCK_SELECTOR = 'p, li, h1, h2, h3, h4, h5, h6, td, th, pre, blockquote, dt, dd, div, table, figcaption';

const HIGHLIGHT_ALL = 'find-match';
const HIGHLIGHT_CURRENT = 'find-current';

// ============================================================
// DOM matching
// ============================================================

/**
 * Collect the text of `root` into one string (with a newline between blocks)
 * and map every regex match back to a DOM Range - matches may span inline
 * elements like `foo **bar**`.
 */
function findRanges(root: Element, regex: RegExp): Range[] {
  const segments: { node: Text; start: number }[] = [];
  let text = '';
  let lastBlock: Element | null = null;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      const parent = node.parentElement;
      if (!parent || parent.closest(SKIP_SELECTOR)) return NodeFilter.FILTER_REJECT;
      return node.nodeValue ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });

  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const block = node.parentElement?.closest(BLOCK_SELECTOR) ?? null;
    if (block !== lastBlock && text.length > 0) text += '\n';
    lastBlock = block;
    segments.push({ node, start: text.length });
    text += node.nodeValue;
  }

  // Last segment starting at or before `index`
  const segmentAt = (index: number) => {
    let lo = 0;
    let hi = segments.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (segments[mid].start <= index) lo = mid;
      else hi = mid - 1;
    }
    const segment = segments[lo];
    // Inside a block separator, not inside a text node
    return segment && index < segment.start + (segment.node.nodeValue?.length ?? 0) ? segment : null;
  };

  const ranges: Range[] = [];
  for (const match of iterateMatches(text, regex)) {
    const first = segmentAt(match.index);
    const last = segmentAt(match.index + match[0].length - 1);
    if (!first || !last) continue;

    const range = document.createRange();
    range.setStart(first.node, match.index - first.start);
    range.setEnd(last.node, match.index + match[0].length - last.start);
    ranges.push(range);
    if (ranges.length >= MAX_MATCHES) break;
  }

  return ranges;
}

/** Index of the rendered match that corresponds to a source match. */
function resolveSourceMatch(
  root: Element,
  ranges: Range[],
  source: string,
  line: number,
  column: number,
  regex: RegExp
): number {
  // Deepest block element that starts at or before the source line
  let block: HTMLElement | null = null;
  let blockLine = -1;
  root.querySelectorAll<HTMLElement>('[data-line]').forEach((el) => {
    const elLine = Number(el.dataset.line);
    if (elLine <= line && elLine >= blockLine) {
      block = el;
      blockLine = elLine;
    }
  });

  // Matches between the block's first line and the target match in the source
  let before = 0;
  const lines = source.split(/\r?\n/);
  for (let i = Math.max(0, blockLine); i <= line && i < lines.length; i++) {
    for (const match of iterateMatches(lines[i], regex)) {
      if (i === line && match.index >= column) break;
      before++;
    }
  }

  let first = 0;
  if (block) {
    const blockRange = document.createRange();
    blockRange.selectNodeContents(block);
    first = ranges.findIndex((r) => r.compareBoundaryPoints(Range.START_TO_START, blockRange) >= 0);
    if (first === -1) first = ranges.length - 1;
  }

  return Math.max(0, Math.min(ranges.length - 1, first + before));
}

/** Scroll the container so the range sits in its upper third, if not visible. */
function scrollRangeIntoView(container: HTMLElement, range: Range): void {
  const rect = range.getBoundingClientRect();
  const box = container.getBoundingClientRect();
  if (rect.top >= box.top + 8 && rect.bottom <= box.bottom - 8) return;
  container.scrollTop += rect.top - box.top - box.height / 3;
}

interface FindHighlights {
  all: Highlight;
  current: Highlight;
}

/**
 * The two highlights, registered once and then only changed in place:
 * WebKitGTK does not repaint the old ranges when a registered highlight is
 * replaced (`set`) or removed (`delete`), so they stay painted until the next
 * scroll. `clear()` and `add()` on a registered highlight do repaint.
 */
function getFindHighlights(): FindHighlights | null {
  if (typeof CSS === 'undefined' || !('highlights' in CSS) || typeof Highlight === 'undefined') return null;
  const registry = CSS.highlights;
  let all = registry.get(HIGHLIGHT_ALL);
  let current = registry.get(HIGHLIGHT_CURRENT);
  if (!all || !current) {
    all = new Highlight();
    current = new Highlight();
    current.priority = 1; // paint over the match highlight it is part of
    registry.set(HIGHLIGHT_ALL, all);
    registry.set(HIGHLIGHT_CURRENT, current);
  }
  return { all, current };
}

function setHighlightRanges(highlight: Highlight, ranges: Range[]): void {
  highlight.clear();
  for (const range of ranges) highlight.add(range);
}

// ============================================================
// Find Bar Component
// ============================================================

interface FindBarProps {
  scrollRef: React.RefObject<HTMLDivElement>;
  activePath: string | null;
}

/**
 * Find in the current document (Ctrl+F). Matches are highlighted with the CSS
 * Custom Highlight API, so the rendered document itself is never modified.
 */
const FindBar: React.FC<FindBarProps> = ({ scrollRef, activePath }) => {
  const findOpen = useStore((s) => s.findOpen);
  const query = useStore((s) => s.findQuery);
  const options = useStore((s) => s.searchOptions);
  const focusNonce = useStore((s) => s.findFocusNonce);
  const findRequest = useStore((s) => s.findRequest);
  const setFindQuery = useStore((s) => s.setFindQuery);
  const setSearchOptions = useStore((s) => s.setSearchOptions);
  const closeFind = useStore((s) => s.closeFind);
  const clearFindRequest = useStore((s) => s.clearFindRequest);

  const inputRef = useRef<HTMLInputElement>(null);
  const rangesRef = useRef<Range[]>([]);
  const [count, setCount] = useState(0);
  const [current, setCurrent] = useState(-1);
  const [error, setError] = useState<string | undefined>();
  const [domVersion, setDomVersion] = useState(0);
  /** Bumped by every search, so highlights repaint even if count/current match. */
  const [searchVersion, setSearchVersion] = useState(0);
  /** Scroll to the current match only after navigation or a new search - a
   *  background DOM refresh must not yank the view back to it. */
  const scrollPendingRef = useRef(false);

  const { regex, error: regexError } = buildSearchRegex(query, options);

  // Focus (and select) the input whenever Ctrl+F is pressed
  useEffect(() => {
    if (!findOpen) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [findOpen, focusNonce]);

  // Re-search when the rendered document changes (late Shiki/Mermaid output,
  // file reloads, switching tabs)
  useEffect(() => {
    const container = scrollRef.current;
    if (!findOpen || !container) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => setDomVersion((v) => v + 1), RESEARCH_DELAY);
    });
    observer.observe(container, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['data-rendered-path'] });

    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [findOpen, scrollRef, activePath]);

  // Search. A new query starts at the first match in view; a DOM refresh keeps
  // the current position.
  const lastSearchKey = useRef('');
  useEffect(() => {
    const container = scrollRef.current;
    const root = container?.querySelector('.markdown-body');
    const renderedPath = root?.getAttribute('data-rendered-path') ?? '';
    const searchKey = `${query}\u0000${JSON.stringify(options)}\u0000${renderedPath}`;
    const isNewSearch = searchKey !== lastSearchKey.current;
    lastSearchKey.current = searchKey;

    if (!findOpen || !regex || !root || !container) {
      rangesRef.current = [];
      setCount(0);
      setCurrent(-1);
      setError(findOpen ? regexError : undefined);
      setSearchVersion((v) => v + 1); // repaint even when current was already -1
      return;
    }

    const ranges = findRanges(root, regex);
    rangesRef.current = ranges;
    setCount(ranges.length);
    setError(undefined);
    setSearchVersion((v) => v + 1);
    if (isNewSearch) scrollPendingRef.current = true;

    // Jump requested by the search panel - once this document is rendered
    if (findRequest && findRequest.path === activePath && renderedPath === activePath) {
      const source = useStore.getState().documents[findRequest.path]?.content ?? '';
      setCurrent(ranges.length > 0
        ? resolveSourceMatch(root, ranges, source, findRequest.line, findRequest.column, regex)
        : -1);
      scrollPendingRef.current = true;
      clearFindRequest();
      return;
    }
    if (findRequest) return; // wait for the requested document to render

    setCurrent((prev) => {
      if (ranges.length === 0) return -1;
      if (!isNewSearch && prev >= 0) return Math.min(prev, ranges.length - 1);
      const top = container.getBoundingClientRect().top;
      const firstVisible = ranges.findIndex((r) => r.getBoundingClientRect().bottom >= top);
      return firstVisible === -1 ? 0 : firstVisible;
    });
    // `regex` is derived from query + options
  }, [findOpen, query, options, activePath, domVersion, findRequest, scrollRef, clearFindRequest]);

  // Paint highlights and bring the current match into view
  useEffect(() => {
    const highlights = getFindHighlights();
    const ranges = rangesRef.current;
    const currentRange = current >= 0 ? ranges[current] : undefined;

    if (highlights) {
      setHighlightRanges(highlights.all, ranges);
      setHighlightRanges(highlights.current, currentRange ? [currentRange] : []);
    } else if (currentRange) {
      // No highlight API: at least select the current match
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(currentRange);
    }

    if (currentRange && scrollRef.current && scrollPendingRef.current) {
      scrollRangeIntoView(scrollRef.current, currentRange);
    }
    scrollPendingRef.current = false;
  }, [current, searchVersion, scrollRef]);

  // Clear highlights when the bar closes (or the component goes away)
  useEffect(() => {
    const clear = () => {
      const highlights = getFindHighlights();
      highlights?.all.clear();
      highlights?.current.clear();
    };
    if (!findOpen) clear();
    return clear;
  }, [findOpen]);

  const step = useCallback((direction: 1 | -1) => {
    const total = rangesRef.current.length;
    if (total === 0) return;
    scrollPendingRef.current = true;
    setCurrent((prev) => (prev + direction + total) % total);
    setSearchVersion((v) => v + 1); // repaint/scroll even when current is unchanged
  }, []);

  // F3 / Shift+F3 work wherever the focus is
  useEffect(() => {
    if (!findOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F3') {
        e.preventDefault();
        step(e.shiftKey ? -1 : 1);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [findOpen, step]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      step(e.shiftKey ? -1 : 1);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeFind();
    }
  }, [step, closeFind]);

  if (!findOpen) return null;

  const status = error
    ? 'Invalid regex'
    : !query
      ? ''
      : count === 0
        ? 'No results'
        : `${current + 1} of ${count}${count >= MAX_MATCHES ? '+' : ''}`;

  return (
    <div className="find-bar" role="search">
      <div className={clsx('find-input-wrap', (error || (query && count === 0)) && 'no-results')}>
        <input
          ref={inputRef}
          className="find-input"
          value={query}
          onChange={(e) => setFindQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Find in document"
          aria-label="Find in document"
          title={error}
          spellCheck={false}
        />
        <SearchOptionToggles options={options} onChange={setSearchOptions} />
      </div>
      <span className="find-status" aria-live="polite">{status}</span>
      <button className="find-button" onClick={() => step(-1)} disabled={count === 0} title="Previous match (Shift+Enter)" type="button">
        <ChevronUp size={14} />
      </button>
      <button className="find-button" onClick={() => step(1)} disabled={count === 0} title="Next match (Enter)" type="button">
        <ChevronDown size={14} />
      </button>
      <button className="find-button" onClick={closeFind} title="Close (Escape)" type="button">
        <X size={14} />
      </button>
    </div>
  );
};

// ============================================================
// Option toggles (shared with the search panel)
// ============================================================

export const SearchOptionToggles: React.FC<{
  options: { caseSensitive: boolean; wholeWord: boolean; regex: boolean };
  onChange: (options: Partial<{ caseSensitive: boolean; wholeWord: boolean; regex: boolean }>) => void;
}> = ({ options, onChange }) => (
  <div className="search-toggles">
    <button
      className={clsx('search-toggle', options.caseSensitive && 'active')}
      onClick={() => onChange({ caseSensitive: !options.caseSensitive })}
      title="Match case"
      aria-pressed={options.caseSensitive}
      type="button"
    >
      <CaseSensitive size={14} />
    </button>
    <button
      className={clsx('search-toggle', options.wholeWord && 'active')}
      onClick={() => onChange({ wholeWord: !options.wholeWord })}
      title="Match whole word"
      aria-pressed={options.wholeWord}
      type="button"
    >
      <WholeWord size={14} />
    </button>
    <button
      className={clsx('search-toggle', options.regex && 'active')}
      onClick={() => onChange({ regex: !options.regex })}
      title="Use regular expression"
      aria-pressed={options.regex}
      type="button"
    >
      <Regex size={14} />
    </button>
  </div>
);

export default FindBar;
