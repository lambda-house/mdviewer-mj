// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import SessionMemoryBrowser from './SessionMemoryBrowser';
import { sessionApi, type Session } from '../utils/sessions';
vi.mock('../utils/sessions', () => ({sessionApi:{memoryAccess:vi.fn(),enableMemories:vi.fn(),memories:vi.fn(),readMemory:vi.fn(),openMemoryWindow:vi.fn()}}));
vi.mock('../utils/agent',()=>({formatAge:()=> 'now'}));
let host:HTMLDivElement;let root:Root;
beforeEach(()=>{vi.resetAllMocks();Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
it('does not inspect memory until its own permission is granted',async()=>{
  vi.mocked(sessionApi.memoryAccess).mockResolvedValue(false);
  await act(async()=>root.render(<SessionMemoryBrowser/>));
  expect(host.textContent).toContain('Enable memory access');expect(sessionApi.memories).not.toHaveBeenCalled();
});
it('keeps user, shared project and session-specific memory distinct',async()=>{
  vi.mocked(sessionApi.memoryAccess).mockResolvedValue(true);
  vi.mocked(sessionApi.memories).mockResolvedValue({notes:[],entries:['user','project','session'].map(scope=>({key:scope,title:`${scope} memory file`,scope,provider:'codex',path:`/${scope}`,modified:1,description:'source'}))});
  await act(async()=>root.render(<SessionMemoryBrowser session={{id:'s',provider:'codex'} as Session}/>));
  expect(host.textContent).toContain('session memory file');expect(host.textContent).not.toContain('user memory file');
  await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='User scope')!.click());
  expect(host.textContent).toContain('user memory file');expect(host.textContent).not.toContain('session memory file');expect(host.textContent).not.toContain('project memory file');
});

it('opens Markdown in a native window and reports failures without switching workspaces',async()=>{
  const path = '/project/memory/MEMORY.md';
  vi.mocked(sessionApi.memoryAccess).mockResolvedValue(true);
  vi.mocked(sessionApi.memories).mockResolvedValue({notes:[],entries:[{key:path,path,title:'MEMORY.md',scope:'user',provider:'claude',modified:1,description:'Shared memory'}]});
  vi.mocked(sessionApi.openMemoryWindow).mockRejectedValueOnce('Memory access revoked');
  await act(async()=>root.render(<SessionMemoryBrowser/>));
  const entry = () => host.querySelector('.sc-memory-list button') as HTMLButtonElement;
  await act(async()=>entry().click());
  expect(sessionApi.readMemory).not.toHaveBeenCalled();
  expect(host.textContent).toContain('Memory access revoked');
  vi.mocked(sessionApi.openMemoryWindow).mockResolvedValue();
  await act(async()=>entry().click());
  expect(sessionApi.openMemoryWindow).toHaveBeenLastCalledWith(path,undefined);
  expect(sessionApi.readMemory).not.toHaveBeenCalled();
  expect(host.textContent).not.toContain('Memory access revoked');
  expect(host.querySelector('.sc-memory-document')).toBeNull();
});

it('keeps generated session context inline instead of opening its backing transcript as Markdown',async()=>{
  vi.mocked(sessionApi.memoryAccess).mockResolvedValue(true);
  vi.mocked(sessionApi.memories).mockResolvedValue({notes:[],entries:[{key:'transcript-memory',path:'/sessions/thread.jsonl',title:'Session context',scope:'session',provider:'claude',modified:1,description:'Recorded context'}]});
  vi.mocked(sessionApi.readMemory).mockResolvedValue({title:'Session context',content:'# Compaction',provenance:'/sessions/thread.jsonl',note:'Recorded context'});
  await act(async()=>root.render(<SessionMemoryBrowser session={{id:'s',provider:'claude'} as Session}/>));
  await act(async()=>(host.querySelector('.sc-memory-list button') as HTMLButtonElement).click());
  expect(sessionApi.openMemoryWindow).not.toHaveBeenCalled();
  expect(host.querySelector('.sc-memory-document')?.textContent).toContain('# Compaction');
});
