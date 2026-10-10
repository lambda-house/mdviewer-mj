import MarkdownIt from 'markdown-it';
import { convertFileSrc } from '@tauri-apps/api/core';
import type { Heading } from '../store';
import { getFileKind } from './files';
import { fb2ToMarkdown } from './fb2';

// ============================================================
// XSS Protection
// ============================================================
//
// No HTML is filtered after rendering: markdown-it runs with `html: false`,
// so raw HTML in the source comes out escaped, and every custom renderer
// below escapes what it interpolates with `escapeHtml`. Link targets are
// additionally checked by `sanitizeUrl`.

const DANGEROUS_PROTOCOLS = ['javascript:', 'vbscript:', 'data:text/html'];

function sanitizeUrl(url: string): string {
  const lower = url.toLowerCase().trim();
  for (const proto of DANGEROUS_PROTOCOLS) {
    if (lower.startsWith(proto)) {
      return '#';
    }
  }
  return url;
}

// ============================================================
// Markdown Parser Configuration
// ============================================================

const md = new MarkdownIt({
  html: false, // SECURITY: Disable raw HTML
  linkify: true,
  typographer: true,
  breaks: false,
});

// Tag block elements with their source line (`data-line`, 0-based, counted
// in the full file including any frontmatter) so search results can be
// mapped to a spot in the rendered document.
md.core.ruler.push('source_lines', (state) => {
  const offset = typeof state.env?.lineOffset === 'number' ? state.env.lineOffset : 0;
  for (const token of state.tokens) {
    if (token.map && token.block && token.nesting !== -1) {
      token.attrSet('data-line', String(token.map[0] + offset));
    }
  }
  return true;
});

// ============================================================
// Unique Heading ID Generator
// ============================================================

class HeadingIdGenerator {
  private usedIds: Map<string, number> = new Map();
  
  reset(): void {
    this.usedIds.clear();
  }
  
  generate(text: string): string {
    const baseId = text
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim() || 'heading';
    
    const count = this.usedIds.get(baseId) || 0;
    this.usedIds.set(baseId, count + 1);
    
    return count === 0 ? baseId : `${baseId}-${count}`;
  }
}

const headingIdGenerator = new HeadingIdGenerator();

// ============================================================
// Custom Renderers
// ============================================================

// Custom heading renderer to add IDs
const defaultHeadingRenderer = md.renderer.rules.heading_open || ((tokens, idx, options, _env, self) => {
  return self.renderToken(tokens, idx, options);
});

md.renderer.rules.heading_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const contentToken = tokens[idx + 1];
  
  if (contentToken && contentToken.type === 'inline' && contentToken.content) {
    const id = headingIdGenerator.generate(contentToken.content);
    token.attrSet('id', id);
  }
  
  return defaultHeadingRenderer(tokens, idx, options, env, self);
};

