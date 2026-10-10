import React, { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { FileQuestion, AlertCircle, Save } from 'lucide-react';
import { useStore } from '../store';
import { renderFile, renderMermaid, highlightCodeBlocks, unescapeHtml, type RenderResult } from '../utils/markdown';
import clsx from 'clsx';
import TabBar from './TabBar';
import FindBar from './FindBar';
import { pruneEditorStates } from '../utils/editorRegistry';

// CodeMirror is only loaded once edit mode is first used
const Editor = React.lazy(() => import('./Editor'));
import { getFileKind, getFileName } from '../utils/files';
import { saveActiveDocument } from '../utils/save';
import { useSmoothWheelScroll } from '../hooks/useSmoothWheelScroll';

// ============================================================
// Scroll Tuning Constants
// ============================================================

/** Debounce before a scroll offset is written to the (persisted) store. */
const SCROLL_SAVE_DELAY = 250;
/** How long a restore keeps re-applying the offset while content settles. */
const SCROLL_RESTORE_WINDOW = 1500;

// ============================================================
// Error Boundary Component
// ============================================================

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  onReset?: () => void;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('Document render error:', error, errorInfo);
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="render-error">
          <AlertCircle size={32} />
          <h3>Failed to render document</h3>
          <p>{this.state.error?.message || 'Unknown error'}</p>
          <button 
            onClick={() => {
              this.setState({ hasError: false, error: null });
              this.props.onReset?.();
            }}
          >
            Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

// ============================================================
// Debounce Utility
// ============================================================

function debounce<T extends (...args: unknown[]) => void>(
  fn: T, 
  delay: number
): T & { cancel: () => void } {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  
  const debounced = (...args: Parameters<T>) => {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
  
  debounced.cancel = () => {
    if (timeoutId) clearTimeout(timeoutId);
  };
  
  return debounced as T & { cancel: () => void };
}

// ============================================================
// Scroll Hooks
// ============================================================

/**
 * Remembers the scroll offset of every document.
 *
 * The scroll container is a single DOM node reused by all tabs, so switching
 * tabs has to explicitly stash the outgoing offset and re-apply the incoming
 * one. Offsets are keyed by path in the persisted store, which is what makes
 * them survive a restart as well.
 */
function useDocumentScroll(
  scrollRef: React.RefObject<HTMLDivElement>,
  path: string | null,
  ready: boolean
): void {
  const restoringRef = useRef(false);
  const pathRef = useRef<string | null>(null);
  const pendingRef = useRef<number | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopRestoreRef = useRef<(() => void) | null>(null);

  const flushSave = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const currentPath = pathRef.current;
    if (currentPath && pendingRef.current !== null) {
      useStore.getState().setScrollPosition(currentPath, pendingRef.current);
    }
    pendingRef.current = null;
  }, []);

  // Record the offset while scrolling (debounced: each write hits localStorage)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const handleScroll = () => {
      if (restoringRef.current) return;
      pendingRef.current = el.scrollTop;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(flushSave, SCROLL_SAVE_DELAY);
    };

    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', handleScroll);
      flushSave();
    };
  }, [scrollRef, flushSave, ready]);

  // Make sure the last position is stored when the window goes away
  useEffect(() => {
    const handleUnload = () => {
      const el = scrollRef.current;
      const currentPath = pathRef.current;
      if (el && currentPath && !restoringRef.current) {
        useStore.getState().setScrollPosition(currentPath, el.scrollTop);
      }
      flushSave();
    };

    window.addEventListener('beforeunload', handleUnload);
    return () => {
      window.removeEventListener('beforeunload', handleUnload);
      handleUnload();
    };
  }, [scrollRef, flushSave]);

  // Stash the outgoing document's offset, then restore the incoming one
  useEffect(() => {
    const el = scrollRef.current;
    const previousPath = pathRef.current;

    if (el && previousPath && previousPath !== path) {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      pendingRef.current = null;
      // The container still holds the previous document at this point
      useStore.getState().setScrollPosition(previousPath, el.scrollTop);
    }
    pathRef.current = path;

    stopRestoreRef.current?.();
    stopRestoreRef.current = null;

    if (!el || !path || !ready) return;

    const target = useStore.getState().getScrollPosition(path);
    const inner = el.firstElementChild;

    restoringRef.current = true;

    const applyTarget = () => {
      const max = Math.max(0, el.scrollHeight - el.clientHeight);
      const next = Math.min(target, max);
      if (Math.abs(el.scrollTop - next) > 0.5) {
        el.scrollTop = next;
      }
    };

    // Syntax highlighting, Mermaid and images all change the height after the
    // first paint - keep re-applying until the layout settles or the user acts.
    const observer = typeof ResizeObserver !== 'undefined' && inner
      ? new ResizeObserver(applyTarget)
      : null;

    const userEvents = ['wheel', 'keydown', 'mousedown', 'touchstart'] as const;
    let stopped = false;

    const stop = () => {
      if (stopped) return;
      stopped = true;
      clearTimeout(timer);
      observer?.disconnect();
      userEvents.forEach((name) => window.removeEventListener(name, stop));
      restoringRef.current = false;
    };

    const timer = setTimeout(stop, SCROLL_RESTORE_WINDOW);
    userEvents.forEach((name) => window.addEventListener(name, stop, { passive: true }));

    applyTarget();
    if (inner) observer?.observe(inner);
    stopRestoreRef.current = stop;

    return () => {
      stop();
      stopRestoreRef.current = null;
    };
  }, [scrollRef, path, ready]);
}

