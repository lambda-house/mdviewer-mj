// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SessionWorkspace from './SessionWorkspace';
import { openExternal } from '../utils/tauri';
import { sessionApi, type Session } from '../utils/sessions';
vi.mock('../utils/sessions', async importOriginal => ({ ...await importOriginal<object>(), sessionApi: { access: vi.fn(), enable: vi.fn(), disable: vi.fn(), snapshot: vi.fn(), detail: vi.fn(), connections: vi.fn(), control: vi.fn(), context: vi.fn() } }));
vi.mock('../utils/tauri', () => ({ isTauri: () => true, openExternal: vi.fn() }));
vi.mock('../utils/agent', () => ({ formatAge: () => 'just now' }));
const session: Session = { id:'a',provider:'codex',parentId:null,name:'root',cwd:'/work/demo',title:'Fix CORE-123',model:'model-a',effort:'high',started:'2026-01-01T00:00:00Z',updated:'2026-01-01T00:00:00Z',modified:Date.now(),status:'working',usage:{input:100,cached:70,cacheWrite:0,output:20,reasoning:5},usageKnown:true,models:{},tools:{shell:2},tickets:['CORE-123'],memoryRefs:[],events:[{seq:1,at:'2026-01-01T00:00:00Z',kind:'assistant',text:'<script>untrusted()</script>',tool:null}],eventCount:1,malformedLines:0,source:'/fake/session.jsonl',turnId:'turn'};
let root: Root; let host: HTMLDivElement;
const flush = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve,0)); }); };
const button = (text: string) => [...host.querySelectorAll('button')].find(b => b.textContent?.trim().toLowerCase() === text) || [...host.querySelectorAll('button')].find(b => b.textContent?.toLowerCase().includes(text))!;
beforeEach(() => { vi.resetAllMocks(); Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);vi.mocked(sessionApi.access).mockResolvedValue(true);vi.mocked(sessionApi.snapshot).mockResolvedValue({sessions:[{...session,events:[]}],scannedFiles:1,pendingFiles:0,indexedAt:Date.now(),errors:[]});vi.mocked(sessionApi.detail).mockResolvedValue(session); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
describe('Sessions workspace', () => {
  it('renders actual session details as text and loads linked work only on request', async () => {
    await act(async () => root.render(<SessionWorkspace onClose={() => {}}/>)); await flush();
    expect(host.textContent).toContain('Fix CORE-123');expect(host.textContent).toContain('<script>untrusted()</script>');expect(host.querySelector('script')).toBeNull();expect(sessionApi.context).not.toHaveBeenCalled();
    await act(async () => button('linked work').click());expect(host.textContent).toContain('CORE-123');
    vi.mocked(sessionApi.context).mockRejectedValue('No Jira credentials');
    await act(async () => (host.querySelector('.sc-ticket-list button') as HTMLButtonElement).click());expect(host.textContent).toContain('No Jira credentials');
  });
  it('opens tickets at the configured site and reports an absent connection', async () => {
    await act(async () => root.render(<SessionWorkspace onClose={() => {}}/>)); await flush();
    await act(async () => button('linked work').click());
    vi.mocked(sessionApi.connections).mockResolvedValue({ jiraSite: 'https://example.atlassian.net/', jiraReady: true, memoryUrl: '', memoryReady: false });
    await act(async () => (host.querySelector('[aria-label="Open CORE-123 in Jira"]') as HTMLButtonElement).click());
    expect(openExternal).toHaveBeenCalledWith('https://example.atlassian.net/browse/CORE-123');
    vi.mocked(openExternal).mockClear();
    vi.mocked(sessionApi.connections).mockResolvedValue({ jiraSite: '', jiraReady: false, memoryUrl: '', memoryReady: false });
    await act(async () => (host.querySelector('[aria-label="Open CORE-123 in Jira"]') as HTMLButtonElement).click());
    expect(openExternal).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Set your Jira site in Connections first.');
  });
  it('does not read transcripts before access is enabled', async () => {
    vi.mocked(sessionApi.access).mockResolvedValue(false);
    await act(async () => root.render(<SessionWorkspace onClose={() => {}}/>));await flush();expect(host.textContent).toContain('Enable session access');expect(sessionApi.snapshot).not.toHaveBeenCalled();
  });
  it('shows control failures without claiming delivery', async () => {
    await act(async () => root.render(<SessionWorkspace onClose={() => {}}/>));await flush();await act(async () => button('direct').click());vi.mocked(sessionApi.control).mockRejectedValue('Daemon unavailable');
    await act(async () => button('inspect live').click());expect(host.textContent).toContain('Daemon unavailable');expect(host.textContent).not.toContain('Instruction accepted');
  });
});
