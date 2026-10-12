// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { renderFile, renderMarkdown } from './markdown';

/** The rendered HTML parsed into a detached element. */
function render(markdown: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = renderMarkdown(markdown).html;
  return root;
}

describe('markdown rendering is inert', () => {
  it('escapes raw HTML', () => {
    const root = render('<img src=x onerror="alert(1)">\n\n<script>alert(1)</script>\n');
    expect(root.querySelector('img, script')).toBeNull();
    expect(root.textContent).toContain('<script>alert(1)</script>');
  });

  it('neutralizes script links', () => {
    const root = render('[a](javascript:alert(1)) [b](JavaScript:alert(1)) [c](https://example.com)');
    const hrefs = Array.from(root.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(hrefs.some((href) => /javascript:/i.test(href ?? ''))).toBe(false);
    const external = root.querySelector('a[href="https://example.com"]');
    expect(external?.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('keeps code and diagram sources as text', () => {
    const root = render('```html\n<b onclick="x()">"quoted"</b>\n```\n\n```mermaid\ngraph TD; A["<img src=x>"]-->B\n```\n');
    expect(root.querySelector('b, img')).toBeNull();
    expect(root.querySelector('code')?.textContent).toBe('<b onclick="x()">"quoted"</b>\n');
    expect(root.querySelector('.code-block-copy')?.getAttribute('data-code')).toBe('<b onclick="x()">"quoted"</b>\n');
    expect(root.querySelector('.mermaid-container')?.getAttribute('data-mermaid')).toBe('graph TD; A["<img src=x>"]-->B\n');
  });

  it('does not load remote images until allowed', () => {
    const root = render('![chart "q"](https://example.com/a.png?x=1&y="2")');
    expect(root.querySelector('img')).toBeNull();
    const placeholder = root.querySelector<HTMLElement>('span.remote-image');
    expect(placeholder?.dataset.src).toBe('https://example.com/a.png?x=1&y=%222%22');
    expect(placeholder?.dataset.alt).toBe('chart "q"');
  });
});

describe('markdown structure', () => {
  it('numbers blocks by their line in the file, frontmatter included', () => {
    const { html, frontmatter } = renderMarkdown('---\ndescription: Style\nalwaysApply: true\n---\n# Title\n\nText\n');
    expect(frontmatter).toEqual({ description: 'Style', alwaysApply: 'true' });
    const root = document.createElement('div');
    root.innerHTML = html;
    expect(root.querySelector('h1')?.dataset.line).toBe('4');
    expect(root.querySelector('p')?.dataset.line).toBe('6');
  });

  it('gives repeated headings distinct ids', () => {
    const { headings } = renderMarkdown('# Setup\n\n## Setup\n\n## Setup\n');
    expect(headings.map((h) => h.id)).toEqual(['setup', 'setup-1', 'setup-2']);
  });

  it('shows a code file as one block that its backticks cannot close', () => {
    const root = document.createElement('div');
    root.innerHTML = renderFile('/a/notes.py', 'x = """\n```\n<b>not bold</b>\n"""\n').html;
    expect(root.querySelectorAll('pre')).toHaveLength(1);
    expect(root.querySelector('b')).toBeNull();
    expect(root.querySelector('code')?.textContent).toContain('```');
  });

  it('shows plain text as text', () => {
    const root = document.createElement('div');
    root.innerHTML = renderFile('/a/server.log', '<b>x</b> & y').html;
    expect(root.querySelector('pre.plain-text-document')?.textContent).toBe('<b>x</b> & y');
  });
});
