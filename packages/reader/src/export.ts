import type { Reader } from './host';
import { escapeHtml, fileToMarkdown, loadRemoteImages } from './markdown';
import { flushEditorChanges } from './editorRegistry';
import { activeTabOf, focusedGroupOf } from './store';

export type ExportFormat = 'markdown' | 'html';

/** Export palette per theme (the app's own variables are not in the file). */
const EXPORT_PALETTE = {
  dark: `
      --canvas: #1e1e1e;
      --surface-1: #252526;
      --surface-2: #2d2d30;
      --line: #3c3c3c;
      --line-subtle: #2d2d30;
      --text: #cccccc;
      --text-muted: #858585;
      --accent: #4fc1ff;
      --selected: #094771;`,
  light: `
      --canvas: #ffffff;
      --surface-1: #f3f3f3;
      --surface-2: #f7f7f7;
      --line: #d0d0d0;
      --line-subtle: #e4e4e4;
      --text: #1f1f1f;
      --text-muted: #6a6a6a;
      --accent: #005fb8;
      --selected: #cce4f7;`,
};

// Generate complete HTML document for export, in the current theme.
// `content` is serialized DOM (already HTML); `title` is a file name.
function generateExportHtml(title: string, content: string, theme: 'dark' | 'light'): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    :root {${EXPORT_PALETTE[theme]}
      color-scheme: ${theme};
      --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      --font-mono: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
    }

    body {
      font-family: var(--font-sans);
      font-size: 14px;
      line-height: 1.7;
      color: var(--text);
      background-color: var(--canvas);
      max-width: 800px;
      margin: 0 auto;
      padding: 32px 48px;
      -webkit-font-smoothing: antialiased;
    }

    h1, h2, h3, h4, h5, h6 {
      margin-top: 1.5em;
      margin-bottom: 0.5em;
      font-weight: 600;
      line-height: 1.3;
    }

    h1 { font-size: 32px; padding-bottom: 0.3em; border-bottom: 1px solid var(--line-subtle); }
    h2 { font-size: 24px; padding-bottom: 0.3em; border-bottom: 1px solid var(--line-subtle); }
    h3 { font-size: 18px; }
    h4 { font-size: 16px; }

    h1:first-child, h2:first-child, h3:first-child { margin-top: 0; }

    p { margin: 1em 0; }

    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }

    code {
      font-family: var(--font-mono);
      font-size: 0.9em;
      padding: 0.2em 0.4em;
      background: var(--surface-2);
      border-radius: 3px;
    }

    pre {
      margin: 1em 0;
      padding: 16px;
      background: var(--surface-2);
      border-radius: 6px;
      overflow-x: auto;
    }

    pre code {
      padding: 0;
      background: none;
      font-size: 12px;
      line-height: 1.6;
    }

    blockquote {
      margin: 1em 0;
      padding: 0.5em 1em;
      border-left: 4px solid #007acc;
      background: var(--surface-1);
      color: var(--text-muted);
    }

    ul, ol { margin: 1em 0; padding-left: 2em; }
    li { margin: 0.5em 0; }

    table { width: 100%; margin: 1em 0; border-collapse: collapse; }
    th, td { padding: 10px 16px; border: 1px solid var(--line); text-align: left; }
    th { background: var(--surface-1); font-weight: 600; }
    tr:nth-child(even) { background: var(--surface-1); }

    img { max-width: 100%; height: auto; border-radius: 6px; }
    hr { margin: 2em 0; border: none; border-top: 1px solid var(--line); }

    .code-block-wrapper { position: relative; margin: 1em 0; }
    .code-block-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 16px;
      background: #3c3c3c;
      border-radius: 6px 6px 0 0;
      border-bottom: 1px solid var(--line-subtle);
    }
    .code-block-language {
      font-size: 11px;
      font-weight: 500;
      text-transform: uppercase;
      color: var(--text-muted);
    }
    .code-block-copy { display: none; }
    .code-block-wrapper pre { margin: 0; border-radius: 0 0 6px 6px; }

    /* Mermaid diagrams */
    .mermaid-container {
      margin: 1em 0;
      background: var(--surface-2);
      border-radius: 6px;
      padding: 16px;
      overflow-x: auto;
    }
    .mermaid-viewport {
      display: flex;
      justify-content: center;
    }
    .mermaid-content {
      display: flex;
      justify-content: center;
    }
    .mermaid-content svg {
      max-width: 100%;
      height: auto;
    }
    .mermaid-controls,
    .mermaid-hint,
    .mermaid-raw { display: none; }
    /* Shiki output carries both themes as CSS variables */
    .shiki span {
      color: var(--shiki-${theme});
      font-style: var(--shiki-${theme}-font-style);
      font-weight: var(--shiki-${theme}-font-weight);
      text-decoration: var(--shiki-${theme}-text-decoration);
    }
  </style>
</head>
<body>
  <article class="markdown-body">
    ${content}
  </article>
</body>
</html>`;
}

/** One export at a time: a second save dialog on top of the first helps nobody. */
let exporting = false;

/**
 * Save a copy of the active document where the user chooses: as a standalone
 * HTML page (what is rendered, in the current theme) or as markdown (with
 * unsaved edits). Failures are shown to the user.
 */
export async function exportActiveDocument(reader: Reader, format: ExportFormat): Promise<void> {
  const state = reader.store.getState();
  const group = focusedGroupOf(state);
  const tab = activeTabOf(group);
  if (!tab || exporting) return;

  const label = format === 'html' ? 'HTML' : 'Markdown';
  const baseName = tab.title.replace(/\.(md|markdown|fb2)$/i, '');

  exporting = true;
  try {
    if (format === 'html') {
      // Get rendered HTML from the actual DOM (includes syntax highlighting & mermaid):
      // the focused group's (a history or other panel can be a .markdown-body too)
      const markdownBody = document.querySelector(`.document-panel[data-group="${CSS.escape(group.id)}"] .markdown-body`);
      if (!markdownBody) {
        alert('No document content to export');
        return;
      }
      // The exported page shows the remote images that are still placeholders here
      const exported = markdownBody.cloneNode(true) as HTMLElement;
      loadRemoteImages(exported);
      const htmlContent = generateExportHtml(tab.title, exported.innerHTML, state.theme);

      await reader.host.saveAs(`${baseName}.html`, htmlContent, [
        { name: 'HTML', extensions: ['html', 'htm'] }
      ], 'Export HTML');
    } else {
      flushEditorChanges();
      const doc = reader.store.getState().documents[tab.path];
      if (!doc) return;

      await reader.host.saveAs(`${baseName}.md`, fileToMarkdown(tab.path, doc.content), [
        { name: 'Markdown', extensions: ['md', 'markdown'] }
      ], 'Export Markdown');
    }
  } catch (error) {
    console.error(`Failed to export ${label}:`, error);
    alert(`Failed to export ${label}: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    exporting = false;
  }
}
