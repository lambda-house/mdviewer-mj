import React, { useEffect, useRef, useCallback, useState, useMemo, type ReactNode } from 'react';
import { FileQuestion, AlertCircle, Save, ImageOff, FileDiff } from 'lucide-react';
import { EmptyState as UiEmptyState, useSmoothWheelScroll } from '@lambda-house/ui';
import clsx from 'clsx';
import { useReader, useReaderContext, type ReaderHost } from './host';
import { MAIN_GROUP, activeTabOf, allTabs, editorGroupFor, type ReaderStore } from './store';
import { renderFile, renderMermaid, highlightCodeBlocks, loadRemoteImages, type RenderResult } from './markdown';
import TabBar from './TabBar';
import FindBar from './FindBar';
import { pruneEditorStates } from './editorRegistry';
import { getFileKind, getFileName, resolveLinkPath } from './files';
import { saveActiveDocument } from './save';
import { holdScroll } from './scrollHold';
import { applyScrollPosition, captureScrollPosition } from './scrollAnchor';
import { CHANGED_CLASS, diffContent, formatAge, markChangedBlocks } from './changes';

// CodeMirror is only loaded once edit mode is first used
const Editor = React.lazy(() => import('./Editor'));

// ============================================================
// Scroll Tuning Constants
// ============================================================

/** Debounce before a scroll offset is written to the (persisted) store. */
const SCROLL_SAVE_DELAY = 250;
/** Longest a restore keeps the saved text in place while late output (Mermaid,
 *  highlighting, images) changes the layout; any scroll, click or key ends it. */
const SCROLL_RESTORE_WINDOW = 10000;

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

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
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
 * Remembers the scroll position of every document, anchored to the text at
 * the top of the view (`utils/scrollAnchor.ts`).
 *
 * The scroll container is a single DOM node reused by all tabs, so switching
 * tabs has to explicitly stash the outgoing position and re-apply the incoming
 * one. Positions are keyed by path in the persisted store, which is what makes
 * them survive a restart as well.
 */
function useDocumentScroll(
  store: ReaderStore,
  group: string,
  scrollRef: React.RefObject<HTMLDivElement | null>,
  path: string | null,
  ready: boolean
): void {
  const restoringRef = useRef(false);
  const pathRef = useRef<string | null>(null);
  /** Pixel offset of an unsaved scroll; the anchor is taken when saving. */
  const pendingRef = useRef<number | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopRestoreRef = useRef<(() => void) | null>(null);

  const flushSave = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const el = scrollRef.current;
    const currentPath = pathRef.current;
    if (currentPath && pendingRef.current !== null) {
      // An unmounting container can't be measured any more: keep the offset
      store.getState().setScrollPosition(
        group,
        currentPath,
        el?.isConnected ? captureScrollPosition(el) : pendingRef.current
      );
    }
    pendingRef.current = null;
  }, [store, group, scrollRef]);

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
      if (el?.isConnected && currentPath && !restoringRef.current) {
        store.getState().setScrollPosition(group, currentPath, captureScrollPosition(el));
        pendingRef.current = null;
      }
      flushSave();
    };

    window.addEventListener('beforeunload', handleUnload);
    return () => {
      window.removeEventListener('beforeunload', handleUnload);
      handleUnload();
    };
  }, [store, group, scrollRef, flushSave]);

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
      store.getState().setScrollPosition(group, previousPath, captureScrollPosition(el));
    }
    pathRef.current = path;

    stopRestoreRef.current?.();
    stopRestoreRef.current = null;

    if (!el || !path || !ready) return;

    const target = store.getState().getScrollPosition(group, path);
    const inner = el.firstElementChild;

    restoringRef.current = true;

    // Until the new document has rendered, the container still shows the
    // previous one, which has blocks with the same line numbers
    const applyTarget = () => {
      if (el.querySelector('.markdown-body')?.getAttribute('data-rendered-path') !== path) return;
      applyScrollPosition(el, target);
    };
    // Its arrival need not change the height, so watch for it as well
    const renderObserver = new MutationObserver(applyTarget);
    renderObserver.observe(el, { subtree: true, attributes: true, attributeFilter: ['data-rendered-path'] });

    // Keep the saved text in place while the layout changes (re-applied on
    // every resize, before it is painted) until the user acts, a find jump
    // takes over or the window ends
    const stop = holdScroll(el, inner, applyTarget, SCROLL_RESTORE_WINDOW, () => {
      renderObserver.disconnect();
      restoringRef.current = false;
    });
    stopRestoreRef.current = stop;

    return () => {
      stop();
      stopRestoreRef.current = null;
    };
  }, [store, group, scrollRef, path, ready]);
}

