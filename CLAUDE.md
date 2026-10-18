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
npm test                 # Frontend unit tests (Vitest)
npm run tauri build      # Build production desktop app
```

Frontend unit tests are Vitest files next to the code (`src/utils/*.test.ts`; DOM tests declare `// @vitest-environment happy-dom`). There is no linter. The Rust backend has unit tests: `cd src-tauri && cargo test`.

## Architecture

### Frontend (src/)

- **State Management**: Zustand store in `src/store/index.ts` manages all app state with localStorage persistence
  - Key constants: `MAX_RECENT_CLOSED = 10`, `MIN_ZOOM = 50`, `MAX_ZOOM = 1600` (no tab limit)
  - State includes: file tree, documents/tabs, UI panels, zoom level (document `zoom` plus per-panel `panelZoom`)

- **Components** (`src/components/`):
  - `App.tsx` - Main shell; its key handler runs the commands of `utils/commands.ts`
  - `MainMenu.tsx` - Toolbar menu (top left): every command, grouped, with its shortcut
  - `FilePanel.tsx` - Left sidebar file tree browser
  - `DocumentPanel.tsx` - Center markdown renderer with ErrorBoundary. Scroll positions per document are anchored to the block at the top of the view (`utils/scrollAnchor.ts`), so late Mermaid output doesn't move the restored text
  - `TabBar.tsx` - Tab strip: preview tab, context menu, back/forward, overflow scrolling
  - `TocSidebar.tsx` - Right sidebar table of contents
  - `AgentPanel.tsx` - Agent workspace panel (shares the left slot with search and history)
  - `FindBar.tsx` - Ctrl+F find in document (CSS Custom Highlight API; highlights are changed in place, WebKitGTK doesn't repaint replaced ones). A jump and the scroll restore both use `utils/scrollHold.ts` to keep their offset while late output changes the layout
  - `SearchPanel.tsx` - Ctrl+Shift+F text search in open tabs / folders
  - `Editor.tsx` - CodeMirror 6 source editor (Ctrl+E), lazy-loaded; per-document state lives in `utils/editorRegistry.ts`, saving in `utils/save.ts`
  - `WorkspaceMenu.tsx` - Saved workspaces (folders + tabs)
  - `Toolbar.tsx` - Top bar with search, zoom, theme controls
  - `ConfirmDialog.tsx` - Modal question; buttons in the platform's order (`utils/platform.ts`). `SaveAllDialog.tsx` uses it
  - `Resizer.tsx` - Panel separators: drag to resize, drag to the edge or double-click to hide/show
  - `StatusBar.tsx` - Bottom status bar (auto-hides)

- **Hooks** (`src/hooks/`): `useSmoothWheelScroll` - velocity-based wheel scrolling shared by the document, file panel and TOC

- **Commands** (`src/utils/commands.ts`): `buildMenu` is the one list of commands (label, shortcut, `enabled`/`checked`, `run`). The menu renders it and the key handler in `App.tsx` matches key presses against it, so a new command or shortcut goes there, not into either of them. `run` must be safe when `enabled` is false (shortcuts don't check it)

- **Markdown Processing** (`src/utils/markdown.ts`):
  - markdown-it with `html: false` (raw HTML is escaped; every custom renderer rule must escape what it emits with `escapeHtml`)
  - Shiki for syntax highlighting (15+ languages)
  - Mermaid for diagrams with unique ID generation per render
  - HeadingIdGenerator for automatic anchor links
  - `renderFile` dispatches by type (`getFileKind` in `utils/files.ts`): markdown, fb2 (converted via `utils/fb2.ts`), code (one highlighted fence), plain text
  - Block elements carry `data-line` (0-based source line, frontmatter included) to map search results to the rendered DOM

### Backend (src-tauri/)

Rust backend provides Tauri commands:
- `scan_directories` - Recursive file discovery (markdown, plus other text files with `includeTextFiles`; extension lists mirrored in `utils/files.ts`)
- `read_file` / `write_file` - File I/O; `read_file` decodes UTF-16 BOM and XML-declared encodings, `write_file` encodes back the same way (refuses unknown encodings) and replaces the file atomically (temp file + rename, `atomic_write`)
- `pick_directory` / `pick_files` / `export_file` - Native folder picker, file picker (Open File) and save dialog, opened from Rust (the JS dialog plugin isn't exposed)
- `get_file_info` - File metadata
- `start_watching` / `stop_watching` - File system watching (one event per change; `node_modules`/`target`/`.git` ignored). The frontend debounces rescans (300ms, no overlapping scans), `setFiles` reuses unchanged tree nodes, and open documents whose file name changed are reloaded unless dirty (`reloadChangedDocuments` in `App.tsx`)
- `read_history` / `append_to_history` / `clear_history` - `history/history.md` in the config dir, capped at 1000 entries, writes serialized
- `adopt_session_access` - One-time migration of a session saved before the access list existed
- `open_external` - Opens http/https/mailto links in the default browser (opener plugin, Rust-side only)
- `localfile://` protocol - Serves images referenced by documents (`convertFileSrc(path, 'localfile')` in the frontend)

Security: an allowlist (`Access` / `AccessState` in main.rs, persisted to `access.json` in the config dir). Paths are added only from Rust on user actions: the folder and file pickers, drag & drop (`on_window_event`), command-line / single-instance launch paths. Every command resolves its path to a `Target` (as named, and canonicalized with `dunce`) and checks it with `AccessState::check(target, Use::...)`: documents need to be an opened file or a viewable file inside an opened folder, listing/watching needs an opened folder, `localfile://` serves only images. A symlink inside an opened folder passes when its real target fits the use (`Use::fits_target`); paths with `..` only count as their real location. Never add a command that grants access to a path passed from the webview: the only exception, `follow_local_link`, grants after the user confirms a native dialog. 10MB limit for documents, 50MB for images. CSP in `tauri.conf.json`. A navigation guard plugin (`navigation_guard`) blocks any navigation away from the app's own pages; document link clicks are handled in `App.tsx` (anchors, `openExternal`, local files via `followLocalLink` then `openPath`). Updates: `tauri-plugin-updater`, Rust-only (`check_for_update`, `install_update`); the frontend shows `UpdateBanner` and blocks installing while tabs are dirty. Release builds need `TAURI_SIGNING_PRIVATE_KEY`/`_PASSWORD` because `bundle.createUpdaterArtifacts` is on. Remote images render as `span.remote-image` placeholders; `MarkdownViewer` swaps them in with `loadRemoteImages` when the `loadRemoteImages` setting or the per-document "Load images" allows it. Agent workspace (`src-tauri/src/agent.rs`, `AgentPanel.tsx`, `utils/agent.ts`): turned on by `enable_agent_workspace` after a native dialog, stored as `agent_workspace` in `access.json`. While on, `Access::can_open`/`can_stat` also allow `agent::is_agent_document` (markdown in fixed places under `~/.claude`, `~/.codex`, `~/.gemini`; extend `classify_rel` and its test together). Markdown includes Cursor's `.mdc` and `.cursorrules` (`is_markdown_file` / `isMarkdownFile`). `agent::Watch` (started by the `agent_workspace` scan, re-armed on every scan) emits `agent-files-changed`; the frontend debounces it and polls only when `watching` is false. `agent_workspace` scans those plus agent files in opened folders; `mark_read` / `read_snapshot` keep a copy per file in `read-state/` for the "changed since you read it" highlight (`diffContent` + `markChangedBlocks` on `data-line` blocks). Capabilities (`capabilities/default.json`) only allow `core:default`.

Tests: `cargo test` in `src-tauri` (unit tests at the bottom of main.rs and agent.rs). CI runs clippy, the Rust tests and `npm test`.

### Path Alias

TypeScript path alias `@/*` maps to `src/*` (configured in tsconfig.json and vite.config.ts).

## Configuration

There is no config file. UI settings, folders, tabs and workspaces live in localStorage (Zustand persist). The backend's config dir (`dirs::config_dir()/mdviewer`) holds only `access.json`, `history/history.md` and `read-state/` (agent workspace).

## Key Patterns

- React functional components with hooks (no class components except ErrorBoundary)
- CSS custom properties for theming: dark by default, light overrides under `:root[data-theme='light']`; Shiki emits both themes as `--shiki-dark` / `--shiki-light` variables
- Zustand actions return `{ success: boolean; error?: string }` for operations that can fail
- Scroll handlers debounced at 50ms
- Mermaid renders lazily with strict security level
