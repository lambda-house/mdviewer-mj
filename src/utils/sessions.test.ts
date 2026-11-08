import { describe, expect, it } from 'vitest';
import { family, origin, within, matchesActivity, sessionTree, directoryTree, matchesSession, resumeCommand, sumUsage, totalTokens, type Session } from './sessions';
const s = (id: string, parentId: string | null = null, provider: 'codex' | 'claude' = 'codex') => ({ id, parentId, provider, cwd: '/work/it\'s repo', title: 'Fix CORE-123', name: '', model: 'model-a', tickets: ['CORE-123'], tools: { shell: 1 }, usage: { input: 100, cached: 70, cacheWrite: 5, output: 20, reasoning: 6 } } as unknown as Session);
describe('session landscape', () => {
  it('does not add cached and reasoning tokens twice', () => { expect(totalTokens(sumUsage([s('1'),s('2')]))).toBe(240); });
  it('finds descendants regardless of ordering, provider, or cycles', () => {
    const root = s('root');
    expect(family([s('grandchild','child'), s('child','root'),s('unrelated'),s('root',null,'claude'),root],root).map(x => x.id)).toEqual(['grandchild','child','root']);
    expect(family([s('a','b'),s('b','a')],s('a','b'))).toHaveLength(2);
  });
  it('searches tickets, tools and models', () => { expect(matchesSession(s('1'),'core-123')).toBe(true); expect(matchesSession(s('1'),'shell')).toBe(true); expect(matchesSession(s('1'),'other')).toBe(false); });
  it('quotes resume commands and resumes the parent for Claude subagents', () => {
    expect(resumeCommand(s('id'))).toBe("cd '/work/it'\\''s repo' && codex resume 'id'");
    expect(resumeCommand(s('child','parent','claude'))).toContain("claude --resume 'parent'");
  });
});

describe('hierarchy, location and activity', () => {
  it('keeps a matched child under its context-only parent', () => {
    const root=s('root'); const child=s('child','root');
    const tree=sessionTree([child,root],[child]);
    expect(tree[0].session.id).toBe('root');expect(tree[0].contextOnly).toBe(true);expect(tree[0].children[0].session.id).toBe('child');
  });
  it('handles missing parents and cycles without dropping sessions', () => {
    expect(sessionTree([s('a','missing')],[s('a','missing')])[0].missingParent).toBe(true);
    const cycle=[s('a','b'),s('b','a')];const tree=sessionTree(cycle,cycle);expect(tree).toHaveLength(1);expect(tree[0].children).toHaveLength(1);
  });
  it('uses path boundaries and includes historical worktrees once per directory', () => {
    expect(within('/work/repo-other','/work/repo')).toBe(false);
    const x={...s('x'),cwd:'/work/repo/wt',directories:['/work/repo','/work/repo/wt']};
    const map=directoryTree([x]);expect(map.children.get('work')?.sessions.size).toBe(1);expect(map.children.get('work')?.children.get('repo')?.sessions.size).toBe(1);
  });
  it('combines explicit inactivity and since thresholds at inclusive boundaries', () => {
    const x={...s('x'),modified:100000};
    expect(matchesActivity(x,{activeSince:100000,inactiveSince:100000})).toBe(true);
    expect(matchesActivity(x,{activeSince:100001})).toBe(false);
    expect(matchesActivity(x,{inactiveMinutes:5,now:399999})).toBe(false);
    expect(matchesActivity(x,{inactiveMinutes:5,now:400000})).toBe(true);
    expect(matchesActivity(x,{activeMinutes:5,now:400000})).toBe(true);
    expect(matchesActivity(x,{activeMinutes:5,now:400001})).toBe(false);
    expect(matchesActivity(x,{activeMinutes:30,inactiveMinutes:5,now:700000})).toBe(true);
    expect(matchesActivity(x,{activeMinutes:5,inactiveMinutes:30,now:700000})).toBe(false);
    expect(origin({...x,origin:'human',forkedFrom:'earlier'})).toBe('human');
  });
});
