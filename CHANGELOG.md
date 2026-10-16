# MDViewer - Fixes Applied

## Version 1.1.0

This is the first release with in-app updates.

### Opening files and folders
- Global agent files now appear as a collapsible top-level root alongside opened folders in the Files column. The root can be hidden and restored with the toolbar button.
- Files now filters out subfolders without Markdown. The Files panel has an Agents filter for agent documents inside opened folders, including hidden agent directories; the toolbar 🤖 button shows or hides the separate Global agent files root.
- Opening a folder brings its location into the Files panel, even if the panel was hidden or the folder was already open; picker errors are shown instead of disappearing into the console
- The native File menu now offers Open File, Open Folder, Save and Export actions; Help links to the documentation and issue tracker
- Toolbar icons show visible tooltips, and the Workspaces menu explains how to save a workspace when none exist
- Installers register MDViewer as a viewer for `.md` and `.markdown`; macOS Finder file-open events reach the running app

### Find and scrolling
- Find highlights matches across formatted text, keeps the selected match in view while diagrams and code finish rendering, and responds faster when jumping between results
- Restored scroll positions stay anchored to the visible document block as content changes height

### App icon
- Replaced the desktop icon with the new hexagon design across macOS, Windows and Linux assets

### Main menu (`MainMenu.tsx`, `utils/commands.ts`, `App.tsx`, `main.rs`)
- **Before:** the menu button in the top left corner did nothing
- **After:** it opens a menu of every command with its shortcut: Open File, Open Folder, Save File, Export As (Markdown, HTML), Save All, the View, Edit, Search and Tabs groups, and Settings. Items are greyed out when they don't apply (Save File without changes), toggles show a check mark, and the menu works from the keyboard (arrows, Enter, Escape)
- **Open File** (Ctrl+O / Cmd+O) is new: a native file picker, several files at once (`pick_files`). The picked files are added to the access list, like a picked folder
- **Save All** (Ctrl+Shift+S) asks first and lists the modified files. The dialog's buttons are in the platform's order: Save All then Cancel on Windows, Cancel then Save All on macOS and Linux; Enter saves, Escape cancels
- **Export As → Markdown** is new: markdown as it is (with unsaved edits), fb2 books converted, code as a fenced block
- Settings opens with Ctrl+, / Cmd+,
- Commands are defined once in `utils/commands.ts`; the menu and the key handler both read that list. Shortcuts now work on Cyrillic and other non-Latin keyboard layouts, and AltGr combinations no longer trigger them

### Agent workspace (`agent.rs`, `AgentPanel.tsx`, `utils/agent.ts`, `DocumentPanel.tsx`)
- The Files column has an Agents filter for the folders you open and a collapsible Global agent files root (🤖, Ctrl+Shift+A) for Claude Code, Codex and Gemini CLI user files. Skills, memory and commands show their frontmatter descriptions, and a filter searches titles, descriptions and paths
- Turning it on asks in a native dialog. It adds no folders to the access list: while it's on, markdown in fixed places inside `~/.claude`, `~/.codex` and `~/.gemini` counts as opened (`agent::is_agent_document`); settings, credentials and transcripts stay unreadable
- **What changed since you read it:** a copy of each agent file is kept when you read it (`read-state/` in the config dir). Changed files get a dot and a "Changed since you read them" section; opening one highlights the changed blocks, with **Next change** and **Mark as read**
- Open agent files reload when an agent changes them
- **Rules:** Cursor rules (`.cursor/rules/*.mdc`, legacy `.cursorrules`) and Claude Code rules (`~/.claude/rules`, `.claude/rules`) get their own section, described by what they apply to (`globs` / `paths`, `alwaysApply`). `.mdc` and `.cursorrules` open as markdown everywhere
- **Live updates (`agent::Watch`):** instead of rescanning every 10 s, the backend watches the agents' folders and the opened folders and reports changes to agent files only (transcripts and caches next to them are ignored); the Global agent files root updates about half a second after an agent writes. Polling remains as a fallback if the watcher can't start

