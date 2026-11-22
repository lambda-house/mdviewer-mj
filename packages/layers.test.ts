import { builtinModules } from 'node:module';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve, isAbsolute } from 'node:path';
import { describe, expect, it } from 'vitest';

// ============================================================
// The layer rules of the shared packages
// ============================================================
//
// Each package may import packages of a lower rank, its own files and the
// external libraries listed for it, and nothing else: no app code, no `@/`
// alias, no Tauri. Features (same rank) never import each other.
// See the shared UI spec (20261122_ui-concept.md in lambda-house/mdviewer-mj, §3).

const SCOPE = '@lambda-house/';

/** Layer of each package; a package imports only packages of a lower rank. */
const RANK: Record<string, number> = {
  tokens: 0,
  ui: 1,
  workbench: 2,
  reader: 3,
  journal: 3,
};

const VIEW = ['react', 'react-dom', 'lucide-react', 'clsx'];

/** External libraries each package may import (`@scope/*` matches a whole scope). */
const EXTERNAL: Record<string, string[]> = {
  tokens: [],
  ui: VIEW,
  workbench: [...VIEW, 'zustand'],
  reader: [...VIEW, 'zustand', 'markdown-it', 'shiki', 'mermaid', 'codemirror', '@codemirror/*', '@lezer/*'],
  journal: [...VIEW, 'zustand'],
};

/** Test files may also use the test runner and Node. */
const TEST_ONLY = ['vitest', 'happy-dom'];

const FORBIDDEN: Array<[prefix: string, why: string]> = [
  ['@tauri-apps/', 'Tauri belongs to the app: ask for it through the host interface'],
  ['@/', 'the app\'s `@/` alias reaches into app code'],
];

const SOURCE_FILE = /\.(ts|tsx|js|jsx|mjs|cjs|css)$/;
const TEST_FILE = /\.test\.(ts|tsx)$/;

const STATIC_IMPORT = /(?:^|[^\w$.])(?:import|export)\s+(?:type\s+)?(?:[\w*${}\s,]+?\s+from\s+)?['"]([^'"\n]+)['"]/g;
const DYNAMIC_IMPORT = /\b(?:import|require)\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g;
const CSS_IMPORT = /@import\s+(?:url\(\s*)?['"]?([^'")\s;]+)/g;

/** Module specifiers a source file imports. */
function importsOf(file: string, source: string): string[] {
  const patterns = file.endsWith('.css') ? [CSS_IMPORT] : [STATIC_IMPORT, DYNAMIC_IMPORT];
  const found: string[] = [];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) found.push(match[1]);
  }
  return found;
}

/** `@scope/name/sub` → `@scope/name`, `name/sub` → `name`. */
function packageName(specifier: string): string {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

function matchesAllowed(name: string, allowed: string[]): boolean {
  return allowed.some((entry) => (entry.endsWith('/*') ? name.startsWith(entry.slice(0, -1)) : name === entry));
}

const NODE_BUILTINS = new Set(builtinModules);

function isNodeBuiltin(specifier: string): boolean {
  return specifier.startsWith('node:') || NODE_BUILTINS.has(packageName(specifier));
}

/** Why a package may not import a specifier, or null when it may. */
function importViolation(pkg: string, packageDir: string, file: string, specifier: string): string | null {
  const isTest = TEST_FILE.test(file);

  for (const [prefix, why] of FORBIDDEN) {
    if (specifier.startsWith(prefix)) return `${specifier}: ${why}`;
  }

  if (specifier.startsWith('.')) {
    const target = resolve(dirname(file), specifier);
    const inside = relative(packageDir, target);
    if (inside.startsWith('..') || isAbsolute(inside)) {
      return `${specifier}: leaves the package (import other packages as ${SCOPE}<name>)`;
    }
    return null;
  }
  if (specifier.startsWith('/')) return `${specifier}: absolute path`;

  if (specifier.startsWith(SCOPE)) {
    const target = packageName(specifier).slice(SCOPE.length);
    if (target === pkg) return `${specifier}: a package imports its own files by relative path`;
    if (!(target in RANK)) return `${specifier}: not a shared package`;
    if (RANK[target] >= RANK[pkg]) {
      return `${specifier}: ${pkg} (layer ${RANK[pkg]}) may only import lower layers, ${target} is layer ${RANK[target]}`;
    }
    return null;
  }

  if (isNodeBuiltin(specifier)) {
    return isTest ? null : `${specifier}: Node modules don't exist in the webview`;
  }

  const name = packageName(specifier);
  if (matchesAllowed(name, EXTERNAL[pkg] ?? [])) return null;
  if (isTest && matchesAllowed(name, TEST_ONLY)) return null;
  return `${specifier}: ${pkg} may not use ${name} (allowed: ${(EXTERNAL[pkg] ?? []).join(', ') || 'nothing'})`;
}

// ============================================================
// Reading the packages
// ============================================================

const PACKAGES_DIR = import.meta.dirname;

interface SharedPackage {
  name: string;
  dir: string;
  manifest: { name?: string; dependencies?: Record<string, string>; peerDependencies?: Record<string, string>; devDependencies?: Record<string, string> };
}

function sharedPackages(): SharedPackage[] {
  return readdirSync(PACKAGES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(PACKAGES_DIR, entry.name, 'package.json')))
    .map((entry) => {
      const dir = join(PACKAGES_DIR, entry.name);
      return { name: entry.name, dir, manifest: JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) };
    });
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name === 'dist') return [];
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return SOURCE_FILE.test(entry.name) ? [path] : [];
  });
}

