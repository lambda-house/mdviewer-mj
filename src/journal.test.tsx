// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { JournalProvider, JournalView, createJournalStore, type Session } from '@lambda-house/journal';
import { journalHost } from './journal';
import { openExternal } from './utils/tauri';

// The journal against MDViewer's own host: what it asks the backend for, by
// command name and arguments (sessions.rs, session_commands.rs, …).

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('./utils/tauri', () => ({ isTauri: () => true, openExternal: vi.fn() }));

const session: Session = { id: 'a', provider: 'codex', parentId: null, name: 'root', cwd: '/work/demo', title: 'Fix CORE-123', model: 'model-a', effort: 'high', started: '2026-01-01T00:00:00Z', updated: '2026-01-01T00:00:00Z', modified: Date.now(), status: 'working', usage: { input: 100, cached: 70, cacheWrite: 0, output: 20, reasoning: 5 }, usageKnown: true, models: {}, tools: { shell: 2 }, tickets: ['CORE-123'], memoryRefs: [], events: [{ seq: 1, at: '2026-01-01T00:00:00Z', kind: 'assistant', text: 'Done', tool: null }], eventCount: 1, malformedLines: 0, source: '/fake/session.jsonl', turnId: 'turn' };

const backend: Record<string, (args?: Record<string, unknown>) => unknown> = {
  session_access: () => true,
  sessions_snapshot: () => ({ sessions: [{ ...session, events: [] }], scannedFiles: 1, pendingFiles: 0, indexedAt: Date.now(), errors: [] }),
  session_details: () => session,
  session_connections: () => ({ jiraSite: 'https://example.atlassian.net', jiraReady: true, memoryUrl: '', memoryReady: false }),
  session_control: () => { throw 'Daemon unavailable'; },
};

let root: Root; let container: HTMLDivElement;
const flush = async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };
const button = (text: string) => [...container.querySelectorAll('button')].find((b) => b.textContent?.trim().toLowerCase() === text)!;

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    const answer = backend[command];
    if (!answer) throw new Error(`unexpected command ${command}`);
    return answer(args as Record<string, unknown>);
  });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

describe('the journal in MDViewer', () => {
  it('asks the backend for access, the index and the chosen session', async () => {
    const store = createJournalStore({ storage: null, name: 'test' });
    await act(async () => root.render(<JournalProvider journal={{ store, host: journalHost }}><JournalView /></JournalProvider>));
    await flush();
    expect(invoke).toHaveBeenCalledWith('session_access');
    expect(invoke).toHaveBeenCalledWith('sessions_snapshot');
    expect(invoke).toHaveBeenCalledWith('session_details', { provider: 'codex', id: 'a' });
    expect(container.querySelector('.sc-detail h2')?.textContent).toBe('Fix CORE-123');
    // MDViewer has the remote context and the Codex controls
    expect(button('connections')).toBeTruthy();
    await act(async () => button('linked work').click());
    await act(async () => (container.querySelector('[aria-label="Open CORE-123 in Jira"]') as HTMLButtonElement).click());
    expect(openExternal).toHaveBeenCalledWith('https://example.atlassian.net/browse/CORE-123');
    await act(async () => button('direct').click());
    await act(async () => button('inspect live codex state').click());
    expect(invoke).toHaveBeenCalledWith('session_control', { action: 'inspect', id: 'a', turnId: 'turn', text: '' });
    expect(container.textContent).toContain('Daemon unavailable');
  });

  it('names the backend commands of memories and agent access', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    const s = { provider: 'claude', id: 's' } as Session;
    await journalHost.memories(s);
    expect(invoke).toHaveBeenLastCalledWith('session_memories', { provider: 'claude', id: 's' });
    await journalHost.openMemoryWindow('/m/MEMORY.md', s);
    expect(invoke).toHaveBeenLastCalledWith('open_session_memory_window', { key: '/m/MEMORY.md', provider: 'claude', id: 's' });
    await journalHost.readMemory('k');
    expect(invoke).toHaveBeenLastCalledWith('read_session_memory', { key: 'k', provider: undefined, id: undefined, openInDocuments: false });
    await journalHost.events('codex', 'a', 40);
    expect(invoke).toHaveBeenLastCalledWith('session_events', { provider: 'codex', id: 'a', before: 40 });
    await journalHost.analysis!.enable({ enabled: true, directory: '/w', session: '', excerpts: false });
    expect(invoke).toHaveBeenLastCalledWith('enable_analysis', { grant: { enabled: true, directory: '/w', session: '', excerpts: false } });
    await journalHost.analysis!.query('analyze_tools', { cohort: {} });
    expect(invoke).toHaveBeenLastCalledWith('run_session_analysis', { name: 'analyze_tools', arguments: { cohort: {} } });
    await journalHost.context!('jira', 'CORE-1');
    expect(invoke).toHaveBeenLastCalledWith('session_context', { provider: 'jira', key: 'CORE-1' });
  });
});