// Custom fence renderer for code blocks and mermaid
md.renderer.rules.fence = (tokens, idx, _options, _env, _self) => {
  const token = tokens[idx];
  const language = token.info.trim().toLowerCase();
  const content = token.content;
  
  // Handle Mermaid diagrams. The source travels in an attribute; reading it
  // back with getAttribute() decodes it, so it must not be unescaped again.
  if (language === 'mermaid') {
    const escaped = escapeHtml(content);
    const uniqueId = `mermaid-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return `<div class="mermaid-container" id="${uniqueId}" data-mermaid="${escaped}">
      <div class="mermaid-placeholder">Loading diagram...</div>
    </div>`;
  }
  
  // Handle code blocks with language
  const escaped = escapeHtml(content);
  const langDisplay = language ? escapeHtml(language) : 'text';
  const langClass = language ? `language-${escapeHtml(language)}` : '';
  
  return `<div class="code-block-wrapper">
    <div class="code-block-header">
      <span class="code-block-language">${langDisplay}</span>
      <button class="code-block-copy" data-code="${escaped}" type="button">Copy</button>
    </div>
    <pre class="${langClass}"><code class="${langClass}">${escaped}</code></pre>
  </div>`;
};

// Custom link renderer to add security attributes
const defaultLinkRenderer = md.renderer.rules.link_open || ((tokens, idx, options, _env, self) => {
  return self.renderToken(tokens, idx, options);
});

md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const hrefIndex = token.attrIndex('href');
  
  if (hrefIndex >= 0 && token.attrs) {
    const href = token.attrs[hrefIndex][1];
    token.attrs[hrefIndex][1] = sanitizeUrl(href);
    
    // Add rel="noopener noreferrer" and target="_blank" for external links
    if (href.startsWith('http://') || href.startsWith('https://')) {
      token.attrSet('target', '_blank');
      token.attrSet('rel', 'noopener noreferrer');
    }
  }
  
  return defaultLinkRenderer(tokens, idx, options, env, self);
};

// Custom image renderer to resolve relative paths via the localfile protocol
md.renderer.rules.image = (tokens, idx, _options, env, _self) => {
  const token = tokens[idx];
  const srcIndex = token.attrIndex('src');
  const altIndex = token.attrIndex('alt');

  let src = srcIndex >= 0 && token.attrs ? token.attrs[srcIndex][1] : '';
  const alt = token.children
    ? token.children.map((t) => t.content).join('')
    : (altIndex >= 0 && token.attrs ? token.attrs[altIndex][1] : '');

  // Resolve relative image paths (served by the backend's localfile protocol)
  if (src && env.basePath && !src.startsWith('http://') && !src.startsWith('https://') && !src.startsWith('data:')) {
    // markdown-it has already percent-encoded the link ("мой файл.png" ->
    // "%D0%BC...%20..."); decode it, since convertFileSrc encodes the whole
    // path and the localfile handler decodes exactly once.
    let path = src;
    try {
      path = decodeURIComponent(src);
    } catch {
      // Malformed escape: use the link as written
    }
    // Resolve relative path against document's directory
    let absolutePath: string;
    if (path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path)) {
      absolutePath = path;
    } else {
      // Handle ./ and ../ prefixes
      const base = env.basePath.replace(/\\/g, '/');
      const parts = base.split('/');
      const srcParts = path.replace(/\\/g, '/').split('/');
      for (const part of srcParts) {
        if (part === '..') {
          parts.pop();
        } else if (part !== '.') {
          parts.push(part);
        }
      }
      absolutePath = parts.join('/');
    }
    // localfile://localhost/<path> on macOS/Linux,
    // http://localfile.localhost/<path> on Windows
    src = '__TAURI_INTERNALS__' in window
      ? convertFileSrc(absolutePath, 'localfile')
      : `localfile://localhost/${encodeURIComponent(absolutePath)}`;
  }

  // Build attributes
  let attrStr = '';
  if (token.attrs) {
    for (const [key, value] of token.attrs) {
      if (key === 'src') continue; // We handle src separately
      if (key === 'alt') continue; // We handle alt separately
      attrStr += ` ${escapeHtml(key)}="${escapeHtml(value)}"`;
    }
  }

  return `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}"${attrStr} />`;
};

// ============================================================
// Helper Functions
// ============================================================

function escapeHtml(text: string): string {
  const escapeMap: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, (char) => escapeMap[char] || char);
}

// ============================================================
// Parsing Functions
// ============================================================

export function parseMarkdown(content: string, basePath?: string, lineOffset = 0): string {
  // Reset heading ID generator for each document
  headingIdGenerator.reset();

  const env = { ...(basePath ? { basePath } : {}), lineOffset };
  return md.render(content, env);
}

export function extractHeadings(content: string): Heading[] {
  const headings: Heading[] = [];
  const tokens = md.parse(content, {});
  const localIdGenerator = new HeadingIdGenerator();
  
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type === 'heading_open') {
      const level = parseInt(token.tag.substring(1), 10);
      const contentToken = tokens[i + 1];
      
      if (contentToken && contentToken.type === 'inline' && contentToken.content) {
        const text = contentToken.content;
        const id = localIdGenerator.generate(text);
        
        headings.push({ id, text, level });
      }
    }
  }
  
  return headings;
}

