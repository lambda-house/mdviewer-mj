// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentAccess } from './AgentAccess';
import { JournalProvider, type JournalHost, type SessionRowProps } from './host';
import { JournalView } from './JournalView';
import { MemoryBrowser } from './MemoryBrowser';
import { journalSettingsTabs } from './JournalSettings';
import { createJournalStore, detailPanes, MAIN_DETAIL } from './store';
import { journalPlugin } from './plugin';
import { PluginRegistry, Workbench } from '@lambda-house/workbench';
import type { Session } from './sessions';

const session: Session = { id: 'a', provider: 'codex', parentId: null, name: 'root', cwd: '/work/demo', title: 'Fix CORE-123', model: 'model-a', effort: 'high', started: '2026-01-01T00:00:00Z', updated: '2026-01-01T00:00:00Z', modified: Date.now(), status: 'working', usage: { input: 100, cached: 70, cacheWrite: 0, output: 20, reasoning: 5 }, usageKnown: true, models: {}, tools: { shell: 2 }, tickets: ['CORE-123'], memoryRefs: [], events: [{ seq: 1, at: '2026-01-01T00:00:00Z', kind: 'assistant', text: '<script>untrusted()</script>', tool: null }], eventCount: 1, malformedLines: 0, source: '/fake/session.jsonl', turnId: 'turn' };
const other: Session = { ...session, id: 'b', title: 'Parser rewrite', cwd: '/work/parser', modified: Date.now() - 1000, events: [] };

/** The core host every app has; a test adds what it needs. */
function fakeHost(extra: Partial<JournalHost> = {}): JournalHost {
  return {
    appName: 'Test app',
    available: true,
    access: vi.fn(async () => true),
    enable: vi.fn(async () => true),
    disable: vi.fn(async () => {}),
    snapshot: vi.fn(async () => ({ sessions: [{ ...session, events: [] }, other], scannedFiles: 2, pendingFiles: 0, indexedAt: Date.now(), errors: [] })),
    detail: vi.fn(async (_provider: string, id: string) => (id === 'a' ? session : other)),
    events: vi.fn(async () => []),
    memoryAccess: vi.fn(async () => false),
    enableMemories: vi.fn(async () => true),
    memories: vi.fn(async () => ({ entries: [], notes: [] })),
    readMemory: vi.fn(async () => ({ title: '', content: '', provenance: '', note: '' })),
    openMemoryWindow: vi.fn(async () => {}),
    ...extra,
  };
}

let root: Root; let container: HTMLDivElement;
const flush = async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };
const buttons = () => [...container.querySelectorAll('button')];
const button = (text: string) => buttons().find((b) => b.textContent?.trim().toLowerCase() === text) || buttons().find((b) => b.textContent?.toLowerCase().includes(text))!;
const render = async (host: JournalHost, ui = <JournalView />, row?: (props: SessionRowProps) => React.ReactNode) => {
  const store = createJournalStore({ storage: null, name: 'journal' });
  await act(async () => root.render(<JournalProvider journal={{ store, host }} row={row}>{ui}</JournalProvider>));
  await flush();
  return store;
};

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

