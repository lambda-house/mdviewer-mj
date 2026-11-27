import React, { useEffect, useCallback, useRef, useMemo } from 'react';
import { Trash2, RefreshCw } from 'lucide-react';
import { Button } from '@lambda-house/ui';
import { Pane } from '@lambda-house/workbench';
import { useStore } from '../store';
import { readHistory, clearHistory, readFile, isTauri } from '../utils/tauri';
import { renderMarkdown } from '@lambda-house/reader';
import { useReader } from '../reader';

// ============================================================
// History Panel Component
// ============================================================

const HistoryPanel: React.FC = () => {
  const historyContent = useStore((s) => s.historyContent);
  const setHistoryContent = useStore((s) => s.setHistoryContent);
  const openDocument = useReader((s) => s.openDocument);
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
          // Paths are percent-encoded in history.md (spaces, parentheses...)
          let path = href;
          try {
            path = decodeURIComponent(href);
          } catch {
            // Malformed escape: use the link as written
          }
          try {
            const content = await readFile(path);
            openDocument(path, content);
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
    <Pane
      as="aside"
      className="history-panel"
      title="History"
      tools={<>
        <Button variant="ghost" size="xs" icon={<RefreshCw size={16} />} onClick={loadHistory} title="Refresh history" aria-label="Refresh history" disabled={isLoading} busy={isLoading} />
        <Button variant="ghost" size="xs" icon={<Trash2 size={16} />} onClick={handleClear} title="Clear history" aria-label="Clear history" />
      </>}
    >
      <div className="history-panel-content">
        <div
          ref={contentRef}
          className="history-panel-markdown markdown-body"
          dangerouslySetInnerHTML={{ __html: renderedHtml }}
        />
      </div>
    </Pane>
  );
};

export default HistoryPanel;
