import React, { useEffect, useRef } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState, type Extension } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { indentWithTab } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { isMarkdownFile } from '../utils/files';
import { savedEditorStates as savedStates, setEditorFlush, getEditorFlush } from '../utils/editorRegistry';

// ============================================================
// Tuning
// ============================================================

/** Typing pause before the text goes to the store (dirty flag, preview). */
const CHANGE_DEBOUNCE = 300;
/** Editor font size at 100% document zoom (px). */
const BASE_FONT_SIZE = 13;

// ============================================================
// Look - everything through the app's CSS variables, so both themes work
// ============================================================

const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    color: 'var(--text-primary)',
    backgroundColor: 'var(--surface-bg)',
  },
  '.cm-scroller': {
    fontFamily: 'var(--font-mono)',
    lineHeight: '1.6',
  },
  '.cm-content': {
    caretColor: 'var(--text-primary)',
    padding: '12px 0',
  },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--text-primary)' },
  '&.cm-focused': { outline: 'none' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'var(--selected-bg)',
  },
  '.cm-activeLine': { backgroundColor: 'var(--hover-bg)' },
  '.cm-gutters': {
    backgroundColor: 'var(--surface-elevated)',
    color: 'var(--text-disabled)',
    border: 'none',
    borderRight: '1px solid var(--border-subtle)',
  },
  '.cm-activeLineGutter': { backgroundColor: 'var(--hover-bg)', color: 'var(--text-secondary)' },
  '.cm-foldPlaceholder': {
    backgroundColor: 'var(--surface-input)',
    border: 'none',
    color: 'var(--text-secondary)',
  },
  '.cm-searchMatch': { backgroundColor: 'rgba(234, 179, 8, 0.3)' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'rgba(245, 158, 11, 0.6)' },
  '.cm-selectionMatch': { backgroundColor: 'var(--active-bg)' },
  '.cm-matchingBracket': { outline: '1px solid var(--border-active)', backgroundColor: 'transparent' },
  '.cm-panels': {
    backgroundColor: 'var(--surface-elevated)',
    color: 'var(--text-primary)',
    borderColor: 'var(--border-default)',
  },
  '.cm-panels input, .cm-panels button, .cm-textfield, .cm-button': {
    backgroundColor: 'var(--surface-input)',
    backgroundImage: 'none',
    color: 'var(--text-primary)',
    border: '1px solid var(--border-default)',
    borderRadius: 'var(--radius-sm)',
  },
  '.cm-tooltip': {
    backgroundColor: 'var(--surface-overlay)',
    color: 'var(--text-primary)',
    border: '1px solid var(--border-default)',
  },
});

const markdownHighlight = HighlightStyle.define([
  { tag: tags.heading, color: 'var(--syntax-keyword)', fontWeight: 'bold' },
  { tag: tags.strong, fontWeight: 'bold' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: [tags.link, tags.url], color: 'var(--text-accent)' },
  { tag: tags.monospace, color: 'var(--syntax-string)' },
  { tag: tags.quote, color: 'var(--syntax-comment)', fontStyle: 'italic' },
  { tag: [tags.list, tags.contentSeparator], color: 'var(--syntax-number)' },
  { tag: [tags.processingInstruction, tags.meta], color: 'var(--text-secondary)' },
  { tag: tags.comment, color: 'var(--syntax-comment)' },
]);

interface EditorProps {
  path: string;
  content: string;
  zoom: number;
  onChange: (path: string, content: string) => void;
  onSave: () => void;
  /** Top visible source line (0-based) when the editor is scrolled. */
  onScrollLine?: (line: number) => void;
}

/**
 * CodeMirror source editor for the active document.
 */
const Editor: React.FC<EditorProps> = ({ path, content, zoom, onChange, onSave, onScrollLine }) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const pathRef = useRef(path);
  // Latest callbacks for the long-lived CodeMirror listeners
  const callbacks = useRef({ onChange, onSave, onScrollLine });
  callbacks.current = { onChange, onSave, onScrollLine };

  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>();
  /** Last text sent to the store - an equal `content` prop is our own echo. */
  const emittedRef = useRef<string | null>(null);

  const flush = () => {
    clearTimeout(timerRef.current);
    timerRef.current = undefined;
    const view = viewRef.current;
    if (!view) return;
    const text = view.state.doc.toString();
    if (text === emittedRef.current) return;
    emittedRef.current = text;
    callbacks.current.onChange(pathRef.current, text);
  };

  const createState = (docPath: string, doc: string): EditorState => {
    const extensions: Extension[] = [
      keymap.of([
        { key: 'Mod-s', preventDefault: true, run: () => { flush(); callbacks.current.onSave(); return true; } },
        indentWithTab,
      ]),
      syntaxHighlighting(markdownHighlight),
      basicSetup,
      editorTheme,
      EditorView.updateListener.of((update) => {
        if (!update.docChanged) return;
        clearTimeout(timerRef.current);
        timerRef.current = setTimeout(flush, CHANGE_DEBOUNCE);
      }),
    ];
    if (isMarkdownFile(docPath)) {
      extensions.push(markdown(), EditorView.lineWrapping);
    } else if (/\.(txt|text|log|fb2|rst|adoc|org|tex)$/i.test(docPath)) {
      extensions.push(EditorView.lineWrapping);
    }
    return EditorState.create({ doc, extensions });
  };

  // Create the view once
  useEffect(() => {
    if (!hostRef.current) return;
    const view = new EditorView({
      state: savedStates.get(path) ?? createState(path, content),
      parent: hostRef.current,
    });
    viewRef.current = view;
    emittedRef.current = view.state.doc.toString();
    setEditorFlush(flush);

    const handleScroll = () => {
      const block = view.lineBlockAtHeight(view.scrollDOM.scrollTop);
      callbacks.current.onScrollLine?.(view.state.doc.lineAt(block.from).number - 1);
    };
    view.scrollDOM.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      flush();
      savedStates.set(pathRef.current, view.state);
      view.scrollDOM.removeEventListener('scroll', handleScroll);
      view.destroy();
      viewRef.current = null;
      if (getEditorFlush() === flush) setEditorFlush(null);
    };
    // The view lives as long as the component; path/content changes are
    // handled by the effects below
  }, []);

  // Switching documents: keep the old state (undo, cursor), restore or create the new one
  useEffect(() => {
    const view = viewRef.current;
    if (!view || pathRef.current === path) return;
    flush();
    savedStates.set(pathRef.current, view.state);
    pathRef.current = path;
    const saved = savedStates.get(path);
    view.setState(saved && saved.doc.toString() === content ? saved : createState(path, content));
    emittedRef.current = view.state.doc.toString();
    // Only a path change switches documents; content changes are handled below
  }, [path]);

  // The document changed outside the editor (reloaded, workspace switch):
  // take the new text, unless it is just our own change coming back
  useEffect(() => {
    const view = viewRef.current;
    if (!view || content === emittedRef.current) return;
    if (content === view.state.doc.toString()) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: content } });
    emittedRef.current = content;
  }, [content]);

  // Follow the document zoom
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.style.fontSize = `${(BASE_FONT_SIZE * zoom) / 100}px`;
    viewRef.current?.requestMeasure();
  }, [zoom]);

  return <div ref={hostRef} className="editor-host" />;
};

export default Editor;