### Frontend tests (`src/utils/*.test.ts`)
- Vitest (`npm test`, also run in CI) with tests for the line diff and changed-block marking, file types, and the markdown renderer's escaping of raw HTML, code, diagrams and remote images

### Scrolling (`useSmoothWheelScroll.ts`)
- **Before:** trackpad and Magic Mouse scrolling was animated a second time on top of the system's momentum, and stretched up to 2.5× because their events come fast, so the page overshot and kept gliding
- **After:** only mouse wheel notches are animated; trackpads scroll natively

### Privacy and access

#### Remote images are not loaded until you allow it (`utils/markdown.ts`, `DocumentPanel.tsx`, `SettingsModal.tsx`)
- **Before:** images from the web loaded as soon as a document opened, telling their server when and where it was read (tracking pixels)
- **After:** they render as placeholders and a notice above the document offers **Load images** (this document, this session) or **Always load**. The setting is in Settings → General → Load remote images, off by default. HTML export includes the images

#### Links to files outside the opened folders (`main.rs`, `App.tsx`)
- **Before:** with a single file open, a link to another file next to it failed with "Not inside a folder or file you opened"
- **After:** the backend asks in a native dialog ("Open linked file?") and, if you confirm, adds that file to the access list. The webview can't answer the dialog, so a script still can't widen access on its own. Links to non-documents ask before revealing them in the file manager

#### Symlinks inside opened folders (`main.rs`)
- **Before:** a symlink pointing outside an opened folder was listed in the tree but refused when clicked
- **After:** followed when its target is a document (or, for images, an image), the way an editor would. A `.md` link to a non-document (`notes.md -> ~/.ssh/id_rsa`) is neither listed nor readable, `..` is never followed through a link, and a link back to a parent folder no longer repeats the tree. History records the path as listed

### Updates (`main.rs`, `UpdateBanner.tsx`, `SettingsModal.tsx`, `release.yml`)
- The app checks GitHub for a new version a few seconds after start and shows a bar with **Install and restart**; it installs only when clicked, and not while documents have unsaved changes. Settings → General has the on/off switch and **Check now**
- Update packages are signed in CI and verified against the public key in `tauri.conf.json` before installing. A final `updater-manifest` job writes `latest.json` after all four builds

### Mermaid 11 (`package.json`, `utils/markdown.ts`)
- Mermaid 10.9 → 11.17: architecture, kanban, packet and other newer diagram types render instead of showing an error. Quadrant charts get colors from the app's theme instead of bright blue

### Dependencies
- Vite 5 → 8 and `@vitejs/plugin-react` 4 → 6, which clears the remaining build-tool advisories (esbuild, rollup, postcss); KaTeX (used by Mermaid) pinned to 0.19 for GHSA-238p-pmpm-9mq7. `npm audit` reports no vulnerabilities

### Release
- Optional code signing in the release workflow: macOS signing and notarization, and Windows signing through Azure Trusted Signing, each turned on by adding its secrets (README, "Code signing")
- Backend errors in "Could not open" alerts show their message instead of `[object Object]`

## Version 1.0.4 - Security and robustness review

### Security

#### File access limited to what you opened (`src-tauri/src/main.rs`, `utils/tauri.ts`, `capabilities/default.json`)
- **Before:** a denylist of system folders, compared as strings. It never matched on Windows (`canonicalize()` returns `\\?\C:\...`), left the whole home folder writable (`write_file` could overwrite `~/.bashrc`) and blocked `/tmp`, where downloaded `.md` files often are
- **After:** an allowlist of folders and files you opened: picked in the folder dialog, dropped on the window or passed on the command line ("Open with"). It is kept in Rust, persisted to `access.json` in the config folder, and the webview can't add to it by naming a path. Inside an opened folder only markdown/text files can be read or saved; next to an opened single file only images are served. Paths are canonicalized with symlinks resolved before the check. The folder picker and the HTML export dialog now run in Rust; the JS `fs` and `dialog` plugin permissions are gone. A session saved by an older version is carried over once

