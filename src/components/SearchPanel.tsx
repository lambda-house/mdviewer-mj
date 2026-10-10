import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { X, ChevronRight, FileText } from 'lucide-react';
import { useStore, type FileNode, type SearchScope } from '../store';
import { buildSearchRegex, findLineMatches, type LineMatch } from '../utils/search';
import { flattenFiles, getFileName } from '../utils/files';
import { readFile } from '../utils/tauri';
import { SearchOptionToggles } from './FindBar';
import { useSmoothWheelScroll } from '../hooks/useSmoothWheelScroll';
import clsx from 'clsx';

// ============================================================
// Tuning
// ============================================================

/** Wait for typing to pause before searching. */
const SEARCH_DEBOUNCE = 250;
/** Stop collecting after this many matches in total. */
const MAX_TOTAL_MATCHES = 2000;
/** Files read in parallel during a folder search. */
const READ_CONCURRENCY = 6;
/** Characters of context shown before a match in the result line. */
const PREVIEW_CONTEXT = 30;
/** Minimum time between result list updates while a search is running. */
const FLUSH_INTERVAL = 100;

interface FileResult {
  path: string;
  matches: LineMatch[];
}

interface SearchStatus {
  running: boolean;
  searched: number;
  total: number;
  truncated: boolean;
  error?: string;
}

const IDLE_STATUS: SearchStatus = { running: false, searched: 0, total: 0, truncated: false };

// ============================================================
// Result rows
// ============================================================

const MatchPreview: React.FC<{ match: LineMatch }> = ({ match }) => {
  const { lineText, column, length } = match;
  const start = Math.max(0, column - PREVIEW_CONTEXT);
  const before = (start > 0 ? '…' : '') + lineText.slice(start, column).trimStart();
  return (
    <>
      {before}
      <mark className="search-result-mark">{lineText.slice(column, column + length)}</mark>
      {lineText.slice(column + length)}
    </>
  );
};

interface FileResultGroupProps {
  result: FileResult;
  displayDir: string;
  collapsed: boolean;
  onToggle: () => void;
  onOpen: (path: string, match: LineMatch) => void;
}

const FileResultGroup: React.FC<FileResultGroupProps> = ({ result, displayDir, collapsed, onToggle, onOpen }) => (
  <div className="search-result-file">
    <div className="search-result-file-header" onClick={onToggle} title={result.path} role="button" aria-expanded={!collapsed}>
      <span className={clsx('tree-node-expand', !collapsed && 'expanded')}>
        <ChevronRight size={14} />
      </span>
      <FileText size={14} className="search-result-file-icon" />
      <span className="search-result-file-name">{getFileName(result.path)}</span>
      <span className="search-result-file-dir">{displayDir}</span>
      <span className="search-result-count">{result.matches.length}</span>
    </div>
    {!collapsed && result.matches.map((match, i) => (
      <div
        key={`${match.line}:${match.column}:${i}`}
        className="search-result-line"
        onClick={() => onOpen(result.path, match)}
        title={`Line ${match.line + 1}: ${match.lineText.trim()}`}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onOpen(result.path, match);
        }}
      >
        <MatchPreview match={match} />
      </div>
    ))}
  </div>
);

// ============================================================
// Search Panel Component
// ============================================================

/** Collect the markdown files of the file tree (the open folders). */
function collectFiles(nodes: FileNode[]): string[] {
  const paths = new Set<string>();
  for (const node of flattenFiles(nodes)) {
    if (node.type === 'file') paths.add(node.path);
  }
  return [...paths];
}

/**
 * Text search over the open tabs or the open folders (Ctrl+Shift+F).
 * Clicking a result opens the document and jumps to the match with the find bar.
 */