describe('the journal', () => {
  it('renders actual session details as text and loads linked work only on request', async () => {
    const host = fakeHost({ context: vi.fn(async () => { throw 'No Jira credentials'; }) });
    await render(host);
    expect(container.textContent).toContain('Fix CORE-123');
    expect(container.textContent).toContain('<script>untrusted()</script>');
    expect(container.querySelector('script')).toBeNull();
    expect(host.context).not.toHaveBeenCalled();
    await act(async () => button('linked work').click());
    await act(async () => (container.querySelector('.sc-ticket-list button') as HTMLButtonElement).click());
    expect(container.textContent).toContain('No Jira credentials');
  });

  it('without remote context lists ticket mentions only, and has no Direct tab', async () => {
    await render(fakeHost());
    await act(async () => button('linked work').click());
    expect(container.querySelector('.sc-ticket-list code')?.textContent).toBe('CORE-123');
    expect(container.querySelector('.sc-ticket-list button')).toBeNull();
    expect(buttons().some((b) => b.textContent === 'Direct')).toBe(false);
    expect(container.textContent).not.toContain('Connections');
  });

  it('opens tickets at the configured site and reports an absent connection', async () => {
    const openExternal = vi.fn(async () => {});
    const connections = vi.fn(async () => ({ jiraSite: 'https://example.atlassian.net/', jiraReady: true, memoryUrl: '', memoryReady: false }));
    await render(fakeHost({ context: vi.fn(), connections, openExternal }));
    await act(async () => button('linked work').click());
    await act(async () => (container.querySelector('[aria-label="Open CORE-123 in Jira"]') as HTMLButtonElement).click());
    expect(openExternal).toHaveBeenCalledWith('https://example.atlassian.net/browse/CORE-123');
    openExternal.mockClear();
    connections.mockResolvedValue({ jiraSite: '', jiraReady: false, memoryUrl: '', memoryReady: false });
    await act(async () => (container.querySelector('[aria-label="Open CORE-123 in Jira"]') as HTMLButtonElement).click());
    expect(openExternal).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Set your Jira site in Connections first.');
  });

  it('does not read transcripts before access is enabled', async () => {
    const host = fakeHost({ access: vi.fn(async () => false) });
    await render(host);
    expect(container.textContent).toContain('Enable session access');
    expect(host.snapshot).not.toHaveBeenCalled();
  });

  it('reads nothing while not shown', async () => {
    const host = fakeHost();
    await render(host, <JournalView active={false} />);
    expect(host.snapshot).not.toHaveBeenCalled();
    expect(host.detail).not.toHaveBeenCalled();
  });

  it('shows control failures without claiming delivery', async () => {
    await render(fakeHost({ control: vi.fn(async () => { throw 'Daemon unavailable'; }) }));
    await act(async () => button('direct').click());
    await act(async () => button('inspect live').click());
    expect(container.textContent).toContain('Daemon unavailable');
    expect(container.textContent).not.toContain('Instruction accepted');
  });

  it('offers Resume only with a host that can resume', async () => {
    const resume = vi.fn(async () => {});
    await render(fakeHost({ resume }));
    await act(async () => button('resume in live').click());
    expect(resume).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
  });

  it('shows a list and two detail panes side by side', async () => {
    const host = fakeHost();
    const store = await render(host);
    const rows = () => [...container.querySelectorAll<HTMLButtonElement>('.ss-results .sc-session')];
    expect(rows().map((r) => r.textContent)).toEqual([expect.stringContaining('Fix CORE-123'), expect.stringContaining('Parser rewrite')]);
    // Mod+click opens the session beside the one shown
    await act(async () => rows()[1].dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true })));
    await flush();
    const panes = [...container.querySelectorAll('.wb-leaf')];
    expect(panes.map((p) => (p.querySelector('.ss-list') ? 'list' : p.querySelector('h2')?.textContent))).toEqual(['list', 'Fix CORE-123', 'Parser rewrite']);
    expect(host.detail).toHaveBeenCalledWith('codex', 'b');
    // A plain click shows it in the pane focused last; the other keeps its session
    await act(async () => rows()[0].click());
    expect(detailPanes(store.getState()).map((id) => store.getState().details[id].session)).toEqual(['codex:a', 'codex:a']);
    // Each extra pane can be closed; the last one stays
    await act(async () => (container.querySelectorAll('[aria-label="Close session pane"]')[1] as HTMLButtonElement).click());
    expect(detailPanes(store.getState())).toEqual([MAIN_DETAIL]);
    expect(container.querySelector('[aria-label="Close session pane"]')).toBeNull();
  });

  it('zooms a pane on its own with Ctrl + wheel, with its zoom in its header', async () => {
    const store = await render(fakeHost());
    const detail = () => container.querySelector('.wb-leaf .sc-detail')!;
    // Ctrl + wheel (happy-dom's WheelEvent drops ctrlKey)
    const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -100 });
    Object.defineProperty(wheel, 'ctrlKey', { value: true });
    await act(async () => detail().querySelector('.sc-detail-content')!.dispatchEvent(wheel));
    expect(store.getState().zoom[MAIN_DETAIL]).toBe(110);
    expect(detail().querySelector('.wb-zoom-badge')?.textContent).toBe('110%');
    expect(detail().querySelector<HTMLElement>('.sc-detail-content > .panel-zoom')?.style.zoom).toBe('1.1');
    // The list is still at 100 %, without a badge
    expect(container.querySelector('.ss-list .wb-zoom-badge')).toBeNull();
    // A click on the badge sets it back
    await act(async () => detail().querySelector<HTMLButtonElement>('.wb-zoom-badge')!.click());
    expect(store.getState().zoom[MAIN_DETAIL]).toBeUndefined();
  });

  it('narrows the list by text and by folder', async () => {
    await render(fakeHost());
    const input = container.querySelector('[aria-label="Search sessions"]') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'parser');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(container.querySelectorAll('.ss-results .sc-session')).toHaveLength(1);
    await act(async () => button('clear').click());
    await act(async () => (container.querySelector('[aria-label="Search only /work/demo"]') as HTMLButtonElement).click());
    expect(container.querySelector('.ss-chip')?.textContent).toContain('/work/demo');
    expect(container.querySelectorAll('.ss-results .sc-session')).toHaveLength(1);
  });

  it('draws the rows the app gives it', async () => {
    await render(fakeHost(), <JournalView />, ({ title, onOpen }) => <button className="sc-session app-row" onClick={onOpen}>{title}!</button>);
    expect([...container.querySelectorAll('.app-row')].map((r) => r.textContent)).toEqual(['Fix CORE-123!', 'Parser rewrite!']);
  });

  it('revokes access and forgets the index', async () => {
    const host = fakeHost();
    await render(host);
    await act(async () => button('revoke session access').click());
    expect(host.disable).toHaveBeenCalled();
    expect(container.textContent).toContain('Enable session access');
  });
});