// ============================================================
// Empty State Component
// ============================================================

const EmptyState: React.FC = () => (
  <div className="document-empty">
    <FileQuestion size={64} className="document-empty-icon" aria-hidden="true" />
    <h2 className="document-empty-title">No Document Open</h2>
    <p className="document-empty-subtitle">
      Select a markdown file from the sidebar, or drop one on this window
    </p>
    <p className="document-empty-hint">
      <kbd>Ctrl</kbd>+<kbd>P</kbd> to quick open a file
    </p>
  </div>
);

// ============================================================
// Markdown Viewer Component
// ============================================================

interface MarkdownViewerProps {
  content: string;
  documentPath: string;
  onHeadingsExtracted?: (headings: RenderResult['headings']) => void;
}

const MarkdownViewer: React.FC<MarkdownViewerProps> = ({
  content,
  documentPath,
  onHeadingsExtracted,
}) => {
  const zoom = useStore((s) => s.zoom);
  const setActiveHeadingId = useStore((s) => s.setActiveHeadingId);
  const languageAliases = useStore((s) => s.languageAliases);
  const theme = useStore((s) => s.theme);
  const markdownTextColor = useStore((s) =>
    s.theme === 'light' ? s.markdownTextColorLight : s.markdownTextColor);
  const containerRef = useRef<HTMLDivElement>(null);
  const headingOffsetsRef = useRef<{ id: string; top: number }[] | null>(null);
  const [html, setHtml] = useState('');
  // Committed together with `html`, so the DOM says which document it shows
  // (the find bar must not resolve a jump against the previous document)
  const [renderedPath, setRenderedPath] = useState('');
  const [renderKey, setRenderKey] = useState(0);
  
  // Compute the base directory path for resolving relative image paths
  const basePath = useMemo(() => {
    const sep = documentPath.includes('\\') ? '\\' : '/';
    const lastSep = documentPath.lastIndexOf(sep);
    return lastSep >= 0 ? documentPath.substring(0, lastSep) : '';
  }, [documentPath]);

  // Render markdown when content changes
  useEffect(() => {
    try {
      const result = renderFile(documentPath, content, basePath);
      setHtml(result.html);
      setRenderedPath(documentPath);
      onHeadingsExtracted?.(result.headings);
      headingOffsetsRef.current = null; // Reset cached heading positions
      setRenderKey(k => k + 1); // Force re-render of mermaid
    } catch (error) {
      console.error('Markdown render error:', error);
      setHtml(`<div class="render-error">Failed to render markdown</div>`);
      setRenderedPath(documentPath);
    }
  }, [content, basePath, documentPath, onHeadingsExtracted]);
  
  // Render Mermaid diagrams after HTML is set - and again in the new colors
  // when the theme changes
  useEffect(() => {
    if (!containerRef.current || !html) return;

    renderMermaid(containerRef.current, theme).catch(error => {
      console.error('Mermaid render error:', error);
    });
  }, [html, renderKey, theme]);

  // Highlight code blocks after HTML is set (both themes at once, see
  // highlightCode - no re-run on theme change)
  useEffect(() => {
    if (!containerRef.current || !html) return;

    const container = containerRef.current;

    // Apply syntax highlighting to code blocks with language aliases
    highlightCodeBlocks(container, languageAliases).catch(error => {
      console.error('Code highlighting error:', error);
    });

  }, [html, renderKey, languageAliases]);
  
  // Event delegation for copy buttons (FIX: Memory leak)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    
    const handleClick = async (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      
      // Check if it's a copy button
      if (target.classList.contains('code-block-copy')) {
        const code = target.getAttribute('data-code');
        if (code) {
          try {
            const decoded = unescapeHtml(code);
            await navigator.clipboard.writeText(decoded);
            
            const originalText = target.textContent;
            target.textContent = 'Copied!';
            target.classList.add('copied');
            
            setTimeout(() => {
              target.textContent = originalText;
              target.classList.remove('copied');
            }, 2000);
          } catch (err) {
            console.error('Failed to copy:', err);
            target.textContent = 'Failed';
            setTimeout(() => {
              target.textContent = 'Copy';
            }, 2000);
          }
        }
      }
    };
    
    container.addEventListener('click', handleClick);
    
    return () => {
      container.removeEventListener('click', handleClick);
    };
  }, [html]);
  
  // Debounced scroll handler for active heading tracking.
  // Heading positions are measured once per layout and cached, so scrolling
  // never forces a synchronous layout per heading.
  const debouncedScrollHandler = useMemo(
    () => debounce(() => {
      const container = containerRef.current;
      const scrollContainer = container?.closest('.document-content') as HTMLElement | null;
      if (!container || !scrollContainer) return;

      if (!headingOffsetsRef.current) {
        const containerTop = scrollContainer.getBoundingClientRect().top;
        const scrollTop = scrollContainer.scrollTop;
        headingOffsetsRef.current = Array.from(
          container.querySelectorAll('h1, h2, h3, h4, h5, h6')
        ).map((heading) => ({
          id: heading.id,
          top: heading.getBoundingClientRect().top - containerTop + scrollTop,
        }));
      }

      const offsets = headingOffsetsRef.current;
      if (!offsets.length) return;

      const threshold = scrollContainer.scrollTop + 100; // pixels from top
      let activeId: string | null = null;

      for (const heading of offsets) {
        if (heading.top <= threshold) {
          activeId = heading.id;
        } else {
          break;
        }
      }

      setActiveHeadingId(activeId);
    }, 50),
    [setActiveHeadingId]
  );
  
  // Track active heading on scroll
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    
    const scrollContainer = container.closest('.document-content');
    if (!scrollContainer) return;
    
    scrollContainer.addEventListener('scroll', debouncedScrollHandler, { passive: true });
    debouncedScrollHandler(); // Initial check
    
    return () => {
      scrollContainer.removeEventListener('scroll', debouncedScrollHandler);
      debouncedScrollHandler.cancel();
    };
  }, [html, debouncedScrollHandler]);
  
  // Invalidate cached heading positions whenever the rendered size changes
  // (late Mermaid/Shiki output, images, zoom, panel resize).
  useEffect(() => {
    const container = containerRef.current;
    headingOffsetsRef.current = null;
    if (!container || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(() => {
      headingOffsetsRef.current = null;
    });
    observer.observe(container);

    return () => observer.disconnect();
  }, [html, documentPath, zoom]);
  
  return (
    <div
      ref={containerRef}
      className="markdown-body"
      data-rendered-path={renderedPath}
      style={{
        // Use CSS zoom for better scaling of all content including images
        zoom: zoom / 100,
        '--text-primary': markdownTextColor,
      } as React.CSSProperties}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
};

// ============================================================
// Unsaved Changes Modal
// ============================================================

const UnsavedChangesModal: React.FC = () => {
  const showUnsavedModal = useStore((s) => s.showUnsavedModal);
  const pendingCloseTabId = useStore((s) => s.pendingCloseTabId);
  const tabs = useStore((s) => s.tabs);
  const confirmCloseDocument = useStore((s) => s.confirmCloseDocument);
  const cancelCloseDocument = useStore((s) => s.cancelCloseDocument);
  
  if (!showUnsavedModal || !pendingCloseTabId) return null;
  
  const tab = tabs.find(t => t.id === pendingCloseTabId);
  
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal">
        <h2>Unsaved Changes</h2>
        <p>
          "{tab?.title}" has unsaved changes. Do you want to close it anyway?
        </p>
        <div className="modal-actions">
          <button 
            className="modal-btn modal-btn-secondary"
            onClick={cancelCloseDocument}
          >
            Cancel
          </button>
          <button 
            className="modal-btn modal-btn-danger"
            onClick={confirmCloseDocument}
          >
            Close Without Saving
          </button>
        </div>
      </div>
    </div>
  );
};

