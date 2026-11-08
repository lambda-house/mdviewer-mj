//! Shared, bounded read-only query layer for desktop and MCP. Never scans transcripts.
use crate::sessions::{digest, Event, Index, Session};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Grant {
    pub enabled: bool,
    pub directory: String,
    pub session: String,
    pub excerpts: bool,
}
impl Grant {
    pub fn permits(&self, s: &Session) -> bool {
        self.enabled
            && (self.session.is_empty() || self.session == key(s))
            && (self.directory.is_empty()
                || (!s.cwd.is_empty()
                    && Path::new(&s.cwd).starts_with(&self.directory)
                    && s.directories
                        .iter()
                        .all(|d| Path::new(d).starts_with(&self.directory))))
    }
}
pub fn key(s: &Session) -> String {
    format!("{}:{}", s.provider, s.id)
}
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Cohort {
    pub provider: Option<String>,
    pub model: Option<String>,
    pub role: Option<String>,
    pub directory: Option<String>,
    pub ticket: Option<String>,
    pub skill: Option<String>,
    pub skill_observation: Option<String>,
    pub session: Option<String>,
    #[serde(default)]
    pub descendants: bool,
    pub active_since: Option<String>,
    pub inactive_since: Option<String>,
}
#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Args {
    #[serde(default)]
    cohort: Cohort,
    session: Option<String>,
    cursor: Option<String>,
    limit: Option<usize>,
    event_since: Option<String>,
    event_until: Option<String>,
    tool: Option<String>,
    skill: Option<String>,
    evidence_ids: Option<Vec<String>>,
    left: Option<Cohort>,
    right: Option<Cohort>,
}
fn time(s: &str) -> Result<i64, String> {
    chrono::DateTime::parse_from_rfc3339(s)
        .map(|d| d.timestamp_millis())
        .map_err(|_| "Dates must be RFC3339 with a timezone".into())
}
fn select(all: &[Session], c: &Cohort) -> Result<Vec<Session>, String> {
    if c.provider
        .as_ref()
        .is_some_and(|p| !["codex", "claude"].contains(&p.as_str()))
    {
        return Err("Unknown provider".into());
    }
    if c.role
        .as_ref()
        .is_some_and(|p| !["human", "subagent", "automation", "unknown"].contains(&p.as_str()))
    {
        return Err("Unknown role".into());
    }
    if c.skill_observation.is_some() && c.skill.is_none() {
        return Err("skillObservation requires skill".into());
    }
    if c.descendants && c.session.is_none() {
        return Err("descendants requires a session key".into());
    }
    let since = c.active_since.as_deref().map(time).transpose()?;
    let until = c.inactive_since.as_deref().map(time).transpose()?;
    if since.zip(until).is_some_and(|(a, b)| a > b) {
        return Err("activeSince is after inactiveSince".into());
    }
    let mut family = BTreeSet::new();
    if let Some(root) = &c.session {
        family.insert(root.clone());
    }
    if c.descendants {
        loop {
            let n = family.len();
            for s in all {
                if s.parent_id
                    .as_ref()
                    .is_some_and(|p| family.contains(&format!("{}:{p}", s.provider)))
                {
                    family.insert(key(s));
                }
            }
            if family.len() == n {
                break;
            }
        }
    }
    let mut sessions: Vec<_> = all
        .iter()
        .filter(|s| {
            c.provider.as_ref().is_none_or(|p| p == &s.provider)
                && c.model
                    .as_ref()
                    .is_none_or(|m| s.models.contains_key(m) || &s.model == m)
                && c.role.as_ref().is_none_or(|r| r == &s.origin)
                && c.ticket.as_ref().is_none_or(|t| s.tickets.contains(t))
                && c.skill.as_ref().is_none_or(|skill| {
                    s.skill_observations.get(skill).is_some_and(|obs| {
                        c.skill_observation.as_ref().is_none_or(|o| obs.contains(o))
                    })
                })
                && c.directory.as_ref().is_none_or(|d| {
                    s.directories
                        .iter()
                        .chain(std::iter::once(&s.cwd))
                        .any(|p| Path::new(p).starts_with(d))
                })
                && (c.session.is_none() || family.contains(&key(s)))
                && since.is_none_or(|t| time(&s.updated).is_ok_and(|u| u >= t))
                && until.is_none_or(|t| time(&s.updated).is_ok_and(|u| u <= t))
        })
        .cloned()
        .collect();
    sessions.sort_by_key(key);
    Ok(sessions)
}
fn evidence(s: &Session, e: &Event) -> String {
    format!(
        "{}:{}:{}",
        key(s),
        e.seq,
        &digest(&serde_json::to_string(e).unwrap_or_default())[..16]
    )
}
fn session_value(s: &Session, excerpts: bool) -> Value {
    json!({"session":key(s),"parent":s.parent_id.as_ref().map(|p|format!("{}:{p}",s.provider)),"forkedFrom":s.forked_from,"role":s.origin,
        "title":if excerpts {s.title.clone()}else{String::new()},"directories":s.directories,"cwd":s.cwd,"model":s.model,"models":s.models,
        "lastActivity":s.updated,"started":s.started,"lifetimeUsage":if s.usage_known {json!(s.usage)}else{Value::Null},"events":s.event_count,
        "ticketMentions":s.tickets,"memoryToolReferences":s.memory_refs,"skillObservations":s.skill_observations})
}
fn offset(cursor: Option<&str>, generation: u64, binding: &str) -> Result<usize, String> {
    match cursor {
        None => Ok(0),
        Some(c) => {
            let parts: Vec<_> = c.split(':').collect();
            if parts.len() != 3 || parts[0] != generation.to_string() || parts[1] != binding {
                return Err(
                    "Cursor expired or belongs to a different query; restart without cursor".into(),
                );
            }
            parts[2].parse().map_err(|_| "Invalid cursor".into())
        }
    }
}
fn cursor(g: u64, b: &str, n: usize) -> String {
    format!("{g}:{b}:{n}")
}
fn event_window(e: &Event, since: Option<i64>, until: Option<i64>) -> bool {
    if since.is_none() && until.is_none() {
        return true;
    }
    time(&e.at).is_ok_and(|t| since.is_none_or(|s| t >= s) && until.is_none_or(|u| t <= u))
}
#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct ToolStats {
    calls: usize,
    matched_results: usize,
    explicit_failures: usize,
    explicit_non_errors: usize,
    unknown_outcomes: usize,
    missing_call_ids: usize,
    repeated_input_candidates: usize,
    input_bytes: usize,
    output_bytes: usize,
    elapsed_samples: usize,
    elapsed_ms_p50: Option<i64>,
    elapsed_ms_p95: Option<i64>,
    evidence: Vec<String>,
    wrapper_references: BTreeSet<String>,
    #[serde(skip)]
    elapsed: Vec<i64>,
    #[serde(skip)]
    fingerprints: BTreeSet<String>,
}
struct Facts {
    tools: BTreeMap<String, ToolStats>,
    skills: Vec<Value>,
    read: usize,
    truncated: bool,
    duplicates: usize,
    unresolved_forks: usize,
}
fn facts(index: &mut Index, sessions: &[Session], a: &Args) -> Result<Facts, String> {
    if sessions.len() > 200 {
        return Err("Analysis is limited to 200 sessions per query; narrow the cohort".into());
    }
    let since = a.event_since.as_deref().map(time).transpose()?;
    let until = a.event_until.as_deref().map(time).transpose()?;
    if since.zip(until).is_some_and(|(s, u)| s > u) {
        return Err("eventSince is after eventUntil".into());
    }
    let mut f = Facts {
        tools: BTreeMap::new(),
        skills: vec![],
        read: 0,
        truncated: false,
        duplicates: 0,
        unresolved_forks: 0,
    };
    let mut seen = BTreeSet::new();
    for s in sessions {
        if f.read >= 20000 {
            f.truncated = true;
            break;
        }
        if s.forked_from.is_some() {
            f.unresolved_forks += 1;
        }
        let mut events = index.analysis_events(&s.provider, &s.id, 0, 20001 - f.read)?;
        if events.len() > 20000 - f.read {
            events.truncate(20000 - f.read);
            f.truncated = true;
        }
        f.read += events.len();
        let mut results: BTreeMap<&str, Vec<&Event>> = BTreeMap::new();
        for e in &events {
            if e.kind == "result" {
                if let Some(fact) = &e.fact {
                    if !fact.call_id.is_empty() {
                        results.entry(&fact.call_id).or_default().push(e);
                    }
                }
            }
        }
        for e in &events {
            if e.kind != "tool" || !event_window(e, since, until) {
                continue;
            }
            let name = e.tool.as_deref().unwrap_or("unknown");
            if a.tool.as_ref().is_some_and(|t| t != name) {
                continue;
            }
            let fact = e.fact.as_ref();
            let id = fact.map(|f| f.call_id.as_str()).unwrap_or("");
            // Only deduplicate within a session: provider-wide IDs can be copied into forks.
            if !id.is_empty() && !seen.insert((key(s), id.to_string())) {
                f.duplicates += 1;
                continue;
            }
            let matches = results.get(id).cloned().unwrap_or_default();
            let matched: Vec<_> = matches.into_iter().filter(|r| r.seq > e.seq).collect();
            let stat = f.tools.entry(name.into()).or_default();
            stat.calls += 1;
            if stat.evidence.len() < 10 {
                stat.evidence.push(evidence(s, e));
            }
            if id.is_empty() {
                stat.missing_call_ids += 1;
            }
            if let Some(fact) = fact {
                stat.input_bytes += fact.bytes;
                stat.wrapper_references
                    .extend(fact.wrapper_references.clone());
                if !stat.fingerprints.insert(fact.content_hash.clone()) {
                    stat.repeated_input_candidates += 1;
                }
            }
            let outcome = matched
                .iter()
                .filter_map(|r| r.fact.as_ref().and_then(|f| f.explicit_error))
                .collect::<Vec<_>>();
            if !matched.is_empty() {
                stat.matched_results += 1;
            }
            if outcome.contains(&true) {
                stat.explicit_failures += 1;
            } else if outcome.contains(&false) {
                stat.explicit_non_errors += 1;
            } else {
                stat.unknown_outcomes += 1;
            }
            stat.output_bytes += matched
                .iter()
                .filter_map(|r| r.fact.as_ref().map(|f| f.bytes))
                .sum::<usize>();
            if let Some(r) = matched.first() {
                if let Ok((start, end)) =
                    time(&e.at).and_then(|start| time(&r.at).map(|end| (start, end)))
                {
                    if end >= start {
                        stat.elapsed.push(end - start);
                    }
                }
            }
            if let Some(fact) = fact {
                if let Some(skill) = &fact.skill {
                    if a.skill.as_ref().is_none_or(|v| v == skill) {
                        let mut observation = fact
                            .skill_observation
                            .clone()
                            .unwrap_or_else(|| "reference".into());
                        let read = observation == "definition_requested"
                            && outcome.contains(&false)
                            && !outcome.contains(&true);
                        if read {
                            observation = "definition_read".into();
                        }
                        f.skills.push(json!({"skill":skill,"observation":observation,"session":key(s),"evidence":evidence(s,e),
                        "resultEvidence":matched.iter().map(|r|evidence(s,r)).collect::<Vec<_>>(),"definitionVersion":Value::Null,
                        "observedResultHashes":if read {matched.iter().filter_map(|r|r.fact.as_ref().map(|f|f.content_hash.clone())).collect::<Vec<_>>()}else{vec![]},
                        "versionNote":"Hashes identify recorded tool output, not a verified canonical skill definition. Historical definition version is unknown."}));
                    }
                }
            }
        }
    }
    for stat in f.tools.values_mut() {
        stat.elapsed.sort();
        stat.elapsed_samples = stat.elapsed.len();
        if !stat.elapsed.is_empty() {
            stat.elapsed_ms_p50 = Some(stat.elapsed[(stat.elapsed.len() - 1) / 2]);
            stat.elapsed_ms_p95 = Some(
                stat.elapsed
                    [((stat.elapsed.len() * 95).div_ceil(100) - 1).min(stat.elapsed.len() - 1)],
            );
        }
    }
    Ok(f)
}
fn cohort_summary(sessions: &[Session]) -> Value {
    let mut models = BTreeMap::<String, usize>::new();
    let mut roles = BTreeMap::<String, usize>::new();
    let mut tokens = 0;
    let mut unknown = 0;
    for s in sessions {
        for model in s.models.keys() {
            *models.entry(model.clone()).or_default() += 1;
        }
        *roles.entry(s.origin.clone()).or_default() += 1;
        if s.usage_known {
            tokens += s.usage.input + s.usage.output;
        } else {
            unknown += 1;
        }
    }
    json!({"sessions":sessions.len(),"sessionsWithUnknownUsage":unknown,"recordedLifetimeTokens":tokens,"modelComposition":models,"roleComposition":roles,"verifiedTaskOutcomes":Value::Null,"taskComplexity":Value::Null})
}
pub fn query(index: &mut Index, grant: &Grant, name: &str, args: Value) -> Result<Value, String> {
    if !grant.enabled {
        return Err("Agent analysis access is disabled in MDViewer".into());
    }
    let definitions = tools();
    let definition = definitions["tools"]
        .as_array()
        .unwrap()
        .iter()
        .find(|d| d["name"] == name)
        .ok_or("Unknown analysis tool")?;
    let fields = args.as_object().ok_or("Arguments must be an object")?;
    if fields
        .keys()
        .any(|k| definition["inputSchema"]["properties"].get(k).is_none())
        || definition["inputSchema"]["required"]
            .as_array()
            .unwrap()
            .iter()
            .any(|k| !fields.contains_key(k.as_str().unwrap()))
    {
        return Err("Missing or unsupported tool arguments".into());
    }
    let a: Args =
        serde_json::from_value(args.clone()).map_err(|e| format!("Invalid arguments: {e}"))?;
    let limit = a.limit.unwrap_or(50);
    if !(1..=100).contains(&limit) {
        return Err("limit must be 1–100".into());
    }
    let all: Vec<_> = index
        .summaries()
        .into_iter()
        .filter(|s| grant.permits(s))
        .collect();
    let selected = select(&all, &a.cohort)?;
    let binding = digest(
        &json!({"tool":name,"cohort":a.cohort,"session":a.session,"limit":limit,"grant":grant})
            .to_string(),
    );
    let binding = &binding[..16];
    let start = offset(a.cursor.as_deref(), index.generation, binding)?;
    let data = match name {
        "analysis_status" => {
            json!({"sessions":selected.len(),"scope":grant,"availableTools":7,"limits":{"sessionsPerAnalysis":200,"eventsPerAnalysis":20000,"pageSize":100}})
        }
        "find_sessions" => {
            if start > selected.len() {
                return Err("Cursor offset is outside the result set".into());
            }
            let page: Vec<_> = selected
                .iter()
                .skip(start)
                .take(limit)
                .map(|s| session_value(s, grant.excerpts))
                .collect();
            json!({"sessions":page,"total":selected.len(),"nextCursor":(start+limit<selected.len()).then(||cursor(index.generation,binding,start+limit))})
        }
        "get_session" => {
            let wanted = a
                .session
                .as_ref()
                .ok_or("session is required (provider:id)")?;
            let s = all
                .iter()
                .find(|s| key(s) == *wanted)
                .ok_or("Session unavailable in shared scope")?;
            if start as u64 > s.event_count {
                return Err("Cursor offset is outside the session".into());
            }
            let events = index.analysis_events(&s.provider, &s.id, start as u64, limit + 1)?;
            let more = events.len() > limit;
            let entries:Vec<_>=events.iter().take(limit).map(|e|json!({"id":evidence(s,e),"seq":e.seq,"at":e.at,"kind":e.kind,"tool":e.tool})).collect();
            json!({"session":session_value(s,grant.excerpts),"children":all.iter().filter(|v|v.provider==s.provider && v.parent_id.as_ref()==Some(&s.id)).map(key).collect::<Vec<_>>(),"evidence":entries,"nextCursor":more.then(||cursor(index.generation,binding,events[limit-1].seq as usize))})
        }
        "get_evidence" => {
            if !grant.excerpts {
                return Err(
                    "Detailed evidence sharing is disabled; enable it in Agent access".into(),
                );
            }
            let ids = a.evidence_ids.as_ref().ok_or("evidenceIds is required")?;
            if ids.is_empty() || ids.len() > 20 {
                return Err("Provide 1–20 evidence IDs".into());
            }
            let mut out = vec![];
            for id in ids {
                let parts: Vec<_> = id.rsplitn(3, ':').collect();
                if parts.len() != 3 {
                    return Err("Invalid evidence ID".into());
                }
                let s = all
                    .iter()
                    .find(|s| key(s) == parts[2])
                    .ok_or("Evidence unavailable in shared scope")?;
                let seq = parts[1].parse::<u64>().map_err(|_| "Invalid evidence ID")?;
                let e = index
                    .analysis_events(&s.provider, &s.id, seq.saturating_sub(1), 1)?
                    .into_iter()
                    .next()
                    .filter(|e| e.seq == seq && evidence(s, e) == *id)
                    .ok_or("Evidence changed or no longer indexed")?;
                out.push(json!({"id":id,"session":key(s),"source":s.source,"event":e,"untrusted":true,"excerptTruncated":e.fact.as_ref().is_some_and(|f|f.bytes>e.text.len()) || e.text.chars().count()>=12000}));
            }
            json!({"evidence":out})
        }
        "analyze_tools" | "analyze_skills" => {
            let f = facts(index, &selected, &a)?;
            let tools = serde_json::to_value(&f.tools).map_err(|e| e.to_string())?;
            let mut result = json!({"sample":cohort_summary(&selected),"eventsRead":f.read,"truncated":f.truncated,"duplicateCallRecordsSkipped":f.duplicates,"sessionsWithUnresolvedForkOwnership":f.unresolved_forks});
            if name == "analyze_tools" {
                result["tools"] = tools;
            } else {
                let mut groups: BTreeMap<String, (BTreeSet<String>, BTreeMap<String, usize>)> =
                    BTreeMap::new();
                for observation in &f.skills {
                    let group = groups
                        .entry(observation["skill"].as_str().unwrap_or("").into())
                        .or_default();
                    group
                        .0
                        .insert(observation["session"].as_str().unwrap_or("").into());
                    *group
                        .1
                        .entry(
                            observation["observation"]
                                .as_str()
                                .unwrap_or("unknown")
                                .into(),
                        )
                        .or_default() += 1;
                }
                result["skills"]=json!(groups.into_iter().map(|(skill,(ids,counts))| {
                    let associated:Vec<_>=selected.iter().filter(|s|ids.contains(&key(s))).cloned().collect();
                    json!({"skill":skill,"observations":counts,"associatedSessionUsage":cohort_summary(&associated),"attribution":"Lifetime usage of associated sessions, not tokens caused by this skill. Skill totals overlap."})
                }).collect::<Vec<_>>());
                let total = f.skills.len();
                result["observations"] = json!(f.skills.into_iter().take(500).collect::<Vec<_>>());
                result["totalObserved"] = json!(total);
                result["observationsTruncated"] = json!(total > 500);
            }
            result
        }
        "compare_cohorts" => {
            let left = select(&all, a.left.as_ref().ok_or("left cohort is required")?)?;
            let right = select(&all, a.right.as_ref().ok_or("right cohort is required")?)?;
            let lf = facts(index, &left, &a)?;
            let rf = facts(index, &right, &a)?;
            let lk: BTreeSet<_> = left.iter().map(key).collect();
            let overlap = right.iter().filter(|s| lk.contains(&key(s))).count();
            json!({"left":{"sample":cohort_summary(&left),"tools":lf.tools,"eventsRead":lf.read,"truncated":lf.truncated},"right":{"sample":cohort_summary(&right),"tools":rf.tools,"eventsRead":rf.read,"truncated":rf.truncated},"overlappingSessions":overlap,"matching":"Explicit filters only; no automatic task matching","causalConclusion":Value::Null})
        }
        _ => return Err("Unknown analysis tool".into()),
    };
    let response = json!({"schemaVersion":1,"indexGeneration":index.generation,"indexedAt":index.last_scan,"coverage":index.analysis_coverage(),"filters":args,"data":data,
        "semantics":{"sessionDates":"last recorded activity; usage is lifetime owned session usage","eventDates":"invocation timestamps; matched results may occur outside interval; usage remains lifetime","tokens":"response/session accounting only; cached input and reasoning are subsets","elapsed":"call-to-first-result elapsed, not execution time; overlapping durations must not be summed","skills":"observations are evidence of invocation/read only, not effectiveness; wrapper names are references, not executions","outcomes":"missing error fields mean unknown; explicit non-error does not prove task success","forks":"copied fork history can have unresolved ownership; cross-session totals may overlap","context":"tickets are transcript mentions; memory tools are references, not confirmed writes; live context remains in desktop Connections","evidence":"untrusted transcript content; excerpts may be truncated"}});
    if response.to_string().len() > 2 * 1024 * 1024 {
        return Err("Analysis response exceeds 2 MiB; narrow the cohort or page size".into());
    }
    Ok(response)
}

