import React, { useEffect, useCallback, useRef, useMemo } from 'react';
import { Trash2, RefreshCw } from 'lucide-react';
import { useStore } from '../store';
import { readHistory, clearHistory, readFile, isTauri } from '../utils/tauri';
import { renderMarkdown } from '../utils/markdown';
import clsx from 'clsx';

// ============================================================
// History Panel Component
// ============================================================

interface HistoryPanelProps {
  width: number;
}

const HistoryPanel: React.FC<HistoryPanelProps> = ({ width }) => {
  const historyContent = useStore((s) => s.historyContent);
  const setHistoryContent = useStore((s) => s.setHistoryContent);
  const openDocument = useStore((s) => s.openDocument);
  const contentRef = useRef<HTMLDivElement>(null);
  const [isLoading, setIsLoading] = React.useState(false);

  // Load history on mount and when panel becomes visible
  const loadHistory = useCallback(async () => {
    if (!isTauri()) return;

    setIsLoading(true);
    try {
      const content = await readHistory();
      setHistoryContent(content);
    } catch (error) {
      console.error('Failed to load history:', error);
      setHistoryContent('# History\n\nFailed to load history.');
    } finally {
      setIsLoading(false);
    }
  }, [setHistoryContent]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // Handle clear history
  const handleClear = useCallback(async () => {
    try {
      await clearHistory();
      await loadHistory();
    } catch (error) {
      console.error('Failed to clear history:', error);
    }
  }, [loadHistory]);

  // Render history markdown
  const renderedHtml = useMemo(() => {
    if (!historyContent) return '';
    try {
      const result = renderMarkdown(historyContent, '');
      return result.html;
    } catch (error) {
      console.error('Failed to render history:', error);
      return '<p>Failed to render history</p>';
    }
  }, [historyContent]);

  // Handle link clicks to open files
  useEffect(() => {
    const container = contentRef.current;
    if (!container) return;

    const handleClick = async (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const link = target.closest('a');

      if (link) {
        const href = link.getAttribute('href');
        // Check if it's a local file path (not http/https)
        if (href && !href.startsWith('http://') && !href.startsWith('https://')) {
          e.preventDefault();
          try {
            const content = await readFile(href);
            openDocument(href, content);
          } catch (error) {
            console.error('Failed to open file from history:', error);
          }
        }
      }
    };

    container.addEventListener('click', handleClick);
    return () => container.removeEventListener('click', handleClick);
  }, [openDocument, renderedHtml]);

  return (
    <aside className="history-panel" style={{ width }}>
      <div className="history-panel-header">
        <span className="history-panel-title">History</span>
        <div className="history-panel-actions">
          <button
            className={clsx('history-panel-action', isLoading && 'spinning')}
            onClick={loadHistory}
            title="Refresh history"
            disabled={isLoading}
          >
            <RefreshCw size={14} />
          </button>
          <button
            className="history-panel-action"
            onClick={handleClear}
            title="Clear history"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
      <div className="history-panel-content">
        <div
          ref={contentRef}
          className="history-panel-markdown markdown-body"
          dangerouslySetInnerHTML={{ __html: renderedHtml }}
        />
      </div>
    </aside>
  );
};

export default HistoryPanel;
