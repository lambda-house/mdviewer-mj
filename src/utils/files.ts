import type { FileNode } from '../store';

// ============================================================
// Demo File System (for MVP without Tauri backend)
// ============================================================

export const DEMO_FILES: FileNode[] = [
  {
    id: '1',
    name: 'Documentation',
    path: '/Documentation',
    displayPath: 'Documentation',
    type: 'directory',
    isExpanded: true,
    children: [
      {
        id: '2',
        name: 'getting-started.md',
        path: '/Documentation/getting-started.md',
        displayPath: 'getting-started.md',
        type: 'file',
      },
      {
        id: '3',
        name: 'api-reference.md',
        path: '/Documentation/api-reference.md',
        displayPath: 'api-reference.md',
        type: 'file',
      },
      {
        id: '4',
        name: 'guides',
        path: '/Documentation/guides',
        displayPath: 'guides',
        type: 'directory',
        children: [
          {
            id: '5',
            name: 'installation.md',
            path: '/Documentation/guides/installation.md',
            displayPath: 'installation.md',
            type: 'file',
          },
          {
            id: '6',
            name: 'configuration.md',
            path: '/Documentation/guides/configuration.md',
            displayPath: 'configuration.md',
            type: 'file',
          },
        ],
      },
    ],
  },
  {
    id: '7',
    name: 'Notes',
    path: '/Notes',
    displayPath: 'Notes',
    type: 'directory',
    children: [
      {
        id: '8',
        name: 'meeting-notes.md',
        path: '/Notes/meeting-notes.md',
        displayPath: 'meeting-notes.md',
        type: 'file',
      },
      {
        id: '9',
        name: 'ideas.md',
        path: '/Notes/ideas.md',
        displayPath: 'ideas.md',
        type: 'file',
      },
    ],
  },
];

// ============================================================
// Demo Content
// ============================================================