export function extractFrontmatter(content: string): { 
  frontmatter: Record<string, unknown> | null; 
  body: string;
} {
  const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n/;
  const match = content.match(frontmatterRegex);
  
  if (match) {
    try {
      const yaml = match[1];
      const frontmatter: Record<string, unknown> = {};
      
      // Simple YAML parsing (key: value pairs)
      yaml.split('\n').forEach((line) => {
        const colonIndex = line.indexOf(':');
        if (colonIndex > 0) {
          const key = line.substring(0, colonIndex).trim();
          const value = line.substring(colonIndex + 1).trim();
          // Remove surrounding quotes
          frontmatter[key] = value.replace(/^["']|["']$/g, '');
        }
      });
      
      return {
        frontmatter,
        body: content.substring(match[0].length),
      };
    } catch {
      return { frontmatter: null, body: content };
    }
  }
  
  return { frontmatter: null, body: content };
}

// ============================================================
// Syntax Highlighting (Client-side with Shiki)
// ============================================================

let highlighterPromise: Promise<unknown> | null = null;

async function getHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = import('shiki').then(async (shiki) => {
      return shiki.createHighlighter({
        themes: ['github-dark', 'github-light'],
        langs: [
          'javascript', 'typescript', 'python', 'rust', 'scala',
          'java', 'go', 'sql', 'json', 'yaml', 'bash', 'html',
          'css', 'markdown', 'c', 'cpp', 'toml', 'xml',
          'kotlin', 'tsx', 'jsx', 'scss', 'ini', 'diff',
        ],
      });
    });
  }
  return highlighterPromise;
}

export async function highlightCode(code: string, language: string): Promise<string> {
  try {
    const highlighter = await getHighlighter() as {
      codeToHtml: (
        code: string,
        opts: { lang: string; themes: Record<string, string>; defaultColor: false }
      ) => string
    };
    // Both themes as CSS variables (--shiki-dark / --shiki-light); the
    // stylesheet picks one, so switching themes needs no re-highlighting
    return highlighter.codeToHtml(code, {
      lang: language,
      themes: { dark: 'github-dark', light: 'github-light' },
      defaultColor: false,
    });
  } catch {
    return `<pre><code>${escapeHtml(code)}</code></pre>`;
  }
}

/**
 * Apply syntax highlighting to all code blocks in a container
 * @param container The container element with code blocks
 * @param languageAliases Optional map of language aliases (e.g., { 'tsx': 'typescript' })
 */
export async function highlightCodeBlocks(
  container: HTMLElement,
  languageAliases: Record<string, string> = {}
): Promise<void> {
  const codeBlocks = container.querySelectorAll('.code-block-wrapper pre code');

  for (const codeEl of codeBlocks) {
    const preEl = codeEl.parentElement;
    if (!preEl) continue;

    // Get language from class
    const langMatch = codeEl.className.match(/language-(\w+)/);
    let language = langMatch ? langMatch[1].toLowerCase() : 'text';

    // Resolve alias if exists
    if (languageAliases[language]) {
      language = languageAliases[language];
    }

    // Get the code from the data attribute on the copy button
    // (getAttribute returns it already decoded)
    const wrapper = preEl.closest('.code-block-wrapper');
    const copyBtn = wrapper?.querySelector('.code-block-copy');
    const code = copyBtn?.getAttribute('data-code');

    if (!code) continue;

    try {
      const highlighted = await highlightCode(code, language);

      // Extract just the code content from Shiki output
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = highlighted;
      const shikiPre = tempDiv.querySelector('pre');

      if (shikiPre) {
        // Replace the pre element with highlighted version
        preEl.innerHTML = shikiPre.innerHTML;
        preEl.className = shikiPre.className + ' ' + preEl.className;
      }
    } catch (error) {
      console.error('Failed to highlight code block:', error);
    }
  }
}

// ============================================================
// Mermaid Rendering (Client-side)
// ============================================================

export type ColorTheme = 'dark' | 'light';

