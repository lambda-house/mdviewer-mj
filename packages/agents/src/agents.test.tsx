// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createReaderStore, ReaderProvider, type Reader } from '@lambda-house/reader';
import { PluginRegistry } from '@lambda-house/workbench';
import {
  AGENT_CHANGE_DEBOUNCE, AGENT_POLL_INTERVAL, AgentList, agentChanges, agentEntryMatches, agentFolders, agentsPlugin, createAgents,
  disableAgents, enableAgents, markAgentsRead, refreshAgents,
  type AgentEntry, type AgentHost, type Agents, type AgentWorkspace,
} from './index';

const entry = (path: string, extra: Partial<AgentEntry> = {}): AgentEntry => ({
  path, kind: 'memory', title: path.split('/').pop()!, description: null, group: 'Claude Code', scope: 'user',
  modified: 1, unread: false, isNew: false, folder: null, ...extra,
});

const ENTRIES = [
  entry('/home/me/.claude/CLAUDE.md', { kind: 'instructions', title: 'CLAUDE.md' }),
  entry('/home/me/.claude/skills/review/SKILL.md', { kind: 'skill', title: 'review', description: 'Review a pull request', unread: true }),
  entry('/home/me/.codex/AGENTS.md', { kind: 'instructions', title: 'AGENTS.md', group: 'Codex', unread: true, isNew: true }),
  entry('/home/me/.claude/projects/demo/memory/MEMORY.md', { title: 'MEMORY.md', group: '~/dev/demo', folder: '/home/me/dev/demo/sub' }),
  entry('/home/me/dev/demo/CLAUDE.md', { kind: 'instructions', title: 'Project CLAUDE.md', scope: 'project', folder: '/home/me/dev/demo' }),
];

function fakeHost(workspace: Partial<AgentWorkspace> = {}, extra: Partial<AgentHost> = {}): AgentHost & { emit: () => void } {
  let listener: (() => void) | null = null;
  return {
    available: true,
    workspace: vi.fn(async () => ({ enabled: true, entries: ENTRIES, folders: ['/home/me/dev/demo'], watching: true, ...workspace })),
    onChange: vi.fn(async (handler: () => void) => { listener = handler; return () => { listener = null; }; }),
    enable: vi.fn(async () => true),
    disable: vi.fn(async () => {}),
    markRead: vi.fn(async () => {}),
    readSnapshot: vi.fn(async () => null),
    opened: vi.fn(),
    emit: () => listener?.(),
    ...extra,
  };
}

function fakeReader(files: Record<string, string> = {}): Reader {
  return {
    store: createReaderStore({ storage: null, name: 'test' }),
    host: {
      readFile: vi.fn(async (path: string) => files[path] ?? `# ${path}`),
      writeFile: vi.fn(async () => {}),
      saveAs: vi.fn(async () => {}),
      openPath: vi.fn(async () => {}),
      followLocalLink: vi.fn(async () => 'open' as const),
      openExternal: vi.fn(async () => {}),
    },
  };
}

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});

const flush = async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };
const render = async (reader: Reader, ui: React.ReactNode) => {
  await act(async () => root.render(<ReaderProvider reader={reader}>{ui}</ReaderProvider>));
  await flush();
};
const texts = (selector: string) => [...container.querySelectorAll(selector)].map((el) => el.textContent?.trim());
const button = (text: string) => [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)!;

describe('the entries', () => {
  it('match a filter by title, description, group or path', () => {
    const skill = ENTRIES[1];
    expect(agentEntryMatches(skill, '')).toBe(true);
    expect(agentEntryMatches(skill, 'REVIEW')).toBe(true);
    expect(agentEntryMatches(skill, 'pull request')).toBe(true);
    expect(agentEntryMatches(skill, 'claude code')).toBe(true);
    expect(agentEntryMatches(skill, 'skills/')).toBe(true);
    expect(agentEntryMatches(skill, 'parser')).toBe(false);
  });

  it('go to the nearest session folder above them; the rest are the user’s', () => {
    const grouped = agentFolders(ENTRIES, ['/home/me/dev', '/home/me/dev/demo', '/home/me/notes']);
    // A memory of a subfolder goes to the nearest folder; a folder without documents is left out
    expect(grouped.folders.map((f) => [f.path, f.entries.map((e) => e.title)])).toEqual([
      ['/home/me/dev/demo', ['MEMORY.md', 'Project CLAUDE.md']],
    ]);
    expect(grouped.user.map((e) => e.title)).toEqual(['CLAUDE.md', 'review', 'AGENTS.md']);
    // No folders: everything is the user's
    expect(agentFolders(ENTRIES, []).user).toHaveLength(ENTRIES.length);
  });
});