describe('memories', () => {
  it('does not inspect memory until its own permission is granted', async () => {
    const host = fakeHost();
    await render(host, <MemoryBrowser />);
    expect(container.textContent).toContain('Enable memory access');
    expect(host.memories).not.toHaveBeenCalled();
  });

  it('keeps user, shared project and session-specific memory distinct', async () => {
    const host = fakeHost({
      memoryAccess: vi.fn(async () => true),
      memories: vi.fn(async () => ({ notes: [], entries: ['user', 'project', 'session'].map((scope) => ({ key: scope, title: `${scope} memory file`, scope, provider: 'codex', path: `/${scope}`, modified: 1, description: 'source' })) })),
    });
    await render(host, <MemoryBrowser session={{ id: 's', provider: 'codex' } as Session} />);
    expect(container.textContent).toContain('session memory file');
    expect(container.textContent).not.toContain('user memory file');
    await act(async () => buttons().find((b) => b.textContent === 'User scope')!.click());
    expect(container.textContent).toContain('user memory file');
    expect(container.textContent).not.toContain('session memory file');
    expect(container.textContent).not.toContain('project memory file');
  });

  it('opens Markdown in a native window and reports failures without switching workspaces', async () => {
    const path = '/project/memory/MEMORY.md';
    const host = fakeHost({
      memoryAccess: vi.fn(async () => true),
      memories: vi.fn(async () => ({ notes: [], entries: [{ key: path, path, title: 'MEMORY.md', scope: 'user', provider: 'claude', modified: 1, description: 'Shared memory' }] })),
      openMemoryWindow: vi.fn().mockRejectedValueOnce('Memory access revoked').mockResolvedValue(undefined),
    });
    await render(host, <MemoryBrowser />);
    const entry = () => container.querySelector('.sc-memory-list button') as HTMLButtonElement;
    await act(async () => entry().click());
    expect(host.readMemory).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Memory access revoked');
    await act(async () => entry().click());
    expect(host.openMemoryWindow).toHaveBeenLastCalledWith(path, undefined);
    expect(host.readMemory).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain('Memory access revoked');
    expect(container.querySelector('.sc-memory-document')).toBeNull();
  });

  it('keeps generated session context inline instead of opening its backing transcript as Markdown', async () => {
    const host = fakeHost({
      memoryAccess: vi.fn(async () => true),
      memories: vi.fn(async () => ({ notes: [], entries: [{ key: 'transcript-memory', path: '/sessions/thread.jsonl', title: 'Session context', scope: 'session', provider: 'claude', modified: 1, description: 'Recorded context' }] })),
      readMemory: vi.fn(async () => ({ title: 'Session context', content: '# Compaction', provenance: '/sessions/thread.jsonl', note: 'Recorded context' })),
    });
    await render(host, <MemoryBrowser session={{ id: 's', provider: 'claude' } as Session} />);
    await act(async () => (container.querySelector('.sc-memory-list button') as HTMLButtonElement).click());
    expect(host.openMemoryWindow).not.toHaveBeenCalled();
    expect(container.querySelector('.sc-memory-document')?.textContent).toContain('# Compaction');
  });
});

