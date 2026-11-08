//! Local transcript index. No credential/config files, symlinks, or transcript writes.
use crate::session_db::Database;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
pub const PARSER_VERSION: u32 = 3;
pub fn digest(text: &str) -> String {
    format!("{:x}", Sha256::digest(text.as_bytes()))
}
use std::collections::{BTreeMap, BTreeSet, HashMap, VecDeque};
use std::fs::{self, File};
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

const MAX_LINE: u64 = 16 * 1024 * 1024;
const MAX_EVENTS: usize = 300;
#[derive(Clone, Default, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    pub input: u64,
    pub cached: u64,
    pub cache_write: u64,
    pub output: u64,
    pub reasoning: u64,
}
impl Usage {
    fn from(v: &Value, claude: bool) -> Self {
        let n = |k: &str| v[k].as_u64().unwrap_or(0);
        let cached = n(if claude {
            "cache_read_input_tokens"
        } else {
            "cached_input_tokens"
        });
        let cache_write = n(if claude {
            "cache_creation_input_tokens"
        } else {
            "cache_write_input_tokens"
        });
        Self {
            input: n("input_tokens") + if claude { cached + cache_write } else { 0 },
            cached,
            cache_write,
            output: n("output_tokens"),
            reasoning: if claude {
                v["output_tokens_details"]["thinking_tokens"]
                    .as_u64()
                    .unwrap_or(0)
            } else {
                n("reasoning_output_tokens")
            },
        }
    }
    fn add(&mut self, v: &Self) {
        self.input += v.input;
        self.cached += v.cached;
        self.cache_write += v.cache_write;
        self.output += v.output;
        self.reasoning += v.reasoning;
    }
    fn delta(&self, old: &Self) -> Self {
        Self {
            input: self.input.saturating_sub(old.input),
            cached: self.cached.saturating_sub(old.cached),
            cache_write: self.cache_write.saturating_sub(old.cache_write),
            output: self.output.saturating_sub(old.output),
            reasoning: self.reasoning.saturating_sub(old.reasoning),
        }
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    pub seq: u64,
    pub at: String,
    pub kind: String,
    pub text: String,
    pub tool: Option<String>,
    #[serde(default)]
    pub fact: Option<ToolFact>,
}
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolFact {
    pub call_id: String,
    pub turn_id: String,
    pub model: String,
    pub namespace: String,
    pub content_hash: String,
    pub bytes: usize,
    pub explicit_error: Option<bool>,
    pub exit_code: Option<i64>,
    pub source_offset: u64,
    pub skill: Option<String>,
    pub skill_observation: Option<String>,
    pub wrapper_references: Vec<String>,
}
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub provider: String,
    pub parent_id: Option<String>,
    pub forked_from: Option<String>,
    pub origin: String,
    pub directories: BTreeSet<String>,
    pub name: String,
    pub cwd: String,
    pub title: String,
    pub model: String,
    pub effort: String,
    pub started: String,
    pub updated: String,
    pub modified: u64,
    pub status: String,
    pub usage: Usage,
    pub usage_known: bool,
    pub models: BTreeMap<String, Usage>,
    pub tools: BTreeMap<String, u64>,
    pub tickets: BTreeSet<String>,
    pub memory_refs: BTreeSet<String>,
    #[serde(default)]
    pub skill_observations: BTreeMap<String, BTreeSet<String>>,
    pub events: VecDeque<Event>,
    #[serde(skip)]
    pending_events: Vec<Event>,
    pub event_count: u64,
    pub malformed_lines: u64,
    pub source: String,
    pub turn_id: String,
}
impl Session {
    fn summary(&self) -> Self {
        Self {
            id: self.id.clone(),
            provider: self.provider.clone(),
            parent_id: self.parent_id.clone(),
            forked_from: self.forked_from.clone(),
            origin: self.origin.clone(),
            directories: self.directories.clone(),
            name: self.name.clone(),
            cwd: self.cwd.clone(),
            title: self.title.clone(),
            model: self.model.clone(),
            effort: self.effort.clone(),
            started: self.started.clone(),
            updated: self.updated.clone(),
            modified: self.modified,
            status: self.status.clone(),
            usage: self.usage.clone(),
            usage_known: self.usage_known,
            models: self.models.clone(),
            tools: self.tools.clone(),
            tickets: self.tickets.clone(),
            memory_refs: self.memory_refs.clone(),
            skill_observations: self.skill_observations.clone(),
            events: VecDeque::new(),
            pending_events: Vec::new(),
            event_count: self.event_count,
            malformed_lines: self.malformed_lines,
            source: self.source.clone(),
            turn_id: self.turn_id.clone(),
        }
    }