describe('the store', () => {
  it('takes a scan, and reloads an open document that changed on disk', async () => {
    const reader = fakeReader({ '/home/me/.claude/CLAUDE.md': 'new text' });
    const agents = createAgents(fakeHost({ entries: [ENTRIES[0], ENTRIES[1]] }));
    expect(agents.store.getState().enabled).toBeNull();
    await refreshAgents(agents, reader);
    expect(agents.store.getState()).toMatchObject({ enabled: true, watching: true, folders: ['/home/me/dev/demo'] });
    expect(agents.store.getState().entries).toHaveLength(2);

    // Open one, then a scan says it changed: its text is read again
    reader.store.getState().openDocument('/home/me/.claude/CLAUDE.md', 'old text');
    agents.host.workspace = vi.fn(async () => ({ enabled: true, entries: [{ ...ENTRIES[0], modified: 2 }, ENTRIES[1]], watching: true }));
    await refreshAgents(agents, reader);
    expect(reader.host.readFile).toHaveBeenCalledTimes(1);
    expect(reader.store.getState().documents['/home/me/.claude/CLAUDE.md'].content).toBe('new text');
    // A backend without session folders leaves none
    expect(agents.store.getState().folders).toEqual([]);
  });

  it('scans once at a time', async () => {
    const reader = fakeReader();
    const host = fakeHost();
    const agents = createAgents(host);
    const [a, b] = [refreshAgents(agents, reader), refreshAgents(agents, reader)];
    expect(a).toBe(b);
    await a;
    expect(host.workspace).toHaveBeenCalledTimes(1);
    await refreshAgents(agents, reader);
    expect(host.workspace).toHaveBeenCalledTimes(2);
  });

  it('marks documents read, turns reading on and off', async () => {
    const reader = fakeReader();
    const host = fakeHost({ enabled: false, entries: [] });
    const agents = createAgents(host);
    await refreshAgents(agents, reader);
    expect(agents.store.getState().enabled).toBe(false);

    host.workspace = vi.fn(async () => ({ enabled: true, entries: ENTRIES, watching: false }));
    await enableAgents(agents, reader);
    expect(host.enable).toHaveBeenCalled();
    expect(agents.store.getState().enabled).toBe(true);

    await markAgentsRead(agents, ['/home/me/.codex/AGENTS.md']);
    expect(host.markRead).toHaveBeenCalledWith(['/home/me/.codex/AGENTS.md']);
    const codex = agents.store.getState().entries.find((e) => e.path === '/home/me/.codex/AGENTS.md')!;
    expect([codex.unread, codex.isNew]).toEqual([false, false]);
    await markAgentsRead(agents, []);
    expect(host.markRead).toHaveBeenCalledTimes(1);

    await disableAgents(agents);
    expect(host.disable).toHaveBeenCalled();
    expect(agents.store.getState()).toMatchObject({ enabled: false, entries: [], folders: [] });
  });

  it('tells the reader which documents’ reads it keeps', async () => {
    const reader = fakeReader();
    const agents = createAgents(fakeHost());
    const changes = agentChanges(agents);
    function Tracked({ path }: { path: string }) {
      return <p>{changes.useIsTracked(path) ? 'tracked' : 'not tracked'}</p>;
    }
    await render(reader, <Tracked path="/home/me/.claude/CLAUDE.md" />);
    expect(container.textContent).toBe('not tracked');
    await act(async () => { await refreshAgents(agents, reader); });
    expect(container.textContent).toBe('tracked');
    await changes.markRead(['/home/me/.claude/CLAUDE.md']);
    expect(agents.host.markRead).toHaveBeenCalledWith(['/home/me/.claude/CLAUDE.md']);
    await changes.readSnapshot('/x.md');
    expect(agents.host.readSnapshot).toHaveBeenCalledWith('/x.md');
  });
});