describe('agent access', () => {
  const status = (enabled = false) => ({ grant: { enabled, directory: '/work/demo', session: '', excerpts: false }, socket: '/tmp/private/mcp.sock', executable: '/Applications/Test.app/Contents/MacOS/test', error: null, clients: [], recentQueries: [] });
  const analysis = (enabled = false) => ({ status: vi.fn(async () => status(enabled)), enable: vi.fn(async () => true), revoke: vi.fn(async () => {}), query: vi.fn(async () => ({ data: { message: '<script>not executable</script>' } })) });

  it('keeps excerpts off and sends only the selected directory scope', async () => {
    const host = fakeHost({ analysis: analysis() });
    await render(host, <AgentAccess close={() => {}} directory="/work/demo" inspect={() => {}} />);
    expect((container.querySelector('input[type=checkbox]') as HTMLInputElement).checked).toBe(false);
    await act(async () => button('enable agent access').click());
    expect(host.analysis!.enable).toHaveBeenCalledWith({ enabled: true, directory: '/work/demo', session: '', excerpts: false });
    expect(container.textContent).toContain('--mcp');
    expect(container.textContent).toContain('close Test app');
  });

  it('revokes access and refreshes status', async () => {
    const host = fakeHost({ analysis: analysis(true) });
    await render(host, <AgentAccess close={() => {}} directory="" inspect={() => {}} />);
    await act(async () => button('revoke agent access').click());
    expect(host.analysis!.revoke).toHaveBeenCalled();
  });

  it('uses the shared query API and renders untrusted results as text', async () => {
    const host = fakeHost({ analysis: analysis(true) });
    await render(host, <AgentAccess close={() => {}} directory="/work/demo" inspect={() => {}} />);
    await act(async () => button('tool activity').click());
    expect(host.analysis!.query).toHaveBeenCalledWith('analyze_tools', { cohort: { directory: '/work/demo' } });
    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).toContain('<script>not executable</script>');
  });

  it('is not there without the host’s analysis', async () => {
    await render(fakeHost(), <AgentAccess close={() => {}} directory="" inspect={() => {}} />);
    expect(container.textContent).toBe('');
  });
});

describe('settings', () => {
  it('turns session access on and off from its tab', async () => {
    const host = fakeHost({ access: vi.fn(async () => false) });
    const store = createJournalStore({ storage: null, name: 'journal' });
    store.getState().setEnabled(false);
    const [access] = journalSettingsTabs({ store, host });
    await act(async () => root.render(<>{access.render()}</>));
    await act(async () => button('enable session access').click());
    expect(host.enable).toHaveBeenCalled();
    expect(store.getState().enabled).toBe(true);
    await act(async () => button('revoke session access').click());
    expect(host.disable).toHaveBeenCalled();
    expect(store.getState().enabled).toBe(false);
  });
});

describe('journalPlugin', () => {
  const mount = async (host: JournalHost, surface: string, withSurface = true) => {
    const store = createJournalStore({ storage: null, name: 'journal' });
    const registry = new PluginRegistry();
    registry.register({ id: 'app', name: 'App', setup: (api) => { api.contribute('workbench:surface', { id: 'documents', label: 'Documents', order: 10, render: () => <p>Documents</p> }); } });
    registry.register(journalPlugin({ store, host }, withSurface ? { surface: { id: 'journal', label: 'Journal', order: 20 } } : {}));
    await act(async () => root.render(
      <Workbench registry={registry} surface={surface} onSurface={() => {}} menu={[]} commandContext={() => null} useCommandContext={() => null} settings={{ open: false, onOpenChange: () => {} }} />,
    ));
    await flush();
    return registry;
  };

  it('brings its Settings tabs, and its own surface when the app gives it one', async () => {
    const registry = await mount(fakeHost(), 'documents');
    expect(registry.items('workbench:settings-tab').map((tab) => tab.label)).toEqual(['Session access', 'Memories']);
    expect(registry.items('workbench:surface').map((s) => s.id)).toEqual(['documents', 'journal']);
    expect((await mount(fakeHost(), 'documents', false)).items('workbench:surface').map((s) => s.id)).toEqual(['documents']);
  });

  it('asks for the index only once its surface is shown', async () => {
    const host = fakeHost();
    await mount(host, 'documents');
    expect(host.snapshot).not.toHaveBeenCalled();
    await mount(host, 'journal');
    expect(host.snapshot).toHaveBeenCalled();
    expect(container.textContent).toContain('Fix CORE-123');
  });
});