    fn title_from(&mut self, text: &str) {
        let text = text.trim();
        if self.title.is_empty()
            && text.len() >= 12
            && !text.starts_with('<')
            && !text.starts_with("[SYSTEM")
            && !text.starts_with("Another Claude session")
            && !text.starts_with("The coordinator sent")
        {
            self.title = text.chars().take(220).collect();
        }
    }
    fn event(&mut self, at: &str, kind: &str, text: String, tool: Option<String>) {
        if text.is_empty()
            || self
                .events
                .back()
                .is_some_and(|e| e.kind == kind && e.text == text && e.tool == tool)
        {
            return;
        }
        self.references(&text, &tool);
        self.event_count += 1;
        if self.events.len() == MAX_EVENTS {
            self.events.pop_front();
        }
        let event = Event {
            seq: self.event_count,
            at: at.into(),
            kind: kind.into(),
            text: text.chars().take(12000).collect(),
            tool,
            fact: None,
        };
        self.pending_events.push(event.clone());
        self.events.push_back(event);
    }
    fn references(&mut self, text: &str, tool: &Option<String>) {
        for word in text.split(|c: char| !c.is_ascii_alphanumeric() && c != '-') {
            if let Some((project, number)) = word.split_once('-') {
                if ![
                    "UTF", "SHA", "HTTP", "DNS", "ISO", "GPT", "RFC", "TLS", "SSL",
                ]
                .contains(&project)
                    && (2..=12).contains(&project.len())
                    && project.bytes().all(|b| b.is_ascii_uppercase())
                    && !number.is_empty()
                    && number.len() <= 8
                    && number.bytes().all(|b| b.is_ascii_digit())
                {
                    self.tickets.insert(word.to_string());
                }
            }
        }
        if tool
            .as_ref()
            .is_some_and(|s| s.contains("memory") || s.contains("teob"))
        {
            self.memory_refs.insert(tool.clone().unwrap());
        }
    }
    fn tool_event(
        &mut self,
        at: &str,
        kind: &str,
        text: String,
        tool: Option<String>,
        mut fact: ToolFact,
    ) {
        if let (Some(skill), Some(observation)) = (&fact.skill, &fact.skill_observation) {
            self.skill_observations
                .entry(skill.clone())
                .or_default()
                .insert(observation.clone());
        }
        self.references(&text, &tool);
        fact.bytes = text.len();
        fact.content_hash = digest(&text);
        fact.model = self.model.clone();
        if fact.turn_id.is_empty() {
            fact.turn_id = self.turn_id.clone();
        }
        self.event_count += 1;
        let e = Event {
            seq: self.event_count,
            at: at.into(),
            kind: kind.into(),
            text: text.chars().take(12000).collect(),
            tool: tool.clone(),
            fact: Some(fact),
        };
        if let Some(name) = &tool {
            if name.contains("memory") || name.contains("teob") {
                self.memory_refs.insert(name.clone());
            }
        }
        if self.events.len() == MAX_EVENTS {
            self.events.pop_front();
        }
        self.pending_events.push(e.clone());
        self.events.push_back(e);
    }
}
#[derive(Serialize, Deserialize)]
struct Indexed {
    #[serde(default)]
    parser_version: u32,
    offset: u64,
    modified: u64,
    session: Session,
    records: HashMap<String, Usage>,
    cumulative: Usage,
    has_records: bool,
    identity: String,
    observed_size: u64,
    caught_up: bool,
    prefix_hash: u64,
    tail_hash: u64,
    #[serde(skip)]
    reset: bool,
    #[serde(skip)]
    dirty: bool,
}
impl Indexed {
    fn new(path: &Path, provider: &str) -> Self {
        let stem = path
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        let parent = if provider == "claude"
            && path
                .parent()
                .and_then(Path::file_name)
                .is_some_and(|s| s == "subagents")
        {
            path.parent()
                .and_then(Path::parent)
                .and_then(Path::file_name)
                .map(|s| s.to_string_lossy().to_string())
        } else {
            None
        };
        Self {
            parser_version: PARSER_VERSION,
            offset: 0,
            modified: 0,
            session: Session {
                id: stem,
                provider: provider.into(),
                origin: if parent.is_some() {
                    "subagent"
                } else if provider == "claude" {
                    "human"
                } else {
                    "unknown"
                }
                .into(),
                parent_id: parent,
                source: path.to_string_lossy().into(),
                status: "unknown".into(),
                ..Session::default()
            },
            records: HashMap::new(),
            cumulative: Usage::default(),
            has_records: false,
            identity: String::new(),
            observed_size: 0,
            caught_up: false,
            prefix_hash: 0,
            tail_hash: 0,
            reset: false,
            dirty: false,
        }
    }
    fn usage(&mut self, key: String, usage: Usage, model: String) {
        let previous = self.records.entry(key).or_default();
        let delta = usage.delta(previous);
        previous.add(&delta);
        self.session.usage.add(&delta);
        self.session.models.entry(model).or_default().add(&delta);
        self.session.usage_known = true;
    }
    fn row(&mut self, r: Value) {
        let at = r["timestamp"].as_str().unwrap_or("");
        let kind = r["type"].as_str().unwrap_or("");
        let p = &r["payload"];
        if !at.is_empty() {
            self.session.updated = at.into();
            if self.session.started.is_empty() {
                self.session.started = at.into();
            }
        }
        if self.session.provider == "codex" {
            match kind {
                "session_meta" => {
                    // Forks embed their parent's metadata later: the FIRST metadata is authoritative.
                    if self.session.cwd.is_empty() {
                        self.session.id = strv(p, "id");
                        self.session.cwd = strv(p, "cwd");
                        self.session.name = strv(p, "agent_path");
                        self.session.parent_id = p["parent_thread_id"]
                            .as_str()
                            .or(p["source"]["subagent"]["thread_spawn"]["parent_thread_id"]
                                .as_str())
                            .map(str::to_owned);
                        self.session.forked_from = p["forked_from_id"].as_str().map(str::to_owned);
                        self.session.origin = if self.session.parent_id.is_some()
                            || p["thread_source"] == "subagent"
                            || p["source"].get("subagent").is_some()
                        {
                            "subagent"
                        } else if p["source"] == "exec" {
                            "automation"
                        } else if p["thread_source"] == "user"
                            || matches!(p["source"].as_str(), Some("cli" | "vscode" | "desktop"))
                        {
                            "human"
                        } else {
                            "unknown"
                        }
                        .into();
                        if !self.session.cwd.is_empty() {
                            self.session.directories.insert(self.session.cwd.clone());
                        }
                    }
                }
                "compacted" => self.session.event(at, "memory", strv(p, "message"), None),
                "turn_context" => {
                    if let Some(cwd) = p["cwd"].as_str() {
                        self.session.cwd = cwd.into();
                        self.session.directories.insert(cwd.into());
                    }
                    self.session.model = strv(p, "model");
                    self.session.effort = strv(p, "effort");
                }
                "token_usage_record" => {
                    if p["thread_id"]
                        .as_str()
                        .is_some_and(|id| id != self.session.id)
                    {
                        return;
                    }
                    if !self.has_records {
                        self.session.usage = Usage::default();
                        self.session.models.clear();
                        self.has_records = true;
                    }
                    self.usage(
                        strv(p, "response_id"),
                        Usage::from(&p["usage"], false),
                        self.session.model.clone(),
                    );
                }
                "event_msg" => match p["type"].as_str().unwrap_or("") {
                    "token_count" if !self.has_records && self.session.parent_id.is_none() => {
                        if p["info"]["total_token_usage"].is_object() {
                            let usage = Usage::from(&p["info"]["total_token_usage"], false);
                            let delta = if usage.input < self.cumulative.input {
                                usage.clone()
                            } else {
                                usage.delta(&self.cumulative)
                            };
                            self.cumulative = usage;
                            self.session.usage.add(&delta);
                            self.session
                                .models
                                .entry(self.session.model.clone())
                                .or_default()
                                .add(&delta);
                            self.session.usage_known = true;
                        }
                    }
                    "task_started" => {
                        self.session.status = "working".into();
                        self.session.turn_id = strv(p, "turn_id");
                    }
                    "task_complete" | "task_completed" => self.session.status = "idle".into(),
                    "turn_aborted" => self.session.status = "interrupted".into(),
                    "user_message" => {
                        let msg = strv(p, "message");
                        self.session.title_from(&msg);
                        self.session.event(at, "user", msg, None);
                    }
                    "agent_message" => {
                        self.session
                            .event(at, "assistant", strv(p, "message"), None)
                    }
                    "error" => self.session.event(at, "error", strv(p, "message"), None),
                    _ => {}
                },
                "response_item" => match p["type"].as_str().unwrap_or("") {
                    "message" => {
                        let role = p["role"].as_str().unwrap_or("");
                        if role == "user" || role == "assistant" {
                            if let Some(parts) = p["content"].as_array() {
                                for part in parts {
                                    if let Some(text) = part["text"].as_str() {
                                        if role == "user" {
                                            self.session.title_from(text);
                                        }
                                        self.session.event(at, role, text.into(), None);
                                    }
                                }
                            }
                        }
                    }
                    "function_call" | "custom_tool_call" => {
                        let name = strv(p, "name");
                        *self.session.tools.entry(name.clone()).or_default() += 1;
                        let args = p["arguments"]
                            .as_str()
                            .or(p["input"].as_str())
                            .unwrap_or("")
                            .to_string();
                        let fact = tool_fact(p, &args, &name, self.offset);
                        self.session.tool_event(at, "tool", args, Some(name), fact);
                    }
                    "function_call_output" | "custom_tool_call_output" => {
                        let text = value_text(&p["output"]);
                        let mut fact = tool_fact(p, &text, "", self.offset);
                        fact.exit_code = p["output"]["exit_code"]
                            .as_i64()
                            .or_else(|| recorded_exit(&text));
                        fact.explicit_error = p["output"]["isError"]
                            .as_bool()
                            .or_else(|| fact.exit_code.map(|v| v != 0));
                        self.session.tool_event(at, "result", text, None, fact);
                    }
                    _ => {}
                },
                _ => {}
            }
        } else {
            if let Some(cwd) = r["cwd"].as_str() {
                self.session.cwd = cwd.into();
                self.session.directories.insert(cwd.into());
            }
            if self.session.parent_id.is_none() {
                if let Some(id) = r["sessionId"].as_str() {
                    self.session.id = id.into();
                }
            }
            if let Some(name) = r["agentId"].as_str() {
                self.session.name = name.into();
            }
            if kind == "summary" {
                self.session.event(at, "memory", strv(&r, "summary"), None);
            }
            let m = &r["message"];
            if kind == "assistant" {
                let model = strv(m, "model");
                if model != "<synthetic>" && !model.is_empty() {
                    self.session.model = model.clone();
                    if m["usage"].is_object() {
                        self.usage(strv(m, "id"), Usage::from(&m["usage"], true), model);
                    }
                }
                self.session.status = if m["stop_reason"].as_str() == Some("end_turn") {
                    "idle"
                } else {
                    "working"
                }
                .into();
            }
            if kind == "user" || kind == "assistant" {
                if let Some(text) = m["content"].as_str() {
                    if kind == "user" {
                        self.session.title_from(text);
                    }
                    self.session.event(
                        at,
                        if r["isCompactSummary"] == true {
                            "memory"
                        } else {
                            kind
                        },
                        text.into(),
                        None,
                    );
                }
                if let Some(parts) = m["content"].as_array() {
                    for part in parts {
                        match part["type"].as_str().unwrap_or("") {
                            "text" => {
                                let text = strv(part, "text");
                                if kind == "user" {
                                    self.session.title_from(&text);
                                }
                                self.session.event(at, kind, text, None);
                            }
                            "tool_use" => {
                                let name = strv(part, "name");
                                *self.session.tools.entry(name.clone()).or_default() += 1;
                                let text = part["input"].to_string();
                                let mut fact = tool_fact(part, &text, &name, self.offset);
                                fact.turn_id = strv(m, "id");
                                self.session.tool_event(at, "tool", text, Some(name), fact);
                            }
                            "tool_result" => {
                                let text = value_text(&part["content"]);
                                let mut fact = tool_fact(part, &text, "", self.offset);
                                fact.explicit_error = part["is_error"].as_bool();
                                self.session.tool_event(at, "result", text, None, fact);
                            }
                            _ => {}
                        }
                    }
                }
            }
        }
    }
    fn read(&mut self, path: &Path) -> Result<u64, String> {
        if self.parser_version != PARSER_VERSION {
            *self = Self::new(path, &self.session.provider);
            self.reset = true;
        }
        if fs::symlink_metadata(path)
            .map_err(|e| e.to_string())?
            .file_type()
            .is_symlink()
        {
            return Err("Transcript replaced by a symlink".into());
        }
        let mut file = File::open(path).map_err(|e| e.to_string())?;
        let meta = file.metadata().map_err(|e| e.to_string())?;
        let modified = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_nanos() as u64)
            .unwrap_or(0);
        #[cfg(unix)]
        let identity = {
            use std::os::unix::fs::MetadataExt;
            format!("{}:{}", meta.dev(), meta.ino())
        };
        #[cfg(not(unix))]
        let identity = format!("{:?}", meta.created().ok());
        let replaced = !self.identity.is_empty() && self.identity != identity;
        if !replaced
            && modified == self.modified
            && meta.len() == self.observed_size
            && self.caught_up
        {
            return Ok(0);
        }
        let anchors_changed =
            if self.offset > 0 && self.offset <= meta.len() && modified != self.modified {
                let (prefix, tail) = anchors(&mut file, self.offset)?;
                prefix != self.prefix_hash || tail != self.tail_hash
            } else {
                false
            };
        if replaced
            || meta.len() < self.offset
            || anchors_changed
            || (meta.len() == self.offset && self.modified != modified)
        {
            *self = Self::new(path, &self.session.provider);
            self.reset = true;
        }
        self.identity = identity;
        self.modified = modified;
        self.observed_size = meta.len();
        self.caught_up = false;
        self.session.modified = modified / 1_000_000;
        let initial_offset = self.offset;
        let mut reader = BufReader::new(file);
        reader
            .seek(SeekFrom::Start(self.offset))
            .map_err(|e| e.to_string())?;
        let mut line = Vec::new();
        let began = std::time::Instant::now();
        loop {
            line.clear();
            let n = std::io::Read::by_ref(&mut reader)
                .take(MAX_LINE + 1)
                .read_until(b'\n', &mut line)
                .map_err(|e| e.to_string())?;
            if n == 0 {
                self.caught_up = true;
                break;
            }
            if line.last() != Some(&b'\n') {
                if n as u64 > MAX_LINE {
                    return Err(
                        "Transcript record exceeds 16 MiB; index stopped at this record".into(),
                    );
                }
                self.caught_up = true;
                break; // a writer has not finished this record yet
            }
            self.offset += n as u64;
            #[derive(Deserialize)]
            struct RecordType {
                #[serde(rename = "type")]
                kind: String,
            }
            let relevant = if self.session.provider == "claude" {
                serde_json::from_slice::<RecordType>(&line)
                    .map(|r| r.kind == "assistant" || r.kind == "user" || r.kind == "summary")
                    .unwrap_or(true)
            } else {
                true
            };
            if relevant {
                match serde_json::from_slice(&line) {
                    Ok(r) => self.row(r),
                    Err(_) => self.session.malformed_lines += 1,
                }
            }
            if began.elapsed() > std::time::Duration::from_millis(100) {
                break;
            }
        }
        let (prefix, tail) = anchors(reader.get_mut(), self.offset)?;
        self.prefix_hash = prefix;
        self.tail_hash = tail;
        Ok(self.offset - initial_offset)
    }
}
fn recorded_exit(text: &str) -> Option<i64> {
    if let Ok(v) = serde_json::from_str::<Value>(text) {
        if let Some(n) = v["exit_code"]
            .as_i64()
            .or(v["metadata"]["exit_code"].as_i64())
        {
            return Some(n);
        }
    }
    text.lines().find_map(|l| {
        l.strip_prefix("Process exited with code ")
            .or_else(|| l.strip_prefix("Exit code: "))
            .and_then(|v| v.trim().parse().ok())
    })
}
fn tool_fact(v: &Value, text: &str, name: &str, offset: u64) -> ToolFact {
    let args = serde_json::from_str::<Value>(text).unwrap_or(Value::Null);
    let skill = if name.eq_ignore_ascii_case("skill") {
        args["skill"].as_str().map(str::to_owned)
    } else {
        args["file_path"]
            .as_str()
            .or(args["path"].as_str())
            .filter(|p| p.ends_with("/SKILL.md"))
            .map(str::to_owned)
    };
    let skill = skill.or_else(|| {
        text.split(|c: char| {
            c.is_whitespace() || ['\'', '"', '`', '{', '}', '(', ')', ';'].contains(&c)
        })
        .find(|word| word.ends_with("/SKILL.md") && word.len() < 1024)
        .map(str::to_owned)
    });
    let skill = if name.is_empty() { None } else { skill };
    let observation = skill.as_ref().map(|_| {
        if name.eq_ignore_ascii_case("skill") {
            "explicit_invocation"
        } else if name.eq_ignore_ascii_case("read") || name == "read_file" {
            "definition_requested"
        } else {
            "reference"
        }
        .to_string()
    });
    let refs = if name == "exec" {
        text.split("tools.")
            .skip(1)
            .filter_map(|s| {
                let n: String = s
                    .chars()
                    .take_while(|c| c.is_ascii_alphanumeric() || *c == '_')
                    .collect();
                (!n.is_empty()).then_some(n)
            })
            .collect::<BTreeSet<_>>()
            .into_iter()
            .take(100)
            .collect()
    } else {
        vec![]
    };
    ToolFact {
        call_id: v["call_id"]
            .as_str()
            .or(v["tool_use_id"].as_str())
            .or(v["id"].as_str())
            .unwrap_or("")
            .into(),
        namespace: strv(v, "namespace"),
        source_offset: offset,
        skill,
        skill_observation: observation,
        wrapper_references: refs,
        ..ToolFact::default()
    }
}
fn anchors(file: &mut File, offset: u64) -> Result<(u64, u64), String> {
    fn hash(file: &mut File, start: u64, length: usize) -> Result<u64, String> {
        file.seek(SeekFrom::Start(start))
            .map_err(|e| e.to_string())?;
        let mut bytes = vec![0; length];
        file.read_exact(&mut bytes).map_err(|e| e.to_string())?;
        Ok(bytes.iter().fold(0xcbf29ce484222325u64, |h, b| {
            (h ^ u64::from(*b)).wrapping_mul(0x100000001b3)
        }))
    }
    Ok((
        hash(file, 0, offset.min(4096) as usize)?,
        hash(file, offset.saturating_sub(256), offset.min(256) as usize)?,
    ))
}
fn strv(v: &Value, k: &str) -> String {
    v[k].as_str().unwrap_or("").into()
}
fn value_text(v: &Value) -> String {
    if let Some(s) = v.as_str() {
        s.into()
    } else if let Some(a) = v.as_array() {
        a.iter()
            .filter_map(|v| v["text"].as_str())
            .collect::<Vec<_>>()
            .join("\n")
    } else {
        v.to_string()
    }
}
#[derive(Default)]
pub struct Index {
    files: HashMap<PathBuf, Indexed>,
    database: Option<Database>,
    database_path: Option<PathBuf>,
    restored_files: usize,
    pub generation: u64,
    pub last_scan: u64,
    pub scan_errors: usize,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub sessions: Vec<Session>,
    pub errors: Vec<String>,
    pub scanned_files: usize,
    pub indexed_at: u64,
    pub pending_files: usize,
    pub cache_path: Option<String>,
    pub restored_files: usize,
    pub bytes_read: u64,
    pub current_directory: String,
}
fn walk(root: &Path, depth: usize, out: &mut Vec<PathBuf>, errors: &mut Vec<String>) {
    if depth == 0 {
        return;
    }
    if !root.exists() {
        return;
    }
    let entries = match fs::read_dir(root) {
        Ok(v) => v,
        Err(e) => {
            errors.push(format!("{}: {e}", root.display()));
            return;
        }
    };
    for entry in entries.flatten() {
        let Ok(t) = entry.file_type() else { continue };
        if t.is_symlink() {
            continue;
        }
        let p = entry.path();
        if t.is_dir() {
            walk(&p, depth - 1, out, errors);
        } else if t.is_file() && p.extension().is_some_and(|x| x == "jsonl") {
            out.push(p);
        }
    }
}
impl Index {
    pub fn open_cache(&mut self, path: &Path) -> Result<(), String> {
        if self.database.is_some() {
            return Ok(());
        }
        if let Some(parent) = path.parent() {
            let created = !parent.exists();
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            #[cfg(unix)]
            if created {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(parent, fs::Permissions::from_mode(0o700))
                    .map_err(|e| e.to_string())?;
            }
            #[cfg(not(unix))]
            let _ = created;
        }
        let mut db = Database::open(path, false, false)?;
        let version = db.rows("PRAGMA user_version", &[])?[0][0]
            .parse::<u32>()
            .map_err(|e| e.to_string())?;
        if version != 0 && version != 1 {
            return Err(format!("Unsupported session index version {version}"));
        }
        db.batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA synchronous=NORMAL;
            CREATE TABLE IF NOT EXISTS files(path TEXT PRIMARY KEY, checkpoint TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS events(path TEXT NOT NULL REFERENCES files(path) ON DELETE CASCADE, seq INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY(path,seq));
            CREATE TABLE IF NOT EXISTS analysis_meta(id INTEGER PRIMARY KEY, generation INTEGER NOT NULL);
            INSERT OR IGNORE INTO analysis_meta VALUES(1,0);
            PRAGMA user_version=1;")?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(path, fs::Permissions::from_mode(0o600))
                .map_err(|e| e.to_string())?;
        }
        let mut restored = HashMap::new();
        for row in db.rows("SELECT path,checkpoint FROM files", &[])? {
            let indexed =
                serde_json::from_str(&row[1]).map_err(|e| format!("Read index checkpoint: {e}"))?;
            restored.insert(PathBuf::from(&row[0]), indexed);
        }
        self.generation = db.rows("SELECT generation FROM analysis_meta WHERE id=1", &[])?[0][0]
            .parse()
            .map_err(|e: std::num::ParseIntError| e.to_string())?;
        self.restored_files = restored.len();
        self.files = restored;
        self.database_path = Some(path.into());
        self.database = Some(db);
        Ok(())
    }
    pub fn clear_cache(&mut self) -> Result<(), String> {
        if let Some(db) = &mut self.database {
            db.batch("DELETE FROM files; UPDATE analysis_meta SET generation=generation+1 WHERE id=1; PRAGMA wal_checkpoint(TRUNCATE); VACUUM;")?;
        }
        self.generation += 1;
        self.files.clear();
        self.restored_files = 0;
        Ok(())
    }
    fn checkpoint(&mut self, path: &Path) -> Result<(), String> {
        let item = self.files.get_mut(path).ok_or("Missing checkpoint")?;
        if let Some(db) = self.database.as_mut() {
            db.transaction(|db| {
                let key=path.to_string_lossy();
                if item.reset {db.execute("DELETE FROM files WHERE path=?1",&[key.as_ref()])?;}
                let json=serde_json::to_string(item).map_err(|e|e.to_string())?;
                db.execute("INSERT INTO files(path,checkpoint) VALUES(?1,?2) ON CONFLICT(path) DO UPDATE SET checkpoint=excluded.checkpoint",&[key.as_ref(),&json])?;
                for event in &item.session.pending_events {db.execute("INSERT OR REPLACE INTO events(path,seq,body) VALUES(?1,?2,?3)",&[key.as_ref(),&event.seq.to_string(),&serde_json::to_string(event).map_err(|e|e.to_string())?])?;}
                db.batch("UPDATE analysis_meta SET generation=generation+1 WHERE id=1")?;
                Ok(())
            })?;
        }
        self.generation += 1;
        item.session.pending_events.clear();
        item.reset = false;
        item.dirty = false;
        Ok(())
    }
    pub fn summaries(&self) -> Vec<Session> {
        self.files.values().map(|i| i.session.summary()).collect()
    }
    pub fn analysis_coverage(&self) -> Value {
        serde_json::json!({"files":self.files.len(),"pendingFiles":self.files.values().filter(|i| !i.caught_up || i.dirty || i.parser_version != PARSER_VERSION).count(),"legacyParserFiles":self.files.values().filter(|i|i.parser_version != PARSER_VERSION).count(),"parserVersion":PARSER_VERSION,"scanErrors":self.scan_errors,"malformedLines":self.files.values().map(|i|i.session.malformed_lines).sum::<u64>()})
    }
    pub fn analysis_events(
        &mut self,
        provider: &str,
        id: &str,
        after: u64,
        limit: usize,
    ) -> Result<Vec<Event>, String> {
        let path = self.source(provider, id)?;
        let db = self
            .database
            .as_mut()
            .ok_or("Analysis requires the persistent SQLite index")?;
        db.rows(
            "SELECT body FROM events WHERE path=?1 AND seq>?2 ORDER BY seq LIMIT ?3",
            &[
                path.to_string_lossy().as_ref(),
                &after.to_string(),
                &limit.min(20001).to_string(),
            ],
        )?
        .into_iter()
        .map(|r| serde_json::from_str(&r[0]).map_err(|e| e.to_string()))
        .collect()
    }
    pub fn cached_events(
        &mut self,
        provider: &str,
        id: &str,
        before: u64,
    ) -> Result<Option<Vec<Event>>, String> {
        let path = self.source(provider, id)?;
        let Some(db) = &mut self.database else {
            return Ok(None);
        };
        let rows = db.rows(
            "SELECT body FROM events WHERE path=?1 AND seq<=?2 ORDER BY seq DESC LIMIT 300",
            &[path.to_string_lossy().as_ref(), &before.to_string()],
        )?;
        let mut events = vec![];
        for row in rows {
            events.push(serde_json::from_str(&row[0]).map_err(|e| e.to_string())?);
        }
        events.reverse();
        Ok(Some(events))
    }
    pub fn memory_events(&mut self, provider: &str, id: &str) -> Result<Vec<Event>, String> {
        let path = self.source(provider, id)?;
        let Some(db) = &mut self.database else {
            return Ok(self
                .detail(provider, id)
                .map(|s| {
                    s.events
                        .into_iter()
                        .filter(|e| {
                            e.kind == "memory"
                                || e.tool.as_ref().is_some_and(|t| t.contains("memory"))
                        })
                        .collect()
                })
                .unwrap_or_default());
        };
        let rows=db.rows("SELECT body FROM events WHERE path=?1 AND (json_extract(body,'$.kind')='memory' OR json_extract(body,'$.tool') LIKE '%memory%') ORDER BY seq DESC LIMIT 200",&[path.to_string_lossy().as_ref()])?;
        rows.into_iter()
            .map(|r| serde_json::from_str(&r[0]).map_err(|e| e.to_string()))
            .collect()
    }
    pub fn detail(&self, provider: &str, id: &str) -> Option<Session> {
        self.files
            .values()
            .find(|i| i.session.provider == provider && i.session.id == id)
            .map(|i| i.session.clone())
    }