describe('AgentList', () => {
  const list = (agents: Agents, extra: Partial<React.ComponentProps<typeof AgentList>> = {}) => (
    <AgentList agents={agents} about="Covers the test folders." {...extra} />
  );

  it('says it is loading, then asks before it reads anything', async () => {
    const reader = fakeReader();
    const host = fakeHost({ enabled: false, entries: [] });
    const agents = createAgents(host);
    await render(reader, list(agents, { noun: 'agent files' }));
    expect(container.textContent).toBe('Loading agent files…');
    await act(async () => { await refreshAgents(agents, reader); });
    expect(container.querySelector('.agent-panel-intro-detail')?.textContent).toBe('Covers the test folders. Settings, keys and transcripts are never read.');
    expect(host.workspace).toHaveBeenCalledTimes(1);
    await act(async () => button('Show agent files').click());
    await flush();
    expect(host.enable).toHaveBeenCalled();
    expect(host.workspace).toHaveBeenCalledTimes(2);
  });

  it('lists what changed first, then by kind and group, and narrows with the filter', async () => {
    const reader = fakeReader();
    const agents = createAgents(fakeHost());
    await refreshAgents(agents, reader);
    // MDViewer's Files: the agents' own documents only
    await render(reader, list(agents, { only: (e) => e.scope !== 'project' }));
    expect(texts('.agent-section-title')).toEqual(['Changed since you read them', 'Instructions', 'Memory', 'Skills']);
    expect(texts('.agent-group-title')).toEqual(['Claude Code', 'Codex', '~/dev/demo', 'Claude Code']);
    // A new document is marked new, not changed
    expect(texts('.agent-section-header')[0]).toBe('Changed since you read them1');
    expect(texts('.agent-item-status')).toEqual(['Changed', 'New', 'Changed']);
    // Plans and commands start folded; a header folds and unfolds its section
    await act(async () => (container.querySelector('.agent-section-header') as HTMLButtonElement).click());
    expect(container.querySelector('.agent-section-header')?.getAttribute('aria-expanded')).toBe('false');

    const input = container.querySelector('input')!;
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      set.call(input, 'review');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(texts('.agent-item-title')).toEqual(['review', 'review']);
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      set.call(input, 'nothing like it');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(container.querySelector('.agent-panel-empty')?.textContent).toBe('Nothing matches the filter.');
  });

  it('puts a session folder’s documents under it, the rest under All folders', async () => {
    const reader = fakeReader();
    const agents = createAgents(fakeHost());
    await refreshAgents(agents, reader);
    await render(reader, list(agents, { folders: { label: (path) => `…/${path.split('/').pop()}` } }));
    const folder = container.querySelector('.agent-folder')!;
    expect(folder.getAttribute('aria-label')).toBe('Agent documents in /home/me/dev/demo');
    expect(folder.querySelector('.agent-folder-path')?.textContent).toBe('…/demo');
    expect([...folder.querySelectorAll('.agent-group-title')].map((t) => t.textContent)).toEqual(['Instructions', 'Memory']);
    expect(container.querySelector('.agent-user-title')?.textContent).toBe('All folders');
    // Folding a folder keeps its header
    await act(async () => (folder.querySelector('.agent-folder-header') as HTMLButtonElement).click());
    expect(folder.querySelectorAll('.agent-item')).toHaveLength(0);
    expect(folder.querySelector('.agent-folder-expand')?.classList.contains('expanded')).toBe(false);
  });

  it('opens a document for a look on a click, in a tab of its own on a double-click', async () => {
    const reader = fakeReader({ '/home/me/.claude/CLAUDE.md': '# Instructions' });
    const agents = createAgents(fakeHost());
    await refreshAgents(agents, reader);
    await render(reader, list(agents));
    const item = [...container.querySelectorAll<HTMLElement>('.agent-item')].find((el) => el.title === '/home/me/.claude/CLAUDE.md')!;
    await act(async () => { item.click(); });
    await flush();
    const tabs = () => Object.values(reader.store.getState().groups).flatMap((g) => g.tabs);
    expect(tabs().map((t) => [t.path, t.isPreview])).toEqual([['/home/me/.claude/CLAUDE.md', true]]);
    expect(agents.host.opened).toHaveBeenCalledWith('/home/me/.claude/CLAUDE.md', true);
    expect(item.classList.contains('selected')).toBe(true);
    await act(async () => { item.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); });
    await flush();
    expect(tabs().map((t) => t.isPreview)).toEqual([false]);
    expect(agents.host.opened).toHaveBeenLastCalledWith('/home/me/.claude/CLAUDE.md', false);
  });
});

