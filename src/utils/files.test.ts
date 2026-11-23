import { describe, expect, it } from 'vitest';
import { agentFilesToTree } from './files';

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
