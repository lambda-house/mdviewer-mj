import { describe, expect, it } from 'vitest';
import { agentFilesToTree, getFileKind, getFileName, isMarkdownFile, isViewableFile } from './files';

describe('file types', () => {
  it('counts Cursor rules as markdown', () => {
    expect(isMarkdownFile('/repo/README.md')).toBe(true);
    expect(isMarkdownFile('/repo/notes.MARKDOWN')).toBe(true);
    expect(isMarkdownFile('/repo/.cursor/rules/style.mdc')).toBe(true);
    expect(isMarkdownFile('/repo/.cursorrules')).toBe(true);
    expect(isMarkdownFile('C:\\repo\\.cursorrules')).toBe(true);
    expect(isMarkdownFile('/repo/main.rs')).toBe(false);
    expect(isMarkdownFile('/repo/md')).toBe(false);
  });

  it('shows known text files and nothing else', () => {
    expect(isViewableFile('/repo/Makefile')).toBe(true);
    expect(isViewableFile('/repo/.gitignore')).toBe(true);
    expect(isViewableFile('/repo/src/app.tsx')).toBe(true);
    expect(isViewableFile('/repo/logo.png')).toBe(false);
    expect(isViewableFile('/home/me/.ssh/id_ed25519')).toBe(false);
  });

  it('picks how a file is rendered', () => {
    expect(getFileKind('/a/rule.mdc')).toEqual({ kind: 'markdown' });
    expect(getFileKind('/a/book.fb2')).toEqual({ kind: 'fb2' });
    expect(getFileKind('/a/main.rs')).toEqual({ kind: 'code', language: 'rust' });
    expect(getFileKind('/a/.env')).toEqual({ kind: 'code', language: 'ini' });
    expect(getFileKind('/a/server.log')).toEqual({ kind: 'text' });
  });

  it('takes the name from either separator', () => {
    expect(getFileName('/a/b/c.md')).toBe('c.md');
    expect(getFileName('C:\\a\\b.md')).toBe('b.md');
  });
});

describe('project agent file tree', () => {
  it('keeps only paths in the opened folder and builds hidden folders', () => {
    const tree = agentFilesToTree('/work/project', [
      '/work/project/AGENTS.md',
      '/work/project/.claude/skills/review/SKILL.md',
      '/work/project-other/AGENTS.md',
    ]);
    expect(tree.children?.map((n) => n.name)).toEqual(['.claude', 'AGENTS.md']);
    expect(tree.children?.[0].children?.[0].children?.[0].children?.[0].path)
      .toBe('/work/project/.claude/skills/review/SKILL.md');
  });
});