describe('agentsPlugin', () => {
  async function watch(agents: Agents, reader: Reader, options: Parameters<typeof agentsPlugin>[1]) {
    const registry = new PluginRegistry();
    registry.register(agentsPlugin(agents, options));
    const overlay = registry.items('workbench:overlay').find((o) => o.id === 'agents:watch')!;
    await render(reader, overlay.render());
  }

  it('scans while watched: at once, after a burst of changes, on focus, and by polling when the backend cannot watch', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    const reader = fakeReader();
    const host = fakeHost({ watching: false });
    const agents = createAgents(host);
    await act(async () => root.render(<ReaderProvider reader={reader}><></></ReaderProvider>));
    const registry = new PluginRegistry();
    registry.register(agentsPlugin(agents, { useWatched: () => true }));
    await act(async () => root.render(<ReaderProvider reader={reader}>{registry.items('workbench:overlay')[0].render()}</ReaderProvider>));
    await act(async () => { await Promise.resolve(); });
    expect(host.workspace).toHaveBeenCalledTimes(1);

    // Events in a burst: no scan while they come, one once they pause
    for (let i = 0; i < 3; i++) {
      await act(async () => { host.emit(); vi.advanceTimersByTime(AGENT_CHANGE_DEBOUNCE - 100); });
      expect(host.workspace).toHaveBeenCalledTimes(1);
    }
    await act(async () => { vi.advanceTimersByTime(100); });
    expect(host.workspace).toHaveBeenCalledTimes(2);

    await act(async () => { window.dispatchEvent(new Event('focus')); });
    expect(host.workspace).toHaveBeenCalledTimes(3);

    // The backend said it cannot watch: poll
    await act(async () => { vi.advanceTimersByTime(AGENT_POLL_INTERVAL); });
    expect(host.workspace).toHaveBeenCalledTimes(4);
  });

  it('scans once per key while not watched, and never without a backend', async () => {
    const reader = fakeReader();
    const host = fakeHost();
    const agents = createAgents(host);
    let key = 'a';
    const options = { useWatched: () => false, useScanKey: () => key };
    await watch(agents, reader, options);
    expect(host.workspace).toHaveBeenCalledTimes(1);
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    expect(host.workspace).toHaveBeenCalledTimes(1);
    key = 'b';
    await watch(agents, reader, options);
    expect(host.workspace).toHaveBeenCalledTimes(2);

    const none = fakeHost({}, { available: false });
    await watch(createAgents(none), reader, { useWatched: () => true });
    expect(none.workspace).not.toHaveBeenCalled();
  });

  it('tells the app whether one of the documents is open, to watch them', async () => {
    const reader = fakeReader();
    const host = fakeHost();
    const agents = createAgents(host);
    await refreshAgents(agents, reader);
    const seen: boolean[] = [];
    await watch(agents, reader, { useWatched: (open) => { seen.push(open); return false; } });
    expect(seen[seen.length - 1]).toBe(false);
    await act(async () => { reader.store.getState().openDocument('/home/me/.claude/CLAUDE.md', 'text'); });
    expect(seen[seen.length - 1]).toBe(true);
  });
});
