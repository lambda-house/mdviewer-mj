// Agent workspace: the instructions, rules, memory, plans and skills that
// coding agents (Claude Code, Codex, Gemini CLI, Cursor) keep as markdown files.
//
// The user turns it on once, in a native dialog. After that, markdown files in
// the agents' own folders (`~/.claude/skills`, `~/.claude/projects/*/memory`,
// ...) count as opened, see `is_agent_document`, and `scan` lists them along
// with the agent files inside the folders the user opened. Settings, keys and
// session transcripts are never part of it: only the paths below, and only
// markdown.
//
// "Read" state: when the user has read a file, a copy of it is kept in the
// config dir (`read-state/`), so the app can say what changed since then.

use notify::event::ModifyKind;
use notify::{Config as NotifyConfig, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::{atomic_write, canonicalize, decode_text, generate_id, get_config_dir, is_markdown_file, AppError};

/// Max agent files listed (a folder with thousands of skills stays usable).
const MAX_ENTRIES: usize = 2000;
/// Max folders looked at when searching opened folders for agent files.
const MAX_PROJECT_DIRS: usize = 3000;
/// How deep below an opened folder `CLAUDE.md` / `AGENTS.md` are looked for.
const MAX_PROJECT_DEPTH: usize = 4;
/// Plans are many and short-lived: only the most recent are listed.
const MAX_PLANS: usize = 100;
/// Files larger than this get no read-state copy (and so no "what changed").
const MAX_SNAPSHOT_BYTES: u64 = 2 * 1024 * 1024;

/// Folders skipped when searching opened folders.
const SKIPPED_DIRS: &[&str] = &["node_modules", "target", "dist", "build", "vendor", "venv"];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Instructions,
    Rule,
    Memory,
    Plan,
    Skill,
    Agent,
    Command,
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum Tool {
    Claude,
    Codex,
    Gemini,
}

impl Tool {
    const ALL: [Tool; 3] = [Tool::Claude, Tool::Codex, Tool::Gemini];

    fn dir_name(self) -> &'static str {
        match self {
            Tool::Claude => ".claude",
            Tool::Codex => ".codex",
            Tool::Gemini => ".gemini",
        }
    }

    fn label(self) -> &'static str {
        match self {
            Tool::Claude => "Claude Code",
            Tool::Codex => "Codex",
            Tool::Gemini => "Gemini CLI",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentEntry {
    pub path: String,
    pub kind: Kind,
    pub title: String,
    pub description: Option<String>,
    /// What it belongs to: an agent ("Claude Code"), a project folder or a plugin.
    pub group: String,
    /// "user", "project" or "plugin".
    pub scope: &'static str,
    /// Last change, ms since the epoch.
    pub modified: u64,
    /// Changed since the user last read it.
    pub unread: bool,
    /// Never read (no read-state copy).
    pub is_new: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentWorkspace {
    pub enabled: bool,
    pub entries: Vec<AgentEntry>,
    /// Changes are reported as they happen (`agent-files-changed`); without
    /// a watcher the frontend polls.
    pub watching: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub path: String,
    pub content: String,
    /// When it was read, ms since the epoch.
    #[serde(default)]
    pub read_at: u64,
}

// ============================================================
// Which files belong to the agent workspace
// ============================================================

/// The agents' folders in the home dir, as named and resolved (`~/.claude`
/// may be a symlink into a dotfiles repo).
fn tool_homes() -> Vec<(Tool, PathBuf)> {
    let Some(home) = dirs::home_dir() else { return Vec::new() };
    let mut homes = Vec::new();
    for tool in Tool::ALL {
        let named = home.join(tool.dir_name());
        if let Ok(real) = canonicalize(&named) {
            if real != named {
                homes.push((tool, real));
            }
        }
        homes.push((tool, named));
    }
    homes
}

fn components(rel: &Path) -> Option<Vec<String>> {
    rel.components()
        .map(|c| match c {
            Component::Normal(s) => Some(s.to_string_lossy().into_owned()),
            _ => None,
        })
        .collect()
}

/// Which kind of agent file a path inside an agent's folder is, if any.
fn classify_rel(tool: Tool, parts: &[String]) -> Option<Kind> {
    let first = parts.first()?.as_str();
    let rest = &parts[1..];
    match (tool, first) {
        (Tool::Claude, "CLAUDE.md") if rest.is_empty() => Some(Kind::Instructions),
        (Tool::Claude, "rules") if !rest.is_empty() => Some(Kind::Rule),
        // projects/<project>/memory/...
        (Tool::Claude, "projects") if rest.len() >= 3 && rest[1] == "memory" => Some(Kind::Memory),
        (Tool::Claude, "plans") if !rest.is_empty() => Some(Kind::Plan),
        (Tool::Claude | Tool::Codex, "skills") if !rest.is_empty() => Some(Kind::Skill),
        (Tool::Claude, "agents") if !rest.is_empty() => Some(Kind::Agent),
        (Tool::Claude, "commands") if !rest.is_empty() => Some(Kind::Command),
        (Tool::Claude, "plugins") if rest.first().is_some_and(|p| p == "cache") => {
            // plugins/cache/<marketplace>/<plugin>/<version>/{skills,agents,commands}/...
            rest.iter().skip(4).take(1).find_map(|dir| match dir.as_str() {
                "skills" => Some(Kind::Skill),
                "agents" => Some(Kind::Agent),
                "commands" => Some(Kind::Command),
                _ => None,
            }).filter(|_| rest.len() > 5)
        }
        (Tool::Codex, "AGENTS.md") if rest.is_empty() => Some(Kind::Instructions),
        (Tool::Codex, "prompts") if !rest.is_empty() => Some(Kind::Command),
        (Tool::Gemini, "GEMINI.md") if rest.is_empty() => Some(Kind::Instructions),
        _ => None,
    }
}

fn classify_in(homes: &[(Tool, PathBuf)], path: &Path) -> Option<Kind> {
    if !is_markdown_file(path) {
        return None;
    }
    homes.iter().find_map(|(tool, home)| {
        let rel = path.strip_prefix(home).ok()?;
        classify_rel(*tool, &components(rel)?)
    })
}

/// A markdown file in an agent's own folder that the agent workspace shows.
/// Counts as opened while the workspace is on.
pub fn is_agent_document(path: &Path) -> bool {
    classify_in(&tool_homes(), path).is_some()
}

// ============================================================
// Listing
// ============================================================

fn millis(time: SystemTime) -> u64 {
    time.duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn modified_ms(path: &Path) -> u64 {
    fs::metadata(path).and_then(|m| m.modified()).map(millis).unwrap_or(0)
}

/// `~/...` for paths in the home folder.
fn display_path(path: &Path) -> String {
    if let Some(home) = dirs::home_dir() {
        if let Ok(rel) = path.strip_prefix(&home) {
            return if rel.as_os_str().is_empty() {
                "~".to_string()
            } else {
                format!("~/{}", rel.to_string_lossy())
            };
        }
    }
    path.to_string_lossy().into_owned()
}

/// Sub-folders (symlinks followed), sorted by name.
fn sub_dirs(dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(dir) else { return Vec::new() };
    let mut dirs: Vec<PathBuf> = entries
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.is_dir())
        .collect();
    dirs.sort();
    dirs
}

/// Markdown files in a folder and (up to `depth` levels) below it.
fn markdown_files(dir: &Path, depth: usize, out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    let mut entries: Vec<PathBuf> = entries.filter_map(|e| e.ok()).map(|e| e.path()).collect();
    entries.sort();
    for path in entries {
        let hidden = path.file_name().is_some_and(|n| n.to_string_lossy().starts_with('.'));
        if hidden {
            continue;
        }
        if path.is_dir() {
            if depth > 0 {
                markdown_files(&path, depth - 1, out);
            }
        } else if is_markdown_file(&path) {
            out.push(path);
        }
    }
}

/// `<dir>/*/SKILL.md`
fn skill_files(dir: &Path) -> Vec<PathBuf> {
    sub_dirs(dir).into_iter().map(|d| d.join("SKILL.md")).filter(|f| f.is_file()).collect()
}

/// `name:` and `description:` from YAML frontmatter, and the first `# heading`.
#[derive(Default)]
struct Header {
    name: Option<String>,
    description: Option<String>,
    heading: Option<String>,
    /// Files a rule applies to: Cursor's `globs`, Claude Code's `paths`.
    globs: Vec<String>,
    /// Cursor's `alwaysApply: true`.
    always_apply: bool,
}

fn unquote(value: &str) -> String {
    let value = value.trim();
    let quoted = value.len() >= 2
        && ((value.starts_with('"') && value.ends_with('"'))
            || (value.starts_with('\'') && value.ends_with('\'')));
    if quoted { value[1..value.len() - 1].to_string() } else { value.to_string() }
}

fn parse_header(text: &str) -> Header {
    let mut header = Header::default();
    let text = text.trim_start_matches('\u{feff}');
    let mut lines = text.split_inclusive('\n');
    let mut body = text;
    if text.starts_with("---") {
        let mut consumed = lines.next().map_or(0, str::len);
        let mut key: Option<&str> = None;
        for raw in lines {
            consumed += raw.len();
            let line = raw.trim_end_matches(['\r', '\n']);
            if line.trim_end() == "---" {
                body = &text[consumed..];
                break;
            }
            let indented = line.starts_with([' ', '\t']);
            if let Some((k, v)) = line.split_once(':').filter(|_| !indented) {
                key = Some(k.trim());
                match k.trim() {
                    // `globs: src/**/*.ts, *.md` or a list on the next lines
                    "globs" | "paths" => {
                        let list = v.trim().trim_start_matches('[').trim_end_matches(']');
                        header.globs.extend(list.split(',').map(unquote).filter(|g| !g.is_empty()));
                        continue;
                    }
                    "alwaysApply" => {
                        header.always_apply = v.trim() == "true";
                        continue;
                    }
                    _ => {}
                }
                let target = match k.trim() {
                    "name" => &mut header.name,
                    "description" => &mut header.description,
                    _ => continue,
                };
                // `description: >` / `|`: the text follows on indented lines
                let value = v.trim();
                if !matches!(value, "" | ">" | "|" | ">-" | "|-") {
                    *target = Some(unquote(value));
                }
            } else if let Some(item) = line.trim().strip_prefix("- ").filter(|_| matches!(key, Some("globs" | "paths"))) {
                header.globs.push(unquote(item));
            } else if indented && key == Some("description") {
                let more = line.trim();
                header.description = Some(match header.description.take() {
                    Some(d) => format!("{} {}", d, more),
                    None => more.to_string(),
                });
            }
        }
    }
    header.heading = body
        .lines()
        .find_map(|l| l.strip_prefix("# "))
        .map(|h| h.trim().to_string())
        .filter(|h| !h.is_empty());
    header
}

fn read_header(path: &Path) -> Header {
    use std::io::Read;
    let mut buf = Vec::with_capacity(8192);
    if let Ok(file) = fs::File::open(path) {
        let _ = file.take(8192).read_to_end(&mut buf);
    }
    parse_header(&String::from_utf8_lossy(&buf))
}

/// Inline markdown emphasis and code marks dropped, for a one-line summary.
fn plain_text(text: &str) -> String {
    text.replace("**", "").replace("__", "").replace('`', "").trim().to_string()
}

fn file_stem(path: &Path) -> String {
    path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default()
}

fn make_entry(path: &Path, kind: Kind, group: String, scope: &'static str) -> AgentEntry {
    let header = read_header(path);
    let file_name = path.file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let fallback = match kind {
        Kind::Skill => path.parent().map(file_stem).unwrap_or_else(|| file_stem(path)),
        Kind::Instructions => file_name,
        Kind::Plan => header.heading.clone().unwrap_or_else(|| file_stem(path)),
        _ => file_stem(path),
    };
    let title = match kind {
        Kind::Instructions => fallback,
        _ => header.name.clone().filter(|n| !n.is_empty()).unwrap_or(fallback),
    };
    let mut description = header.description.map(|d| plain_text(&d)).filter(|d| !d.is_empty());
    // A rule without a description: say when it applies
    if kind == Kind::Rule && description.is_none() {
        if header.always_apply {
            description = Some("Always applied".to_string());
        } else if !header.globs.is_empty() {
            description = Some(format!("Applies to {}", header.globs.join(", ")));
        }
    }
    AgentEntry {
        path: path.to_string_lossy().into_owned(),
        kind,
        title,
        description,
        group,
        scope,
        modified: modified_ms(path),
        unread: false,
        is_new: false,
    }
}

/// Folder that a `~/.claude/projects/<name>` entry is about. Claude Code names
/// it after the project's path with every character other than a letter or
/// digit replaced by `-`, which can't be reversed by string replacement alone:
/// walk the file system and match each folder's encoded name instead.
fn decode_project_dir(name: &str) -> Option<PathBuf> {
    fn encode(s: &str) -> String {
        s.chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect()
    }
    fn walk(dir: &Path, rest: &str, budget: &mut usize) -> Option<PathBuf> {
        if rest.is_empty() {
            return Some(dir.to_path_buf());
        }
        if *budget == 0 {
            return None;
        }
        *budget -= 1;
        let entries = fs::read_dir(dir).ok()?;
        let mut candidates: Vec<(String, PathBuf)> = entries
            .filter_map(|e| e.ok())
            .filter(|e| e.path().is_dir())
            .map(|e| (encode(&e.file_name().to_string_lossy()), e.path()))
            .filter(|(enc, _)| !enc.is_empty() && rest.starts_with(enc.as_str()))
            .collect();
        // Longest match first: `mdviewer-mj` before `mdviewer`
        candidates.sort_by_key(|c| std::cmp::Reverse(c.0.len()));
        for (enc, path) in candidates {
            let after = &rest[enc.len()..];
            if after.is_empty() {
                return Some(path);
            }
            if let Some(next) = after.strip_prefix('-') {
                if let Some(found) = walk(&path, next, budget) {
                    return Some(found);
                }
            }
        }
        None
    }
    let mut budget = 200;
    if cfg!(windows) {
        // `C--Users-me-work` is `C:\Users\me\work`
        let (drive, rest) = name.split_once("--")?;
        walk(Path::new(&format!("{}:\\", drive)), rest, &mut budget)
    } else {
        walk(Path::new("/"), name.strip_prefix('-')?, &mut budget)
    }
}

/// Agent files under a folder the user opened: `CLAUDE.md`, `AGENTS.md`,
/// `GEMINI.md`, `.claude/{skills,agents,commands,plans,rules}` and Cursor's
/// `.cursor/rules` and `.cursorrules` at any level down to `MAX_PROJECT_DEPTH`.
fn scan_project(root: &Path, out: &mut Vec<AgentEntry>, visited: &mut HashSet<PathBuf>, budget: &mut usize) {
    fn walk(dir: &Path, depth: usize, out: &mut Vec<AgentEntry>, visited: &mut HashSet<PathBuf>, budget: &mut usize) {
        if *budget == 0 || out.len() >= MAX_ENTRIES {
            return;
        }
        *budget -= 1;
        let Ok(real) = canonicalize(dir) else { return };
        if !visited.insert(real) {
            return;
        }
        let group = display_path(dir);
        for name in ["CLAUDE.md", "CLAUDE.local.md", "AGENTS.md", "GEMINI.md"] {
            let file = dir.join(name);
            if file.is_file() {
                out.push(make_entry(&file, Kind::Instructions, group.clone(), "project"));
            }
        }
        let copilot = dir.join(".github").join("copilot-instructions.md");
        if copilot.is_file() {
            out.push(make_entry(&copilot, Kind::Instructions, group.clone(), "project"));
        }
        let cursorrules = dir.join(".cursorrules");
        if cursorrules.is_file() {
            out.push(make_entry(&cursorrules, Kind::Rule, group.clone(), "project"));
        }
        let mut cursor_rules = Vec::new();
        markdown_files(&dir.join(".cursor").join("rules"), 2, &mut cursor_rules);
        for file in cursor_rules {
            out.push(make_entry(&file, Kind::Rule, group.clone(), "project"));
        }
        let claude = dir.join(".claude");
        for file in skill_files(&claude.join("skills")) {
            out.push(make_entry(&file, Kind::Skill, group.clone(), "project"));
        }
        for (sub, kind) in [
            ("rules", Kind::Rule),
            ("agents", Kind::Agent),
            ("commands", Kind::Command),
            ("plans", Kind::Plan),
        ] {
            let mut files = Vec::new();
            markdown_files(&claude.join(sub), 2, &mut files);
            for file in files {
                out.push(make_entry(&file, kind, group.clone(), "project"));
            }
        }
        if depth == 0 {
            return;
        }
        for sub in sub_dirs(dir) {
            let name = sub.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            if name.starts_with('.') || SKIPPED_DIRS.contains(&name.as_str()) {
                continue;
            }
            walk(&sub, depth - 1, out, visited, budget);
        }
    }
    walk(root, MAX_PROJECT_DEPTH, out, visited, budget);
}

/// Agent files in the agents' own folders.
fn scan_user(out: &mut Vec<AgentEntry>) {
    let Some(home) = dirs::home_dir() else { return };

    let claude = home.join(".claude");
    if claude.is_dir() {
        let group = Tool::Claude.label().to_string();
        let file = claude.join("CLAUDE.md");
        if file.is_file() {
            out.push(make_entry(&file, Kind::Instructions, group.clone(), "user"));
        }
        for project in sub_dirs(&claude.join("projects")) {
            let memory = project.join("memory");
            if !memory.is_dir() {
                continue;
            }
            let mut files = Vec::new();
            markdown_files(&memory, 2, &mut files);
            if files.is_empty() {
                continue;
            }
            let name = project.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            let label = decode_project_dir(&name).map(|p| display_path(&p)).unwrap_or(name);
            for file in files {
                out.push(make_entry(&file, Kind::Memory, label.clone(), "user"));
            }
        }
        let mut plans = Vec::new();
        markdown_files(&claude.join("plans"), 0, &mut plans);
        plans.sort_by_key(|p| std::cmp::Reverse(modified_ms(p)));
        for file in plans.into_iter().take(MAX_PLANS) {
            out.push(make_entry(&file, Kind::Plan, group.clone(), "user"));
        }
        for file in skill_files(&claude.join("skills")) {
            out.push(make_entry(&file, Kind::Skill, group.clone(), "user"));
        }
        for (sub, kind) in [("rules", Kind::Rule), ("agents", Kind::Agent), ("commands", Kind::Command)] {
            let mut files = Vec::new();
            markdown_files(&claude.join(sub), 2, &mut files);
            for file in files {
                out.push(make_entry(&file, kind, group.clone(), "user"));
            }
        }
        // plugins/cache/<marketplace>/<plugin>/<version>: the newest version
        for marketplace in sub_dirs(&claude.join("plugins").join("cache")) {
            for plugin in sub_dirs(&marketplace) {
                let Some(version) = sub_dirs(&plugin).into_iter().max_by_key(|v| modified_ms(v)) else {
                    continue;
                };
                let group = plugin.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
                for file in skill_files(&version.join("skills")) {
                    out.push(make_entry(&file, Kind::Skill, group.clone(), "plugin"));
                }
                for (sub, kind) in [("agents", Kind::Agent), ("commands", Kind::Command)] {
                    let mut files = Vec::new();
                    markdown_files(&version.join(sub), 1, &mut files);
                    for file in files {
                        out.push(make_entry(&file, kind, group.clone(), "plugin"));
                    }
                }
            }
        }
    }

    let codex = home.join(".codex");
    if codex.is_dir() {
        let group = Tool::Codex.label().to_string();
        let file = codex.join("AGENTS.md");
        if file.is_file() {
            out.push(make_entry(&file, Kind::Instructions, group.clone(), "user"));
        }
        let mut prompts = Vec::new();
        markdown_files(&codex.join("prompts"), 1, &mut prompts);
        for file in prompts {
            out.push(make_entry(&file, Kind::Command, group.clone(), "user"));
        }
        for file in skill_files(&codex.join("skills")) {
            out.push(make_entry(&file, Kind::Skill, group.clone(), "user"));
        }
    }

    let gemini = home.join(".gemini").join("GEMINI.md");
    if gemini.is_file() {
        out.push(make_entry(&gemini, Kind::Instructions, Tool::Gemini.label().to_string(), "user"));
    }
}

/// All agent files: the agents' own folders, then the opened folders.
pub fn scan(opened_dirs: &[PathBuf]) -> Vec<AgentEntry> {
    let mut out = Vec::new();
    scan_user(&mut out);
    let mut visited = HashSet::new();
    let mut budget = MAX_PROJECT_DIRS;
    for dir in opened_dirs {
        scan_project(dir, &mut out, &mut visited, &mut budget);
    }
    // The same plugin from two marketplaces: the most recently changed one
    let mut newest: HashMap<(String, Kind, String), u64> = HashMap::new();
    for e in out.iter().filter(|e| e.scope == "plugin") {
        let key = (e.group.clone(), e.kind, e.title.clone());
        let best = newest.entry(key).or_insert(e.modified);
        *best = (*best).max(e.modified);
    }
    let mut kept = HashSet::new();
    out.retain(|e| {
        e.scope != "plugin" || {
            let key = (e.group.clone(), e.kind, e.title.clone());
            newest.get(&key) == Some(&e.modified) && kept.insert(key)
        }
    });
    // A folder opened inside another one (or a project inside ~/.claude) lists once
    let mut seen = HashSet::new();
    out.retain(|e| seen.insert(canonicalize(Path::new(&e.path)).unwrap_or_else(|_| PathBuf::from(&e.path))));
    out.truncate(MAX_ENTRIES);
    for entry in &mut out {
        let (unread, is_new) = read_state(&entry.path);
        entry.unread = unread;
        entry.is_new = is_new;
    }
    out
}

/// Agent documents only in folders the user explicitly opened.
pub fn scan_projects(opened_dirs: &[PathBuf]) -> Vec<AgentEntry> {
    let mut out = Vec::new();
    let mut visited = HashSet::new();
    let mut budget = MAX_PROJECT_DIRS;
    for dir in opened_dirs {
        scan_project(dir, &mut out, &mut visited, &mut budget);
    }
    let mut seen = HashSet::new();
    out.retain(|e| seen.insert(canonicalize(Path::new(&e.path)).unwrap_or_else(|_| PathBuf::from(&e.path))));
    out.truncate(MAX_ENTRIES);
    out
}

/// Where the agents keep their files, for the "turn on" dialog.
pub fn found_locations() -> Vec<String> {
    let Some(home) = dirs::home_dir() else { return Vec::new() };
    Tool::ALL
        .iter()
        .map(|tool| home.join(tool.dir_name()))
        .filter(|dir| dir.is_dir())
        .map(|dir| display_path(&dir))
        .collect()
}

// ============================================================
// Read state
// ============================================================

fn snapshot_file(path: &str) -> Option<PathBuf> {
    get_config_dir().ok().map(|dir| dir.join("read-state").join(format!("{}.json", generate_id(path))))
}

pub fn load_snapshot(path: &str) -> Option<Snapshot> {
    let bytes = fs::read(snapshot_file(path)?).ok()?;
    let snapshot: Snapshot = serde_json::from_slice(&bytes).ok()?;
    // Another path with the same hash
    (snapshot.path == path).then_some(snapshot)
}

fn read_text(path: &Path) -> Option<String> {
    let metadata = fs::metadata(path).ok()?;
    if !metadata.is_file() || metadata.len() > MAX_SNAPSHOT_BYTES {
        return None;
    }
    fs::read(path).ok().map(decode_text)
}

fn store_snapshot(path: &str, content: String) -> Result<(), AppError> {
    let file = snapshot_file(path).ok_or_else(|| AppError::new("CONFIG_ERROR", "Cannot determine config directory"))?;
    let snapshot = Snapshot { path: path.to_string(), content, read_at: millis(SystemTime::now()) };
    let json = serde_json::to_vec(&snapshot)
        .map_err(|e| AppError::with_details("JSON_ERROR", "Failed to save read state", &e.to_string()))?;
    if let Some(dir) = file.parent() {
        fs::create_dir_all(dir)
            .map_err(|e| AppError::with_details("WRITE_ERROR", "Failed to save read state", &e.to_string()))?;
    }
    atomic_write(&file, &json)
        .map_err(|e| AppError::with_details("WRITE_ERROR", "Failed to save read state", &e.to_string()))
}

/// Remember the file as read, as it is now.
pub fn mark_read(path: &str) -> Result<(), AppError> {
    match read_text(Path::new(path)) {
        Some(content) => store_snapshot(path, content),
        None => Ok(()),
    }
}

/// (changed since read, never read). A newer modification time with the same
/// text (a `touch`, a rewrite with no changes) doesn't count as a change.
fn read_state(path: &str) -> (bool, bool) {
    let Some(snapshot) = snapshot_file(path) else { return (false, false) };
    let Ok(read_at) = fs::metadata(&snapshot).and_then(|m| m.modified()) else {
        return (true, true);
    };
    let modified = fs::metadata(path).and_then(|m| m.modified()).ok();
    if modified.is_none_or(|m| m <= read_at) {
        return (false, false);
    }
    match (load_snapshot(path), read_text(Path::new(path))) {
        (Some(saved), Some(current)) if saved.content == current => {
            // Bring the copy's time forward so the next scan doesn't compare again
            let _ = store_snapshot(path, current);
            (false, false)
        }
        (Some(_), _) => (true, false),
        (None, _) => (true, true),
    }
}

/// When the workspace is turned on: everything there is counts as read, so
/// only what changes afterwards is highlighted.
pub fn mark_all_read(entries: &[AgentEntry]) {
    for entry in entries {
        let _ = mark_read(&entry.path);
    }
}

/// Read-state copies for files that no longer exist are removed.
pub fn prune_read_state(entries: &[AgentEntry]) {
    let Some(dir) = snapshot_file("").and_then(|f| f.parent().map(Path::to_path_buf)) else { return };
    let Ok(files) = fs::read_dir(&dir) else { return };
    let listed: HashMap<String, ()> = entries.iter().map(|e| (format!("{}.json", generate_id(&e.path)), ())).collect();
    for file in files.filter_map(|f| f.ok()) {
        let name = file.file_name().to_string_lossy().into_owned();
        if listed.contains_key(&name) {
            continue;
        }
        let gone = fs::read(file.path())
            .ok()
            .and_then(|b| serde_json::from_slice::<Snapshot>(&b).ok())
            .is_none_or(|s| !Path::new(&s.path).exists());
        if gone {
            let _ = fs::remove_file(file.path());
        }
    }
}

// ============================================================
// Watching
// ============================================================

/// Instructions files looked for in every folder of an opened project.
const PROJECT_INSTRUCTIONS: &[&str] = &["CLAUDE.md", "CLAUDE.local.md", "AGENTS.md", "GEMINI.md", ".cursorrules"];

/// Whether a path below an opened folder is one `scan_project` lists.
fn is_project_agent_file(rel: &Path) -> bool {
    let Some(parts) = components(rel) else { return false };
    let Some(name) = parts.last() else { return false };
    if parts.iter().any(|p| p == ".git" || SKIPPED_DIRS.contains(&p.as_str())) {
        return false;
    }
    if PROJECT_INSTRUCTIONS.contains(&name.as_str()) {
        return true;
    }
    is_markdown_file(rel)
        && parts.windows(2).any(|w| {
            matches!(
                (w[0].as_str(), w[1].as_str()),
                (".claude", "skills" | "agents" | "commands" | "plans" | "rules")
                    | (".cursor", "rules")
                    | (".github", "copilot-instructions.md")
            )
        })
}

/// Folders to watch: the agents' homes themselves (not recursively: they also
/// hold transcripts and caches that change all the time), the folders inside
/// them that hold agent files, and the opened folders.
fn watch_roots(opened_dirs: &[PathBuf]) -> Vec<(PathBuf, RecursiveMode)> {
    let Some(home) = dirs::home_dir() else { return Vec::new() };
    let mut roots = Vec::new();
    for tool in Tool::ALL {
        let dir = home.join(tool.dir_name());
        let Ok(dir) = canonicalize(&dir) else { continue };
        let subs: &[&str] = match tool {
            Tool::Claude => &["projects", "plans", "skills", "agents", "commands", "rules", "plugins"],
            Tool::Codex => &["prompts", "skills"],
            Tool::Gemini => &[],
        };
        for sub in subs {
            roots.push((dir.join(sub), RecursiveMode::Recursive));
        }
        roots.push((dir, RecursiveMode::NonRecursive));
    }
    roots.extend(opened_dirs.iter().map(|d| (d.clone(), RecursiveMode::Recursive)));
    roots.retain(|(dir, _)| dir.is_dir());
    roots
}

/// Reports changes to agent files. The watched folders follow the opened
/// folders and pick up agent folders created later: `update` runs on every
/// scan.
pub struct Watch {
    watcher: RecommendedWatcher,
    watched: HashMap<PathBuf, RecursiveMode>,
    opened: Arc<Mutex<Vec<PathBuf>>>,
}

impl Watch {
    pub fn new(on_change: impl Fn() + Send + 'static) -> notify::Result<Self> {
        let homes = tool_homes();
        let opened: Arc<Mutex<Vec<PathBuf>>> = Arc::default();
        let opened_dirs = Arc::clone(&opened);
        let watcher = RecommendedWatcher::new(
            move |res: notify::Result<Event>| {
                let Ok(event) = res else { return };
                // Not `Access` (our own scan opens the files) or metadata
                let content_changed = match event.kind {
                    EventKind::Create(_) | EventKind::Remove(_) => true,
                    EventKind::Modify(ModifyKind::Metadata(_)) => false,
                    EventKind::Modify(_) => true,
                    _ => false,
                };
                if !content_changed {
                    return;
                }
                let opened = opened_dirs.lock().map(|d| d.clone()).unwrap_or_default();
                let relevant = event.paths.iter().any(|path| {
                    classify_in(&homes, path).is_some()
                        // A folder created in an agent's home (`~/.claude/skills`): watch it too
                        || (path.is_dir() && homes.iter().any(|(_, home)| path.parent() == Some(home.as_path())))
                        || opened.iter().any(|dir| path.strip_prefix(dir).is_ok_and(is_project_agent_file))
                });
                if relevant {
                    on_change();
                }
            },
            NotifyConfig::default(),
        )?;
        Ok(Self { watcher, watched: HashMap::new(), opened })
    }

    /// Watch the agent folders and `opened_dirs`, and stop watching folders
    /// no longer among them.
    pub fn update(&mut self, opened_dirs: &[PathBuf]) {
        if let Ok(mut opened) = self.opened.lock() {
            *opened = opened_dirs.to_vec();
        }
        let roots: HashMap<PathBuf, RecursiveMode> = watch_roots(opened_dirs).into_iter().collect();
        self.watched.retain(|dir, mode| {
            let keep = roots.get(dir) == Some(mode) && dir.is_dir();
            if !keep {
                let _ = self.watcher.unwatch(dir);
            }
            keep
        });
        for (dir, mode) in roots {
            if !self.watched.contains_key(&dir) && self.watcher.watch(&dir, mode).is_ok() {
                self.watched.insert(dir, mode);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parts(path: &str) -> Vec<String> {
        path.split('/').map(String::from).collect()
    }

    #[test]
    fn agent_folders_expose_only_their_documents() {
        let claude = |p: &str| classify_rel(Tool::Claude, &parts(p));
        assert_eq!(claude("CLAUDE.md"), Some(Kind::Instructions));
        assert_eq!(claude("projects/-Users-me-work/memory/MEMORY.md"), Some(Kind::Memory));
        assert_eq!(claude("projects/-Users-me-work/memory/sub/note.md"), Some(Kind::Memory));
        assert_eq!(claude("skills/review/SKILL.md"), Some(Kind::Skill));
        assert_eq!(claude("skills/review/references/api.md"), Some(Kind::Skill));
        assert_eq!(claude("plans/quick-plan.md"), Some(Kind::Plan));
        assert_eq!(claude("rules/testing.md"), Some(Kind::Rule));
        assert_eq!(claude("plugins/cache/mk/plug/1.0.0/skills/x/SKILL.md"), Some(Kind::Skill));
        // Transcripts, settings, other project files and plugin repos stay out
        assert_eq!(claude("projects/-Users-me-work/session.md"), None);
        assert_eq!(claude("projects/-Users-me-work/memory"), None);
        assert_eq!(claude("settings.md"), None);
        assert_eq!(claude("plugins/marketplaces/mk/README.md"), None);
        assert_eq!(claude("plugins/cache/mk/plug/1.0.0/README.md"), None);
        assert_eq!(classify_rel(Tool::Codex, &parts("AGENTS.md")), Some(Kind::Instructions));
        assert_eq!(classify_rel(Tool::Codex, &parts("auth.md")), None);
        assert_eq!(classify_rel(Tool::Gemini, &parts("GEMINI.md")), Some(Kind::Instructions));

        let homes = vec![(Tool::Claude, PathBuf::from("/home/me/.claude"))];
        assert_eq!(classify_in(&homes, Path::new("/home/me/.claude/skills/a/SKILL.md")), Some(Kind::Skill));
        // Only markdown
        assert_eq!(classify_in(&homes, Path::new("/home/me/.claude/skills/a/run.sh")), None);
        assert_eq!(classify_in(&homes, Path::new("/home/me/.claude/projects/p/memory/x.json")), None);
        assert_eq!(classify_in(&homes, Path::new("/home/me/other/CLAUDE.md")), None);
    }

    #[test]
    fn project_agent_files_are_recognized_for_watching() {
        let yes = |p: &str| is_project_agent_file(Path::new(p));
        assert!(yes("CLAUDE.md"));
        assert!(yes("apps/web/AGENTS.md"));
        assert!(yes(".cursorrules"));
        assert!(yes(".cursor/rules/style.mdc"));
        assert!(yes(".claude/skills/review/SKILL.md"));
        assert!(yes(".claude/rules/api.md"));
        assert!(yes(".github/copilot-instructions.md"));
        assert!(!yes("README.md"));
        assert!(!yes("docs/rules/style.md"));
        assert!(!yes(".claude/settings.json"));
        assert!(!yes(".cursor/rules/run.sh"));
        assert!(!yes("node_modules/pkg/CLAUDE.md"));
    }

    #[test]
    fn header_reads_frontmatter_and_heading() {
        let h = parse_header("---\nname: pdf\ndescription: \"Read PDFs\"\nmetadata:\n  type: x\n---\n\n# Title\n");
        assert_eq!(h.name.as_deref(), Some("pdf"));
        assert_eq!(h.description.as_deref(), Some("Read PDFs"));
        assert_eq!(h.heading.as_deref(), Some("Title"));

        let folded = parse_header("---\nname: a\ndescription: >\n  first line\n  second line\n---\n");
        assert_eq!(folded.description.as_deref(), Some("first line second line"));

        let cursor = parse_header("---\ndescription:\nglobs: src/**/*.ts, \"*.md\"\nalwaysApply: false\n---\n");
        assert_eq!(cursor.description, None);
        assert_eq!(cursor.globs, vec!["src/**/*.ts", "*.md"]);
        assert!(!cursor.always_apply);
        let listed = parse_header("---\npaths:\n  - \"src/api/**\"\n  - lib/**\nalwaysApply: true\n---\n");
        assert_eq!(listed.globs, vec!["src/api/**", "lib/**"]);
        assert!(listed.always_apply);

        let plain = parse_header("Intro\n\n# Plan: ship it\n");
        assert_eq!(plain.name, None);
        assert_eq!(plain.heading.as_deref(), Some("Plan: ship it"));
    }

    #[cfg(unix)]
    #[test]
    fn project_dir_names_decode_to_existing_folders() {
        let root = std::env::temp_dir().join(format!("mdviewer-agent-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("my-app").join("web_ui")).unwrap();
        fs::create_dir_all(root.join("my")).unwrap();
        let root = canonicalize(&root).unwrap();
        let encoded: String = root.join("my-app").join("web_ui").to_string_lossy()
            .chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect();
        assert_eq!(decode_project_dir(&encoded), Some(root.join("my-app").join("web_ui")));
        assert_eq!(decode_project_dir(&format!("{}-nope", encoded)), None);
        let _ = fs::remove_dir_all(&root);
    }
}