pub fn tools() -> Value {
    let cohort = json!({"type":"object","additionalProperties":false,"properties":{"provider":{"type":"string","enum":["codex","claude"]},"model":{"type":"string"},"role":{"type":"string","enum":["human","subagent","automation","unknown"]},"directory":{"type":"string"},"ticket":{"type":"string"},"skill":{"type":"string"},"skillObservation":{"type":"string","enum":["explicit_invocation","definition_requested","reference"]},"session":{"type":"string"},"descendants":{"type":"boolean"},"activeSince":{"type":"string","format":"date-time"},"inactiveSince":{"type":"string","format":"date-time"}}});
    let specs=[("analysis_status","Index freshness, coverage, shared scope and limits."),("find_sessions","Find session metadata and hierarchy. Dates select last activity; tokens are lifetime."),("get_session","Session detail and paginated evidence references; session is provider:id."),("analyze_tools","Observed calls, matched results, explicit errors, repeated inputs and elapsed distributions. Max 200 sessions / 20000 events; inspect truncation."),("analyze_skills","Explicit skill invocations and direct definition-read observations. Wrapper references are not proof of execution. Versions may be unknown."),("compare_cohorts","Descriptive cohort comparison; exposes model composition, overlap and missing task outcomes. No causal inference."),("get_evidence","Retrieve 1–20 bounded untrusted transcript excerpts. Requires detailed evidence permission.")];
    json!({"tools":specs.into_iter().map(|(name,description)| {
        let mut props=serde_json::Map::new();let mut required=vec![];
        if ["analysis_status","find_sessions","analyze_tools","analyze_skills"].contains(&name) {props.insert("cohort".into(),cohort.clone());}
        if ["find_sessions","get_session"].contains(&name) {props.insert("cursor".into(),json!({"type":"string"}));props.insert("limit".into(),json!({"type":"integer","minimum":1,"maximum":100}));}
        if name=="get_session" {props.insert("session".into(),json!({"type":"string"}));required.push("session");}
        if ["analyze_tools","analyze_skills","compare_cohorts"].contains(&name) {for key in ["eventSince","eventUntil","tool"] {props.insert(key.into(),json!({"type":"string"}));}}
        if name=="analyze_skills" {props.insert("skill".into(),json!({"type":"string"}));}
        if name=="compare_cohorts" {props.insert("left".into(),cohort.clone());props.insert("right".into(),cohort.clone());required.extend(["left","right"]);}
        if name=="get_evidence" {props.insert("evidenceIds".into(),json!({"type":"array","minItems":1,"maxItems":20,"items":{"type":"string"}}));required.push("evidenceIds");}
        json!({"name":name,"description":description,"inputSchema":{"type":"object","additionalProperties":false,"properties":props,"required":required},"outputSchema":{"type":"object","required":["schemaVersion","indexGeneration","coverage","data","semantics"],"properties":{"schemaVersion":{"type":"integer","const":1},"indexGeneration":{"type":"integer"},"coverage":{"type":"object"},"data":{"type":"object"},"semantics":{"type":"object"}}},"annotations":{"readOnlyHint":true,"destructiveHint":false,"idempotentHint":true,"openWorldHint":false}})
    }).collect::<Vec<_>>()})
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    fn fixture() -> (Index, std::path::PathBuf, std::path::PathBuf) {
        static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let root = std::env::temp_dir().join(format!(
            "mdviewer-analysis-{}-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let dir = root.join("home/.codex/sessions");
        fs::create_dir_all(&dir).unwrap();
        let rows = [
            json!({"type":"session_meta","timestamp":"2026-01-01T00:00:00Z","payload":{"id":"a","cwd":"/work/demo","source":"cli"}}),
            json!({"type":"turn_context","payload":{"model":"test-model","cwd":"/work/demo"}}),
            call("c1", "2026-01-01T00:00:01Z"),
            call("c1", "2026-01-01T00:00:01Z"),
            json!({"type":"response_item","timestamp":"2026-01-01T00:00:03Z","payload":{"type":"function_call_output","call_id":"c1","output":"Process exited with code 1\nfailed"}}),
            call("c2", "2026-01-01T00:00:04Z"),
            json!({"type":"response_item","timestamp":"2026-01-01T00:00:05Z","payload":{"type":"function_call_output","call_id":"c2","output":"Process exited with code 0\npassed"}}),
            json!({"type":"response_item","timestamp":"2026-01-01T00:00:06Z","payload":{"type":"function_call","call_id":"wrap","name":"exec","arguments":"await tools.exec_command({cmd:'cat /skills/demo/SKILL.md'})"}}),
            json!({"type":"token_usage_record","payload":{"thread_id":"a","response_id":"r1","usage":{"input_tokens":100,"output_tokens":20,"cached_input_tokens":50}}}),
        ];
        fs::write(
            dir.join("a.jsonl"),
            rows.iter().map(|v| format!("{v}\n")).collect::<String>(),
        )
        .unwrap();
        let claude = root.join("home/.claude/projects/demo");
        fs::create_dir_all(&claude).unwrap();
        let rows = [
            json!({"type":"assistant","timestamp":"2026-01-01T00:01:00Z","sessionId":"b","cwd":"/work/other","message":{"id":"m1","model":"claude","content":[{"type":"tool_use","id":"s1","name":"Skill","input":{"skill":"delivery"}},{"type":"tool_use","id":"r1","name":"Read","input":{"file_path":"/skills/delivery/SKILL.md"}}]}}),
            json!({"type":"user","timestamp":"2026-01-01T00:01:01Z","sessionId":"b","cwd":"/work/other","message":{"content":[{"type":"tool_result","tool_use_id":"s1","content":"ok"},{"type":"tool_result","tool_use_id":"r1","content":"# Delivery\nDo checks", "is_error":false}]}}),
        ];
        fs::write(
            claude.join("b.jsonl"),
            rows.iter().map(|v| format!("{v}\n")).collect::<String>(),
        )
        .unwrap();
        let db = root.join("cache/index.sqlite");
        let mut i = Index::default();
        i.open_cache(&db).unwrap();
        for _ in 0..20 {
            if i.scan(&root.join("home"), None).pending_files == 0 {
                break;
            }
        }
        (i, root, db)
    }
    fn call(id: &str, at: &str) -> Value {
        json!({"type":"response_item","timestamp":at,"payload":{"type":"function_call","call_id":id,"name":"exec_command","arguments":"{\"cmd\":\"cargo test\"}"}})
    }
    fn grant() -> Grant {
        Grant {
            enabled: true,
            excerpts: true,
            ..Grant::default()
        }
    }
    #[test]
    fn correlates_deduplicates_and_preserves_unknown_outcomes() {
        let (mut i, root, _) = fixture();
        let v = query(
            &mut i,
            &grant(),
            "analyze_tools",
            json!({"cohort":{"session":"codex:a"}}),
        )
        .unwrap();
        let t = &v["data"]["tools"]["exec_command"];
        assert_eq!(t["calls"], 2);
        assert_eq!(t["matchedResults"], 2);
        assert_eq!(t["explicitFailures"], 1);
        assert_eq!(t["explicitNonErrors"], 1);
        assert_eq!(t["repeatedInputCandidates"], 1);
        assert_eq!(t["elapsedMsP95"], 2000);
        assert_eq!(v["data"]["duplicateCallRecordsSkipped"], 1);
        assert_eq!(v["data"]["tools"]["exec"]["unknownOutcomes"], 1);
        assert_eq!(
            v["data"]["tools"]["exec"]["wrapperReferences"],
            json!(["exec_command"])
        );
        assert_eq!(v["data"]["sample"]["recordedLifetimeTokens"], 120);
        drop(i);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn pagination_scope_evidence_and_revocation_are_enforced() {
        let (mut i, root, _) = fixture();
        let g = grant();
        let first = query(&mut i, &g, "find_sessions", json!({"limit":1})).unwrap();
        let cursor = first["data"]["nextCursor"].clone();
        let second = query(
            &mut i,
            &g,
            "find_sessions",
            json!({"limit":1,"cursor":cursor}),
        )
        .unwrap();
        assert_ne!(first["data"]["sessions"], second["data"]["sessions"]);
        assert!(query(
            &mut i,
            &g,
            "find_sessions",
            json!({"limit":2,"cursor":cursor})
        )
        .is_err());
        let detail = query(
            &mut i,
            &g,
            "get_session",
            json!({"session":"codex:a","limit":1}),
        )
        .unwrap();
        let id = detail["data"]["evidence"][0]["id"].clone();
        assert!(query(&mut i, &g, "get_evidence", json!({"evidenceIds":[id]})).is_ok());
        let scoped = Grant {
            directory: "/work/other".into(),
            ..g.clone()
        };
        assert!(query(&mut i, &scoped, "get_evidence", json!({"evidenceIds":[id]})).is_err());
        assert!(query(
            &mut i,
            &Grant {
                excerpts: false,
                ..g.clone()
            },
            "get_evidence",
            json!({"evidenceIds":[id]})
        )
        .is_err());
        assert!(query(&mut i, &Grant::default(), "analysis_status", json!({})).is_err());
        i.generation += 1;
        assert!(query(
            &mut i,
            &g,
            "find_sessions",
            json!({"limit":1,"cursor":cursor})
        )
        .is_err());
        drop(i);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn skill_observations_do_not_claim_causality_or_historical_versions() {
        let (mut i, root, _) = fixture();
        let v = query(
            &mut i,
            &grant(),
            "analyze_skills",
            json!({"cohort":{"provider":"claude"}}),
        )
        .unwrap();
        let found = query(
            &mut i,
            &grant(),
            "find_sessions",
            json!({"cohort":{"skill":"delivery","skillObservation":"explicit_invocation"}}),
        )
        .unwrap();
        assert_eq!(found["data"]["total"], 1);
        assert_eq!(v["data"]["skills"].as_array().unwrap().len(), 2);
        let observations = v["data"]["observations"].as_array().unwrap();
        assert_eq!(observations.len(), 2);
        assert_eq!(observations[0]["observation"], "explicit_invocation");
        assert_eq!(observations[1]["observation"], "definition_read");
        assert!(observations[1]["definitionVersion"].is_null());
        let c = query(
            &mut i,
            &grant(),
            "compare_cohorts",
            json!({"left":{},"right":{"provider":"claude"}}),
        )
        .unwrap();
        assert_eq!(c["data"]["overlappingSessions"], 1);
        assert!(c["data"]["causalConclusion"].is_null());
        drop(i);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn restart_reuses_facts_and_generation_and_event_window_is_not_usage_window() {
        let (mut i, root, db) = fixture();
        let before = query(&mut i, &grant(), "analyze_tools", json!({})).unwrap();
        let generation = i.generation;
        drop(i);
        let mut i = Index::default();
        i.open_cache(&db).unwrap();
        let scan = i.scan(&root.join("home"), None);
        assert_eq!(scan.bytes_read, 0);
        assert_eq!(i.generation, generation);
        let after = query(&mut i, &grant(), "analyze_tools", json!({})).unwrap();
        assert_eq!(before["data"], after["data"]);
        let v=query(&mut i,&grant(),"analyze_tools",json!({"cohort":{"session":"codex:a"},"eventSince":"2026-01-01T00:00:04Z","eventUntil":"2026-01-01T00:00:04Z"})).unwrap();
        assert_eq!(v["data"]["tools"]["exec_command"]["calls"], 1);
        assert_eq!(v["data"]["tools"]["exec_command"]["matchedResults"], 1);
        assert_eq!(v["data"]["sample"]["recordedLifetimeTokens"], 120);
        drop(i);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn legacy_checkpoints_backfill_and_replacement_invalidates_evidence() {
        let (mut i, root, db) = fixture();
        let d = query(
            &mut i,
            &grant(),
            "get_session",
            json!({"session":"codex:a"}),
        )
        .unwrap();
        let ids = d["data"]["evidence"].as_array().unwrap();
        let id = ids[0]["id"].clone();
        drop(i);
        let mut database = crate::session_db::Database::open(&db, false, false).unwrap();
        database
            .batch("UPDATE files SET checkpoint=json_remove(checkpoint,'$.parser_version')")
            .unwrap();
        drop(database);
        let mut i = Index::default();
        i.open_cache(&db).unwrap();
        assert_eq!(i.analysis_coverage()["legacyParserFiles"], 2);
        assert!(i.scan(&root.join("home"), None).bytes_read > 0);
        assert_eq!(i.analysis_coverage()["legacyParserFiles"], 0);
        assert!(query(
            &mut i,
            &grant(),
            "get_evidence",
            json!({"evidenceIds":[id]})
        )
        .is_ok());
        let path = root.join("home/.codex/sessions/a.jsonl");
        fs::write(
            path,
            format!(
                "{}\n{}\n",
                json!({"type":"session_meta","payload":{"id":"a","cwd":"/work/demo"}}),
                call("new", "2026-02-01T00:00:00Z")
            ),
        )
        .unwrap();
        i.scan(&root.join("home"), None);
        assert!(query(
            &mut i,
            &grant(),
            "get_evidence",
            json!({"evidenceIds":[id]})
        )
        .is_err());
        drop(i);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn directories_do_not_leak_sessions_that_moved_outside_scope() {
        let g = Grant {
            enabled: true,
            directory: "/work/demo".into(),
            ..Grant::default()
        };
        let mut s = Session::default();
        s.cwd = "/work/demo".into();
        assert!(g.permits(&s));
        s.directories.insert("/work/other".into());
        assert!(!g.permits(&s));
        s.cwd = "/work/demo-other".into();
        assert!(!g.permits(&s));
    }
}