export const DEMO_CONTENT: Record<string, string> = {
  '/Documentation/getting-started.md': `# Getting Started with MDViewer

Welcome to **MDViewer**, a powerful markdown document viewer built with modern web technologies.

## Features

- 📁 **Multi-directory browsing** with recursive file discovery
- 🎨 **Syntax highlighting** for 15+ programming languages
- 📊 **Mermaid diagram support** for flowcharts, sequences, and more
- 🔍 **Full-text search** across all documents
- 🌙 **Dark mode** with IntelliJ IDEA-inspired theme
- 📑 **Tabbed interface** for multi-document workflows

## Quick Start

1. Add a directory to watch using the **+ Add Directory** button
2. Browse your markdown files in the file tree
3. Click any file to view it
4. Use the zoom controls to adjust the view

## Code Example

Here's a simple TypeScript example:

\`\`\`typescript
interface Document {
  path: string;
  content: string;
  headings: Heading[];
}

function parseMarkdown(content: string): Document {
  const headings = extractHeadings(content);
  return { path: '', content, headings };
}
\`\`\`

## Mermaid Diagrams

MDViewer supports Mermaid diagrams out of the box:

\`\`\`mermaid
flowchart TD
    A[Open MDViewer] --> B{Select File}
    B -->|Markdown| C[Render Document]
    B -->|Directory| D[Expand Tree]
    C --> E[View Content]
    D --> B
\`\`\`

## Table Example

| Feature | Status | Priority |
|---------|--------|----------|
| File Navigation | ✅ Complete | High |
| Markdown Rendering | ✅ Complete | High |
| Mermaid Support | ✅ Complete | Medium |
| Search | 🚧 In Progress | Medium |
| Edit Mode | 📋 Planned | Low |

## Next Steps

- Read the [API Reference](/Documentation/api-reference.md)
- Check out the [Installation Guide](/Documentation/guides/installation.md)
- Explore [Configuration Options](/Documentation/guides/configuration.md)

---

*Happy documenting! 📝*
`,

  '/Documentation/api-reference.md': `# API Reference

This document describes the internal API used by MDViewer.

## Store API

### useStore

The main Zustand store hook for accessing application state.

\`\`\`typescript
import { useStore } from './store';

function MyComponent() {
  const { files, zoom, setZoom } = useStore();
  
  return (
    <div style={{ zoom: \`\${zoom}%\` }}>
      {files.map(file => <FileNode key={file.id} file={file} />)}
    </div>
  );
}
\`\`\`

### State Shape

\`\`\`typescript
interface AppState {
  // File Panel
  directories: string[];
  files: FileNode[];
  expandedPaths: Set<string>;
  selectedPath: string | null;
  
  // Document Panel  
  documents: Map<string, Document>;
  tabs: Tab[];
  activeTabId: string | null;
  
  // UI State
  panelWidth: number;
  tocWidth: number;
  tocVisible: boolean;
  zoom: number;
}
\`\`\`

## Markdown Utilities

### parseMarkdown

Parses markdown content and returns HTML.

\`\`\`typescript
import { parseMarkdown } from './utils/markdown';

const html = parseMarkdown('# Hello World');
// Returns: '<h1 id="hello-world">Hello World</h1>'
\`\`\`

### extractHeadings

Extracts headings from markdown for TOC generation.

\`\`\`typescript
import { extractHeadings } from './utils/markdown';

const headings = extractHeadings('# Title\\n## Section');
// Returns: [
//   { id: 'title', text: 'Title', level: 1 },
//   { id: 'section', text: 'Section', level: 2 }
// ]
\`\`\`

## Sequence Diagram

\`\`\`mermaid
sequenceDiagram
    participant U as User
    participant A as App
    participant S as Store
    participant R as Renderer
    
    U->>A: Click file
    A->>S: openDocument(path)
    S->>R: parseMarkdown(content)
    R-->>S: { html, headings }
    S-->>A: Update state
    A-->>U: Display document
\`\`\`

## Component Architecture

\`\`\`mermaid
classDiagram
    class App {
        +render()
    }
    class FilePanel {
        +files: FileNode[]
        +onSelect(path)
    }
    class DocumentPanel {
        +tabs: Tab[]
        +activeDocument: Document
    }
    class TocSidebar {
        +headings: Heading[]
        +activeHeading: string
    }
    
    App --> FilePanel
    App --> DocumentPanel
    App --> TocSidebar
\`\`\`
`,

  '/Documentation/guides/installation.md': `# Installation Guide

## Prerequisites

Before installing MDViewer, ensure you have:

- **Node.js** 18.x or later
- **Rust** 1.70 or later (for Tauri)
- **npm** or **yarn** package manager

## Installation Steps

### 1. Clone the Repository

\`\`\`bash
git clone https://github.com/example/mdviewer.git
cd mdviewer
\`\`\`

### 2. Install Dependencies

\`\`\`bash
npm install
\`\`\`

### 3. Run Development Server

\`\`\`bash
npm run tauri dev
\`\`\`

### 4. Build for Production

\`\`\`bash
npm run tauri build
\`\`\`

## Troubleshooting

### Common Issues

#### Build fails on Windows

Ensure you have the Visual Studio Build Tools installed:

\`\`\`powershell
winget install Microsoft.VisualStudio.2022.BuildTools
\`\`\`

#### Rust not found

Install Rust using rustup:

\`\`\`bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
\`\`\`

## Platform-Specific Notes

### macOS

You may need to install Xcode Command Line Tools:

\`\`\`bash
xcode-select --install
\`\`\`

### Linux

Install required system dependencies:

\`\`\`bash
# Ubuntu/Debian
sudo apt install libwebkit2gtk-4.1-dev libappindicator3-dev

# Fedora
sudo dnf install webkit2gtk4.1-devel libappindicator-gtk3-devel
\`\`\`
`,

  '/Documentation/guides/configuration.md': `# Configuration Guide

MDViewer stores its configuration in TOML format.

## Configuration File Location

| Platform | Path |
|----------|------|
| Linux/macOS | \`~/.config/mdviewer/config.toml\` |
| Windows | \`%APPDATA%\\mdviewer\\config.toml\` |

## Configuration Options

### Directories

\`\`\`toml
[directories]
watch = [
  "~/Documents/notes",
  "~/Projects/*/docs",
]
\`\`\`

### Appearance

\`\`\`toml
[appearance]
theme = "intellij-dark"
zoom_default = 100
panel_width = 280
toc_visible = true
\`\`\`

### Editor

\`\`\`toml
[editor]
font_family = "JetBrains Mono"
font_size = 14
line_height = 1.6
auto_save = false
\`\`\`

## Theme Customization

You can customize colors using CSS variables:

\`\`\`css
:root {
  --surface-bg: #1e1e1e;
  --text-primary: #cccccc;
  --text-accent: #4fc1ff;
}
\`\`\`

## Configuration Diagram

\`\`\`mermaid
pie title Configuration Sections
    "Directories" : 25
    "Appearance" : 35
    "Editor" : 25
    "Behavior" : 15
\`\`\`
`,

  '/Notes/meeting-notes.md': `# Meeting Notes

## Project Kickoff - January 15, 2026

### Attendees
- Alice (Product Lead)
- Bob (Tech Lead)
- Carol (Designer)

### Agenda

1. ✅ Review project scope
2. ✅ Discuss technical architecture
3. ✅ Assign initial tasks
4. 📋 Set up development environment

### Decisions

> **Key Decision:** We will use Tauri for the desktop application to minimize bundle size and leverage Rust for performance-critical operations.

### Action Items

- [ ] Alice: Create detailed product requirements
- [ ] Bob: Set up CI/CD pipeline
- [ ] Carol: Design mockups for main views
- [x] Everyone: Install development tools

### Technical Notes

\`\`\`mermaid
gantt
    title Project Timeline
    dateFormat  YYYY-MM-DD
    section Phase 1
    Requirements    :a1, 2026-01-15, 7d
    Design          :a2, after a1, 7d
    section Phase 2
    Development     :a3, after a2, 21d
    Testing         :a4, after a3, 7d
    section Phase 3
    Launch          :a5, after a4, 3d
\`\`\`

---

## Follow-up Meeting - January 22, 2026

*Notes to be added...*
`,

  '/Notes/ideas.md': `# Ideas & Brainstorming

## Feature Ideas

### High Priority 🔴

1. **Split View Mode**
   - Allow viewing two documents side by side
   - Useful for comparing versions

2. **Quick Search**
   - Cmd/Ctrl + P for quick file search
   - Fuzzy matching for file names

### Medium Priority 🟡

3. **Bookmarks**
   - Pin frequently accessed files
   - Quick access sidebar

4. **Recent Files**
   - Track recently opened documents
   - Show in welcome screen

### Low Priority 🟢

5. **Custom Themes**
   - Theme editor UI
   - Import/export themes

## Random Thoughts

\`\`\`
💡 What if we added a "focus mode" that hides 
   all UI except the document content?

💡 Could integrate with Git to show file history?

💡 Voice-to-text for quick note taking?
\`\`\`

## Architecture Sketch

\`\`\`mermaid
graph LR
    A[User] --> B[Tauri App]
    B --> C[React Frontend]
    B --> D[Rust Backend]
    C --> E[State Management]
    D --> F[File System]
    D --> G[File Watcher]
    E --> C
    F --> D
    G --> D
\`\`\`

## Mood Board

Colors that inspire:

| Color | Hex | Usage |
|-------|-----|-------|
| Deep Blue | \`#094771\` | Selected items |
| Electric Cyan | \`#4fc1ff\` | Accents |
| Warm Yellow | \`#dcb67a\` | Warnings |
| Soft Green | \`#89d185\` | Success |
`,
};

// ============================================================
// Utility Functions
// ============================================================

export function getFileContent(path: string): string {
  return DEMO_CONTENT[path] || `# File Not Found\n\nThe file "${path}" does not exist.`;
}

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