const MERMAID_THEME_VARIABLES: Record<ColorTheme, Record<string, string>> = {
  dark: {
    primaryColor: '#4fc1ff',
    primaryTextColor: '#cccccc',
    primaryBorderColor: '#3c3c3c',
    lineColor: '#858585',
    secondaryColor: '#2d2d30',
    tertiaryColor: '#252526',
    background: '#1e1e1e',
    mainBkg: '#2d2d30',
    secondBkg: '#252526',
    border1: '#3c3c3c',
    border2: '#3c3c3c',
    arrowheadColor: '#858585',
    fontFamily: 'Inter, sans-serif',
    fontSize: '14px',
    textColor: '#cccccc',
    nodeTextColor: '#cccccc',
  },
  light: {
    primaryColor: '#dbe9f8',
    primaryTextColor: '#1f1f1f',
    primaryBorderColor: '#7aa7d6',
    lineColor: '#6a6a6a',
    secondaryColor: '#f3f3f3',
    tertiaryColor: '#ffffff',
    background: '#ffffff',
    mainBkg: '#eef4fb',
    secondBkg: '#f3f3f3',
    border1: '#7aa7d6',
    border2: '#d0d0d0',
    arrowheadColor: '#6a6a6a',
    fontFamily: 'Inter, sans-serif',
    fontSize: '14px',
    textColor: '#1f1f1f',
    nodeTextColor: '#1f1f1f',
  },
};

/** Theme Mermaid was last initialized with (null = not yet). */
let mermaidTheme: ColorTheme | null = null;

export async function initMermaid(theme: ColorTheme = 'dark'): Promise<void> {
  if (mermaidTheme === theme) return;
  
  try {
    const mermaid = await import('mermaid');
    mermaid.default.initialize({
      startOnLoad: false,
      theme: theme === 'dark' ? 'dark' : 'default',
      securityLevel: 'strict', // SECURITY: Enable strict mode
      themeVariables: MERMAID_THEME_VARIABLES[theme],
      flowchart: {
        curve: 'basis',
        padding: 20,
      },
      sequence: {
        actorMargin: 50,
        boxMargin: 10,
        boxTextMargin: 5,
        noteMargin: 10,
        messageMargin: 35,
      },
    });
    
    mermaidTheme = theme;
  } catch (error) {
    console.error('Failed to initialize Mermaid:', error);
  }
}

/**
 * Render the not-yet-rendered Mermaid diagrams in `container`. Diagrams
 * rendered with another theme are rendered again.
 */
