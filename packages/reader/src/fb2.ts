// ============================================================
// FictionBook (fb2) -> markdown
// ============================================================
//
// fb2 is XML: <description> holds the metadata, one or more <body> elements
// hold nested <section>s with <title>, <p>, <epigraph>, <poem>, <cite>...
// Converting to markdown reuses the whole rendering pipeline, and the section
// titles become headings - so the TOC shows the book's chapters.

/** Escape text so markdown does not interpret it. */
function escapeMarkdown(text: string): string {
  return text
    .replace(/([\\`*_[\]<>#|~])/g, '\\$1')
    // A paragraph starting with "1." or "-" would become a list
    .replace(/^(\d+)\.(\s)/, '$1\\.$2')
    .replace(/^([-+])(\s)/, '\\$1$2');
}

function normalizeSpace(text: string): string {
  return text.replace(/\s+/g, ' ');
}

/** Child elements by local name (fb2 uses a default namespace). */
function childElements(el: Element, name?: string): Element[] {
  return Array.from(el.children).filter((c) => !name || c.localName === name);
}

/** Inline content of a <p>, <v>, <subtitle>... */
function inline(node: Node): string {
  let out = '';
  node.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      out += escapeMarkdown(normalizeSpace(child.nodeValue ?? ''));
      return;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) return;

    const el = child as Element;
    const inner = inline(el).trim();
    if (!inner) return;
    switch (el.localName) {
      case 'emphasis':
        out += `*${inner}*`;
        break;
      case 'strong':
        out += `**${inner}**`;
        break;
      case 'strikethrough':
        out += `~~${inner}~~`;
        break;
      case 'code':
        out += `\`${el.textContent ?? ''}\``;
        break;
      case 'sup':
        out += `^${inner}`;
        break;
      default: // <a> (footnote refs), <style>, <sub>...
        out += inner;
    }
  });
  return out;
}

function paragraphs(el: Element): string[] {
  return childElements(el, 'p').map((p) => inline(p).trim()).filter(Boolean);
}

function titleText(title: Element): string {
  return paragraphs(title).join(' — ') || escapeMarkdown(normalizeSpace(title.textContent ?? '').trim());
}

function quoteBlock(lines: string[]): string {
  return lines
    .flatMap((line) => line.split('\n'))
    .map((line) => (line ? `> ${line}` : '>'))
    .join('\n');
}

/**
 * Block content of a <section>, <body>, <epigraph>, <cite>... `depth` is the
 * heading level of `el`'s own <title>; nested sections go one level deeper.
 * The title page of a <body> is not a chapter, so it is shown bold instead.
 */
function blocks(el: Element, depth: number, titleAsHeading = true): string[] {
  const out: string[] = [];

  for (const child of childElements(el)) {
    switch (child.localName) {
      case 'title': {
        const text = titleText(child);
        if (text) out.push(titleAsHeading ? `${'#'.repeat(Math.min(depth, 6))} ${text}` : `**${text}**`);
        break;
      }
      case 'section':
        out.push(...blocks(child, depth + 1));
        break;
      case 'p': {
        const text = inline(child).trim();
        if (text) out.push(text);
        break;
      }
      case 'subtitle': {
        const text = inline(child).trim();
        if (text) out.push(`**${text}**`);
        break;
      }
      case 'epigraph':
      case 'cite': {
        const inner = blocks(child, depth + 1);
        const author = childElements(child, 'text-author').map((a) => `— ${inline(a).trim()}`);
        const lines = [...inner, ...author].flatMap((block, i) => (i > 0 ? ['', block] : [block]));
        if (lines.length) out.push(quoteBlock(lines));
        break;
      }
      case 'poem': {
        const title = childElements(child, 'title')[0];
        if (title) out.push(`**${titleText(title)}**`);
        for (const stanza of childElements(child, 'stanza')) {
          const verses = childElements(stanza, 'v').map((v) => inline(v).trim()).filter(Boolean);
          // Two trailing spaces: hard line break between verses
          if (verses.length) out.push(verses.join('  \n'));
        }
        for (const author of childElements(child, 'text-author')) {
          out.push(`*— ${inline(author).trim()}*`);
        }
        break;
      }
      case 'text-author':
        // Handled by the enclosing epigraph/cite/poem
        if (!['epigraph', 'cite', 'poem'].includes(el.localName)) {
          out.push(`*— ${inline(child).trim()}*`);
        }
        break;
      case 'empty-line':
      case 'image':
      case 'binary':
        break;
      case 'table':
        out.push(...childElements(child, 'tr').map((tr) =>
          childElements(tr).map((cell) => inline(cell).trim()).join(' | ')));
        break;
      default:
        out.push(...blocks(child, depth));
    }
  }

  return out;
}

/**
 * Convert an fb2 document to markdown.
 * @returns null when the XML cannot be parsed or is not FictionBook
 */
export function fb2ToMarkdown(xml: string): string | null {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) return null;

  const root = doc.documentElement;
  if (root.localName !== 'FictionBook') return null;

  const out: string[] = [];

  // Title page from <description><title-info>
  const titleInfo = doc.getElementsByTagNameNS('*', 'title-info')[0];
  if (titleInfo) {
    const bookTitle = childElements(titleInfo, 'book-title')[0];
    if (bookTitle) out.push(`# ${escapeMarkdown(normalizeSpace(bookTitle.textContent ?? '').trim())}`);

    const authors = childElements(titleInfo, 'author')
      .map((author) =>
        ['first-name', 'middle-name', 'last-name']
          .map((part) => childElements(author, part)[0]?.textContent?.trim())
          .filter(Boolean)
          .join(' ') || childElements(author, 'nickname')[0]?.textContent?.trim() || '')
      .filter(Boolean);
    if (authors.length) out.push(`*${escapeMarkdown(authors.join(', '))}*`);

    const annotation = childElements(titleInfo, 'annotation')[0];
    if (annotation) {
      const lines = blocks(annotation, 2).flatMap((block, i) => (i > 0 ? ['', block] : [block]));
      if (lines.length) out.push(quoteBlock(lines));
    }
  }

  // Main text first, then notes/comments bodies. Top-level sections are
  // level 2, since the book title is the level-1 heading.
  const bodies = childElements(root, 'body');
  for (const body of bodies) {
    const name = body.getAttribute('name');
    if (name) out.push(`## ${name === 'notes' ? 'Notes' : escapeMarkdown(name)}`);
    out.push(...blocks(body, name ? 2 : 1, false));
  }

  return out.join('\n\n') + '\n';
}
