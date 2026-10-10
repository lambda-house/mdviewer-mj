import type { FileNode } from '../store';

// ============================================================
// Utility Functions
// ============================================================

export function getFileName(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

export function getFileExtension(path: string): string {
  const name = getFileName(path);
  const dotIndex = name.lastIndexOf('.');
  return dotIndex > 0 ? name.substring(dotIndex + 1) : '';
}

export function isMarkdownFile(path: string): boolean {
  const ext = getFileExtension(path).toLowerCase();
  return ext === 'md' || ext === 'markdown';
}

/**
 * Text formats shown besides markdown. Keep in sync with
 * `TEXT_FILE_EXTENSIONS` / `TEXT_FILE_NAMES` in src-tauri/src/main.rs.
 */
export const TEXT_FILE_EXTENSIONS = [
  'txt', 'text', 'log', 'fb2', 'xml', 'csv', 'tsv', 'rst', 'adoc', 'org', 'tex',
  'scala', 'sc', 'sbt', 'java', 'kt', 'kts', 'groovy', 'gradle',
  'py', 'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'json', 'jsonc',
  'rs', 'go', 'c', 'h', 'cpp', 'hpp', 'cc', 'cs', 'rb', 'php', 'lua', 'sql',
  'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat',
  'html', 'htm', 'css', 'scss', 'less', 'vue', 'svelte',
  'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'config', 'properties', 'env',
  'diff', 'patch',
];

export const TEXT_FILE_NAMES = [
  'readme', 'license', 'changelog', 'makefile', 'dockerfile', 'jenkinsfile',
  '.gitignore', '.gitattributes', '.editorconfig', '.env', '.npmrc', '.scalafmt.conf',
];

/** Markdown or any other text file the viewer can show. */
export function isViewableFile(path: string): boolean {
  if (isMarkdownFile(path)) return true;
  const name = getFileName(path).toLowerCase();
  return TEXT_FILE_NAMES.includes(name) || TEXT_FILE_EXTENSIONS.includes(getFileExtension(name));
}

/** File extension -> Shiki language (loaded in utils/markdown.ts). */
const CODE_LANGUAGES: Record<string, string> = {
  scala: 'scala', sc: 'scala', sbt: 'scala',
  java: 'java', kt: 'kotlin', kts: 'kotlin',
  py: 'python',
  ts: 'typescript', tsx: 'tsx', js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'jsx',
  json: 'json', jsonc: 'json',
  rs: 'rust', go: 'go', c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp', cc: 'cpp', sql: 'sql',
  sh: 'bash', bash: 'bash', zsh: 'bash', fish: 'bash',
  html: 'html', htm: 'html', vue: 'html', svelte: 'html',
  css: 'css', less: 'css', scss: 'scss',
  yaml: 'yaml', yml: 'yaml', toml: 'toml',
  ini: 'ini', cfg: 'ini', conf: 'ini', config: 'ini', properties: 'ini', env: 'ini',
  xml: 'xml', fb2: 'xml',
  diff: 'diff', patch: 'diff',
};

const CODE_FILE_NAMES: Record<string, string> = {
  '.editorconfig': 'ini', '.env': 'ini', '.npmrc': 'ini',
};

/** How a file is shown: rendered markdown, an fb2 book, highlighted code or plain text. */
export type FileKind =
  | { kind: 'markdown' }
  | { kind: 'fb2' }
  | { kind: 'code'; language: string }
  | { kind: 'text' };

export function getFileKind(path: string): FileKind {
  if (isMarkdownFile(path)) return { kind: 'markdown' };
  const name = getFileName(path).toLowerCase();
  const ext = getFileExtension(name);
  if (ext === 'fb2') return { kind: 'fb2' };
  const language = CODE_FILE_NAMES[name] ?? CODE_LANGUAGES[ext];
  return language ? { kind: 'code', language } : { kind: 'text' };
}

export function filterFiles(files: FileNode[], query: string): FileNode[] {
  if (!query.trim()) return files;
  
  const lowerQuery = query.toLowerCase();
  
  function filterNode(node: FileNode): FileNode | null {
    if (node.type === 'file') {
      return node.name.toLowerCase().includes(lowerQuery) ? node : null;
    }
    
    // Directory: filter children
    const filteredChildren = node.children
      ?.map(filterNode)
      .filter((n): n is FileNode => n !== null);
    
    if (filteredChildren && filteredChildren.length > 0) {
      return { ...node, children: filteredChildren, isExpanded: true };
    }
    
    return null;
  }
  
  return files.map(filterNode).filter((n): n is FileNode => n !== null);
}

export function flattenFiles(files: FileNode[]): FileNode[] {
  const result: FileNode[] = [];
  
  function traverse(nodes: FileNode[]) {
    for (const node of nodes) {
      result.push(node);
      if (node.children) {
        traverse(node.children);
      }
    }
  }
  
  traverse(files);
  return result;
}

// ============================================================
// Path helpers (work with both / and \ separators)
// ============================================================

function separatorOf(path: string): string {
  return path.includes('\\') && !path.includes('/') ? '\\' : '/';
}

/** Strip trailing separators (but keep a filesystem root like "/" or "C:\"). */
export function normalizeDirPath(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, '');
  return trimmed === '' || /^[A-Za-z]:$/.test(trimmed) ? path : trimmed;
}

