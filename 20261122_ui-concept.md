# Shared workbench UI for MDViewer and Agent MCR

Spec · draft · 2026-11-22

This replaces the tiling-layout concept prompt that was in this file. That text is kept word for word in Appendix B; Appendix A says what became of each of its requirements.

## 1. Goal

MDViewer and Agent MCR look and behave as one product, and their UI code comes from one place. The shared code knows nothing about either app's store or backend: it gets what it needs through small interfaces that each app supplies.

Not goals:

- Merging the apps. They keep separate backends, releases and feature sets.
- Sharing Rust code. Only the frontend is shared.
- Blender-style corner gestures (Appendix A).
- Bringing back what Agent MCR removed (file tree, folder search, history, saved workspaces, Open File/Folder, drag and drop). Those stay in MDViewer only.

## 2. Starting point

The facts the design depends on, as of 2026-11-22. Screenshots: `docs/20261122_mdviewer-mj-md.png`, `docs/20261122_mdviewer-mj-sessions.png`, agent-mcr `docs/20261122_agent-mcr.png`.

**The code is copied and synced by hand.** Agent MCR began as "Initial import of MDViewer 1.0.3". The repos share no git history, and agent-mcr has no `upstream` remote (its CLAUDE.md says it has one).

| State | Files (lines that differ) |
|---|---|
| Identical | `TabBar`, `TocSidebar`, `Resizer`, `ConfirmDialog`, `SaveAllDialog`, `WorkspaceSwitch`, `PanelZoomBadge`, `SessionMemoryBrowser`, `utils/{export,save,scrollAnchor,scrollHold,editorRegistry,fb2,search}` |
| Nearly identical | `DocumentPanel` (11), `StatusBar` (7), `markdown` (6), `Editor` (2), `MainMenu` (2), `useSmoothWheelScroll` (2) |
| Far apart | `styles/index.css` (576), `SettingsModal` (542), `App.tsx` (452), `store/index.ts` (379), `utils/tauri.ts` (220), `files.ts` (172), `SessionWorkspace` (167), `AgentPanel` (166) |
| Agent MCR only, reusable | `src/ui` (controls), `src/plugins/sdk.ts` (plugin registry), `utils/paneLayout.ts` (split tree) |

**The "shared" components depend on the app.** `TabBar` imports the store and `openInExplorer`. `FindBar` reads 9 store fields and `DocumentPanel` more than 15, and `DocumentPanel` calls `readSnapshot`. `markdown.ts` calls Tauri's `convertFileSrc`, and `save.ts` and `export.ts` use both the store and Tauri. These components still work in both apps only because both stores have kept the same fields.

**There are three colour vocabularies.**
- MDViewer's names in `index.css` (`--surface-bg`, `--text-primary`, `--border-default`, …).
- The Sessions page's own palette (`--sc-*`, blue-black with a mint accent, `sessions.css:1-2`).
- Agent MCR's semantic set (`--canvas`, `--text`, `--line`, plus spacing, type and radius scales), defined at the top of `settings-modal.css` as aliases of MDViewer's names.

Agent MCR's `harness.css` and `command-panel.css` also hardcode colours. `#e0a23c` alone appears 12 times, for quiet or stopped sessions and for high context use.

**There are two splitters.**
- MDViewer's `Resizer`: pixel widths, collapse by dragging, an edge grip, keyboard support.
- Agent MCR's `paneLayout.ts` with `.hs-divider`: splits into exactly two, ratios clamped to 0.15–0.85, no keyboard, no collapse.

Live keeps every terminal mounted and moves it into whichever pane shows it (`PaneSlot` and `HiddenPaneSlot` in `LiveWorkspace.tsx`).

**The plugin SDK is tied to the harness.** `sdk.ts` imports `Hosted`, `Resumable`, `HarnessStatus` and `Session`, and every override slot is named `live:*`.

**What looks different on screen:**

| | MDViewer Documents | MDViewer Sessions | Agent MCR Live |
|---|---|---|---|
| Colours | Grey, blue accent | Own palette, mint accent | Grey, plus hardcoded colours |
| Controls | Flat icon buttons | Bordered text buttons | Segmented control, settings gear |
| Panes | Flush, uppercase titles | Rounded card | Floating rounded pane with a margin |
| Bottom bar | Status bar | Own footer | None |
| Main menu, theme switch | Yes | No | No |

MDViewer's "Sessions" page is what Agent MCR calls "Journal". There are three different search entries, and the palette's commands are kept apart from `buildMenu`.

**Conflicts to resolve:**
- Agent MCR opens its palette with ⌘S on macOS (`platform.ts:25-29`), which is Save in MDViewer's command list.
- React is 18 in MDViewer and 19 in Agent MCR; lucide-react is 0.263 against 1.73. The rest of the UI stack is on the same versions.

## 3. Architecture

### 3.1 Layers

```
app (mdviewer | agent-mcr)    composition, Tauri adapters, app-only features, app store
  │
  ├── features                 reader · journal                    (packages)
  │                            files · search · history            (MDViewer only, app code)
  │                            live · board · slack · harness      (Agent MCR only, app code)
  ├── workbench                shell, surfaces and views, layout tree, pane types,
  │                            commands, palette, settings, status bar, plugin registry
  ├── ui                       controls
  └── tokens                   CSS variables, light theme
```

The rules:
- Each layer imports only from the layers below it.
- A feature never imports another feature.
- Shared packages never import `@tauri-apps/*`, an app's `src/`, the `@/` alias or an app store.

### 3.2 Packages and repos

The packages live in npm workspaces inside mdviewer-mj:

| Package | Contents | May import |
|---|---|---|
| `packages/tokens` (`@lambda-house/tokens`) | `tokens.css` | nothing |
| `packages/ui` (`@lambda-house/ui`) | controls, `ui.css` | tokens, react, react-dom, lucide-react, clsx |
| `packages/workbench` (`@lambda-house/workbench`) | §5 | ui, tokens, the libraries of `ui`, zustand |
| `packages/reader` (`@lambda-house/reader`) | §6.1 | workbench, ui, tokens, the libraries of `workbench`, markdown-it, shiki, mermaid, codemirror, `@codemirror/*`, `@lezer/*` |
| `packages/journal` (`@lambda-house/journal`) | §6.2 | workbench, ui, tokens, the libraries of `workbench` |

The exact lists are `RANK` and `EXTERNAL` in `packages/layers.test.ts`.

Packages ship TypeScript source (`"main": "src/index.ts"`). Vite and Vitest compile them together with the app, so there is no build or publish step.

Agent MCR takes in `packages/` with `git subtree` (decided 2026-11-22). Agent-mcr fetches mdviewer-mj as `upstream`, splits out its `packages/` history with `git subtree split --prefix=packages upstream/main`, and merges the result with `git subtree add` the first time and `git subtree merge … --squash` after that. The exact commands are in `packages/README.md`.

Shared changes land in mdviewer-mj first. A change that had to be made in agent-mcr goes back to mdviewer-mj as a patch (`git format-patch --relative=packages` in agent-mcr, `git am --directory=packages` in mdviewer-mj) before anything else touches that package. If a third app ever uses the packages, move `packages/` to its own repo.

**Enforcement.** There is no linter, so a test does it. `packages/layers.test.ts` reads every import in `packages/*/src` and fails on:
- a package the table above doesn't allow;
- `@tauri-apps/` or `@/`;
- a relative path that leaves its package.

Each package also has its own `tsconfig.json` without the app's `@/*` path.

### 3.3 Hosts

Every shared layer that needs the outside world declares a host interface. Each app implements it with Tauri, and tests implement it with fakes. Hosts are passed in once, where the app assembles itself:

```tsx
<Workbench
  host={workbenchHost}
  plugins={[readerPlugin(readerHost), journalPlugin(journalHost), ...appPlugins]}
/>
```

A host method is optional when only one app has that capability. UI for a missing capability is not rendered.

## 4. Tokens and look

### 4.1 Tokens

`packages/tokens/tokens.css` defines one vocabulary with concrete values and no fallbacks. It takes Agent MCR's semantic names and MDViewer's current values.

| Token | Dark | Light | Replaces |
|---|---|---|---|
| `--canvas` | `#1e1e1e` | `#ffffff` | `--surface-bg`, `--sc-bg` |
| `--surface-1` | `#252526` | `#f3f3f3` | `--surface-elevated`, `--bg-panel`, `--sc-panel` |
| `--surface-2` | `#2d2d30` | `#f7f7f7` | `--surface-overlay`, `--layer-1`, `--bg-subtle`, `--sc-card` |
| `--input` | `#3c3c3c` | `#e9e9e9` | `--surface-input`, `--bg-input`, `--layer-2` |
| `--hover` | `#2a2d2e` | `#e8e8e8` | `--hover-bg`, `--layer-hover`, `--bg-hover` |
| `--selected` | `#094771` | `#cce4f7` | `--selected-bg`, `--layer-selected` |
| `--pressed` | `#04395e` | `#dbe9f8` | `--active-bg` |
| `--line` | `#3c3c3c` | `#d0d0d0` | `--border-default`, `--sc-border` |
| `--line-subtle` | `#2d2d30` | `#e4e4e4` | `--border-subtle` |
| `--line-strong` | `#555558` | `#b8b8b8` | border literals in Agent MCR's CSS |
| `--focus` | `#007acc` | `#005fb8` | `--focus-ring`, `--border-active` |
| `--text` | `#cccccc` | `#1f1f1f` | `--text-primary`, `--text-soft`, `--sc-text` |
| `--text-muted` | `#858585` | `#6a6a6a` | `--text-secondary`, `--sc-muted` |
| `--text-faint` | `#5a5a5a` | `#a6a6a6` | `--text-disabled` |
| `--text-inverse` | `#1e1e1e` | `#ffffff` | same name |
| `--accent` / `-bg` / `-line` | `#4fc1ff` / 14 % / 40 % | `#005fb8` / 12 % / 35 % | `--text-accent`, `--info*`, `--sc-accent` |
| `--ok` / `-bg` / `-line` | `#89d185` / `#1d5a2a` / 40 % | `#107c10` / `#dff6dd` / 35 % | `--success-*` |
| `--warn` / `-bg` / `-line` | `#cca700` / `#5a4a1d` / 40 % | `#7a5d00` / `#fff4ce` / 35 % | `--warning-*`, `#e0a23c` |
| `--danger` / `-bg` / `-line` | `#f48771` / `#5a1d1d` / 40 % | `#c42b1c` / `#fde7e6` / 35 % | `--error-*` |
| `--overlay` | `rgba(0,0,0,.55)` | `rgba(0,0,0,.25)` | Agent MCR's dialog backdrop |

The percentages are the alpha of the base colour, as in Agent MCR today.

Added in phase 1, because the table above couldn't express them:

| Token | Dark | Light | Why |
|---|---|---|---|
| `--accent-fill` | `#007acc` | `#007acc` | Background of filled controls (primary buttons). `--accent` is a light text blue in the dark theme, and white text on it is unreadable. Replaces `--border-active`. |
| `--text-on-accent` | `#ffffff` | `#ffffff` | Text on `--accent-fill` |
| `--surface-3` | `#4a4a4d` | `#d4d4d4` | A raised hover surface (Agent MCR's `--layer-3`) |
| `--cat-blue`, `--cat-green`, `--cat-tan`, `--cat-orange` | `#9bc5e8`, `#91d6b3`, `#d3aa8d`, `#f08a4b` | `#1f5f99`, `#216d47`, `#8a5a3c`, `#b5530f` | Identity, not state: human/agent, Codex/Claude, "cache warm". Without them those distinctions would collapse into the accent. |
| `--dur-slow` | `300ms` | | MDViewer's `--transition-slow` |

Scales:

- **Spacing** `--sp-1` … `--sp-6`: 4, 8, 12, 16, 24, 32 px.
- **Type** `--fs-11`, `--fs-12`, `--fs-13`, `--fs-14`, `--fs-16`, with 13 px as the base. Document type sizes (18–32 px) stay in the reader.
- **Radius** `--r-sm` 3, `--r-md` 6, `--r-lg` 8 px, plus `--r-full`. Agent MCR's 5, 7, 10 and 12 px map to the nearest of these.
- **Motion** `--dur-fast` 100 ms, `--dur-normal` 200 ms, `--ease-standard` `cubic-bezier(.2,0,0,1)`.
- **Shadows and fonts**: `--shadow-sm/md/lg`, `--font-sans`, `--font-mono`, with MDViewer's values.
- **Chrome sizes**: `--toolbar-height` 32, `--tab-bar-height` 30, `--status-bar-height` 28 px.

Syntax colours (`--syntax-*`), `--folder-color` and the Shiki variables stay in the reader's CSS. MDViewer's `--drop-overlay-bg` stays in MDViewer.

Every colour a rule uses is a variable. Colours that belong to one feature are variables in that feature's own `:root` block, not in `tokens.css`: syntax colours, `--find-match-bg`. The `::highlight()` rules for find matches keep literal colours until `var()` inside `::highlight()` has been checked in WebKitGTK.

**Migrating to the new names, within one release:**
1. `tokens.css` also defines every old name as an alias (`--surface-bg: var(--canvas)`). Nothing changes on screen except where a palette is dropped.
2. Files move to the new names one at a time.
3. The aliases are deleted once `grep` finds no old name.

### 4.2 Look

The Documents surface is the reference look.

| Element | Rule | What changes |
|---|---|---|
| Panes | Flush, separated by a 1 px `--line`, no outer margin or radius | Live's floating rounded pane, Sessions' rounded card |
| Pane header | 40 px high (Documents' headers); title in 11 px uppercase `--text-muted` (like "FILES"); tools on the right | Every pane, Live included |
| Toolbar buttons | 28 px ghost icon buttons; the tooltip shows the shortcut | Sessions' bordered text buttons become ghost buttons with labels in the view's tools |
| Text buttons | `ui` `Button` in `secondary`/`primary`, only in dialogs, settings and empty states | none |
| Accent | `--accent` (blue) | Sessions' mint |
| State colours | Only `--ok`, `--warn`, `--danger`, `--accent` | Agent MCR's hardcoded colours |
| Focus | A 1 px `--focus` line on the focused pane's header; a 2 px ring on focused controls | none |
| Status bar | One 28 px bar that auto-hides or is pinned, as today | Sessions' footer |
| Density | 13 px base, 28 px list rows | Sessions' larger controls |

## 5. Workbench

### 5.1 Shell

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│ [▤ Documents │ ⌁ Sessions]  ☰  [Live │ Journal │ Board │ Slack]  ‹view tools›  ⌕ ⚙ ☾ │
├──────────────┬────────────────────────────────────────────────────┬─────────────────┤
│ FILES ▾   ⋯  │ ← → │ README.md │ ARCHITECTURE.md × │           ⫼ ⋯ │ CONTENTS ▾  ⋯   │
│              │                                                    │                 │
│              │                                                    │                 │
├──────────────┴────────────────────────────────────────────────────┴─────────────────┤
│ ‹status items of the focused pane›                                              📌  │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

- The top bar, left to right: surface switch, main menu (☰), view switch, the current view's tools. On the right: palette, settings, theme. The view switch is hidden when a surface has only one view.
- Every surface of both apps uses this same bar.
- A surface that isn't shown stays mounted when its view asks for it (`keepMounted`), as Sessions does today (`App.tsx:79-80`, `App.tsx:753-755`).
- The native menu (File, Edit, Window, Help) stays.

### 5.2 Surfaces and views

```ts
interface Surface { id: string; label: string; icon: ReactNode; order: number }

interface View {
  id: string;
  surface: string;
  label: string;
  icon?: ReactNode;
  title?: string;
  order: number;
  keepMounted?: boolean;
  /** A view either holds a layout of panes, or renders itself. */
  layout?: { default: () => Layout };
  render?: (ctx: ViewContext) => ReactNode;
  tools?: (ctx: ViewContext) => ReactNode;
}
```

| App | Documents surface | Sessions surface |
|---|---|---|
| MDViewer | `documents`: a layout of files/search/history, a document group, contents | `journal`: a layout of a session list and session details (§6.2) |
| Agent MCR | `documents`: a layout of agent documents, a document group, contents | `live` (a layout), `journal` (a layout, as in MDViewer), `board`, `slack` |

MDViewer's Sessions page is renamed Journal, matching Agent MCR.

### 5.3 Layout tree

```ts
type Layout = { version: 1; root: LayoutNode };
type LayoutNode = Split | Leaf;

interface Split {
  kind: 'split';
  id: string;
  dir: 'row' | 'col';
  children: LayoutNode[];
  sizes: Size[];
}
type Size = { px: number } | { fr: number };

interface Leaf {
  kind: 'leaf';
  id: string;
  pane: PaneRef | null;
  collapsed?: boolean;
}

interface PaneRef { type: string; key: string; state?: JsonValue }
```

Invariants. `normalize` checks them, and every operation ends with it.

- A split has two or more children, and `sizes.length === children.length`.
- A child split runs in the other direction from its parent. Same-direction nesting is flattened.
- Every split has at least one `fr` child, which takes whatever space the `px` children leave. That way side panels keep their width when the window is resized.
- A `collapsed` leaf takes 0 px, and its divider shows the edge grip (today's `Resizer`). Only pane types marked `collapsible: true` can collapse.
- `id`s are stable strings, and the layout is plain JSON.

**Operations.** These are pure functions in `layout.ts`, grown from `paneLayout.ts`, and each has tests.

| Operation | Behaviour |
|---|---|
| `split(leaf, dir, side, pane)` | If the parent runs in `dir`, insert a sibling before or after the leaf, splitting the leaf's size between the two. Otherwise replace the leaf with a split of both (each `fr 1`) that takes over the leaf's size. |
| `close(leaf)` | Remove the leaf. Its space goes to the previous sibling, or the next one if it was first. The last leaf of a view stays as an empty pane. |
| `join(keep, remove)` | Allowed only when both are adjacent children of the same split. Works like `close(remove)`, with the space going to `keep`. |
| `swap(a, b)` | Exchange the two leaves' `pane`s. Works for any two leaves. |
| `resize(split, divider, deltaPx)` | Move space between the children on either side of the divider, within their minimums. Dragging a collapsible child below half its minimum collapses it; dragging back out restores it. |
| `setCollapsed(leaf, v)`, `setPane(leaf, pane)`, `reset(view)` | As named. |

**When the window is smaller than the panes' minimums.** This is worked out at render time and never saved, so a bigger window brings back the stored sizes. In order:
1. Shrink the `fr` children down to their minimums.
2. Then shrink the `px` children.
3. Then collapse collapsible leaves, from the outermost inwards.
4. Whatever is still left over is clipped (overflow hidden).

**Rendering:**

- **Dividers** are the `ui` `Splitter`, which is today's `Resizer` made to work in both directions:
  - a 4 px hit area with a `col-resize` or `row-resize` cursor;
  - no text selection while dragging;
  - `role="separator"`;
  - the arrow keys move it 16 px (64 px with Shift), and Enter or a double-click toggles collapse.
- **Keep-alive.** Pane types marked `keepAlive: true` (terminal, editor, document group) render once per `PaneRef.key`, into an element outside the tree. The leaf only holds an empty slot, and that element is moved into it. Moving, splitting or swapping panes never remounts their content. This is Live's `PaneSlot` pattern, moved into the workbench.
- **Focus.** Each view has one focused leaf, set by `pointerdown` or `focusin` inside it. Its header shows the focus line. Commands, the status bar and the Contents pane all follow it.

**Saving.** Each view's layout is saved through `WorkbenchHost.storage` under `layout.<view>`. A read-only host (memory reader windows) keeps layout changes in memory only. MDViewer's saved workspaces also store the Documents layout.

### 5.4 Pane types

```ts
interface PaneType<S = JsonValue> {
  type: string;
  label: string;
  icon: ReactNode;
  views: string[];            // the views it may appear in
  min: { w: number; h: number };
  collapsible?: boolean;
  keepAlive?: boolean;
  singleton?: boolean;        // at most one per view (files, contents)
  switchable?: boolean;       // offered in the header's type menu
  zoom?: PaneZoom<S>;         // the pane can be zoomed (see below)
  title: (ctx: PaneContext<S>) => ReactNode;
  tools?: (ctx: PaneContext<S>) => ReactNode;
  render: (ctx: PaneContext<S>) => ReactNode;
}

interface PaneZoom<S> {
  get(ctx: PaneContext<S>): number;                    // percent
  step(ctx: PaneContext<S>, direction: 1 | -1 | 0): void;   // 0 resets to 100 %
}
```

**Zoom belongs to the pane** (decided 2026-11-22). Every pane that can zoom has its own zoom level, and a document group has its own as well, so two groups can show the same file at different sizes.
- Ctrl+wheel zooms the pane under the cursor; the zoom commands zoom the focused pane.
- The toolbar's zoom badge shows the focused pane's zoom. A pane header shows `PanelZoomBadge`, which moves into the workbench, whenever its pane isn't at 100 %.
- The workbench owns the wheel handler. It replaces the `data-zoom-panel` routing in `App.tsx:726-747`.
- Panes other than document groups keep their zoom in `PaneRef.state`. This generalises today's `panelZoom` for Files and Contents.
- A document group keeps its zoom in the reader store (§6.1), because the reader renders with it.

For a `switchable` pane, the header title is a type menu ("FILES ▾"). Choosing another type keeps the leaf and replaces its `PaneRef`. This replaces MDViewer's three mutually exclusive flags (`filePanelVisible`, `searchVisible`, `historyVisible`) and Agent MCR's single `AgentPanel` slot.

The pane header menu (⋯) offers: Split right, Split down, Join with ‹neighbour›, Swap with…, Close pane. Hovering Split or Join previews the result as an overlay on the pane before you choose. This is the concept's "preview line".

| Type | App | Minimum width (px) | Collapsible | Keep-alive |
|---|---|---|---|---|
| `documents` (a document group) | both | 320 | no | yes |
| `contents` | both | 180 | yes | no |
| `files`, `search`, `history` | MDViewer | 200 | yes | no |
| `agent-docs` | Agent MCR | 200 | yes | no |
| `journal-list` | both | 280 | yes | no |
| `journal-detail` | both | 400 | no | no |
| `live-sessions` (Live's sidebar list) | Agent MCR | `LIST_MIN_WIDTH` | yes | no |
| `terminal`, plugin panes | Agent MCR | as in Live today | no | yes |

### 5.5 Commands and palette

```ts
interface Command {
  id: string;
  label: string;
  group: string;
  shortcut?: Shortcut;
  aliases?: Shortcut[];
  enabled?: (ctx: CommandContext) => boolean;
  checked?: (ctx: CommandContext) => boolean;
  run: (ctx: CommandContext) => void | Promise<void>;
  palette?: boolean;          // listed in the palette; default true
}

interface CommandContext {
  surface: string;
  view: string;
  leaf: Leaf | null;
  pane: PaneRef | null;
}
```

- `buildMenu` becomes the registry, and features and plugins add their own commands to it. The main menu, the key handler, native menu events and the palette all read from it.
- The existing rules still apply: there is one list of commands, and `run` must be safe to call when the command is not enabled.
- `CommandContext` replaces `AppState` as the argument, so the registry doesn't know about the app store. A feature's commands read that feature's own store.
- `view.zoomIn`, `view.zoomOut` and `view.resetZoom` act on the focused pane through its `PaneZoom`. They are disabled when that pane can't zoom.
- The Rust native menu keeps its own list of ids (`main.rs:1615` onward). An app test reads `main.rs` and fails if a native menu id has no matching command.
- New layout commands:

  | Command | Shortcut |
  |---|---|
  | `layout.splitRight` | Mod+\\ |
  | `layout.splitDown` | none |
  | `layout.closePane` | none |
  | `layout.focusNext` | F6 |
  | `layout.focusPrevious` | Shift+F6 |
  | `layout.reset` | none |

- **One palette.** Agent MCR's `SessionCommandPanel` becomes general and opens with **Mod+Shift+P on every platform**, so ⌘S is Save again in Agent MCR. Its sources are registered providers: commands, open tabs, files (MDViewer), sessions (both apps), agent documents.

```ts
interface PaletteProvider {
  id: string;
  label: string;
  search(query: string, signal: AbortSignal): Promise<PaletteItem[]>;
}
```

### 5.6 Settings and status bar

**Settings.** There is one Settings dialog, using the layout of Agent MCR's `SettingsModal`. Tabs are registered with `registerSettingsTab`:

| Owner | Tabs |
|---|---|
| Workbench | Appearance, Shortcuts, Plugins |
| Reader | Documents |
| Journal | Session access, Memories |
| MDViewer | Folders, Updates |
| Agent MCR | Harness, Slack |

**Status bar.** There is one bar. Its items come from the focused pane and the current view:

```ts
interface StatusItem {
  id: string;
  side: 'left' | 'right';
  text: string;
  icon?: ReactNode;
  title?: string;
  onClick?: () => void;
  order: number;
}
```

Journal's footer ("SQLite index · …") becomes status items. Auto-hide and pinning work as they do today.

### 5.7 Plugin registry

This is `sdk.ts` without the harness types:

```ts
interface Plugin {
  id: string;
  name: string;
  version?: string;
  description?: string;
  defaultDisabled?: boolean;
  setup(api: PluginApi): void | (() => void);
}

interface PluginApi {
  registerSurface(s: Surface): void;
  registerView(v: View): void;
  registerPaneType(p: PaneType): void;
  registerCommand(c: Command): void;
  registerPaletteProvider(p: PaletteProvider): void;
  registerSettingsTab(t: SettingsTab): void;
  registerStatusItem(i: StatusItemSource): void;
  registerOverlay(o: Overlay): void;
  registerAppWrapper(w: AppWrapper): void;
  overrideSlot<K extends keyof WorkbenchSlots>(slot: K, render: WorkbenchSlots[K]): void;
  onEvent<E extends keyof WorkbenchEvents>(event: E, fn: (p: WorkbenchEvents[E]) => void): () => void;
  emitEvent<E extends keyof WorkbenchEvents>(event: E, payload: WorkbenchEvents[E]): void;
}
```

Events and slots are interfaces that each app extends by declaration merging. That keeps Agent MCR's `live:*` slots and `session:*` events inside Agent MCR:

```ts
// agent-mcr: src/plugins/harness-types.ts
declare module '@lambda-house/workbench' {
  interface WorkbenchEvents {
    'session:started': { id: string; profile: string; cwd: string };
  }
  interface WorkbenchSlots {
    'live:pane-tools': (ctx: LivePaneToolsContext) => ReactNode;
  }
}
```

The reader and the journal are plugins too, so an app is simply the list of plugins it loads. Which plugins are enabled is stored through `WorkbenchHost.storage`, not under fixed `agent-mcr:` localStorage keys.

### 5.8 Workbench host

```ts
interface WorkbenchHost {
  appId: string;                                // storage namespace
  platform: 'macos' | 'windows' | 'linux';
  storage: StateStorage;                        // zustand-compatible
  readOnly?: boolean;                           // memory reader windows
  onNativeMenu?(fn: (commandId: string) => void): () => void;
}
```

## 6. Shared features

### 6.1 Reader

What moves into the package:
- `DocumentPanel`, `TabBar`, `TocSidebar` (as the `contents` pane), `FindBar`, `Editor`, `SaveAllDialog`;
- the document status items from `StatusBar`;
- `utils/{markdown,fb2,save,export,editorRegistry,scrollAnchor,scrollHold,search}` and `useSmoothWheelScroll`;
- the document link handler that is in `App.tsx` today.

Host:

```ts
interface ReaderHost {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  saveAs(defaultName: string, content: string, kind: 'markdown' | 'html'): Promise<string | null>;
  /** Tauri: convertFileSrc(path, 'localfile') */
  imageUrl(absolutePath: string): string;
  followLocalLink(path: string): Promise<'open' | 'revealed' | 'cancelled'>;
  openExternal(url: string): Promise<void>;
  revealInFolder?(path: string): Promise<void>;
  /** "Changed since you read it" for agent documents */
  changes?: {
    isTracked(path: string): boolean;
    readSnapshot(path: string): Promise<ReadSnapshot | null>;
    markRead(paths: string[]): Promise<void>;
  };
  /** MDViewer appends to its history */
  onOpened?(path: string): void;
  storage: StateStorage;
}
```

The security rules stay in Rust: the reader asks and the backend decides. That covers the access list, the `follow_local_link` confirmation dialog and serving only images over `localfile://`.

The reader keeps its own Zustand store, saved through `storage`:

```ts
interface ReaderState {
  documents: Record<string, Document>;       // per path: content, dirty, rendered
  groups: Record<string, DocumentGroup>;     // key: the pane's PaneRef.key
  focusedGroup: string | null;
  recentlyClosed: ClosedTab[];
  scroll: Record<string, ScrollPosition>;    // key: `${group}\n${path}`
  editing: Record<string, string>;           // path → the group whose editor has it
  editMode: boolean;
  settings: ReaderSettings;
}

interface DocumentGroup {
  zoom: number;                              // MIN_ZOOM–MAX_ZOOM; the editor uses it too
  tabs: Tab[];
  activeTabId: string | null;
  nav: { history: string[]; index: number };
  headings: Heading[];
  activeHeadingId: string | null;
  find: FindState;
}
```

**Code that assumes a single document, and how it changes:**

| Today | Change |
|---|---|
| One `activeTabId` (`DocumentPanel.tsx:605`, `Toolbar.tsx:128`, `commands.ts:109`, `export.ts:190`) | One per group; commands act on `focusedGroup` |
| Relative links resolve against the active tab (`App.tsx:411-414`) | Resolve against the clicked document instead. Its `.markdown-body` already carries `data-rendered-path` (`DocumentPanel.tsx:213`). The handler moves into the reader's pane. |
| Export takes the first `.document-panel .markdown-body` on the page (`export.ts:201`) | Export from the focused group's container |
| Find highlights are two global registry entries (`FindBar.tsx:28-29`, `177-185`) | Each group keeps its own ranges, and one module merges them into the same two `Highlight` objects. The objects are changed in place, because WebKitGTK doesn't repaint replaced highlights and the `::highlight()` CSS stays static. |
| Headings are held in `App` state, with one `activeHeadingId` (`App.tsx:109`, `570`) | One per group; `contents` shows the focused group |
| Scroll positions are stored per path | Stored per group and path |
| One editor flush slot (`editorRegistry.ts:12-16`, `Editor.tsx:161`) | A set of mounted editors; saving flushes all of them |
| The same file can open in two editors | A file is edited in one group at a time (`editing`). Other groups show its preview, and Ctrl+E there moves focus to the group that is editing it. |
| One document `zoom` for the whole app (`DocumentPanel.tsx:607`, Ctrl+wheel in `App.tsx:726-747`) | One zoom per group (§5.4). A group created by a split starts with the zoom of the group it came from. |

This one set of changes gives both apps document groups, that is, documents side by side.

### 6.2 Journal

What moves into the package: the index-browser part of `SessionWorkspace`, plus `SessionTree`, `SessionMemoryBrowser`, `SessionAgentAccess` and the helpers in `utils/sessions.ts`.

**Journal is a layout and can be split** (decided 2026-11-22). Today's single page becomes two pane types:

| Pane | Key | Shows | Its own state (`PaneRef.state`) |
|---|---|---|---|
| `journal-list` | a list id | The search box, filters (provider, role, activity, activity window, directory map) and the session tree | Query and filters, expanded rows, zoom |
| `journal-detail` | the session key (`sessionKey`) | The session header and its tabs (Activity, Agents, Usage, Memories, plus Linked Work and Direct when the host has them), with evidence navigation | Active tab, event filter, focused evidence, zoom |

- **Default layout:** a row of `journal-list` (px 360, collapsible) and `journal-detail` (fr 1), which looks the way the page does today.
- **Opening sessions:**
  - Clicking a session in a list shows it in the detail pane focused most recently, or opens a detail pane to the right if there is none.
  - Mod+click, or "Open to the side" in the row menu, splits a new detail pane next to the current one. This lets you compare sessions, such as a parent and one of its subagents, side by side.
- **More than one list:** each list keeps its own filters, so two lists can show different selections, for example two folders.
- **One snapshot:** all of a view's panes share one snapshot in the journal store. It refreshes every 5 s while the view is shown, as `SessionWorkspace` does today.
- **Details load on selection,** as now. Each detail pane loads only its own session, and a collapsed detail pane loads nothing.
- **Counts:** the "0 working · 50 sessions" summary moves into the view's tools, and the index state ("SQLite index · …") into the status bar.

The host is `sessionApi` as it is today. When the package is created, take the signatures from mdviewer-mj and reconcile where agent-mcr's differ.

| Methods | MDViewer | Agent MCR | In the host |
|---|---|---|---|
| `access`, `enable`, `disable`, `snapshot`, `detail`, `events`, `cacheWrite` | yes | yes | required |
| `memoryAccess`, `enableMemories`, `memories`, `readMemory`, `openMemoryWindow` | yes | yes | required |
| `stats` | no | yes | optional |
| `connections`, `configure`, `context`, `control` | yes | removed (MCR-24) | optional |
| `resume(session)`: continue in Live | no | yes (`harnessApi.spawn`) | optional |

The UI only shows what the host supports:
- Linked Work, Direct and Connections only with `context`, `control` and `connections`;
- usage statistics only with `stats`;
- "Continue in Live" only with `resume`.

Agent MCR provides none of the network methods, so its "no outside service" rule holds by construction.

These rules stay as they are:
- Credentials live only in process memory, never in a store or an export.
- Summaries exclude activity bodies.
- A status inferred from files is never shown as verified process liveness.

### 6.3 App-only features

| MDViewer | Agent MCR |
|---|---|
| `files`, `search` and `history` panes; workspaces menu; update banner; drag and drop; Open File/Folder | `live` view and `terminal` pane; cockpit; `board`; `slack`; harness settings; background gate; agent documents pane |

These use `ui` and `workbench` like any other plugin. Shared packages never import them.

## 7. Migration

Each phase ships on its own in both apps. Neither app is left on a half-moved layer.

| # | Phase | Done when |
|---|---|---|
| 0 | Move MDViewer to React 19 and lucide-react 1.x. Set up npm workspaces, empty `packages/*` and `layers.test.ts`. Add the subtree to agent-mcr. | Both apps build and pass their tests on the new versions |
| 1 | `tokens`: one `tokens.css` with the old names as aliases. Drop `--sc-*` (`sessions.css:1-2`) and Agent MCR's hardcoded colours. | Every declaration, resolved through the variables in both themes, is compared before and after, and only intended changes remain: the Sessions palette, amber → `--warn`, Agent MCR's radii, the dialog backdrop, and variables that were never defined now resolving. Documents screenshots are pixel-identical. |
| 2 | `ui`: Agent MCR's `src/ui`, plus `ConfirmDialog`, `Splitter` (from `Resizer`), `Segmented` (replaces `WorkspaceSwitch`, the Files/Agents switch and the view switch), `Tabs`, `Menu` (from `RowMenu` and the tab context menu), `PaneFrame`, `EmptyState` | No app CSS styles a shared control; Sessions uses `ui` buttons for its actions. Done 2026-11-22, with two parts moved to later phases: `MainMenu`'s submenus and `WorkspaceMenu` move to `Menu` in phase 3 with the commands; the Sessions and Live row buttons (rows, tree toggles, list items) move with their views in phases 4 and 6. Until then the Sessions element rules skip the shared controls with `:where(:not([class^="ui-"], …))`, which keeps their weight, so the app's own class rules resolve as before. |
| 3 | Command registry and the single palette; ⌘S is Save again in Agent MCR | The native menu id test passes; the palette lists commands in both apps. Done 2026-11-22: `@lambda-house/workbench` has the command types, `commandForKey`, `formatShortcut`, `createMenuStore`, `MainMenu` (generic over the app's state, read through a hook only while open) and `Palette` (the shell of Agent MCR's palette: items come from the app; `commandItems` turns the menu into items). The palette opens through the command `app.commandPalette` (Mod+Shift+P) only. |
| 4 | `workbench`: shell, surfaces and views, plugin registry, layout tree with keep-alive and focus. MDViewer's side panels and Agent MCR's Live move onto it, and saved state is migrated. | Layout operation tests pass; Live terminals survive splitting, swapping and closing other panes; MDViewer's saved state migrates. Part 1 done 2026-11-23: the layout tree (`layout.ts`) and `LayoutView` with keep-alive panes, focus and `SplitHandle`; MDViewer's and Agent MCR's Documents views and Agent MCR's Live panes are drawn by it, pixel-identical. Changed on the way: the apps' layouts are *derived* for now: the Documents views from the stores' widths and flags (whose left-slot rules and tests stay), Live from its own two-way tree, whose drags come back as ratios. A stored layout comes with document groups (phase 5), the first layout the stores can't express. Nothing to migrate yet, so the saved state is unchanged. When the window is too small, flex shrinks fractional panes to their minimum and pixel panes keep their width; collapsing panes for room is not done. Part 2: the shell, surfaces and views, the plugin registry. |
| 5 | `reader` with `ReaderHost`, its own store, the single-document changes and document groups | In both apps, two groups show side by side, each with its own zoom, and links, find, export, contents and save all act on the focused group |
| 6 | `journal` with `JournalHost`, as `journal-list` and `journal-detail` panes; MDViewer's Sessions page is renamed Journal | Journal tests pass in both apps against their own hosts; a list and two detail panes show side by side |

After phase 6, each app's `App.tsx` only assembles plugins and supplies its Tauri adapters.

**Saved-state migration in phase 4.** Bump the persist version.
- MDViewer: `panelWidth`, `filePanelVisible`, `searchVisible`, `historyVisible`, `tocWidth` and `tocVisible` become the Documents layout. The default is a row of `files` (px 280, collapsible), `documents` (fr 1) and `contents` (px 220, collapsible).
- MDViewer: `panelZoom.files` and `panelZoom.toc` become the zoom of the `files` and `contents` panes. `zoom` becomes the zoom of the first document group (phase 5).
- Agent MCR: Live's list width (`hs-*` localStorage keys) becomes Live's layout.

## 8. Rules for both CLAUDE.md files

Add these when phase 0 lands.

- Shared code lives in `packages/`. It imports nothing from an app, `@/`, `@tauri-apps/*` or an app store; `layers.test.ts` checks this. Shared changes land in mdviewer-mj first.
- Colours, spacing, radii and type sizes come from `tokens.css`. Component CSS has no literal colours.
- A new command goes into the registry, and every native menu id needs a command.
- A pane whose content is expensive to recreate (terminal, editor, rendered document) is `keepAlive`.
- Agent MCR: the MDViewer features it removed stay out. They exist only in MDViewer's app code, never in `packages/`.

## 9. Decisions and open questions

Decided on 2026-11-22:

1. **Sharing:** `git subtree` of `packages/` from mdviewer-mj (§3.2).
2. **Zoom:** per pane, and per document group (§5.4, §6.1).
3. **Journal:** a layout of `journal-list` and `journal-detail` panes that can be split (§6.2).
4. **Dragging a tab to a pane's edge to split it:** after phase 6, not part of this migration.

## Appendix A. What became of the concept's requirements

| Concept | Decision |
|---|---|
| Binary tree of splits (ratio 0–1) and leaves (id, viewportType) | Changed: splits hold two or more children, sizes are px or fr, leaves can collapse, the tree is normalised (§5.3) |
| Panels fill 100%, with no gaps | Kept; a collapsed leaf takes 0 px and shows an edge grip |
| Draggable gutters with a minimum of about 100 px | Kept, with a minimum per pane type (§5.4) |
| Panels "cannot collapse unintentionally" | Changed: collapsible panes collapse below half their minimum, as they do today |
| Drag from a corner hotspot to split | Dropped: the hotspots collide with the tab bar and panel header buttons, and are hard to discover. Split from the pane menu, a command, or later by dragging a tab. |
| Gutter context menu "Split Vertical/Horizontal" with a preview line | Changed: the pane menu, with a preview overlay |
| Drag from a corner to join, with an arrow overlay | Dropped; Join is in the pane menu |
| "Join Areas" and "Swap Areas" on the gutter | Kept, in the pane menu; Swap works for any two panes |
| Join only "direct siblings sharing a full edge" | Changed: panes that are adjacent children of one split, after normalisation. In a binary tree, two panes can share a full edge without being siblings, as B and C do in `(A │ B) │ C`. |
| A header bar with a type selector in every leaf | Kept, inside the existing headers; a document group's header is its tab bar |
| Placeholder views (3D Canvas, Node Graph, …) | Replaced by the real pane types |
| Dark studio look, 1 px borders, focus state, resize cursors | Kept (§4.2) |
| No text selection while dragging | Kept |
| A "Reset Layout" button and the layout as JSON | Kept: the `layout.reset` command, versioned JSON per view, also stored in MDViewer's saved workspaces |

## Appendix B. The original concept text

```text
Role: Act as a senior frontend UI/UX engineer specializing in complex desktop-grade web applications and interactive tiling window managers.
Task: Build a modular, non-overlapping tiling workspace layout system (inspired by Blender’s area-based UI) where users can dynamically split, resize, join, and switch the content type of any panel in real time.
Core Functional Requirements:
1. Tree-Based Layout Data Structure:
	• Represent the workspace as a binary tree of Split Nodes (horizontal or vertical orientation, split ratio 0.0–1.0) and Leaf Nodes (individual viewport panels with an id and viewportType).
	• Ensure panels fill 100% of the viewport container without overlapping or leaving empty gaps.
2. Interactive Resizing:
	• Render draggable divider gutters between all split nodes.
	• Dragging a gutter updates the split ratio smoothly while enforcing minimum panel dimensions (e.g., 100px) so panels cannot collapse unintentionally.
3. Splitting Viewports:
	• Corner-Drag Gesture: Add an interactive hotspot in the corners of every leaf panel. When hovered, change the cursor to a crosshair (+). Clicking and dragging inward splits the panel into two: dragging horizontally creates a vertical split; dragging vertically creates a horizontal split.
	• Context Menu: Right-clicking any divider gutter opens a menu with options for "Split Vertical" and "Split Horizontal", displaying a live preview line before confirming on click.
4. Joining (Merging) Viewports:
	• Corner-Drag Gesture: Clicking a panel's corner hotspot and dragging outward into an adjacent sibling panel that shares a full-length edge initiates a join action. Display a semi-transparent overlay with a directional arrow pointing toward the panel that will be absorbed/closed. Releasing the mouse removes the target panel and expands the source panel to fill the combined space.
	• Context Menu: Right-clicking a shared divider gutter offers "Join Areas" (with directional arrows) and "Swap Areas" (which exchanges the viewportType and state of the two adjacent panels).
	• Enforce the rule that two panels can only join if they are direct siblings sharing a complete, unbroken border edge.
5. Viewport Type Selection:
	• Include a compact top header bar inside every leaf panel.
	• Place a Viewport Type Selector dropdown in the top-left corner of each header.
	• Populate the dropdown with distinct, functional placeholder views (e.g., 3D Canvas, Node Graph, Inspector/Properties, Hierarchy/Outliner, Timeline, Console/Logs). Switching the type dynamically swaps the panel's rendered component while preserving the layout tree.
Visual & UX Polish:
• Use a clean, dark-mode studio aesthetic with subtle 1px borders, clear active-panel focus states, and smooth cursor transitions (col-resize, row-resize, crosshair).
• Prevent accidental text selection during drag operations.
• Provide a "Reset Layout" button and serialize the layout tree to JSON so workspace configurations can be saved and restored.
```
