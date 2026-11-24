# Shared packages

Frontend code shared by MDViewer (`lambda-house/mdviewer-mj`) and Agent MCR (`lambda-house/agent-mcr`). The design and the migration plan are in the shared UI spec, `20261122_ui-concept.md` in mdviewer-mj.

| Package | Layer | Contents | Filled in |
|---|---|---|---|
| `tokens` (`@lambda-house/tokens`) | 0 | Colour, spacing, type and radius variables | phase 1 |
| `ui` (`@lambda-house/ui`) | 1 | Controls, the elements' base look (`@layer base`) | phases 2, 9 |
| `workbench` (`@lambda-house/workbench`) | 2 | Window shell and its tool buttons, layout tree, panes, commands (the window's own too), palette, settings, status bar, plugins, the `Workbench` an app assembles | phases 3–4, 7–9 |
| `reader` (`@lambda-house/reader`) | 3 | Markdown reader and editor, its contents pane, toolbar zoom and styles, `readerPlugin` | phases 5, 8–9 |
| `journal` (`@lambda-house/journal`) | 3 | Index of past agent sessions, `journalPlugin` | phases 6, 8 |

## Rules

- A package imports only packages of a lower layer, its own files and the libraries listed for it in `layers.test.ts`. Never an app's `src/`, the `@/` alias, `@tauri-apps/*` or an app store. `reader` and `journal` don't import each other.
- What a package needs from the app (files, dialogs, links, storage) comes through a host interface that the app passes in.
- External libraries are `peerDependencies` of the package; the app installs them, so there is one copy of React.
- `layers.test.ts` checks every import and every `package.json`, and runs with `npm test`. `tsc -p packages`, part of `npm run build`, type-checks the packages without the app's `@/` alias.
- A new package goes into `RANK` and `EXTERNAL` in `layers.test.ts`. A new library for a package goes into its `EXTERNAL` entry.

## Sharing with Agent MCR

This directory in mdviewer-mj is the source. Agent MCR keeps a copy at `packages/` with `git subtree`. Make shared changes here first.

The app side, in each app's root `package.json`:

```json
"workspaces": ["packages/*"],
"scripts": { "build": "tsc && tsc -p packages && vite build" }
```

In agent-mcr, the first time:

```sh
git remote add upstream git@github.com:lambda-house/mdviewer-mj.git
git fetch upstream
# split refuses a prefix that isn't in the working tree yet (git 2.47): an empty folder stands in
mkdir packages && commit=$(git subtree split --prefix=packages upstream/main) && rmdir packages
git subtree add --prefix=packages "$commit" --squash
npm install
```

In agent-mcr, to take in later changes:

```sh
git fetch upstream
git subtree merge --prefix=packages "$(git subtree split --prefix=packages upstream/main)" --squash
npm install
```

A change that had to be made in agent-mcr goes back to mdviewer-mj as a patch, before anything else touches that package:

```sh
# in agent-mcr
git format-patch -1 --relative=packages -o /tmp/shared <commit>
# in mdviewer-mj
git am --directory=packages /tmp/shared/*.patch
```

The next `subtree merge` in agent-mcr then brings back the same change without a conflict.