    pub fn source(&self, provider: &str, id: &str) -> Result<PathBuf, String> {
        self.files
            .iter()
            .find(|(_, i)| i.session.provider == provider && i.session.id == id)
            .map(|(p, _)| p.clone())
            .ok_or_else(|| "Session not indexed".into())
    }
    pub fn scan(&mut self, home: &Path, workspace: Option<&Path>) -> Snapshot {
        let mut errors = vec![];
        let mut paths = vec![];
        let began = std::time::Instant::now();
        let mut discovered = vec![];
        for (relative, provider) in [(".codex/sessions", "codex"), (".claude/projects", "claude")] {
            let root = home.join(relative);
            let mut found = vec![];
            if fs::symlink_metadata(&root).is_ok_and(|m| m.file_type().is_symlink()) {
                errors.push(format!("{} is a symlink; skipped", root.display()));
                continue;
            }
            walk(&root, 8, &mut found, &mut errors);
            for path in found {
                let modified = path.metadata().ok().and_then(|m| m.modified().ok());
                discovered.push((path, provider, modified));
            }
        }
        discovered.sort_by_key(|(_, _, m)| std::cmp::Reverse(*m));
        let mut pending_files = 0;
        let mut bytes_read = 0;
        for (path, provider, _) in discovered {
            let item = self
                .files
                .entry(path.clone())
                .or_insert_with(|| Indexed::new(&path, provider));
            if began.elapsed() < std::time::Duration::from_millis(750) {
                let old = (
                    item.offset,
                    item.modified,
                    item.observed_size,
                    item.caught_up,
                );
                match item.read(&path) {
                    Ok(bytes) => bytes_read += bytes,
                    Err(e) => errors.push(format!("{}: {e}", path.display())),
                }
                let changed =
                    old != (
                        item.offset,
                        item.modified,
                        item.observed_size,
                        item.caught_up,
                    ) || item.reset;
                if changed {
                    item.dirty = true;
                }
                if item.dirty {
                    if let Err(e) = self.checkpoint(&path) {
                        errors.push(format!("Persist {}: {e}", path.display()));
                    }
                }
            }
            let item = &self.files[&path];
            if item.parser_version != PARSER_VERSION
                || !item.caught_up
                || path.metadata().is_ok_and(|m| m.len() > item.observed_size)
            {
                pending_files += 1;
            }
            paths.push(path);
        }
        let present: std::collections::HashSet<_> = paths.iter().cloned().collect();
        // A failed directory enumeration must not purge previously indexed history.
        if errors.is_empty() {
            let deleted: Vec<_> = self
                .files
                .keys()
                .filter(|p| !present.contains(*p))
                .cloned()
                .collect();
            for path in deleted {
                if let Some(db) = &mut self.database {
                    if let Err(e) = db.execute(
                        "DELETE FROM files WHERE path=?1",
                        &[path.to_string_lossy().as_ref()],
                    ) {
                        errors.push(e.to_string());
                        continue;
                    }
                }
                self.files.remove(&path);
                if let Some(db) = &mut self.database {
                    let _ = db.batch("UPDATE analysis_meta SET generation=generation+1 WHERE id=1");
                }
                self.generation += 1;
            }
        }
        let mut sessions: Vec<_> = self
            .files
            .values()
            .filter(|i| {
                !i.session.cwd.is_empty()
                    && workspace.is_none_or(|w| Path::new(&i.session.cwd).starts_with(w))
            })
            .map(|i| {
                let mut s = i.session.summary();
                let age = chrono::Utc::now().timestamp_millis().max(0) as u64
                    - s.modified
                        .min(chrono::Utc::now().timestamp_millis().max(0) as u64);
                if s.status == "working" && age > 120_000 {
                    s.status = "stale".into();
                }
                s
            })
            .collect();
        sessions.sort_by_key(|s| std::cmp::Reverse(s.modified));
        self.last_scan = chrono::Utc::now().timestamp_millis().max(0) as u64;
        self.scan_errors = errors.len();
        Snapshot {
            sessions,
            errors,
            cache_path: self
                .database_path
                .as_ref()
                .map(|p| p.to_string_lossy().into()),
            restored_files: self.restored_files,
            bytes_read,
            current_directory: std::env::current_dir()
                .ok()
                .filter(|p| p.starts_with(home))
                .unwrap_or_else(|| home.join("work"))
                .to_string_lossy()
                .into(),
            pending_files,
            scanned_files: paths.len(),
            indexed_at: chrono::Utc::now().timestamp_millis().max(0) as u64,
        }
    }
}
pub fn events_before(path: &Path, provider: &str, before: u64) -> Result<Vec<Event>, String> {
    if fs::symlink_metadata(path)
        .map_err(|e| e.to_string())?
        .file_type()
        .is_symlink()
    {
        return Err("Transcript was replaced by a symlink".into());
    }
    let mut page = Indexed::new(path, provider);
    let mut reader = BufReader::new(File::open(path).map_err(|e| e.to_string())?);
    let mut line = Vec::new();
    while page.session.event_count < before {
        line.clear();
        let n = std::io::Read::by_ref(&mut reader)
            .take(MAX_LINE + 1)
            .read_until(b'\n', &mut line)
            .map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        if line.last() != Some(&b'\n') {
            if n as u64 > MAX_LINE {
                return Err("Transcript record exceeds 16 MiB".into());
            }
            break;
        }
        if let Ok(r) = serde_json::from_slice(&line) {
            page.row(r);
            page.session.pending_events.clear();
        }
    }
    Ok(page
        .session
        .events
        .into_iter()
        .filter(|e| e.seq <= before)
        .collect())
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn persistent_fixture(name: &str) -> (PathBuf, PathBuf, PathBuf) {
        let home =
            std::env::temp_dir().join(format!("mdviewer-sqlite-{name}-{}", std::process::id()));
        let transcript = home.join(".claude/projects/project/session.jsonl");
        fs::create_dir_all(transcript.parent().unwrap()).unwrap();
        let cache = home.join("cache/index.sqlite");
        (home, transcript, cache)
    }
    fn append(path: &Path, row: Value) {
        use std::io::Write;
        let mut file = fs::OpenOptions::new()
            .append(true)
            .create(true)
            .open(path)
            .unwrap();
        writeln!(file, "{row}").unwrap();
    }
    fn drain(index: &mut Index, home: &Path) -> Snapshot {
        for _ in 0..30 {
            let s = index.scan(home, None);
            assert!(s.errors.is_empty(), "{:?}", s.errors);
            if s.pending_files == 0 {
                return s;
            }
        }
        panic!("fixture did not finish indexing");
    }
    #[test]
    fn sqlite_restart_reuses_checkpoints_and_usage_deduplication() {
        let (home, path, cache) = persistent_fixture("restart");
        append(
            &path,
            json!({"type":"user","cwd":home.join("repo"),"sessionId":"s1","message":{"content":"Build a persistent index"}}),
        );
        let usage = json!({"type":"assistant","message":{"id":"m1","model":"opus","usage":{"input_tokens":10,"output_tokens":3},"content":[{"type":"text","text":"working"}]}});
        append(&path, usage.clone());
        let mut first = Index::default();
        first.open_cache(&cache).unwrap();
        let initial = drain(&mut first, &home);
        assert!(initial.bytes_read > 0);
        assert_eq!(initial.sessions[0].usage.input, 10);
        drop(first);
        let mut second = Index::default();
        second.open_cache(&cache).unwrap();
        let warm = drain(&mut second, &home);
        assert_eq!(warm.restored_files, 1);
        assert_eq!(warm.bytes_read, 0);
        assert_eq!(warm.sessions[0].usage.input, 10);
        append(&path, usage);
        append(
            &path,
            json!({"type":"assistant","message":{"id":"m2","model":"opus","usage":{"input_tokens":7,"output_tokens":2}}}),
        );
        let update = drain(&mut second, &home);
        assert_eq!(update.sessions[0].usage.input, 17);
        assert_eq!(update.sessions[0].usage.output, 5);
        assert!(!second
            .cached_events("claude", "s1", 100)
            .unwrap()
            .unwrap()
            .is_empty());
        drop(second);
        fs::remove_dir_all(home).unwrap();
    }
    #[test]
    fn sqlite_pages_survive_restart_and_truncation_removes_old_events() {
        let (home, path, cache) = persistent_fixture("history");
        for n in 0..620 {
            append(
                &path,
                json!({"type":"user","cwd":home.join("repo"),"sessionId":"s1","message":{"content":format!("user message number {n}")}}),
            );
        }
        let mut first = Index::default();
        first.open_cache(&cache).unwrap();
        drain(&mut first, &home);
        drop(first);
        let mut second = Index::default();
        second.open_cache(&cache).unwrap();
        let page = second.cached_events("claude", "s1", 320).unwrap().unwrap();
        assert_eq!(page.len(), 300);
        assert_eq!(page[0].seq, 21);
        fs::write(&path, b"").unwrap();
        append(
            &path,
            json!({"type":"user","cwd":home.join("repo"),"sessionId":"s1","message":{"content":"replacement session"}}),
        );
        drain(&mut second, &home);
        let page = second.cached_events("claude", "s1", 1000).unwrap().unwrap();
        assert_eq!(page.len(), 1);
        assert_eq!(page[0].text, "replacement session");
        second.clear_cache().unwrap();
        drop(second);
        let mut third = Index::default();
        third.open_cache(&cache).unwrap();
        assert!(third.files.is_empty());
        drop(third);
        fs::remove_dir_all(home).unwrap();
    }
    #[test]
    fn sqlite_partial_lines_resume_and_deleted_files_are_pruned() {
        let (home, path, cache) = persistent_fixture("partial");
        append(
            &path,
            json!({"type":"user","cwd":home.join("repo"),"sessionId":"s1","message":{"content":"complete first message"}}),
        );
        {
            use std::io::Write;
            fs::OpenOptions::new()
                .append(true)
                .open(&path)
                .unwrap()
                .write_all(b"{\"type\":\"user\"")
                .unwrap();
        }
        let mut first = Index::default();
        first.open_cache(&cache).unwrap();
        drain(&mut first, &home);
        drop(first);
        let mut second = Index::default();
        second.open_cache(&cache).unwrap();
        assert_eq!(drain(&mut second, &home).bytes_read, 0);
        {
            use std::io::Write;
            fs::OpenOptions::new()
                .append(true)
                .open(&path)
                .unwrap()
                .write_all(b",\"message\":{\"content\":\"completed second message\"}}\n")
                .unwrap();
        }
        assert_eq!(drain(&mut second, &home).sessions[0].event_count, 2);
        fs::remove_file(path).unwrap();
        assert!(drain(&mut second, &home).sessions.is_empty());
        drop(second);
        let mut third = Index::default();
        third.open_cache(&cache).unwrap();
        assert!(third.files.is_empty());
        drop(third);
        fs::remove_dir_all(home).unwrap();
    }
    #[test]
    fn human_forks_are_not_subagents_and_directory_history_is_retained() {
        let mut i = Indexed::new(Path::new("fork.jsonl"), "codex");
        i.row(json!({"type":"session_meta","payload":{"id":"fork","cwd":"/work/root","thread_source":"user","source":"vscode","forked_from_id":"parent"}}));
        i.row(json!({"type":"turn_context","payload":{"cwd":"/work/repo/worktree","model":"m"}}));
        assert_eq!(i.session.origin, "human");
        assert_eq!(i.session.parent_id, None);
        assert_eq!(i.session.forked_from.as_deref(), Some("parent"));
        assert_eq!(i.session.directories.len(), 2);
    }
    #[test]
    fn claude_counts_messages_not_fragments() {
        let mut i = Indexed::new(Path::new("a.jsonl"), "claude");
        for output in [4, 4, 9, 4, 9] {
            i.row(json!({"type":"assistant","message":{"id":"m1","model":"opus","usage":{"input_tokens":2,"cache_read_input_tokens":20,"cache_creation_input_tokens":5,"output_tokens":output}}}));
        }
        assert_eq!(i.session.usage.input, 27);
        assert_eq!(i.session.usage.output, 9);
    }
    #[test]
    fn codex_cumulative_and_records_not_added_together() {
        let mut i = Indexed::new(Path::new("a.jsonl"), "codex");
        i.row(json!({"type":"session_meta","payload":{"id":"child","cwd":"/work","parent_thread_id":"parent"}}));
        i.row(json!({"type":"session_meta","payload":{"id":"parent","cwd":"/work"}}));
        assert_eq!(i.session.id, "child");
        for _ in 0..2 {
            i.row(json!({"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":100,"output_tokens":5}}}}));
        }
        assert!(!i.session.usage_known);
        for thread in ["parent", "child", "child"] {
            i.row(json!({"type":"token_usage_record","payload":{"thread_id":thread,"response_id":"r1","usage":{"input_tokens":20,"output_tokens":3}}}));
        }
        assert_eq!(i.session.usage.input, 20);
        assert_eq!(i.session.usage.output, 3);
    }
    #[test]
    fn task_titles_survive_reminders_and_standard_names_are_not_tickets() {
        let mut i = Indexed::new(Path::new("a.jsonl"), "codex");
        for text in [
            "<environment_context>context</environment_context>",
            "Build a dashboard for CORE-123 with UTF-8",
            "<system-reminder>notification</system-reminder>",
        ] {
            i.row(json!({"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":text}]}}));
        }
        assert_eq!(i.session.title, "Build a dashboard for CORE-123 with UTF-8");
        assert_eq!(
            i.session.tickets.iter().cloned().collect::<Vec<_>>(),
            vec!["CORE-123"]
        );
    }
    #[test]
    fn cumulative_counter_reset_is_a_new_usage_epoch() {
        let mut i = Indexed::new(Path::new("a.jsonl"), "codex");
        for input in [100, 100, 20, 30] {
            i.row(json!({"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":input}}}}));
        }
        assert_eq!(i.session.usage.input, 130);
    }
    #[test]
    fn history_pages_reach_events_outside_the_recent_window() {
        let path = std::env::temp_dir().join(format!(
            "mdviewer-history-test-{}.jsonl",
            std::process::id()
        ));
        let rows = (1..=620)
            .map(|n| {
                json!({"type":"user","message":{"content":format!("message {n}")}}).to_string()
            })
            .collect::<Vec<_>>()
            .join("\n")
            + "\n";
        fs::write(&path, rows).unwrap();
        let recent = events_before(&path, "claude", 620).unwrap();
        assert_eq!(recent.first().unwrap().seq, 321);
        let earlier = events_before(&path, "claude", 320).unwrap();
        assert_eq!(earlier.first().unwrap().seq, 21);
        assert_eq!(earlier.last().unwrap().seq, 320);
        let first = events_before(&path, "claude", 20).unwrap();
        assert_eq!(first.len(), 20);
        assert_eq!(first[0].text, "message 1");
        fs::remove_file(path).unwrap();
    }
    #[test]
    fn partial_record_is_retried_and_truncation_resets() {
        let path = std::env::temp_dir().join(format!(
            "mdviewer-session-test-{}.jsonl",
            std::process::id()
        ));
        fs::write(&path, b"{\"type\":\"user\"").unwrap();
        let mut i = Indexed::new(&path, "claude");
        i.read(&path).unwrap();
        assert_eq!(i.offset, 0);
        fs::write(
            &path,
            b"{\"type\":\"user\",\"message\":{\"content\":\"CORE-123 hello\"}}\n",
        )
        .unwrap();
        i.read(&path).unwrap();
        i.read(&path).unwrap();
        assert_eq!(i.session.event_count, 1);
        assert!(i.session.tickets.contains("CORE-123"));
        fs::write(&path, b"{}\n").unwrap();
        i.read(&path).unwrap();
        assert_eq!(i.session.event_count, 0);
        fs::remove_file(path).unwrap();
    }
}
