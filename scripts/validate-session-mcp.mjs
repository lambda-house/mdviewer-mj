// Official MCP SDK integration validation against an explicitly supplied small fixture home.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const [command,home,db,sdkRoot] = process.argv.slice(2);
if (!sdkRoot) throw new Error('Usage: node scripts/validate-session-mcp.mjs HOST FIXTURE_HOME CACHE SDK_PACKAGE_DIRECTORY');
const { Client } = await import(pathToFileURL(path.join(sdkRoot, 'dist/esm/client/index.js')));
const { StdioClientTransport } = await import(pathToFileURL(path.join(sdkRoot, 'dist/esm/client/stdio.js')));
import fs from 'node:fs';
import assert from 'node:assert/strict';
function expectedTools(file,provider) {
  const seen=new Set();const counts={};
  for(const line of fs.readFileSync(file,'utf8').split('\n')) {
    if(!line.trim())continue;let r;try{r=JSON.parse(line);}catch{continue;}
    const parts=provider==='codex' && r.type==='response_item' ? [r.payload] : provider==='claude' && ['assistant','user'].includes(r.type) && Array.isArray(r.message?.content) ? r.message.content : [];
    for(const p of parts)if(['function_call','custom_tool_call','tool_use'].includes(p.type)) {
      const id=p.call_id||p.id;if(id&&seen.has(id))continue;if(id)seen.add(id);
      counts[p.name]=(counts[p.name]||0)+1;
    }
  }return counts;
}
const summaries=[];let cold;
for(let pass=0;pass<2;pass++) {
  const transport=new StdioClientTransport({command,args:[home,db],stderr:'pipe'});
  let logs='';transport.stderr?.on('data',d=>logs+=d);
  const client=new Client({name:'mdviewer-validation',version:'1.0.0'});
  await client.connect(transport);
  const tools=await client.listTools();assert.equal(tools.tools.length,7);
  const call=async(name,args={})=>{const r=await client.callTool({name,arguments:args});assert.equal(r.isError,false,JSON.stringify(r));assert.deepEqual(JSON.parse(r.content[0].text),r.structuredContent);return r.structuredContent;};
  const status=await call('analysis_status');assert.equal(status.coverage.pendingFiles,0);assert.equal(status.coverage.legacyParserFiles,0);
  const found=await call('find_sessions',{limit:2});let sessions=found.data.sessions;let cursor=found.data.nextCursor;
  while(cursor){const page=await call('find_sessions',{limit:2,cursor});sessions.push(...page.data.sessions);cursor=page.data.nextCursor;}
  assert(sessions.length > 0);assert.equal(new Set(sessions.map(s=>s.session)).size,sessions.length);
  let total=0,skillObservations=0;const perSession=[];
  for(const s of sessions) {
    const detail=await call('get_session',{session:s.session,limit:2});assert(detail.data.evidence.length>0);
    const ev=await call('get_evidence',{evidenceIds:[detail.data.evidence[0].id]});const source=ev.data.evidence[0].source;
    assert(source.startsWith(path.resolve(home)+path.sep));assert.equal(ev.data.evidence[0].untrusted,true);
    const counts=expectedTools(source,s.session.split(':')[0]);
    const tools=await call('analyze_tools',{cohort:{session:s.session}});assert.equal(tools.data.truncated,false);
    assert.deepEqual(Object.fromEntries(Object.entries(tools.data.tools).map(([k,v])=>[k,v.calls])),counts);
    const skills=await call('analyze_skills',{cohort:{session:s.session}});skillObservations+=skills.data.totalObserved;
    const n=Object.values(counts).reduce((a,b)=>a+b,0);total+=n;perSession.push({session:s.session,calls:n});
  }
  const comparison=await call('compare_cohorts',{left:{provider:'codex'},right:{provider:'claude'}});assert.equal(comparison.data.overlappingSessions,0);assert.equal(comparison.data.causalConclusion,null);
  const invalid=await client.callTool({name:'get_evidence',arguments:{evidenceIds:['codex:outside:1:bad']}});assert.equal(invalid.isError,true);
  const report={pass:pass?'warm':'cold',sessions:sessions.length,toolCalls:total,skillObservations,generation:status.indexGeneration,parserVersion:status.coverage.parserVersion,perSession};
  if(cold){assert.equal(report.generation,cold.generation);assert.deepEqual(report.perSession,cold.perSession);}else{cold=report;}
  await client.close();
  if(pass)assert(logs.includes('0 transcript bytes read'),logs);
  report.host=logs.trim();summaries.push(report);
}
console.log(JSON.stringify(summaries.map(({perSession,...s})=>s),null,2));