/** True when `child` is strictly inside directory `parent`. */
/**
 * Resolve a link in a document to a local file path. `href` as it appears in
 * the rendered HTML (percent-encoded by markdown-it); relative links resolve
 * against the document's folder, `#fragment` and `?query` are dropped.
 */
export function resolveLinkPath(href: string, documentPath: string): string {
  let target = href.replace(/[?#].*$/, '');
  try {
    target = decodeURIComponent(target);
  } catch {
    // Malformed escape: use the link as written
  }
  if (target.startsWith('file://')) {
    target = target.slice('file://'.length);
    // file:///C:/x on Windows
    if (/^\/[A-Za-z]:\//.test(target)) target = target.slice(1);
  }
  if (target.startsWith('/') || /^[A-Za-z]:[\\/]/.test(target)) {
    return target;
  }

  const separator = documentPath.includes('\\') && !documentPath.includes('/') ? '\\' : '/';
  const parts = documentPath.split(/[/\\]/);
  parts.pop(); // the document's file name
  for (const part of target.split(/[/\\]/)) {
    if (part === '..') {
      if (parts.length > 1) parts.pop();
    } else if (part !== '.' && part !== '') {
      parts.push(part);
    }
  }
  return parts.join(separator);
}

export function isPathInside(child: string, parent: string): boolean {
  const base = normalizeDirPath(parent);
  if (child.length <= base.length || !child.startsWith(base)) return false;
  const next = child[base.length];
  return next === '/' || next === '\\' || /[/\\]$/.test(base);
}

/**
 * Directory paths from just below `root` down to `target` (inclusive), e.g.
 * pathChain('/a', '/a/b/c') -> ['/a/b', '/a/b/c']. Empty if not inside.
 */
export function pathChain(root: string, target: string): string[] {
  if (!isPathInside(target, root)) return [];
  const base = normalizeDirPath(root);
  const sep = separatorOf(target);
  const parts = target.slice(base.length).split(/[/\\]/).filter(Boolean);
  const chain: string[] = [];
  let current = /[/\\]$/.test(base) ? base.slice(0, -1) : base;
  for (const part of parts) {
    current = `${current}${sep}${part}`;
    chain.push(current);
  }
  return chain;
}

/**
 * Shallowest markdown file under a directory node - a README/index wins
 * within the same depth. Returns the file plus the directories leading to it.
 */
export function findFirstMarkdown(root: FileNode): { file: FileNode; dirs: string[] } | null {
  const preferred = ['readme.md', 'index.md', 'readme.markdown'];
  let level: { node: FileNode; dirs: string[] }[] = [{ node: root, dirs: [] }];

  while (level.length > 0) {
    const next: typeof level = [];
    for (const { node, dirs } of level) {
      const children = node.children ?? [];
      const markdown = children.filter((c) => c.type === 'file' && isMarkdownFile(c.path));
      const file = markdown.find((f) => preferred.includes(f.name.toLowerCase())) ?? markdown[0];
      if (file) return { file, dirs };
      for (const child of children) {
        if (child.type === 'directory') next.push({ node: child, dirs: [...dirs, child.path] });
      }
    }
    level = next;
  }

  return null;
}

// ============================================================
// Tree reuse across rescans
// ============================================================

function reuseNode(prev: FileNode, next: FileNode): FileNode {
  if (
    prev.id !== next.id ||
    prev.type !== next.type ||
    prev.name !== next.name ||
    prev.displayPath !== next.displayPath ||
    prev.isExpanded !== next.isExpanded
  ) {
    return next;
  }
  if (!prev.children && !next.children) return prev;
  if (!prev.children || !next.children) return next;
  const children = reuseUnchangedNodes(prev.children, next.children);
  return children === prev.children ? prev : { ...next, children };
}

/**
 * Merge a freshly scanned tree into the previous one, keeping the previous
 * objects wherever nothing changed. Unchanged subtrees keep their identity,
 * so memoized tree rows skip re-rendering; an unchanged tree returns `prev`.
 */
export function reuseUnchangedNodes(prev: FileNode[], next: FileNode[]): FileNode[] {
  const prevByPath = new Map(prev.map((node) => [node.path, node]));
  let unchanged = prev.length === next.length;

  const merged = next.map((node, i) => {
    const old = prevByPath.get(node.path);
    const result = old ? reuseNode(old, node) : node;
    if (result !== prev[i]) unchanged = false;
    return result;
  });

  return unchanged ? prev : merged;
}