// ============================================================
// Document Panel Component
// ============================================================

interface DocumentPanelProps {
  onHeadingsChange?: (headings: RenderResult['headings']) => void;
}

const DocumentPanel: React.FC<DocumentPanelProps> = ({ onHeadingsChange }) => {
  // Narrow subscriptions: scrolling must not re-render the whole app
  const activePath = useStore((s) => s.tabs.find((t) => t.id === s.activeTabId)?.path ?? null);
  const content = useStore((s) => (activePath ? s.documents[activePath]?.content : undefined));
  const zoom = useStore((s) => s.zoom);
  const smoothScroll = useStore((s) => s.smoothScroll);
  const editMode = useStore((s) => s.editMode);
  const isDirty = useStore((s) => (activePath ? s.documents[activePath]?.isDirty ?? false : false));
  const openPathsKey = useStore((s) => s.tabs.map((t) => t.path).join('\n'));
  const updateDocumentContent = useStore((s) => s.updateDocumentContent);

  const scrollRef = useRef<HTMLDivElement>(null);
  const hasDocument = activePath !== null && content !== undefined;

  // Edit mode: markdown and fb2 get the editor next to a live preview; for
  // code and plain text the preview would repeat the editor, so it is hidden
  const kind = activePath ? getFileKind(activePath).kind : 'markdown';
  const showEditor = editMode && hasDocument;
  const showPreview = hasDocument && (!showEditor || kind === 'markdown' || kind === 'fb2');

  useDocumentScroll(scrollRef, activePath, showPreview);
  useSmoothWheelScroll(scrollRef, smoothScroll, showPreview);

  // Editor states (undo history) of closed documents are dropped
  useEffect(() => {
    pruneEditorStates(openPathsKey ? openPathsKey.split('\n') : []);
  }, [openPathsKey]);

  // Editor -> preview scroll sync: show the block at the editor's top line
  const syncFrameRef = useRef(0);
  const handleEditorScrollLine = useCallback((line: number) => {
    cancelAnimationFrame(syncFrameRef.current);
    syncFrameRef.current = requestAnimationFrame(() => {
      const container = scrollRef.current;
      if (!container) return;
      let target: HTMLElement | null = null;
      let targetLine = -1;
      container.querySelectorAll<HTMLElement>('[data-line]').forEach((el) => {
        const elLine = Number(el.dataset.line);
        if (elLine <= line && elLine > targetLine) {
          target = el;
          targetLine = elLine;
        }
      });
      if (!target) {
        container.scrollTop = 0;
        return;
      }
      const offset = (target as HTMLElement).getBoundingClientRect().top - container.getBoundingClientRect().top;
      container.scrollTop += offset - 8;
    });
  }, []);
  
  const handleHeadingsExtracted = useCallback((headings: RenderResult['headings']) => {
    onHeadingsChange?.(headings);
  }, [onHeadingsChange]);
  
  const handleErrorReset = useCallback(() => {
    // Could trigger a re-fetch of the document here
    console.log('Resetting document render');
  }, []);
  
  return (
    <main className="document-panel">
      <TabBar />
      {showPreview && <FindBar scrollRef={scrollRef} activePath={activePath} />}
      
      {hasDocument ? (
        <div className={clsx('document-body', showEditor && showPreview && 'split')}>
        {showEditor && (
          <div className="editor-pane">
            <div className="editor-header">
              <span className="editor-header-title" title={activePath as string}>
                {getFileName(activePath as string)}
              </span>
              <span className={clsx('editor-header-status', isDirty && 'dirty')}>
                {isDirty ? 'Unsaved changes' : 'Saved'}
              </span>
              <button
                className="editor-save-button"
                onClick={() => saveActiveDocument()}
                disabled={!isDirty}
                title="Save (Ctrl+S)"
                type="button"
              >
                <Save size={13} /> Save
              </button>
            </div>
            <React.Suspense fallback={<div className="editor-host editor-loading">Loading editor…</div>}>
              <Editor
                path={activePath as string}
                content={content as string}
                zoom={zoom}
                onChange={updateDocumentContent}
                onSave={() => saveActiveDocument()}
                onScrollLine={showPreview ? handleEditorScrollLine : undefined}
              />
            </React.Suspense>
          </div>
        )}
        {showPreview && (
        <div
          className="document-content"
          ref={scrollRef}
          // Zoom widens the text column (up to the viewport) instead of only
          // scaling glyphs inside a fixed-width column.
          style={{ '--zoom-factor': zoom / 100 } as React.CSSProperties}
        >
          <div className="document-content-inner">
            <ErrorBoundary 
              onReset={handleErrorReset}
              fallback={
                <div className="render-error">
                  <AlertCircle size={32} />
                  <h3>Failed to render document</h3>
                  <p>There was an error rendering this markdown file.</p>
                </div>
              }
            >
              <MarkdownViewer
                content={content as string}
                documentPath={activePath as string}
                onHeadingsExtracted={handleHeadingsExtracted}
              />
            </ErrorBoundary>
          </div>
        </div>
        )}
        </div>
      ) : (
        <EmptyState />
      )}
      
      <UnsavedChangesModal />
    </main>
  );
};

export default DocumentPanel;
