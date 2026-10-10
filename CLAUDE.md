# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MDViewer is a cross-platform markdown document viewer built with Tauri 2.0, React 18, and TypeScript. It renders markdown with Shiki syntax highlighting, Mermaid diagram support, and features a tabbed multi-document interface.

## Build Commands

```bash
npm install              # Install dependencies
npm run dev              # Start Vite dev server (port 1420)
npm run tauri dev        # Run full Tauri desktop app in dev mode
npm run build            # TypeScript check + Vite build
npm run tauri build      # Build production desktop app
```

No test runner or linter is currently configured.

## Architecture

### Frontend (src/)

- **State Management**: Zustand store in `src/store/index.ts` manages all app state with localStorage persistence
  - Key constants: `MAX_RECENT_CLOSED = 10`, `MIN_ZOOM = 50`, `MAX_ZOOM = 1600` (no tab limit)
  - State includes: file tree, documents/tabs, UI panels, zoom level (document `zoom` plus per-panel `panelZoom`)

- **Components** (`src/components/`):
  - `App.tsx` - Main shell with keyboard shortcut handlers
  - `FilePanel.tsx` - Left sidebar file tree browser
  - `DocumentPanel.tsx` - Center markdown renderer with ErrorBoundary
  - `TabBar.tsx` - Tab strip: preview tab, context menu, back/forward, overflow scrolling
  - `TocSidebar.tsx` - Right sidebar table of contents
  - `FindBar.tsx` - Ctrl+F find in document (CSS Custom Highlight API)
  - `SearchPanel.tsx` - Ctrl+Shift+F text search in open tabs / folders
  - `Editor.tsx` - CodeMirror 6 source editor (Ctrl+E), lazy-loaded; per-document state lives in `utils/editorRegistry.ts`, saving in `utils/save.ts`
  - `WorkspaceMenu.tsx` - Saved workspaces (folders + tabs)
  - `Toolbar.tsx` - Top bar with search, zoom, theme controls
  - `Resizer.tsx` - Panel separators: drag to resize, drag to the edge or double-click to hide/show
  - `StatusBar.tsx` - Bottom status bar (auto-hides)

- **Hooks** (`src/hooks/`): `useSmoothWheelScroll` - velocity-based wheel scrolling shared by the document, file panel and TOC

- **Markdown Processing** (`src/utils/markdown.ts`):
  - markdown-it for parsing with HTML sanitization
  - Shiki for syntax highlighting (15+ languages)
  - Mermaid for diagrams with unique ID generation per render
  - HeadingIdGenerator for automatic anchor links
  - `renderFile` dispatches by type (`getFileKind` in `utils/files.ts`): markdown, fb2 (converted via `utils/fb2.ts`), code (one highlighted fence), plain text
  - Block elements carry `data-line` (0-based source line, frontmatter included) to map search results to the rendered DOM

### Backend (src-tauri/)

Rust backend provides Tauri commands:
- `scan_directories` - Recursive file discovery (markdown, plus other text files with `includeTextFiles`; extension lists mirrored in `utils/files.ts`)
- `read_file` / `write_file` - File I/O with path validation; `read_file` decodes UTF-16 BOM and XML-declared encodings, `write_file` encodes back the same way (refuses unknown encodings) and keeps a `<name>.backup`
- `get_file_info` - File metadata
- `load_config` / `save_config` - TOML config management
- `start_watching` / `stop_watching` - File system watching (one event per change; `node_modules`/`target`/`.git` ignored). The frontend debounces rescans (300ms, no overlapping scans) and `setFiles` reuses unchanged tree nodes

Security: Path validation with forbidden directories blocklist, 10MB file size limit.

### Path Alias

TypeScript path alias `@/*` maps to `src/*` (configured in tsconfig.json and vite.config.ts).

## Configuration

App config stored in TOML format:
- Linux/macOS: `~/.config/mdviewer/config.toml`
- Windows: `%APPDATA%\mdviewer\config.toml`

## Key Patterns

- React functional components with hooks (no class components except ErrorBoundary)
- CSS custom properties for theming: dark by default, light overrides under `:root[data-theme='light']`; Shiki emits both themes as `--shiki-dark` / `--shiki-light` variables
- Zustand actions return `{ success: boolean; error?: string }` for operations that can fail
- Scroll handlers debounced at 50ms
- Mermaid renders lazily with strict security level