export async function renderMermaid(container: HTMLElement, theme: ColorTheme = 'dark'): Promise<void> {
  await initMermaid(theme);
  container
    .querySelectorAll(`.mermaid-container.mermaid-rendered:not([data-mermaid-theme="${theme}"])`)
    .forEach((el) => el.classList.remove('mermaid-rendered'));

  try {
    const mermaid = (await import('mermaid')).default;
    const mermaidContainers = container.querySelectorAll('.mermaid-container:not(.mermaid-rendered)');

    for (const el of mermaidContainers) {
      const htmlEl = el as HTMLElement;
      const code = htmlEl.getAttribute('data-mermaid');

      if (!code) continue;

      // Generate a unique ID for this render call (not reusing container ID)
      const renderId = `mermaid-render-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      try {
        const { svg } = await mermaid.render(renderId, code);

        // Wrap SVG in zoomable container
        const escapedCode = escapeHtml(code);
        htmlEl.innerHTML = `
          <div class="mermaid-viewport">
            <div class="mermaid-content">${svg}</div>
            <div class="mermaid-hint">Scroll to zoom • Drag to pan</div>
          </div>
          <div class="mermaid-raw" style="display: none;">
            <pre><code>${escapedCode}</code></pre>
          </div>
          <div class="mermaid-controls">
            <div class="mermaid-diagram-controls">
              <button class="mermaid-zoom-in" title="Zoom in">+</button>
              <button class="mermaid-zoom-reset" title="Fit to view">⊡</button>
              <button class="mermaid-zoom-out" title="Zoom out">−</button>
              <span class="mermaid-controls-separator"></span>
              <button class="mermaid-expand" title="Expand to full height">⤢</button>
            </div>
            <div class="mermaid-raw-controls" style="display: none;">
              <button class="mermaid-copy" title="Copy code" data-code="${escapedCode}">Copy</button>
            </div>
            <span class="mermaid-controls-separator"></span>
            <button class="mermaid-raw-toggle" title="Toggle raw code">{ }</button>
          </div>
        `;
        htmlEl.classList.add('mermaid-rendered');
        htmlEl.setAttribute('data-mermaid-theme', theme);

        // Setup zoom/pan
        setupMermaidZoomPan(htmlEl);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to render diagram';
        htmlEl.innerHTML = `<div class="mermaid-error">
          <strong>Diagram Error:</strong><br>
          ${escapeHtml(errorMessage)}
        </div>`;
        htmlEl.classList.add('mermaid-error-container');
      }
    }
  } catch (error) {
    console.error('Failed to render Mermaid diagrams:', error);
  }
}

function setupMermaidZoomPan(container: HTMLElement): void {
  const viewport = container.querySelector('.mermaid-viewport') as HTMLElement;
  const content = container.querySelector('.mermaid-content') as HTMLElement;
  const svg = content?.querySelector('svg') as SVGSVGElement;
  const zoomInBtn = container.querySelector('.mermaid-zoom-in') as HTMLButtonElement;
  const zoomOutBtn = container.querySelector('.mermaid-zoom-out') as HTMLButtonElement;
  const zoomResetBtn = container.querySelector('.mermaid-zoom-reset') as HTMLButtonElement;

  if (!viewport || !content || !svg) return;

  // Get SVG dimensions - try multiple sources
  let svgWidth = 0;
  let svgHeight = 0;

  // First try viewBox (most reliable for Mermaid)
  const viewBox = svg.viewBox?.baseVal;
  if (viewBox && viewBox.width > 0 && viewBox.height > 0) {
    svgWidth = viewBox.width;
    svgHeight = viewBox.height;
  }

  // Fallback: try getBBox (actual rendered bounds)
  if (!svgWidth || !svgHeight) {
    try {
      const bbox = svg.getBBox();
      if (bbox.width > 0 && bbox.height > 0) {
        svgWidth = bbox.width;
        svgHeight = bbox.height;
      }
    } catch {
      // getBBox can throw if SVG not rendered
    }
  }

  // Final fallback: parse width/height attributes
  if (!svgWidth || !svgHeight) {
    const widthAttr = svg.getAttribute('width');
    const heightAttr = svg.getAttribute('height');
    if (widthAttr && !/[%a-z]/i.test(widthAttr)) {
      svgWidth = parseFloat(widthAttr) || 0;
    }
    if (heightAttr && !/[%a-z]/i.test(heightAttr)) {
      svgHeight = parseFloat(heightAttr) || 0;
    }
  }

  // Ultimate fallback
  svgWidth = svgWidth || 400;
  svgHeight = svgHeight || 300;

  // Set SVG to use viewBox for proper scaling, remove fixed dimensions
  if (!svg.getAttribute('viewBox')) {
    svg.setAttribute('viewBox', `0 0 ${svgWidth} ${svgHeight}`);
  }
  // Set SVG to fill its container - actual size controlled by container
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '100%');
  svg.style.width = '';
  svg.style.height = '';

  // Container constraints
  const containerWidth = container.clientWidth;
  const maxViewportHeight = 600;
  const minViewportHeight = 150;

  // Viewport always uses full container width
  const viewportWidth = containerWidth;

  // Calculate scale to fit diagram in viewport width
  const scaleToFitWidth = viewportWidth / svgWidth;

  // Calculate what height the diagram would have at this scale
  const scaledHeight = svgHeight * scaleToFitWidth;

  // Viewport height: use scaled height, but cap at max and enforce min
  let viewportHeight = Math.min(maxViewportHeight, Math.max(minViewportHeight, scaledHeight));

  // Calculate initial scale to fit diagram fully within viewport
  const initialScale = Math.min(
    viewportWidth / svgWidth,
    viewportHeight / svgHeight,
    1 // Don't scale up beyond 100%
  );

  // Calculate the actual displayed dimensions at initial scale
  const displayWidth = svgWidth * initialScale;
  const displayHeight = svgHeight * initialScale;

  // Set content (wrapper) dimensions to match the initially scaled diagram
  content.style.width = `${displayWidth}px`;
  content.style.height = `${displayHeight}px`;

  // Set viewport dimensions - full width, calculated height
  viewport.style.width = '100%';
  viewport.style.height = `${viewportHeight}px`;

  // Scale is relative to initial display size (1.0 = initial fit)
  let scale = 1.0;
  let panX = 0;
  let panY = 0;
  let isPanning = false;
  let startX = 0;
  let startY = 0;

  const minScale = 0.5;
  const maxScale = 4;
  const scaleStep = 0.15;

  function updateTransform() {
    // Apply zoom scale relative to the initial display size
    content.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
  }

  function zoom(delta: number, centerX?: number, centerY?: number) {
    const oldScale = scale;
    scale = Math.min(maxScale, Math.max(minScale, scale + delta));

    // Zoom toward cursor position if provided
    if (centerX !== undefined && centerY !== undefined) {
      const rect = viewport.getBoundingClientRect();
      const x = centerX - rect.left - viewport.clientWidth / 2;
      const y = centerY - rect.top - viewport.clientHeight / 2;
      const scaleFactor = scale / oldScale;
      panX = x - (x - panX) * scaleFactor;
      panY = y - (y - panY) * scaleFactor;
    }

    updateTransform();
  }

  function fitToView() {
    scale = 1.0;
    panX = 0;
    panY = 0;
    updateTransform();
  }

  // No initial transform needed - content is already sized correctly

  // Mouse wheel zoom
  viewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -scaleStep : scaleStep;
    zoom(delta, e.clientX, e.clientY);
  }, { passive: false });

  // Pan with mouse drag
  viewport.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return; // Left click only
    isPanning = true;
    startX = e.clientX - panX;
    startY = e.clientY - panY;
    viewport.style.cursor = 'grabbing';
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isPanning) return;
    panX = e.clientX - startX;
    panY = e.clientY - startY;
    updateTransform();
  });

  document.addEventListener('mouseup', () => {
    if (isPanning) {
      isPanning = false;
      viewport.style.cursor = 'grab';
    }
  });

  // Button controls
  zoomInBtn?.addEventListener('click', () => zoom(scaleStep));
  zoomOutBtn?.addEventListener('click', () => zoom(-scaleStep));
  zoomResetBtn?.addEventListener('click', fitToView);

  // Raw toggle button
  const rawToggleBtn = container.querySelector('.mermaid-raw-toggle') as HTMLButtonElement;
  const rawView = container.querySelector('.mermaid-raw') as HTMLElement;
  const diagramControls = container.querySelector('.mermaid-diagram-controls') as HTMLElement;
  const rawControls = container.querySelector('.mermaid-raw-controls') as HTMLElement;
  let isRawView = false;

  rawToggleBtn?.addEventListener('click', () => {
    isRawView = !isRawView;
    if (isRawView) {
      viewport.style.display = 'none';
      rawView.style.display = 'block';
      diagramControls.style.display = 'none';
      rawControls.style.display = 'flex';
      rawToggleBtn.classList.add('active');
    } else {
      viewport.style.display = 'flex';
      rawView.style.display = 'none';
      diagramControls.style.display = 'flex';
      rawControls.style.display = 'none';
      rawToggleBtn.classList.remove('active');
    }
  });

  // Copy button for raw view
  const copyBtn = container.querySelector('.mermaid-copy') as HTMLButtonElement;
  copyBtn?.addEventListener('click', async () => {
    const code = copyBtn.getAttribute('data-code');
    if (code) {
      try {
        await navigator.clipboard.writeText(code);
        const originalText = copyBtn.textContent;
        copyBtn.textContent = 'Copied!';
        copyBtn.classList.add('copied');
        setTimeout(() => {
          copyBtn.textContent = originalText;
          copyBtn.classList.remove('copied');
        }, 2000);
      } catch {
        // Fallback for older browsers
        console.error('Failed to copy to clipboard');
      }
    }
  });

  // Expand button - toggles between constrained and full height
  const expandBtn = container.querySelector('.mermaid-expand') as HTMLButtonElement;
  let isExpanded = false;

  expandBtn?.addEventListener('click', () => {
    isExpanded = !isExpanded;
    if (isExpanded) {
      // Expand: viewport width stays full, height expands to fit diagram at full width
      const fullWidthScale = viewportWidth / svgWidth;
      const expandedHeight = svgHeight * fullWidthScale;

      // Set content to fill viewport width, scale accordingly
      content.style.width = `${viewportWidth}px`;
      content.style.height = `${expandedHeight}px`;
      viewport.style.height = `${expandedHeight}px`;

      // Reset zoom/pan since we're showing full diagram
      scale = 1.0;
      panX = 0;
      panY = 0;
      updateTransform();

      expandBtn.classList.add('active');
      expandBtn.title = 'Collapse to fit';
    } else {
      // Collapse: restore original constrained view
      content.style.width = `${displayWidth}px`;
      content.style.height = `${displayHeight}px`;
      viewport.style.height = `${viewportHeight}px`;

      // Reset zoom/pan
      scale = 1.0;
      panX = 0;
      panY = 0;
      updateTransform();

      expandBtn.classList.remove('active');
      expandBtn.title = 'Expand to full height';
    }
  });

  // Set initial cursor
  viewport.style.cursor = 'grab';
}

// ============================================================
// Full Render Pipeline
// ============================================================

export interface RenderResult {
  html: string;
  headings: Heading[];
  frontmatter: Record<string, unknown> | null;
}

export function renderMarkdown(content: string, basePath?: string): RenderResult {
  const { frontmatter, body } = extractFrontmatter(content);
  // Lines taken by the stripped frontmatter, so data-line matches the file
  const lineOffset = body.length < content.length
    ? content.slice(0, content.length - body.length).split('\n').length - 1
    : 0;
  const html = parseMarkdown(body, basePath, lineOffset);
  const headings = extractHeadings(body);

  return { html, headings, frontmatter };
}

/** Code files above this size are shown as plain text - Shiki gets slow. */
const MAX_HIGHLIGHT_SIZE = 512 * 1024;

/** Longest run of backticks, so a fence around `text` cannot be closed early. */
function fenceFor(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  return '`'.repeat(Math.max(3, longest + 1));
}

function renderPlainText(content: string): RenderResult {
  return {
    html: `<pre class="plain-text-document">${escapeHtml(content)}</pre>`,
    headings: [],
    frontmatter: null,
  };
}

/**
 * Render any viewable file: markdown as-is, fb2 books converted to markdown,
 * code as one highlighted code block, everything else as wrapped plain text.
 */
export function renderFile(path: string, content: string, basePath?: string): RenderResult {
  const fileKind = getFileKind(path);

  switch (fileKind.kind) {
    case 'markdown':
      return renderMarkdown(content, basePath);

    case 'fb2': {
      const markdown = fb2ToMarkdown(content);
      if (markdown !== null) {
        const { html, headings } = renderMarkdown(markdown, basePath);
        // data-line refers to the generated markdown, not the fb2 source
        return { html: html.replace(/ data-line="\d+"/g, ''), headings, frontmatter: null };
      }
      return renderFile(`${path}.xml`, content, basePath);
    }

    case 'code': {
      if (content.length > MAX_HIGHLIGHT_SIZE) return renderPlainText(content);
      const fence = fenceFor(content);
      const body = content.endsWith('\n') ? content : `${content}\n`;
      const html = parseMarkdown(`${fence}${fileKind.language}\n${body}${fence}\n`, basePath);
      return { html, headings: [], frontmatter: null };
    }

    default:
      return renderPlainText(content);
  }
}

// Export utilities
export { escapeHtml };
export default md;
