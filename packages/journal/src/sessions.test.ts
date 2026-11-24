import { describe, expect, it } from 'vitest';
import {
  applyJournalUpdate, cacheState, directoryTree, family, filterSessions, formatSessionTitle, matchesActivity, matchesSession, NO_FILTERS, origin,
  resumeCommand, sessionTooltip, sessionTree, sumUsage, totalTokens, within, type Session, type Snapshot,
} from './sessions';

const s = (id: string, parentId: string | null = null, provider: 'codex' | 'claude' = 'codex') => ({ id, parentId, provider, cwd: '/work/it\'s repo', title: 'Fix CORE-123', name: '', model: 'model-a', tickets: ['CORE-123'], tools: { shell: 1 }, usage: { input: 100, cached: 70, cacheWrite: 5, output: 20, reasoning: 6 } } as unknown as Session);

describe('session landscape', () => {
  it('names sessions from cleaned titles, user requests, tickets and projects', () => {
    const session = { ...s('1'), cwd: '/work/api', name: 'root', title: '<INSTRUCTIONS>Setup</INSTRUCTIONS>\n Fix   login', events: [] };
    expect(formatSessionTitle(session)).toBe('Fix login');
    const instructions = { ...session, title: '# AGENTS.md instructions', events: [{ seq: 1, at: '', kind: 'user', text: '<environment_context>Setup</environment_context>', tool: null }, { seq: 2, at: '', kind: 'user', text: 'Repair\n the cache', tool: null }] };
    expect(formatSessionTitle(instructions)).toBe('Repair the cache');
    expect(formatSessionTitle({ ...instructions, events: [] })).toBe('CORE-123 · api');
    expect(formatSessionTitle({ ...instructions, events: [], tickets: [] })).toBe('api session');
  });
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
  it('keeps what a row leaves out in its tooltip', () => {
    const tip = sessionTooltip({ session: { ...s('x', 'gone'), status: 'working', usageKnown: true }, children: [], contextOnly: true, missingParent: true });
    expect(tip).toContain('120 tokens');
    expect(tip).toContain('working (inferred from the transcript)');
    expect(tip).toContain('excluded from totals');
    expect(tip).toContain('Parent not indexed: gone');
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
  it('groups and filters Windows directories at boundaries', () => {
    const path = 'C:\\Users\\me\\repo';
    expect(within(path, 'C:\\Users\\me')).toBe(true);
    expect(within(path, 'C:\\Users\\m')).toBe(false);
    expect(within(path, 'c:/users/ME')).toBe(true);
    expect(within(path, 'c:/users/m')).toBe(false);
    expect(within('\\\\Server\\Share\\Repo', '\\\\server\\share')).toBe(true);
    expect(within('/Work/repo', '/work')).toBe(false);
    const tree = directoryTree([{ cwd: path, id: '1', provider: 'codex' } as Session]);
    expect(tree.children.get('C:')?.path).toBe('C:\\');
    expect(tree.children.get('C:')?.children.get('Users')?.children.get('me')?.children.get('repo')?.path).toBe(path);
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
  it('filters a list by every field together', () => {
    const now = 10 * 86_400_000;
    const a = { ...s('a'), status: 'working', modified: now - 1000, cwd: '/work/a' };
    const b = { ...s('b', 'a', 'claude'), status: 'idle', modified: now - 2 * 86_400_000, cwd: '/work/b', title: 'Other' };
    const all = [a, b];
    expect(filterSessions(all, NO_FILTERS, now)).toEqual(all);
    expect(filterSessions(all, { ...NO_FILTERS, provider: 'claude' }, now)).toEqual([b]);
    expect(filterSessions(all, { ...NO_FILTERS, role: 'subagent' }, now)).toEqual([b]);
    expect(filterSessions(all, { ...NO_FILTERS, activity: 'recent' }, now)).toEqual([a]);
    expect(filterSessions(all, { ...NO_FILTERS, activity: 'roots' }, now)).toEqual([a]);
    expect(filterSessions(all, { ...NO_FILTERS, activity: 'idle' }, now)).toEqual([b]);
    expect(filterSessions(all, { ...NO_FILTERS, directory: '/work/b' }, now)).toEqual([b]);
    expect(filterSessions(all, { ...NO_FILTERS, query: 'other' }, now)).toEqual([b]);
    expect(filterSessions(all, { ...NO_FILTERS, inactiveMinutes: '60' }, now)).toEqual([b]);
  });
});

describe('cacheState', () => {
  const at = 1_000_000_000;
  const of = (provider: string, context: object) => ({ provider, context } as unknown as Session);
  it('follows the recorded lifetime', () => {
    const c = of('claude', { cacheTtl: 300, cacheAt: at });
    expect(cacheState(c, at + 60_000)).toMatchObject({ warm: true, cooling: false, assumed: false, until: at + 300_000 });
    expect(cacheState(c, at + 290_000)).toMatchObject({ warm: true, cooling: true });
    expect(cacheState(c, at + 301_000)).toMatchObject({ warm: false, assumed: false });
  });
  it('assumes an hour for Codex, which records none, and nothing for other agents', () => {
    const c = of('codex', { cacheAt: at });
    expect(cacheState(c, at + 600_000)).toMatchObject({ warm: true, assumed: true, ttl: 3600 });
    expect(cacheState(c, at + 2 * 3600_000)).toMatchObject({ warm: false, assumed: true });
    expect(cacheState(of('claude', { cacheAt: at }), at)).toBeNull();
    expect(cacheState(of('codex', {}), at)).toBeNull();
  });
});

describe('applyJournalUpdate', () => {
  const at = (id: string, title = id) => ({ id, source: `/fake/${id}.jsonl`, title }) as Session;
  const held: Snapshot = { sessions: [at('a'), at('b'), at('c'), at('d')], errors: [], scannedFiles: 4, pendingFiles: 0, indexedAt: 1 };
  const figures = { errors: ['late'], scannedFiles: 5, pendingFiles: 1, indexedAt: 2 };

  it('keeps what it holds for no snapshot, and takes a whole one', () => {
    expect(applyJournalUpdate(held, { stamp: 's', snapshot: null })).toBe(held);
    const whole = { ...figures, sessions: [at('x')] };
    expect(applyJournalUpdate(held, { stamp: 's', snapshot: whole })).toBe(whole);
  });

  it('puts the changed sessions at their places around the unchanged ones, without the removed', () => {
    const next = applyJournalUpdate(held, { stamp: 's', snapshot: { ...figures, sessions: [at('c', 'C again'), at('e')] }, positions: [0, 2], removed: ['/fake/b.jsonl'] });
    expect(next.sessions.map((s) => s.title)).toEqual(['C again', 'a', 'e', 'd']);
    expect(next.sessions[1]).toBe(held.sessions[0]);
    expect(next.pendingFiles).toBe(1);
  });

  it('takes the new figures with the same sessions when only they changed', () => {
    const next = applyJournalUpdate(held, { stamp: 's', snapshot: { ...figures, sessions: [] }, positions: [] });
    expect(next.sessions).toBe(held.sessions);
    expect(next.scannedFiles).toBe(5);
  });
});
