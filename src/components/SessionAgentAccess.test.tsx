// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import SessionAgentAccess from './SessionAgentAccess';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
let root: Root; let host: HTMLDivElement;
const status = (enabled = false) => ({ grant: { enabled, directory: '/work/demo', session: '', excerpts: false }, socket: '/tmp/private/mcp.sock', executable: '/Applications/MDViewer.app/Contents/MacOS/mdviewer', error: null, clients: [], recentQueries: [] });
const button = (label: string) => [...host.querySelectorAll('button')].find(b => b.textContent?.includes(label))!;
beforeEach(() => { vi.resetAllMocks();Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);vi.mocked(invoke).mockResolvedValue(status()); });
afterEach(async () => {await act(async () => root.unmount());host.remove();});
it('keeps excerpts off and sends only the selected directory scope', async () => {
  await act(async () => root.render(<SessionAgentAccess close={()=>{}} directory="/work/demo" inspect={()=>{}}/>));
  expect((host.querySelector('input[type=checkbox]') as HTMLInputElement).checked).toBe(false);
  await act(async () => button('Enable agent access').click());
  expect(invoke).toHaveBeenCalledWith('enable_analysis',{grant:{enabled:true,directory:'/work/demo',session:'',excerpts:false}});
  expect(host.textContent).toContain('--mcp');
});
it('revokes access and refreshes status', async () => {
  vi.mocked(invoke).mockImplementation(async command => command === 'analysis_access' ? status(true) : undefined);
  await act(async () => root.render(<SessionAgentAccess close={()=>{}} directory="" inspect={()=>{}}/>));
  await act(async () => button('Revoke agent access').click());
  expect(invoke).toHaveBeenCalledWith('revoke_analysis');
});
it('uses the shared query API and renders untrusted results as text', async () => {
  vi.mocked(invoke).mockImplementation(async command => command==='analysis_access' ? status(true) : {data:{message:'<script>not executable</script>'}});
  await act(async () => root.render(<SessionAgentAccess close={()=>{}} directory="/work/demo" inspect={()=>{}}/>));
  await act(async () => button('Tool activity').click());
  expect(invoke).toHaveBeenCalledWith('run_session_analysis',{name:'analyze_tools',arguments:{cohort:{directory:'/work/demo'}}});
  expect(host.querySelector('script')).toBeNull();expect(host.textContent).toContain('<script>not executable</script>');
});
