import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// ============================================================
// Every stylesheet's blocks close
// ============================================================
//
// A brace lost from the end of an at-rule doesn't fail the build: the
// browser closes the block at the end of the file, so every rule after it
// lands inside that `@keyframes` or `@layer` and is dropped without a
// word. This reads the packages' stylesheets and the app's (`src/`, beside
// `packages/` in both apps).

const ROOT = resolve(import.meta.dirname, '..');

function stylesheets(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === 'node_modules') return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return stylesheets(path);
    return name.endsWith('.css') ? [path] : [];
  });
}

/** Where blocks open that never close, or close that never opened (1-based lines). */
export function unbalancedBraces(css: string): string[] {
  // Comments and strings may hold braces: blank them, keeping the line breaks
  const blank = (text: string) => text.replace(/[^\n]/g, ' ');
  const code = css.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g, blank);
  const open: number[] = [];
  const problems: string[] = [];
  let line = 1;
  for (const char of code) {
    if (char === '\n') line++;
    else if (char === '{') open.push(line);
    else if (char === '}' && open.pop() === undefined) problems.push(`a } at line ${line} closes nothing`);
  }
  return [...problems, ...open.map((at) => `the { at line ${at} is never closed`)];
}

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === 'node_modules') return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

const withoutComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * Variables used without a fallback that nothing defines: no stylesheet, and
 * no component as an inline style (`'--zoom-factor': …`, `setProperty('--x')`).
 * Such a `var()` makes its declaration invalid, so the property falls back to
 * its initial value. Shiki writes its `--shiki-*` into the HTML it renders.
 */
export function undefinedVariables(stylesheets: string[], code: string[]): string[] {
  const defined = new Set<string>();
  for (const css of stylesheets) for (const [, name] of withoutComments(css).matchAll(/(--[\w-]+)\s*:/g)) defined.add(name);
  for (const source of code) {
    for (const [, name] of source.matchAll(/['"](--[\w-]+)['"]\s*:/g)) defined.add(name);
    for (const [, name] of source.matchAll(/setProperty\(\s*['"](--[\w-]+)/g)) defined.add(name);
  }
  const used = new Set<string>();
  for (const css of stylesheets) for (const [, name] of withoutComments(css).matchAll(/var\(\s*(--[\w-]+)\s*\)/g)) used.add(name);
  return [...used].filter((name) => !defined.has(name) && !name.startsWith('--shiki-')).sort();
}

describe('stylesheets', () => {
  const files = [...stylesheets(join(ROOT, 'packages')), ...stylesheets(join(ROOT, 'src'))];

  it('finds the stylesheets', () => {
    expect(files.length).toBeGreaterThan(4);
  });

  it.each(files.map((file) => [relative(ROOT, file), file]))('%s closes every block', (_, file) => {
    expect(unbalancedBraces(readFileSync(file, 'utf8'))).toEqual([]);
  });

  it('uses no variable that nothing defines', () => {
    const code = [...sources(join(ROOT, 'packages')), ...sources(join(ROOT, 'src'))].map((file) => readFileSync(file, 'utf8'));
    expect(undefinedVariables(files.map((file) => readFileSync(file, 'utf8')), code)).toEqual([]);
  });

  it('names a variable nothing defines', () => {
    expect(undefinedVariables([':root { --a: 1px; } .x { width: var(--a); height: var(--b); top: var(--c, 0); }'], [])).toEqual(['--b']);
    expect(undefinedVariables(['.x { zoom: var(--z); }'], ["style={{ '--z': 2 }}"])).toEqual([]);
  });

  it('reports what is left open', () => {
    expect(unbalancedBraces('@keyframes spin {\n  to { color: red; }\n\n.a { color: blue; }\n')).toEqual(['the { at line 1 is never closed']);
    expect(unbalancedBraces('.a { content: "}"; } /* { */')).toEqual([]);
    expect(unbalancedBraces('.a { }\n}')).toEqual(['a } at line 2 closes nothing']);
  });
});