#### `localfile://` image protocol (`main.rs`, `utils/markdown.ts`)
- **Before:** served any file on disk, of any size, with `Access-Control-Allow-Origin: *`
- **After:** only images, only inside the access list, at most 50MB, `nosniff`, no CORS header. Image URLs come from `convertFileSrc`, so local images also work on Windows (`http://localfile.localhost/...`), and Windows-absolute image paths (`C:\...`) resolve

#### Content Security Policy (`tauri.conf.json`)
- **Before:** `csp: null`
- **After:** only the app's own scripts (plus WebAssembly for Shiki), no plugins, frames, forms or network requests besides IPC; images may still be remote. `devCsp` is off for `tauri dev` (Vite's HMR needs inline scripts and websockets)

#### Links in documents (`App.tsx`, `utils/files.ts`, `main.rs`)
- **Before:** clicks on links weren't handled. A relative link (`[next](other.md)`) navigated the whole window away from the app, and web links did nothing (the webview ignores `target="_blank"`)
- **After:** `#anchors` scroll within the document, `http`/`https`/`mailto` links open in the default browser or mail app (`open_external`, nothing else is accepted), and links to local files open in a tab, subject to the access list (other files are revealed in the file manager). A navigation guard in the backend keeps the window on the app's own pages, whatever a link or script tries

#### Dependencies
- Tauri 2.9 → 2.12 (Rust crates and `@tauri-apps/api`/`cli`); `npm audit fix` for runtime dependencies (markdown-it, linkify-it, DOMPurify, lodash-es)

#### HTML sanitizer removed (`utils/markdown.ts`)
- **Before:** `sanitizeHtml` ran regexes over the rendered HTML: "Let one = 1" became "Let and>", and code blocks lost parts of tags such as `</code>`, breaking the page
- **After:** removed. markdown-it runs with `html: false`, so raw HTML is escaped, and every custom renderer escapes what it emits

### Fixes

#### Atomic saves (`main.rs`)
- **Before:** `fs::write` over the original (a crash mid-save left it truncated), a silently overwritten `<name>.backup`, and writes followed symlinks anywhere
- **After:** written to a temporary file next to the original, synced and renamed over it, keeping the file's permissions. No more `.backup` files. A symlink is resolved and its target, which must be in the access list, is replaced

#### History (`main.rs`, `HistoryPanel.tsx`)
- Paths with spaces, parentheses or brackets no longer break the markdown link (they are percent-encoded; names are escaped)
- Capped at the newest 1000 entries, and concurrent writes no longer lose entries

#### Mermaid and code blocks decoded twice (`utils/markdown.ts`, `DocumentPanel.tsx`)
- A literal `&lt;` in a diagram, code block or copied code turned into `<`. The source is now decoded exactly once

#### Local images with spaces or non-ASCII names (`utils/markdown.ts`)
- The path was percent-encoded twice and the image failed to load

#### Export as HTML (`Toolbar.tsx`)
- The file name is escaped in `<title>`, and with the History panel open the export no longer saves the history instead of the document

#### `percent_decode` panic (`main.rs`)
- A non-ASCII character right after `%` (e.g. in an "Open with" `file://` URI) panicked

### Cleanup

- **Config that didn't exist:** `load_config`/`save_config` kept settings only in memory and nothing called them. Removed; the docs no longer mention `config.toml` (settings live in the app's own storage)
- **Unused dependencies:** removed `tauri-plugin-fs`, `@tauri-apps/plugin-fs`, `@tauri-apps/plugin-dialog` (JS), `tokio`, `walkdir`, `glob`, `toml`, the unused `file_cache`, and ~500 lines of unused demo data in `utils/files.ts`
- **Fonts:** Inter and JetBrains Mono are bundled (`@fontsource`) instead of loaded from Google Fonts, so they work offline
- **Icons:** regenerated from a vector source (`icons/icon.svg`): `128x128@2x.png` is now 256×256, `icon.icns` covers up to 1024px, `icon.ico` has 16–256px
- **`mdviewer.desktop`:** no hardcoded `/home/fx/` path
- **Tests:** Rust unit tests for the access list, atomic writes, history and `percent_decode`; CI runs clippy and the tests