// ============================================================
// Tests
// ============================================================

describe('the import check', () => {
  const dir = '/repo/packages/ui';
  const file = `${dir}/src/Button.tsx`;
  const check = (pkg: string, specifier: string, from = file) =>
    importViolation(pkg, pkg === 'ui' ? dir : `/repo/packages/${pkg}`, from, specifier);

  it('finds every kind of import', () => {
    const source = [
      "import React from 'react';",
      "import type { Store } from '@/store';",
      'import {\n  a,\n  b,\n} from "./multi";',
      "export { c } from '../outside';",
      "export * from './all';",
      "import './side-effect.css';",
      "const lazy = import('@tauri-apps/api/core');",
    ].join('\n');
    expect(importsOf(file, source)).toEqual([
      'react', '@/store', './multi', '../outside', './all', './side-effect.css', '@tauri-apps/api/core',
    ]);
    expect(importsOf('/x/a.css', "@import url('../other.css');\n@import \"./b.css\";")).toEqual(['../other.css', './b.css']);
  });

  it('allows own files, lower layers and listed libraries', () => {
    expect(check('ui', './Dialog')).toBeNull();
    expect(check('ui', '@lambda-house/tokens/tokens.css')).toBeNull();
    expect(check('ui', 'react')).toBeNull();
    expect(check('ui', 'react-dom/client')).toBeNull();
    expect(check('reader', '@codemirror/view')).toBeNull();
    expect(check('reader', '@lambda-house/workbench')).toBeNull();
  });

  it('rejects app code, Tauri and other layers', () => {
    expect(check('ui', '@tauri-apps/api/core')).toMatch(/Tauri/);
    expect(check('ui', '@/store')).toMatch(/alias/);
    expect(check('ui', '../../../src/store')).toMatch(/leaves the package/);
    expect(check('ui', 'zustand')).toMatch(/may not use zustand/);
    expect(check('ui', '@lambda-house/workbench')).toMatch(/lower layers/);
    expect(check('journal', '@lambda-house/reader')).toMatch(/lower layers/);
    expect(check('ui', '@lambda-house/ui')).toMatch(/own files/);
    expect(check('ui', '@lambda-house/unknown')).toMatch(/not a shared package/);
  });

  it('keeps Node and the test runner in tests', () => {
    expect(check('ui', 'node:fs')).toMatch(/webview/);
    expect(check('ui', 'path')).toMatch(/webview/);
    expect(check('ui', 'vitest')).toMatch(/may not use vitest/);
    expect(check('ui', 'node:fs', `${dir}/src/Button.test.tsx`)).toBeNull();
    expect(check('ui', 'vitest', `${dir}/src/Button.test.tsx`)).toBeNull();
  });
});

describe('the shared packages', () => {
  const packages = sharedPackages();

  it('are the ones the layer table knows', () => {
    expect(packages.map((p) => p.name).sort()).toEqual(Object.keys(RANK).sort());
    for (const { name, manifest } of packages) {
      expect(manifest.name, `packages/${name}/package.json`).toBe(`${SCOPE}${name}`);
    }
  });

  it('import only what their layer allows', () => {
    const violations = packages.flatMap(({ name, dir }) =>
      sourceFiles(dir).flatMap((file) =>
        importsOf(file, readFileSync(file, 'utf8'))
          .map((specifier) => importViolation(name, dir, file, specifier))
          .filter((why): why is string => why !== null)
          .map((why) => `${relative(PACKAGES_DIR, file)}: ${why}`)
      )
    );
    expect(violations).toEqual([]);
  });

  it('declare only dependencies their layer allows', () => {
    const violations = packages.flatMap(({ name, dir, manifest }) => {
      const runtime = { ...manifest.dependencies, ...manifest.peerDependencies };
      const declared = [
        ...Object.keys(runtime).map((dep) => ({ dep, from: `${dir}/src/index.ts` })),
        ...Object.keys(manifest.devDependencies ?? {}).map((dep) => ({ dep, from: `${dir}/src/index.test.ts` })),
      ];
      return declared
        .map(({ dep, from }) => importViolation(name, dir, from, dep))
        .filter((why): why is string => why !== null)
        .map((why) => `packages/${name}/package.json: ${why}`);
    });
    expect(violations).toEqual([]);
  });
});
