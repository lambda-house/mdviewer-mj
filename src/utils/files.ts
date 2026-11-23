import type { FileNode } from '../store';
import { getFileName, isMarkdownFile } from '@lambda-house/reader';


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

/** Turn project agent document paths into the same tree used by the Files panel. */
export function agentFilesToTree(root: string, paths: string[]): FileNode {
  const children: FileNode[] = [];
  const base = normalizeDirPath(root);
  for (const path of paths) {
    if (!isPathInside(path, base)) continue;
    const parts = path.slice(base.length).replace(/^[/\\]/, '').split(/[/\\]/);
    let level = children;
    let current = base;
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      const separator = root.includes('\\') && !root.includes('/') ? '\\' : '/';
      current += `${current.endsWith(separator) ? '' : separator}${name}`;
      let node = level.find((n) => n.path === current);
      if (!node) {
        node = {
          id: current,
          name,
          path: current,
          displayPath: name,
          type: i === parts.length - 1 ? 'file' : 'directory',
          ...(i === parts.length - 1 ? {} : { children: [] }),
        };
        level.push(node);
      }
      level = node.children ?? [];
    }
  }
  const sort = (nodes: FileNode[]) => {
    nodes.sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1);
    nodes.forEach((n) => n.children && sort(n.children));
  };
  sort(children);
  return { id: base, name: getFileName(base), path: base, displayPath: base, type: 'directory', children };
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