const SearchPanel: React.FC<{ width: number }> = ({ width }) => {
  const query = useStore((s) => s.searchQuery);
  const scope = useStore((s) => s.searchScope);
  const options = useStore((s) => s.searchOptions);
  const focusNonce = useStore((s) => s.searchFocusNonce);
  const files = useStore((s) => s.files);
  const directories = useStore((s) => s.directories);
  const tabs = useStore((s) => s.tabs);
  const documents = useStore((s) => s.documents);
  const smoothScroll = useStore((s) => s.smoothScroll);
  const setSearchQuery = useStore((s) => s.setSearchQuery);
  const setSearchScope = useStore((s) => s.setSearchScope);
  const setSearchOptions = useStore((s) => s.setSearchOptions);
  const setSearchVisible = useStore((s) => s.setSearchVisible);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const runIdRef = useRef(0);
  const [results, setResults] = useState<FileResult[]>([]);
  const [status, setStatus] = useState<SearchStatus>(IDLE_STATUS);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [rerun, setRerun] = useState(0);

  useSmoothWheelScroll(listRef, smoothScroll);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusNonce]);

  // What to search: open tabs, or every markdown file in the open folders
  const targetSource = scope === 'tabs' ? tabs : files;
  const targets = useMemo(
    () => (scope === 'tabs' ? tabs.map((t) => t.path) : collectFiles(files)),
    // Only the list for the current scope matters (tab changes must not
    // restart a folder search)
    [scope, targetSource]
  );
  // Tabs are searched in memory, so re-run when their content changes
  const tabContentKey = scope === 'tabs'
    ? targets.map((p) => documents[p]?.content.length ?? 0).join(',')
    : '';

  useEffect(() => {
    const runId = ++runIdRef.current;
    const { regex, error } = buildSearchRegex(query, options);

    if (!regex) {
      setResults([]);
      setStatus({ ...IDLE_STATUS, error });
      return;
    }

    const timer = setTimeout(async () => {
      const collected: FileResult[] = [];
      let totalMatches = 0;
      let searched = 0;
      let truncated = false;
      let lastFlush = 0;

      const flush = (running: boolean) => {
        if (runIdRef.current !== runId) return;
        setResults([...collected]);
        setStatus({ running, searched, total: targets.length, truncated });
        lastFlush = performance.now();
      };

      const searchPath = async (path: string) => {
        const open = useStore.getState().documents[path];
        const content = open ? open.content : await readFile(path);
        if (runIdRef.current !== runId || truncated) return;

        const matches = findLineMatches(content, regex, MAX_TOTAL_MATCHES - totalMatches);
        searched++;
        if (matches.length > 0) {
          collected.push({ path, matches });
          totalMatches += matches.length;
          if (totalMatches >= MAX_TOTAL_MATCHES) truncated = true;
        }
        if (performance.now() - lastFlush > FLUSH_INTERVAL) flush(true);
      };

      setStatus({ running: true, searched: 0, total: targets.length, truncated: false });

      // Small worker pool; results keep the target order when sorted below
      let next = 0;
      const worker = async () => {
        while (next < targets.length && runIdRef.current === runId && !truncated) {
          const path = targets[next++];
          try {
            await searchPath(path);
          } catch (err) {
            console.warn(`Search skipped ${path}:`, err);
            searched++;
          }
        }
      };
      await Promise.all(Array.from({ length: READ_CONCURRENCY }, worker));

      const order = new Map(targets.map((p, i) => [p, i]));
      collected.sort((a, b) => (order.get(a.path) ?? 0) - (order.get(b.path) ?? 0));
      flush(false);
    }, SEARCH_DEBOUNCE);

    return () => clearTimeout(timer);
    // tabContentKey stands in for `documents` when searching tabs
  }, [query, options, targets, tabContentKey, rerun]);

  const handleOpen = useCallback(async (path: string, match: LineMatch) => {
    const state = useStore.getState();
    try {
      const tab = state.tabs.find((t) => t.path === path);
      if (tab) {
        state.setActiveTab(tab.id);
      } else {
        const content = await readFile(path);
        const result = state.openDocument(path, content, { preview: true });
        if (!result.success) throw new Error(result.error);
      }
      useStore.getState().requestFindAt(path, match.line, match.column, query);
    } catch (error) {
      console.error('Failed to open search result:', error);
      alert(`Failed to open ${getFileName(path)}: ${error}`);
    }
  }, [query]);

  const toggleCollapsed = useCallback((path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  // Directory of a result, relative to the open folder that contains it
  const displayDir = useCallback((path: string) => {
    const root = directories
      .filter((dir) => path.startsWith(dir))
      .sort((a, b) => b.length - a.length)[0];
    const dir = path.slice(0, path.length - getFileName(path).length - 1);
    if (!root) return dir;
    const rootName = getFileName(root);
    return rootName + dir.slice(root.length);
  }, [directories]);

  const matchCount = results.reduce((sum, r) => sum + r.matches.length, 0);
  let summary = '';
  if (status.error) summary = `Invalid regex: ${status.error}`;
  else if (!query) summary = scope === 'tabs' ? `Search ${targets.length} open tab(s)` : `Search ${targets.length} file(s) in open folders`;
  else if (status.running) summary = `Searching… ${status.searched}/${status.total} files, ${matchCount} results`;
  else if (matchCount === 0) summary = 'No results';
  else summary = `${matchCount}${status.truncated ? '+' : ''} results in ${results.length} file(s)${status.truncated ? ' (limit reached)' : ''}`;

  const scopes: Array<{ value: SearchScope; label: string }> = [
    { value: 'tabs', label: 'Open tabs' },
    { value: 'folders', label: 'Folders' },
  ];

  return (
    <aside className="search-panel file-panel" style={{ width }}>
      <div className="file-panel-header">
        <span className="file-panel-title">Search</span>
        <div className="file-panel-actions">
          <button className="file-panel-action" onClick={() => setSearchVisible(false)} title="Close search" type="button">
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="search-panel-controls">
        <div className={clsx('find-input-wrap', status.error && 'no-results')}>
          <input
            ref={inputRef}
            className="find-input"
            value={query}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') setRerun((v) => v + 1);
              if (e.key === 'Escape') inputRef.current?.blur();
            }}
            placeholder="Search text"
            aria-label="Search text"
            spellCheck={false}
          />
          <SearchOptionToggles options={options} onChange={setSearchOptions} />
        </div>
        <div className="search-scope" role="radiogroup" aria-label="Search in">
          {scopes.map(({ value, label }) => (
            <button
              key={value}
              className={clsx('search-scope-button', scope === value && 'active')}
              onClick={() => setSearchScope(value)}
              role="radio"
              aria-checked={scope === value}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
        <div className={clsx('search-summary', status.error && 'error')} aria-live="polite">{summary}</div>
      </div>

      <div ref={listRef} className="search-results">
        {results.map((result) => (
          <FileResultGroup
            key={result.path}
            result={result}
            displayDir={displayDir(result.path)}
            collapsed={collapsed.has(result.path)}
            onToggle={() => toggleCollapsed(result.path)}
            onOpen={handleOpen}
          />
        ))}
      </div>
    </aside>
  );
};

export default SearchPanel;