// ============================================================
// Empty State Component
// ============================================================

const EmptyState: React.FC = () => (
  <UiEmptyState size="lg" icon={<FileQuestion size={64} />} title="No Document Open" />
);

// ============================================================
// Markdown Viewer Component
// ============================================================

/** Documents whose remote images the user loaded this session. */
const remoteImageDocuments = new Set<string>();

interface MarkdownViewerProps {
  group: string;
  content: string;
  documentPath: string;
  onHeadingsExtracted?: (headings: RenderResult['headings']) => void;
}

/** Tracked reads without a host that tracks them: never. */
const useNeverTracked = (_path: string) => false;

export const MarkdownViewer: React.FC<MarkdownViewerProps> = ({
  group,
  content,
  documentPath,
  onHeadingsExtracted,
}) => {
  const { store, host } = useReaderContext();
  const zoom = useReader((s) => s.groups[group]?.zoom ?? 100);
  const setActiveHeadingId = useCallback((id: string | null) => store.getState().setActiveHeadingId(id, group), [store, group]);
  const languageAliases = useReader((s) => s.settings.languageAliases);
  const theme = useReader((s) => s.theme);
  const markdownTextColor = useReader((s) =>
    s.theme === 'light' ? s.settings.markdownTextColorLight : s.settings.markdownTextColor);
  const alwaysLoadRemoteImages = useReader((s) => s.settings.loadRemoteImages);
  const setLoadRemoteImages = (value: boolean) => store.getState().setSettings({ loadRemoteImages: value });
  const containerRef = useRef<HTMLDivElement>(null);
  const headingOffsetsRef = useRef<{ id: string; top: number }[] | null>(null);
  const [html, setHtml] = useState('');
  const [blockedImages, setBlockedImages] = useState(0);
  const [remoteImagesLoaded, setRemoteImagesLoaded] = useState(0);
  // Tracked documents (agent files): what changed since the person last read it
  const changesHost: ReaderHost['changes'] = host.changes;
  const useIsTracked = changesHost?.useIsTracked ?? useNeverTracked;
  const isAgentDocument = useIsTracked(documentPath);
  const [changes, setChanges] = useState<{ blocks: HTMLElement[]; readAt: number } | null>(null);
  const changeIndexRef = useRef(-1);
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
      store.getState().setHeadings(result.headings, group);
      onHeadingsExtracted?.(result.headings);
      headingOffsetsRef.current = null; // Reset cached heading positions
      setRenderKey(k => k + 1); // Force re-render of mermaid
    } catch (error) {
      console.error('Markdown render error:', error);
      setHtml(`<div class="render-error">Failed to render markdown</div>`);
      setRenderedPath(documentPath);
    }
  }, [content, basePath, documentPath, onHeadingsExtracted, store, group]);
  
  // Remote images: loaded when allowed, otherwise counted for the notice
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !html) {
      setBlockedImages(0);
      return;
    }
    if (alwaysLoadRemoteImages || remoteImageDocuments.has(documentPath)) {
      loadRemoteImages(container);
      setBlockedImages(0);
    } else {
      setBlockedImages(container.querySelectorAll('span.remote-image').length);
    }
  }, [html, documentPath, alwaysLoadRemoteImages, remoteImagesLoaded]);

  // Compare with the copy kept when the document was last read. Runs once the
  // new HTML is in the DOM (`content` is what produced it).
  useEffect(() => {
    const container = containerRef.current;
    setChanges(null);
    if (!container || !html || !isAgentDocument || !changesHost) return;
    let cancelled = false;
    changesHost.readSnapshot(documentPath)
      .then((snapshot) => {
        if (cancelled || !snapshot || snapshot.content === content) return;
        const blocks = markChangedBlocks(container, diffContent(snapshot.content, content));
        changeIndexRef.current = -1;
        setChanges(blocks.length > 0 ? { blocks, readAt: snapshot.readAt } : null);
      })
      .catch((error) => console.error('Failed to compare with the last read:', error));
    return () => {
      cancelled = true;
    };
  }, [html, documentPath, isAgentDocument, changesHost]); // not `content`: it changes before the HTML does

  // Leaving a tracked document counts as having read it
  useEffect(() => {
    if (!isAgentDocument || !changesHost) return;
    return () => {
      changesHost.markRead([documentPath]).catch((error) => console.error('Failed to save read state:', error));
    };
  }, [documentPath, isAgentDocument, changesHost]);

  const showNextChange = useCallback(() => {
    if (!changes) return;
    changeIndexRef.current = (changeIndexRef.current + 1) % changes.blocks.length;
    changes.blocks[changeIndexRef.current].scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [changes]);

  const markDocumentRead = useCallback(() => {
    containerRef.current?.querySelectorAll(`.${CHANGED_CLASS}`).forEach((el) => el.classList.remove(CHANGED_CLASS));
    setChanges(null);
    changesHost?.markRead([documentPath]).catch((error) => console.error('Failed to save read state:', error));
  }, [documentPath, changesHost]);

  const loadImagesForDocument = useCallback(() => {
    remoteImageDocuments.add(documentPath);
    setRemoteImagesLoaded((n) => n + 1);
  }, [documentPath]);

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
        // getAttribute returns the code already decoded
        const code = target.getAttribute('data-code');
        if (code) {
          try {
            await navigator.clipboard.writeText(code);
            
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
    <>
    {changes && (
      <div className="remote-images-notice changes-notice" role="status">
        <FileDiff size={14} aria-hidden="true" />
        <span>
          {changes.blocks.length === 1 ? '1 place' : `${changes.blocks.length} places`} changed since you
          read it {formatAge(changes.readAt)}
        </span>
        <button type="button" onClick={showNextChange}>Next change</button>
        <button type="button" onClick={markDocumentRead}>Mark as read</button>
      </div>
    )}
    {blockedImages > 0 && (
      <div className="remote-images-notice" role="status">
        <ImageOff size={14} aria-hidden="true" />
        <span>
          {blockedImages === 1 ? '1 image from the web was' : `${blockedImages} images from the web were`} not loaded
        </span>
        <button type="button" onClick={loadImagesForDocument}>Load images</button>
        <button type="button" onClick={() => setLoadRemoteImages(true)}>Always load</button>
      </div>
    )}
    <div
      ref={containerRef}
      className="markdown-body"
      data-rendered-path={renderedPath}
      style={{
        // Use CSS zoom for better scaling of all content including images
        zoom: zoom / 100,
        '--text': markdownTextColor,
      } as React.CSSProperties}
      dangerouslySetInnerHTML={{ __html: html }}
      // The notice is at the top, out of view in a long document: a
      // placeholder loads the images too
      onClick={(e) => {
        if ((e.target as Element).closest?.('span.remote-image')) loadImagesForDocument();
      }}
    />
    </>
  );
};


// ============================================================
// Document Panel Component
// ============================================================

export interface DocumentPanelProps {
  /** The document group shown (a `documents` pane's key). */
  group?: string;
  /** What an empty group says: how to open a document in this app. */
  empty?: ReactNode;
  onHeadingsChange?: (headings: RenderResult['headings']) => void;
}

/** Errors opening a link, for the person. */
function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return String(error);
}

