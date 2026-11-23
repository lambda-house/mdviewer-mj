// What kind of file a path is and how the reader shows it; links between documents.
// The extension lists mirror src-tauri/src/main.rs in MDViewer (`TEXT_FILE_EXTENSIONS`, `is_markdown_file`).

export function getFileName(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

export function getFileExtension(path: string): string {
  const name = getFileName(path);
  const dotIndex = name.lastIndexOf('.');
  return dotIndex > 0 ? name.substring(dotIndex + 1) : '';
}

/**
 * `.md`, `.markdown`, Cursor's `.mdc` rules and the legacy `.cursorrules`.
 * Same as `is_markdown_file` in src-tauri/src/main.rs.
 */
export function isMarkdownFile(path: string): boolean {
  if (getFileName(path).toLowerCase() === '.cursorrules') return true;
  const ext = getFileExtension(path).toLowerCase();
  return ext === 'md' || ext === 'markdown' || ext === 'mdc';
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

/** File extension -> Shiki language (loaded in markdown.ts). */
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