## Version 1.0.3 - todo/todo.md Round 2

#### "Open with" did not open the file (`src-tauri/src/main.rs`, `App.tsx`, `mdviewer.desktop`)
- **Before:** command-line arguments were ignored, so `mdviewer %F` from a file manager only launched the app
- **After:** launch paths (plain paths or `file://` URIs, relative to the caller's cwd) are opened once the previous session is restored; files go to tabs, folders go to the file tree. `tauri-plugin-single-instance` sends files from a second launch to the running window and focuses it. The desktop entry declares `MimeType=text/markdown;...`

#### Tab context menu (`TabBar.tsx`, `store/index.ts`)
- **Before:** tabs could only be closed one at a time (Ctrl+Shift+W force-closed everything, discarding unsaved changes)
- **After:** right-click a tab for Close / Close Others / Close to the Left / Close to the Right / Close All, Keep Open, Copy Path and Reveal in File Manager. Bulk closes (and Ctrl+Shift+W) keep tabs with unsaved changes open and say which

#### Preview tab (`TabBar.tsx`, `FilePanel.tsx`, `store/index.ts`)
- **Before:** every click in the file tree opened another tab
- **After:** VS Code model - a single click opens the file in the preview tab (italic title), which the next single click reuses; double-clicking the file or the tab, the pin button, "Keep Open" or editing makes it permanent. Files opened any other way (drop, "Open with", history) open permanently

#### Tab strip scrolling (`TabBar.tsx`, `styles/index.css`)
- **Before:** overflowing tabs could only be reached by keyboard
- **After:** the mouse wheel scrolls the strip horizontally, and `[<] [tabs] [>]` buttons appear when the tabs overflow; scrolling never switches tabs. The active tab is scrolled into view when it changes

#### Back / forward between tabs (`TabBar.tsx`, `App.tsx`, `store/index.ts`)
- **After:** back/forward buttons at the start of the tab bar, Alt+Left/Right and the mouse back/forward buttons walk the tab activation history (closed tabs are skipped)

#### Wheel scrolling follows the wheel (`hooks/useSmoothWheelScroll.ts`)
- **Before:** every notch eased towards a target at a fixed rate, so slow and fast spinning felt the same
- **After:** each notch adds its distance to a pending budget and the time between notches sets the speed. The scroll ramps up gradually, and when the notches stop it brakes smoothly into the remaining distance instead of halting. Fast spinning (notches < 60ms apart) also covers up to 2.5x the distance. The file panel and the TOC use the same scrolling now. Tuning constants sit at the top of the hook

#### Separate zoom for the file panel and the TOC (`App.tsx`, `FilePanel.tsx`, `TocSidebar.tsx`, `store/index.ts`)
- **Before:** Ctrl + wheel anywhere zoomed the document
- **After:** Ctrl + wheel zooms what is under the cursor: the file panel and the TOC each have their own zoom (50%..400%, persisted), everywhere else it is the document zoom. A panel that is not at 100% shows its zoom in the header; click it to reset. Keyboard zoom (Ctrl +/-/0) and the toolbar still control the document

#### Hiding side panels with the separator (`Resizer.tsx`, `App.tsx`, `store/index.ts`)
- **Before:** separators only resized between fixed limits; panels could only be hidden from the toolbar/shortcuts, and the file panel's visibility was forgotten on restart
- **After:** dragging a separator towards the window edge past half the panel's minimum width hides the panel (file/history panel on the left, TOC on the right); double-clicking it (or Enter) toggles the panel. A hidden panel's separator stays at the window edge, and a grip slides in when the cursor comes within 24px of that edge - click it, double-click or drag it out to bring the panel back. File panel visibility is now persisted like the TOC's

#### Find in document (`FindBar.tsx`, `utils/search.ts`)
- **Before:** Ctrl+F was a placeholder
- **After:** Ctrl+F opens a find bar over the document (seeded with the selected text): match case / whole word / regex toggles, "3 of 17" counter, Enter / Shift+Enter / F3 / Shift+F3 to step, Escape to close. Matches are painted with the CSS Custom Highlight API, so the rendered document is never modified; matches may span inline formatting (`foo **bar**`). The search follows late Shiki/Mermaid output and file reloads without jumping the view

#### Search in open tabs and folders (`SearchPanel.tsx`, `utils/markdown.ts`)
- **Before:** Ctrl+Shift+F was a placeholder; only file names could be filtered
- **After:** Ctrl+Shift+F (or the toolbar button) opens a search panel in the left slot with the same options and an "Open tabs / Folders" scope. Folder search covers every markdown file in the file tree (open tabs are searched in memory, the rest read in parallel), results are grouped per file with the match highlighted, and stop at 2000 matches. Clicking a result opens the document (preview tab) and jumps to exactly that match: rendered blocks now carry a `data-line` source line, which maps the source match to the rendered one

#### Other text files (`src-tauri/src/main.rs`, `utils/files.ts`, `utils/markdown.ts`, `utils/fb2.ts`)
- **Before:** only `.md` / `.markdown` files were listed and opened
- **After:** code and config files (scala, py, ts, rs, json, yaml, toml, ini/conf, sh, ...) open as one Shiki-highlighted code block; txt/log/csv/rst/... as wrapped plain text; fb2 books are converted to markdown (title page, nested chapters as headings - so the TOC lists the chapters -, epigraphs, poems, emphasis, notes). Setting *Show text files* (default on) controls whether the file tree lists them; drops and "Open with" accept them either way. `read_file` now decodes non-UTF-8 files: UTF-16 by BOM, and the encoding named in an XML declaration (fb2 books are often windows-1251); anything else falls back to lossy UTF-8. Files over 512KB are not highlighted

#### Compact folders (`FilePanel.tsx`, `styles/index.css`)
- **Before:** deep single-folder chains took one nested row per folder; long root paths were cut with an ellipsis
- **After:** like VS Code, a folder whose only child is a folder is shown as one row `src/main/scala/cc/teob` - long chains and root paths wrap at the `/` when the panel is narrow. Files get code/book icons by type

#### Opening folders (`App.tsx`, `store/index.ts`)
- **Before:** every opened folder was added as another root, even when it was already inside an open one; a new folder showed collapsed
- **After:** opening a folder inside an open one expands the tree down to it and selects it instead of adding a duplicate root; opening a parent of open folders replaces them (keeping their expanded state). A newly added folder is expanded down to its first markdown file (the shallowest one, README/index first), which opens in the preview tab. Selected tree rows scroll into view

#### Light theme (`styles/index.css`, `main.tsx`, `utils/markdown.ts`, `Toolbar.tsx`)
- **Before:** the theme button only flipped its own icon
- **After:** the toolbar button switches between the dark and a light (IntelliJ / VS Code light) theme; the choice is persisted and applied before the first paint. Code blocks are highlighted once with both Shiki themes as CSS variables, so switching needs no re-highlighting; Mermaid diagrams re-render in the new colors. The markdown text color setting is now per theme, and *Export as HTML* uses the current theme

#### Workspaces (`WorkspaceMenu.tsx`, `store/index.ts`)
- **After:** the toolbar's workspace menu saves the open folders, expanded tree state, tabs and active tab under a name, and switches between saved workspaces (the current one is saved first; tabs whose file is gone are dropped). Workspaces can be re-saved, deleted, or detached from. Stored with the other settings (localStorage), not in the unused TOML config

#### Edit mode (`Editor.tsx`, `DocumentPanel.tsx`, `utils/save.ts`, `src-tauri/src/main.rs`)
- **Before:** the edit button was a placeholder, and Ctrl+S only cleared the dirty flag without writing anything
- **After:** Ctrl+E (or the toolbar button) opens a CodeMirror 6 editor: markdown and fb2 get a live preview next to it (the preview follows the editor's scroll via `data-line`), code and text files the editor alone. Markdown syntax colors, line numbers, undo history per tab, the editor's own Ctrl+F search, Tab indents, and it follows the document zoom and theme. Ctrl+S (or the Save button) writes the file; closing a dirty tab or the window asks first. CodeMirror is lazy-loaded, so startup does not pay for it
- `write_file` keeps the file's encoding: an XML declaration naming a legacy encoding (fb2 in windows-1251) is honored, UTF-16/UTF-8 BOM files keep their BOM, and files in an unknown non-UTF-8 encoding are refused instead of being corrupted. The backup is now `<name>.backup` (it was always `<name>.md.backup`)

#### Unresponsive UI while the file list updates (`App.tsx`, `FilePanel.tsx`, `utils/files.ts`, `src-tauri/src/main.rs`)
- **Before:** every single file-system event (a checkout or build sends hundreds, including from `node_modules`, `target` and `.git`) triggered a full rescan, and each rescan and each keystroke in the file filter re-rendered the whole tree - the main thread was busy and typing lagged. (The documented 300ms watcher debounce only applied to notify's polling backend, not inotify.)
- **After:** watcher events inside `node_modules`, `target` and `.git` are dropped; rescans wait for 300ms of quiet and never overlap; a rescan keeps unchanged tree nodes, and memoized rows skip re-rendering; filtering renders in the background (deferred), so the filter box always responds first

#### Empty strip under a hidden status bar (`styles/index.css`)
- **Before:** the auto-hiding status bar only slid out of view - its 28px row stayed in the layout as an empty panel
- **After:** unpinned, the status bar overlays the bottom edge (shown when the cursor comes near it) and takes no space when hidden; pinned, it has its own row so it never covers the document
- WebKitGTK left a stale horizontal-scrollbar image in the viewer after unpinning (until the text was scrolled); the panels area is now force-repainted after pin changes and after the bar's slide animation

#### Tab limit removed (`store/index.ts`)
- **Before:** at most 20 tabs
- **After:** no limit

#### Zoom up to 1600% (`store/index.ts`, `Toolbar.tsx`)
- **Before:** 50%..200% in +/-10 steps
- **After:** 50%..1600% in x1.1 steps; the toolbar slider is logarithmic

#### Hidden folders in the file panel (`src-tauri/src/main.rs`)
- **Before:** every dot-entry was skipped
- **After:** dot-folders/files are scanned like any other (folders without markdown are still pruned); only `node_modules` and `target` are skipped

#### Dark mode text color (`store/index.ts`)
- **Before:** `#cccccc`
- **After:** `#9a9996`; stored settings still at the old default are migrated, custom colors are kept

## Version 1.0.2 - todo/todo.md Round

### Rendering / Platform

#### Torn screen on Raspberry Pi (`src-tauri/src/main.rs`)
- **Before:** WebKitGTK used its DMA-BUF renderer, which tears/corrupts the window on Raspberry Pi and some other ARM GL drivers ([tauri#9289](https://github.com/tauri-apps/tauri/issues/9289))
- **After:** `WEBKIT_DISABLE_DMABUF_RENDERER=1` is set on Linux before the webview starts; `MDVIEWER_ENABLE_DMABUF=1` opts back out, `MDVIEWER_DISABLE_COMPOSITING=1` adds the heavier `WEBKIT_DISABLE_COMPOSITING_MODE` fallback, and an explicitly exported value is never overridden

### Tabs & Scrolling

#### Scroll position shared by all tabs (`DocumentPanel.tsx`, `store/index.ts`)
- **Before:** every tab rendered into the same scroll container, so switching tabs kept the previous document's offset
- **After:** `scrollPositions` (keyed by document path) is persisted; switching tabs stashes the outgoing offset and re-applies the incoming one, re-asserting it through a `ResizeObserver` while Shiki/Mermaid/images settle, and stopping as soon as the user scrolls

#### Dead tabs after restart (`store/index.ts`, `App.tsx`)
- **Before:** tabs were persisted without their `id`, so `closeDocument(undefined)` matched every tab (closing one closed all) and no document was ever reloaded - the restored tabs did nothing when clicked
- **After:** tabs persist with `id` + `activeTabId`, any legacy/missing id is regenerated on rehydrate, and startup re-reads each tab's file and drops only the ones that no longer exist. `migrate` keeps existing settings across the storage version bump

### UI

#### Toolbar height (`styles/index.css`, `Toolbar.tsx`)
- **Before:** 48px bar with 36px buttons and 32px inputs; tab bar 36px
- **After:** 32px bar with 24px buttons, 24px search/zoom controls and 16px icons; tab bar 30px

#### Zoom did not widen the document (`styles/index.css`, `DocumentPanel.tsx`)
- **Before:** the text column was pinned at 800px, so zooming only made the text bigger inside the same width
- **After:** the column is `calc(800px * zoom)`, capped by the viewport - it widens with zoom until it fills the window, then the text simply re-wraps

#### Smooth scrolling (`DocumentPanel.tsx`, `SettingsModal.tsx`)
- **Before:** WebKitGTK scrolled in discrete per-notch jumps, and every scroll event re-rendered the whole app through the shared store subscription
- **After:** wheel scrolling eases toward an accumulated target (respects `prefers-reduced-motion`, nested scrollers and Mermaid zoom, toggle in Settings > General), heading tracking uses cached offsets instead of a layout read per heading, `setActiveHeadingId` is a no-op when unchanged, and every component subscribes to individual store fields instead of the entire state

#### Drag & drop (`App.tsx`, `utils/tauri.ts`, `main.rs`)
- **New:** dropping markdown files opens them in tabs, dropping folders adds them to the file tree, with a drop overlay while dragging. Uses Tauri's native drag & drop event (the only one that carries real file paths); `get_file_info` now reports `isDirectory`


## Version 1.0.1 - Bug Fixes

### 🔴 Critical Fixes

#### 1. Memory Leak in Event Listeners (DocumentPanel.tsx)
- **Before:** Event listeners added to copy buttons on every render, never cleaned up
- **After:** Using event delegation with single listener on container, properly cleaned up in useEffect return

#### 2. XSS Vulnerability (markdown.ts)
- **Before:** `html: true` in MarkdownIt config allowed arbitrary HTML injection
- **After:** 
  - Set `html: false` to disable raw HTML
  - Added `sanitizeHtml()` function that strips script tags, event handlers, javascript: URLs
  - Mermaid security level set to 'strict'
  - External links get `rel="noopener noreferrer"`

#### 3. Set/Map Serialization (store/index.ts)
- **Before:** Used `Set` and `Map` which don't serialize to JSON
- **After:** 
  - `expandedPaths` is now `string[]` array
  - `documents` is now `Record<string, Document>` object
  - Added Zustand `persist` middleware for session storage

#### 4. Tab Limit Not Enforced (store/index.ts)
- **Before:** No limit on tabs
- **After:**
  - `MAX_TABS = 20` constant exported
  - `openDocument()` returns `{ success: boolean; error?: string }` 
  - Returns error if limit exceeded
  - UI shows alert when limit reached

#### 5. Missing `dirs` Crate (Cargo.toml)
- **Before:** Code referenced `dirs::home_dir()` but crate not in dependencies
- **After:** Added `dirs = "5.0"` to dependencies

### 🟠 High Priority Fixes

#### 6. React Error Boundary (DocumentPanel.tsx)
- Added `ErrorBoundary` class component wrapping `MarkdownViewer`
- Catches render errors and displays friendly message with retry button

#### 7. Mermaid ID Collisions (markdown.ts)
- **Before:** Used sequential index `mermaid-${i}`
- **After:** Uses `mermaid-${Date.now()}-${random}` for uniqueness

#### 8. Scroll Handler Not Debounced (DocumentPanel.tsx)
- **Before:** DOM query on every scroll event
- **After:**
  - Custom `debounce()` utility with 50ms delay
  - Cached headings reference (`headingsRef`)
  - Cleanup with `debouncedScrollHandler.cancel()`

#### 9. Path Traversal Vulnerability (main.rs)
- **Before:** No validation of paths
- **After:**
  - `FORBIDDEN_PATHS` array blocks system directories
  - `expand_path()` canonicalizes paths and validates
  - `is_path_allowed()` checks against blocklist
  - `MAX_SCAN_DEPTH` and `MAX_FILES_PER_DIRECTORY` limits

#### 10. File Watching Added (main.rs)
- Added `start_watching()` and `stop_watching()` Tauri commands
- Uses `notify` crate with 300ms debounce
- Emits `file-change` events to frontend

### 🟡 Medium Priority Fixes

#### 11. Duplicate Heading IDs (markdown.ts)
- Created `HeadingIdGenerator` class that tracks used IDs
- Appends `-1`, `-2`, etc. for duplicates
- Resets on each document render

#### 12. Keyboard Shortcuts (App.tsx)
- **Ctrl+W:** Close current tab
- **Ctrl+Shift+W:** Close all tabs
- **Ctrl+Shift+T:** Reopen closed tab
- **Ctrl+Tab / Ctrl+Shift+Tab:** Next/previous tab
- **Ctrl+1-9:** Go to tab by index
- **Ctrl+Shift+O:** Toggle TOC
- **Ctrl+B:** Toggle file panel
- **Ctrl+Plus/Minus/0:** Zoom in/out/reset
- **Ctrl+P:** Focus search
- **Ctrl+Scroll:** Zoom in/out

#### 13. Zoom Scaling Fixed (DocumentPanel.tsx)
- **Before:** `fontSize: ${zoom}%` didn't scale images/diagrams
- **After:** Using CSS `zoom: zoom / 100` for proper scaling

#### 14. Status Bar Flicker Fixed (StatusBar.tsx)
- **Before:** Rapid show/hide near boundary
- **After:**
  - Hysteresis with different show (40px) and hide (80px) thresholds
  - Delayed hide (300ms)
  - Pin button to keep visible
  - `useMemo` for stats calculation

#### 15. Unsaved Changes Warning (store/index.ts, DocumentPanel.tsx)
- Added `showUnsavedModal` and `pendingCloseTabId` state
- `closeDocument(tabId, force)` checks dirty state
- Modal component with Cancel/Close options
- `confirmCloseDocument()` and `cancelCloseDocument()` actions

### Additional Improvements

#### Store Enhancements
- `originalContent` field for dirty detection
- `recentlyClosed` array for Ctrl+Shift+T
- `reopenClosedTab()` action
- `activateNextTab()`, `activatePrevTab()`, `activateTabByIndex()` actions
- `toggleTocVisible()` action
- `zoomIn()`, `zoomOut()`, `resetZoom()` actions
- `statusBarPinned` state

#### Rust Backend Enhancements
- `AppError` struct for structured error responses
- Automatic backup before overwriting files
- File size limit check (10MB max)
- Hidden file/folder filtering (`.git`, `node_modules`, `target`)
- Sorted directory listing (folders first, then alphabetically)

#### CSS Additions
- Modal overlay and dialog styles
- Error state styling
- Status bar pin button
- Empty state keyboard hint
- Code block copy button states
- Mermaid placeholder and error states

## Files Changed

| File | Changes |
|------|---------|
| `src-tauri/Cargo.toml` | Added `dirs = "5.0"` |
| `src-tauri/src/main.rs` | Security, file watching, error handling |
| `src/store/index.ts` | Serialization, tab limits, actions |
| `src/utils/markdown.ts` | XSS protection, unique IDs |
| `src/components/DocumentPanel.tsx` | Memory leak, error boundary, debounce |
| `src/components/StatusBar.tsx` | Flicker fix, pin button |
| `src/components/Toolbar.tsx` | Use new store methods |
| `src/components/FilePanel.tsx` | Use new store structure |
| `src/App.tsx` | Keyboard shortcuts |
| `src/styles/index.css` | New component styles |

## Testing Recommendations

1. Open 20+ files to verify tab limit
2. Edit file and close without saving to verify modal
3. Check Ctrl+W, Ctrl+Tab shortcuts
4. Verify zoom affects images and diagrams
5. Test status bar hover/pin behavior
6. Check Mermaid renders without ID conflicts
7. Verify no memory growth over extended use