/**
 * A document group: its tabs, find bar, the shown document and its editor.
 */
export const DocumentPanel: React.FC<DocumentPanelProps> = ({ group = MAIN_GROUP, empty, onHeadingsChange }) => {
  const reader = useReaderContext();
  const { store, host } = reader;
  // Narrow subscriptions: scrolling must not re-render the whole app
  const activePath = useReader((s) => activeTabOf(s.groups[group])?.path ?? null);
  const content = useReader((s) => (activePath ? s.documents[activePath]?.content : undefined));
  const zoom = useReader((s) => s.groups[group]?.zoom ?? 100);
  const smoothScroll = useReader((s) => s.settings.smoothScroll);
  const editMode = useReader((s) => s.editMode);
  const isDirty = useReader((s) => (activePath ? s.documents[activePath]?.isDirty ?? false : false));
  const openPathsKey = useReader((s) => allTabs(s).map((t) => t.path).join('\n'));
  const updateDocumentContent = useReader((s) => s.updateDocumentContent);
  // A file shown in several groups is edited in one of them (the focused one, if it shows it)
  const editsHere = useReader((s) => (activePath ? editorGroupFor(s, activePath) === group : false));

  const scrollRef = useRef<HTMLDivElement>(null);
  const hasDocument = activePath !== null && content !== undefined;

  // Edit mode: markdown and fb2 get the editor next to a live preview; for
  // code and plain text the preview would repeat the editor, so it is hidden
  const kind = activePath ? getFileKind(activePath).kind : 'markdown';
  const showEditor = editMode && hasDocument && editsHere;
  const showPreview = hasDocument && (!showEditor || kind === 'markdown' || kind === 'fb2');

  useDocumentScroll(store, group, scrollRef, activePath, showPreview);
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
  
  // Links in the document. The window itself never navigates (the backend
  // blocks it): anchors scroll, web and mail links open in the default browser,
  // links to local files open in a tab (or are revealed if not viewable), after
  // a confirmation when they're outside what the person opened. A relative
  // link resolves against the document it is in.
  const handleLinkClick = useCallback(async (e: React.MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0) return;
    const link = (e.target as HTMLElement).closest?.('.markdown-body a[href]');
    if (!link) return;
    const href = link.getAttribute('href') ?? '';
    e.preventDefault();

    if (href.startsWith('#')) {
      let id = href.slice(1);
      try {
        id = decodeURIComponent(id);
      } catch {
        // Malformed escape: use the id as written
      }
      link.closest('.markdown-body')?.querySelector(`[id="${CSS.escape(id)}"]`)?.scrollIntoView({ behavior: 'smooth' });
      return;
    }

    try {
      if (/^(https?|mailto):/i.test(href)) {
        await host.openExternal(href);
        return;
      }
      if (/^[a-z][a-z0-9+.-]*:/i.test(href) && !/^file:/i.test(href) && !/^[A-Za-z]:[\\/]/.test(href)) {
        return; // other schemes (javascript:, data:, ...) are ignored
      }
      const documentPath = link.closest('.markdown-body')?.getAttribute('data-rendered-path');
      if (!documentPath) return;
      const path = resolveLinkPath(href, documentPath);
      if ((await host.followLocalLink(path)) === 'open') {
        store.getState().focusGroup(group);
        await host.openPath(path);
      }
    } catch (error) {
      console.error('Failed to open link:', href, error);
      alert(`Could not open ${href}:\n${errorText(error)}`);
    }
  }, [host, store, group]);

  const handleErrorReset = useCallback(() => {
    // Could trigger a re-fetch of the document here
    console.log('Resetting document render');
  }, []);
  
  return (
    <main
      className="document-panel"
      data-group={group}
      onPointerDownCapture={() => store.getState().focusGroup(group)}
      onFocusCapture={() => store.getState().focusGroup(group)}
      onClick={handleLinkClick}
    >
      <TabBar group={group} />
      {showPreview && <FindBar group={group} scrollRef={scrollRef} activePath={activePath} />}
      
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
                onClick={() => saveActiveDocument(reader, group)}
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
                onSave={() => saveActiveDocument(reader, group)}
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
                group={group}
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
        empty ?? <EmptyState />
      )}
    </main>
  );
};
