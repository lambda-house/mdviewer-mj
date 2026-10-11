// MDViewer - Tauri Backend
// Handles file system operations, watching, and configuration

#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use notify::{Config as NotifyConfig, RecommendedWatcher, RecursiveMode, Watcher, Event};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, DragDropEvent, Emitter, Manager, State, WindowEvent};
use tauri::http::{Response as HttpResponse, StatusCode};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_updater::UpdaterExt;

mod agent;

// ============================================================
// Types
// ============================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileNode {
    pub id: String,
    pub name: String,
    pub path: String,
    #[serde(rename = "displayPath")]
    pub display_path: String,
    #[serde(rename = "type")]
    pub node_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<FileNode>>,
    #[serde(rename = "isExpanded", skip_serializing_if = "Option::is_none")]
    pub is_expanded: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
pub struct FileChangeEvent {
    pub event_type: String,
    pub path: String,
}

#[derive(Debug, Serialize)]
pub struct AppError {
    pub code: String,
    pub message: String,
    pub details: Option<String>,
}

impl AppError {
    fn new(code: &str, message: &str) -> Self {
        Self {
            code: code.to_string(),
            message: message.to_string(),
            details: None,
        }
    }

    fn with_details(code: &str, message: &str, details: &str) -> Self {
        Self {
            code: code.to_string(),
            message: message.to_string(),
            details: Some(details.to_string()),
        }
    }
}

// ============================================================
// App State
// ============================================================

#[derive(Default)]
pub struct AppState {
    pub watcher: Arc<Mutex<Option<RecommendedWatcher>>>,
    pub watched_paths: Arc<Mutex<HashSet<PathBuf>>>,
}

// ============================================================
// Security: Access List
// ============================================================

const MAX_SCAN_DEPTH: usize = 10;
const MAX_FILES_PER_DIRECTORY: usize = 10000;

/// Folders and files the user opened: picked in the folder dialog, dropped on
/// the window, or passed on the command line ("Open with"). Every file command
/// checks its path against this list, and the list is persisted so a restored
/// session keeps working.
///
/// Paths are only ever added from Rust, as a result of a user action. The
/// webview can't add a path by naming it, so a script injected into a document
/// can't read anything the user didn't open.
#[derive(Debug, Default, Serialize, Deserialize)]
pub struct Access {
    /// Opened folders: documents and images anywhere below them are readable.
    #[serde(default)]
    directories: Vec<PathBuf>,
    /// Opened single files: the file itself, plus images next to/below it.
    #[serde(default)]
    files: Vec<PathBuf>,
    /// Agent workspace turned on: markdown in the agents' own folders
    /// (`agent::is_agent_document`) counts as opened.
    #[serde(default)]
    agent_workspace: bool,
}

impl Access {
    fn in_tree(&self, path: &Path) -> bool {
        self.directories.iter().any(|dir| path.starts_with(dir))
    }

    /// Add a canonical path. Returns whether the list changed.
    fn grant(&mut self, path: &Path) -> bool {
        if self.in_tree(path) {
            return false;
        }
        if path.is_dir() {
            // A parent folder replaces the folders and files inside it
            self.directories.retain(|dir| !dir.starts_with(path));
            self.files.retain(|file| !file.starts_with(path));
            self.directories.push(path.to_path_buf());
            true
        } else if path.is_file() && !self.files.iter().any(|file| file == path) {
            self.files.push(path.to_path_buf());
            true
        } else {
            false
        }
    }

    /// Folder listing and watching: only inside opened folders.
    fn can_list(&self, path: &Path) -> bool {
        self.in_tree(path)
    }

    /// Reading or saving a document: an opened file, or a markdown/text file
    /// inside an opened folder (never keys, binaries or dotfiles like .bashrc).
    fn can_open(&self, path: &Path) -> bool {
        self.files.iter().any(|file| file == path)
            || (self.in_tree(path) && is_viewable_file(path, true))
            || (self.agent_workspace && agent::is_agent_document(path))
    }

    /// Metadata and "reveal in file manager".
    fn can_stat(&self, path: &Path) -> bool {
        self.in_tree(path)
            || self.files.iter().any(|file| file == path)
            || (self.agent_workspace && agent::is_agent_document(path))
    }

    /// Images referenced by documents (the `localfile://` protocol).
    fn can_read_image(&self, path: &Path) -> bool {
        is_image_file(path)
            && (self.in_tree(path)
                || self.files.iter().any(|file| file.parent().is_some_and(|dir| path.starts_with(dir))))
    }

    fn allows(&self, path: &Path, use_: Use) -> bool {
        match use_ {
            Use::List => self.can_list(path),
            Use::Open => self.can_open(path),
            Use::Stat => self.can_stat(path),
            Use::Image => self.can_read_image(path),
        }
    }
}

/// What a command does with a path, for the access check.
#[derive(Debug, Clone, Copy)]
enum Use {
    List,
    Open,
    Stat,
    Image,
}

impl Use {
    /// Whether a symlink's target is the kind of thing this use may reach.
    fn fits_target(self, real: &Path) -> bool {
        match self {
            Use::List => real.is_dir(),
            Use::Open => real.is_file() && is_viewable_file(real, true),
            Use::Stat => true,
            Use::Image => real.is_file() && is_image_file(real),
        }
    }
}

/// A path from the frontend: as named (the way the file tree lists it, with
/// symlinks not followed) and where it really is.
#[derive(Debug)]
struct Target {
    named: PathBuf,
    real: PathBuf,
}

/// The access list plus where it is saved.
pub struct AccessState {
    access: Mutex<Access>,
    file: Option<PathBuf>,
    /// No access file existed at startup: the first `adopt_session_access`
    /// call may carry over a session saved by a version without the list.
    migration_pending: Mutex<bool>,
}

impl AccessState {
    fn load() -> Self {
        let file = get_config_dir().ok().map(|dir| dir.join("access.json"));
        let saved = file.as_ref().and_then(|f| fs::read(f).ok());
        let migration_pending = saved.is_none();
        let access = saved
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();
        Self {
            access: Mutex::new(access),
            file,
            migration_pending: Mutex::new(migration_pending),
        }
    }

    /// Allowed when the real path is, or when the path as named is inside an
    /// opened folder and is a symlink there whose target fits the use: a link
    /// in an opened folder is followed like a text editor would, but only to
    /// documents (or images) and never through `..`.
    fn check(&self, target: &Target, use_: Use) -> Result<(), AppError> {
        let access = self.access.lock()
            .map_err(|_| AppError::new("STATE_ERROR", "Failed to access the access list"))?;
        let allowed = access.allows(&target.real, use_)
            || (target.named != target.real
                && access.allows(&target.named, use_)
                && use_.fits_target(&target.real));
        if allowed {
            Ok(())
        } else {
            Err(AppError::with_details(
                "ACCESS_DENIED",
                "Not inside a folder or file you opened",
                &target.named.to_string_lossy(),
            ))
        }
    }

    /// Grant user-chosen paths (dialog, drop, command line) and save the list.
    fn grant<P: AsRef<Path>>(&self, paths: impl IntoIterator<Item = P>) {
        let Ok(mut access) = self.access.lock() else { return };
        let mut changed = false;
        for path in paths {
            if let Ok(canonical) = canonicalize(path.as_ref()) {
                changed |= access.grant(&canonical);
            }
        }
        if changed {
            self.save(&access);
        }
    }

    /// Turn the agent workspace on or off and save the list.
    fn set_agent_workspace(&self, enabled: bool) {
        let Ok(mut access) = self.access.lock() else { return };
        if access.agent_workspace != enabled {
            access.agent_workspace = enabled;
            self.save(&access);
        }
    }

    /// Whether the agent workspace is on, and the opened folders.
    fn agent_scope(&self) -> (bool, Vec<PathBuf>) {
        self.access.lock()
            .map(|access| (access.agent_workspace, access.directories.clone()))
            .unwrap_or_default()
    }

    fn save(&self, access: &Access) {
        let Some(file) = &self.file else { return };
        let saved = serde_json::to_vec_pretty(access)
            .map_err(std::io::Error::other)
            .and_then(|json| {
                if let Some(dir) = file.parent() {
                    fs::create_dir_all(dir)?;
                }
                atomic_write(file, &json)
            });
        if let Err(e) = saved {
            eprintln!("Failed to save {}: {}", file.display(), e);
        }
    }
}

/// `canonicalize` without Windows' `\\?\` prefix (when the path doesn't need it),
/// so paths compare and display the same as the ones the user picked.
fn canonicalize(path: &Path) -> std::io::Result<PathBuf> {
    dunce::canonicalize(path)
}

/// `~/` expanded, nothing resolved.
fn expand_home(path_str: &str) -> Result<PathBuf, AppError> {
    if let Some(rest) = path_str.strip_prefix("~/") {
        let home = dirs::home_dir()
            .ok_or_else(|| AppError::new("PATH_ERROR", "Cannot determine home directory"))?;
        Ok(home.join(rest))
    } else if path_str.starts_with('~') {
        Err(AppError::new("PATH_ERROR", "~user syntax not supported"))
    } else {
        Ok(PathBuf::from(path_str))
    }
}

/// Absolute, symlink-free path of an existing file or folder; `~/` is expanded.
fn expand_path(path_str: &str) -> Result<PathBuf, AppError> {
    canonicalize(&expand_home(path_str)?).map_err(|e| {
        AppError::with_details("PATH_ERROR", "Invalid path", &e.to_string())
    })
}

/// An existing path both as named and resolved. A relative path or one with
/// `..` only counts as its real location.
fn resolve_target(path: &Path) -> Result<Target, AppError> {
    let real = canonicalize(path).map_err(|e| {
        AppError::with_details("PATH_ERROR", "Invalid path", &e.to_string())
    })?;
    let named = if path.is_absolute() && !path.components().any(|c| c == std::path::Component::ParentDir) {
        // Drops `.` components and doubled separators
        path.components().collect()
    } else {
        real.clone()
    };
    Ok(Target { named, real })
}

fn expand_target(path_str: &str) -> Result<Target, AppError> {
    resolve_target(&expand_home(path_str)?)
}

/// Write `bytes` to a temporary file next to `target`, then rename it over
/// `target`: a crash or power loss leaves either the old or the new file,
/// never a truncated one. An existing file keeps its permissions.
fn atomic_write(target: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let dir = target.parent().ok_or_else(|| std::io::Error::other("path has no parent folder"))?;
    let name = target.file_name().ok_or_else(|| std::io::Error::other("path has no file name"))?;
    let mut tmp_name = std::ffi::OsString::from(".");
    tmp_name.push(name);
    tmp_name.push(format!(".mdviewer-{}.tmp", std::process::id()));
    let tmp = dir.join(tmp_name);

    let result = (|| {
        let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&tmp)?;
        file.write_all(bytes)?;
        if let Ok(metadata) = fs::metadata(target) {
            file.set_permissions(metadata.permissions())?;
        }
        file.sync_all()?;
        drop(file);
        fs::rename(&tmp, target)?;
        // Persist the rename itself
        #[cfg(unix)]
        fs::File::open(dir)?.sync_all()?;
        Ok(())
    })();

    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

// ============================================================
// File System Functions
// ============================================================

fn generate_id(path: &str) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    
    let mut hasher = DefaultHasher::new();
    path.hash(&mut hasher);
    format!("{:x}", hasher.finish())
}

fn is_markdown_file(path: &Path) -> bool {
    path.extension()
        .map(|ext| {
            let ext = ext.to_string_lossy().to_lowercase();
            ext == "md" || ext == "markdown"
        })
        .unwrap_or(false)
}

/// Text formats shown in the file tree besides markdown.
/// Keep in sync with `TEXT_FILE_EXTENSIONS` in src/utils/files.ts.
const TEXT_FILE_EXTENSIONS: &[&str] = &[
    "txt", "text", "log", "fb2", "xml", "csv", "tsv", "rst", "adoc", "org", "tex",
    "scala", "sc", "sbt", "java", "kt", "kts", "groovy", "gradle",
    "py", "ts", "tsx", "js", "jsx", "mjs", "cjs", "json", "jsonc",
    "rs", "go", "c", "h", "cpp", "hpp", "cc", "cs", "rb", "php", "lua", "sql",
    "sh", "bash", "zsh", "fish", "ps1", "bat",
    "html", "htm", "css", "scss", "less", "vue", "svelte",
    "yaml", "yml", "toml", "ini", "cfg", "conf", "config", "properties", "env",
    "diff", "patch",
];

/// Extension-less (or dot-) files that are text. Same list as the frontend.
const TEXT_FILE_NAMES: &[&str] = &[
    "readme", "license", "changelog", "makefile", "dockerfile", "jenkinsfile",
    ".gitignore", ".gitattributes", ".editorconfig", ".env", ".npmrc", ".scalafmt.conf",
];

/// Markdown, or (when `include_text` is set) any other known text file.
fn is_viewable_file(path: &Path, include_text: bool) -> bool {
    if is_markdown_file(path) {
        return true;
    }
    if !include_text {
        return false;
    }
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if TEXT_FILE_NAMES.contains(&name.as_str()) {
        return true;
    }
    path.extension()
        .map(|ext| TEXT_FILE_EXTENSIONS.contains(&ext.to_string_lossy().to_lowercase().as_str()))
        .unwrap_or(false)
}

/// Encoding named in an XML declaration (`<?xml ... encoding="windows-1251"?>`).
fn xml_declared_encoding(bytes: &[u8]) -> Option<&'static encoding_rs::Encoding> {
    let head = &bytes[..bytes.len().min(256)];
    let head = std::str::from_utf8(head)
        .ok()
        .or_else(|| head.iter().position(|&b| b >= 0x80).and_then(|i| std::str::from_utf8(&head[..i]).ok()))?;
    let decl_end = head.find("?>")?;
    let decl = &head[..decl_end];
    if !decl.trim_start().starts_with("<?xml") {
        return None;
    }
    let rest = &decl[decl.find("encoding")? + "encoding".len()..];
    let rest = rest.trim_start().strip_prefix('=')?.trim_start();
    let quote = rest.chars().next().filter(|c| *c == '"' || *c == '\'')?;
    let value = &rest[1..];
    let label = &value[..value.find(quote)?];
    encoding_rs::Encoding::for_label(label.as_bytes())
}

/// How a text file's bytes are encoded.
#[derive(Debug, PartialEq)]
enum TextEncoding {
    Utf8,
    /// Byte order mark (UTF-16 LE/BE, or UTF-8 with BOM) - `usize` is its length.
    Bom(&'static encoding_rs::Encoding, usize),
    /// Named by an XML declaration (fb2 books are often windows-1251).
    Declared(&'static encoding_rs::Encoding),
    /// Not UTF-8 and nothing says what it is.
    Unknown,
}

fn detect_encoding(bytes: &[u8]) -> TextEncoding {
    if let Some((encoding, bom_len)) = encoding_rs::Encoding::for_bom(bytes) {
        return TextEncoding::Bom(encoding, bom_len);
    }
    if std::str::from_utf8(bytes).is_ok() {
        return TextEncoding::Utf8;
    }
    match xml_declared_encoding(bytes) {
        Some(encoding) => TextEncoding::Declared(encoding),
        None => TextEncoding::Unknown,
    }
}

/// Decode file bytes: UTF-8, else a BOM (UTF-16), else the encoding an XML
/// declaration names, else lossy UTF-8.
fn decode_text(bytes: Vec<u8>) -> String {
    match detect_encoding(&bytes) {
        TextEncoding::Bom(encoding, bom_len) => {
            encoding.decode_without_bom_handling(&bytes[bom_len..]).0.into_owned()
        }
        TextEncoding::Declared(encoding) => encoding.decode_without_bom_handling(&bytes).0.into_owned(),
        TextEncoding::Utf8 => String::from_utf8(bytes).unwrap_or_default(),
        TextEncoding::Unknown => String::from_utf8_lossy(&bytes).into_owned(),
    }
}

/// Encode `content` for saving so the file keeps its encoding:
/// - an XML declaration in the content naming a legacy encoding wins
///   (unmappable characters become `&#NNNN;` references, valid in XML)
/// - a file that had a BOM keeps it (and stays UTF-16 if it was)
/// - a file in an unknown non-UTF-8 encoding is refused: it was decoded lossily
/// - everything else is UTF-8
fn encode_text(content: &str, previous: Option<&[u8]>) -> Result<Vec<u8>, AppError> {
    if let Some(encoding) = xml_declared_encoding(content.as_bytes()) {
        if encoding != encoding_rs::UTF_8
            && encoding != encoding_rs::UTF_16LE
            && encoding != encoding_rs::UTF_16BE
        {
            return Ok(encoding.encode(content).0.into_owned());
        }
    }

    match previous.map(detect_encoding) {
        Some(TextEncoding::Bom(encoding, _)) if encoding == encoding_rs::UTF_16LE => {
            let mut out = vec![0xFF, 0xFE];
            content.encode_utf16().for_each(|unit| out.extend_from_slice(&unit.to_le_bytes()));
            Ok(out)
        }
        Some(TextEncoding::Bom(encoding, _)) if encoding == encoding_rs::UTF_16BE => {
            let mut out = vec![0xFE, 0xFF];
            content.encode_utf16().for_each(|unit| out.extend_from_slice(&unit.to_be_bytes()));
            Ok(out)
        }
        Some(TextEncoding::Bom(_, _)) => {
            let mut out = vec![0xEF, 0xBB, 0xBF];
            out.extend_from_slice(content.as_bytes());
            Ok(out)
        }
        Some(TextEncoding::Unknown) => Err(AppError::new(
            "UNKNOWN_ENCODING",
            "The file is not UTF-8 and its encoding is unknown - saving would corrupt it",
        )),
        _ => Ok(content.as_bytes().to_vec()),
    }
}

/// Build/dependency/VCS folders whose churn must not trigger a tree rescan
/// (a build or `git checkout` produces thousands of events there).
fn is_watch_noise(path: &Path) -> bool {
    path.components().any(|c| {
        let name = c.as_os_str();
        name == "node_modules" || name == "target" || name == ".git"
    })
}

/// Heavy build/dependency folders skipped while scanning. Dot-folders are
/// listed like any other; folders without markdown are pruned anyway.
fn is_hidden(name: &str) -> bool {
    name == "node_modules" || name == "target"
}

/// List a folder's documents. Symlinked folders are followed, but each real
/// folder is listed once, so a link to a parent can't loop.
fn scan_directory_recursive(
    dir_path: &Path,
    depth: usize,
    file_count: &mut usize,
    include_text: bool,
    visited: &mut HashSet<PathBuf>,
) -> Option<FileNode> {
    if depth > MAX_SCAN_DEPTH || *file_count > MAX_FILES_PER_DIRECTORY {
        return None;
    }
    
    if !dir_path.is_dir() {
        return None;
    }

    if !visited.insert(canonicalize(dir_path).ok()?) {
        return None;
    }
    
    let name = dir_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| dir_path.to_string_lossy().to_string());
    
    if is_hidden(&name) {
        return None;
    }
    
    let path_str = dir_path.to_string_lossy().to_string();
    let mut children: Vec<FileNode> = Vec::new();
    let mut has_md_files = false;
    
    let entries = match fs::read_dir(dir_path) {
        Ok(entries) => entries,
        Err(_) => return None,
    };
    
    let mut entries: Vec<_> = entries.filter_map(|e| e.ok()).collect();
    entries.sort_by(|a, b| {
        let a_is_dir = a.path().is_dir();
        let b_is_dir = b.path().is_dir();
        match (a_is_dir, b_is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.file_name().cmp(&b.file_name()),
        }
    });
    
    for entry in entries {
        if *file_count > MAX_FILES_PER_DIRECTORY {
            break;
        }
        
        let entry_path = entry.path();
        let entry_name = entry.file_name().to_string_lossy().to_string();
        
        if is_hidden(&entry_name) {
            continue;
        }
        
        if entry_path.is_dir() {
            if let Some(child) = scan_directory_recursive(&entry_path, depth + 1, file_count, include_text, visited) {
                children.push(child);
            }
        } else if is_viewable_file(&entry_path, include_text)
            && (!entry.file_type().is_ok_and(|t| t.is_symlink())
                || canonicalize(&entry_path).is_ok_and(|real| is_viewable_file(&real, include_text)))
        {
            *file_count += 1;
            has_md_files = true;
            children.push(FileNode {
                id: generate_id(&entry_path.to_string_lossy()),
                name: entry_name.clone(),
                path: entry_path.to_string_lossy().to_string(),
                display_path: entry_name,
                node_type: "file".to_string(),
                children: None,
                is_expanded: None,
            });
        }
    }
    
    if children.is_empty() && !has_md_files {
        return None;
    }
    
    Some(FileNode {
        id: generate_id(&path_str),
        name: name.clone(),
        path: path_str,
        display_path: name,
        node_type: "directory".to_string(),
        children: Some(children),
        is_expanded: Some(false),
    })
}

// ============================================================
// History Functions
// ============================================================

/// Oldest entries are dropped beyond this many.
const MAX_HISTORY_ENTRIES: usize = 1000;

/// Serializes read-modify-write of history.md: concurrent opens would
/// otherwise lose entries.
static HISTORY_LOCK: Mutex<()> = Mutex::new(());

fn get_config_dir() -> Result<PathBuf, AppError> {
    dirs::config_dir()
        .map(|p| p.join("mdviewer"))
        .ok_or_else(|| AppError::new("CONFIG_ERROR", "Cannot determine config directory"))
}

fn get_history_file_path() -> Result<PathBuf, AppError> {
    let config_dir = get_config_dir()?;
    Ok(config_dir.join("history").join("history.md"))
}

fn ensure_history_dir() -> Result<PathBuf, AppError> {
    let history_path = get_history_file_path()?;
    if let Some(parent) = history_path.parent() {
        fs::create_dir_all(parent).map_err(|e| {
            AppError::with_details("FS_ERROR", "Failed to create history directory", &e.to_string())
        })?;
    }
    Ok(history_path)
}

/// Link text: every ASCII punctuation character backslash-escaped, so names
/// with `[`, `]`, `*` or `_` stay literal.
fn markdown_link_text(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        if c.is_ascii_punctuation() {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

/// Link destination: percent-encode everything that could end or confuse it
/// (spaces, parentheses, `<>`, `%`, backslashes...). The history panel decodes
/// the href with `decodeURIComponent`.
fn markdown_link_destination(path: &str) -> String {
    let mut out = String::with_capacity(path.len());
    for c in path.chars() {
        if c.is_ascii_alphanumeric() || matches!(c, '/' | '-' | '.' | '_' | '~' | ':') || !c.is_ascii() {
            out.push(c);
        } else {
            out.push_str(&format!("%{:02X}", c as u32));
        }
    }
    out
}

/// Insert an entry under today's date (newest first within a day; days are in
/// chronological order) and drop the oldest entries beyond the cap.
fn add_history_entry(content: &str, date_str: &str, entry: &str, max_entries: usize) -> String {
    // Preamble ("# History", notes) and the "## <date>" sections in file order
    let mut preamble = String::new();
    let mut sections: Vec<(String, Vec<String>)> = Vec::new();
    for line in content.lines() {
        if let Some(date) = line.strip_prefix("## ") {
            sections.push((date.trim().to_string(), Vec::new()));
        } else if let Some((_, entries)) = sections.last_mut() {
            if !line.trim().is_empty() {
                entries.push(line.to_string());
            }
        } else {
            preamble.push_str(line);
            preamble.push('\n');
        }
    }

    match sections.iter_mut().find(|(date, _)| date == date_str) {
        Some((_, entries)) => entries.insert(0, entry.to_string()),
        None => sections.push((date_str.to_string(), vec![entry.to_string()])),
    }

    // Oldest day first, oldest entry last within a day
    let mut total: usize = sections.iter().map(|(_, entries)| entries.len()).sum();
    while total > max_entries {
        let Some((_, oldest_day)) = sections.first_mut() else { break };
        oldest_day.pop();
        total -= 1;
        if oldest_day.is_empty() {
            sections.remove(0);
        }
    }

    let mut out = preamble.trim_end().to_string();
    out.push('\n');
    for (date, entries) in &sections {
        out.push_str(&format!("\n## {}\n", date));
        for entry in entries {
            out.push_str(entry);
            out.push('\n');
        }
    }
    out
}

// ============================================================
// Tauri Commands
// ============================================================

#[tauri::command]
async fn get_history_path() -> Result<String, AppError> {
    let path = get_history_file_path()?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
async fn read_history() -> Result<String, AppError> {
    let path = get_history_file_path()?;

    if !path.exists() {
        return Ok(String::from("# History\n\nNo files opened yet.\n"));
    }

    fs::read_to_string(&path)
        .map_err(|e| AppError::with_details("FILE_ERROR", "Failed to read history", &e.to_string()))
}

#[tauri::command]
async fn append_to_history(
    file_path: String,
    file_name: String,
    access: State<'_, AccessState>,
) -> Result<(), AppError> {
    // Only files the app could open end up in the history
    let target = expand_target(&file_path)?;
    access.check(&target, Use::Open)?;

    let _guard = HISTORY_LOCK.lock()
        .map_err(|_| AppError::new("STATE_ERROR", "Failed to lock history"))?;
    let history_path = ensure_history_dir()?;

    let now = chrono::Local::now();
    let date_str = now.format("%Y-%m-%d").to_string();
    let entry = format!(
        "- {} [{}]({})",
        now.format("%H:%M"),
        markdown_link_text(&file_name),
        markdown_link_destination(&target.named.to_string_lossy()),
    );

    let content = fs::read_to_string(&history_path).unwrap_or_else(|_| String::from("# History\n"));
    let content = add_history_entry(&content, &date_str, &entry, MAX_HISTORY_ENTRIES);

    atomic_write(&history_path, content.as_bytes())
        .map_err(|e| AppError::with_details("FILE_ERROR", "Failed to write history", &e.to_string()))
}

#[tauri::command]
async fn clear_history() -> Result<(), AppError> {
    let _guard = HISTORY_LOCK.lock()
        .map_err(|_| AppError::new("STATE_ERROR", "Failed to lock history"))?;
    let history_path = ensure_history_dir()?;
    let content = "# History\n\nHistory cleared.\n";

    atomic_write(&history_path, content.as_bytes())
        .map_err(|e| AppError::with_details("FILE_ERROR", "Failed to clear history", &e.to_string()))
}

#[tauri::command]
async fn scan_directories(
    paths: Vec<String>,
    include_text_files: Option<bool>,
    access: State<'_, AccessState>,
) -> Result<Vec<FileNode>, AppError> {
    let include_text = include_text_files.unwrap_or(false);
    let mut results = Vec::new();
    
    for path_str in paths {
        let target = match expand_target(&path_str).and_then(|t| {
            access.check(&t, Use::List)?;
            Ok(t)
        }) {
            Ok(t) => t,
            Err(e) => {
                eprintln!("Skipping '{}': {}", path_str, e.message);
                continue;
            }
        };
        
        let mut file_count = 0;
        let mut visited = HashSet::new();
        if let Some(node) = scan_directory_recursive(&target.named, 0, &mut file_count, include_text, &mut visited) {
            results.push(node);
        }
    }
    
    Ok(results)
}

#[tauri::command]
async fn read_file(path: String, access: State<'_, AccessState>) -> Result<String, AppError> {
    let expanded = expand_target(&path)?;
    access.check(&expanded, Use::Open)?;
    let expanded = expanded.real;
    
    // Check file size (max 10MB)
    let metadata = fs::metadata(&expanded)
        .map_err(|e| AppError::with_details("FILE_ERROR", "Cannot read file metadata", &e.to_string()))?;
    
    if metadata.len() > 10 * 1024 * 1024 {
        return Err(AppError::new("FILE_TOO_LARGE", "File exceeds 10MB limit"));
    }
    
    fs::read(&expanded)
        .map(decode_text)
        .map_err(|e| AppError::with_details("FILE_ERROR", "Failed to read file", &e.to_string()))
}

/// Save an open document. The file must exist and be one the user opened; a
/// symlink is resolved and its target is replaced atomically.
#[tauri::command]
async fn write_file(path: String, content: String, access: State<'_, AccessState>) -> Result<(), AppError> {
    let expanded = expand_target(&path)?;
    access.check(&expanded, Use::Open)?;
    let expanded = expanded.real;

    let previous = fs::read(&expanded)
        .map_err(|e| AppError::with_details("FILE_ERROR", "Failed to read file", &e.to_string()))?;
    let bytes = encode_text(&content, Some(&previous))?;

    atomic_write(&expanded, &bytes)
        .map_err(|e| AppError::with_details("FILE_ERROR", "Failed to write file", &e.to_string()))
}

#[derive(Debug, Deserialize)]
pub struct FileFilter {
    name: String,
    extensions: Vec<String>,
}

/// Native folder picker. The chosen folder is added to the access list.
#[tauri::command]
async fn pick_directory(app: AppHandle, access: State<'_, AccessState>) -> Result<Option<String>, AppError> {
    let Some(picked) = app.dialog().file().set_title("Select Directory").blocking_pick_folder() else {
        return Ok(None);
    };
    let path = picked.into_path()
        .map_err(|e| AppError::with_details("PATH_ERROR", "Invalid folder", &e.to_string()))?;
    let canonical = canonicalize(&path)
        .map_err(|e| AppError::with_details("PATH_ERROR", "Invalid folder", &e.to_string()))?;
    access.grant([&canonical]);
    Ok(Some(canonical.to_string_lossy().to_string()))
}

/// Native save dialog, then write `content` (UTF-8) where the user chose.
/// Returns the saved path, or `None` when cancelled.
#[tauri::command]
async fn export_file(
    app: AppHandle,
    default_name: String,
    content: String,
    filters: Option<Vec<FileFilter>>,
    title: Option<String>,
) -> Result<Option<String>, AppError> {
    let mut dialog = app.dialog().file()
        .set_file_name(&default_name)
        .set_title(title.as_deref().unwrap_or("Export"));
    for filter in filters.unwrap_or_default() {
        let extensions: Vec<&str> = filter.extensions.iter().map(String::as_str).collect();
        dialog = dialog.add_filter(&filter.name, &extensions);
    }

    let Some(picked) = dialog.blocking_save_file() else {
        return Ok(None);
    };
    let path = picked.into_path()
        .map_err(|e| AppError::with_details("PATH_ERROR", "Invalid path", &e.to_string()))?;

    atomic_write(&path, content.as_bytes())
        .map_err(|e| AppError::with_details("FILE_ERROR", "Failed to write file", &e.to_string()))?;
    Ok(Some(path.to_string_lossy().to_string()))
}

/// One-time carry-over of a session saved before the access list existed:
/// its folders, tabs and workspaces, plus the files in the history. Only works
/// while no access file has been written yet.
#[tauri::command]
async fn adopt_session_access(
    directories: Vec<String>,
    files: Vec<String>,
    access: State<'_, AccessState>,
) -> Result<(), AppError> {
    let mut pending = access.migration_pending.lock()
        .map_err(|_| AppError::new("STATE_ERROR", "Failed to access the access list"))?;
    if !*pending {
        return Ok(());
    }
    *pending = false;

    let history = get_history_file_path().ok()
        .and_then(|path| fs::read_to_string(path).ok())
        .unwrap_or_default();
    let history_files = history_link_destinations(&history);

    let paths: Vec<PathBuf> = directories.iter()
        .chain(files.iter())
        .chain(history_files.iter())
        .filter_map(|path| expand_path(path).ok())
        .collect();
    access.grant(&paths);

    // Write the file even when nothing was granted, so this never runs again
    if let Ok(list) = access.access.lock() {
        access.save(&list);
    }
    Ok(())
}

/// Link destinations in history.md (`- 12:34 [name](path)`), decoded.
fn history_link_destinations(history: &str) -> Vec<String> {
    history.lines()
        .filter_map(|line| {
            let line = line.trim_end().strip_suffix(')')?;
            let start = line.rfind("](")? + 2;
            Some(percent_decode(&line[start..]))
        })
        .collect()
}

#[tauri::command]
async fn get_file_info(path: String, access: State<'_, AccessState>) -> Result<serde_json::Value, AppError> {
    let expanded = expand_target(&path)?;
    access.check(&expanded, Use::Stat)?;
    
    let metadata = fs::metadata(&expanded.real)
        .map_err(|e| AppError::with_details("FILE_ERROR", "Failed to get metadata", &e.to_string()))?;
    
    Ok(serde_json::json!({
        "size": metadata.len(),
        "modified": metadata.modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs()),
        "isReadOnly": metadata.permissions().readonly(),
        "isDirectory": metadata.is_dir(),
    }))
}

#[tauri::command]
async fn start_watching(
    paths: Vec<String>,
    app_handle: AppHandle,
    state: State<'_, AppState>,
    access: State<'_, AccessState>,
) -> Result<(), AppError> {
    let mut watcher_guard = state.watcher.lock()
        .map_err(|_| AppError::new("STATE_ERROR", "Failed to access watcher"))?;
    let mut watched_paths = state.watched_paths.lock()
        .map_err(|_| AppError::new("STATE_ERROR", "Failed to access watched paths"))?;
    
    // Create new watcher
    let app_handle_clone = app_handle.clone();
    let watcher = RecommendedWatcher::new(
        move |res: Result<Event, notify::Error>| {
            if let Ok(event) = res {
                for path in event.paths {
                    if is_watch_noise(&path) {
                        continue;
                    }
                    if is_viewable_file(&path, true) || path.is_dir() {
                        let event_type = match event.kind {
                            notify::EventKind::Create(_) => "created",
                            notify::EventKind::Modify(_) => "modified",
                            notify::EventKind::Remove(_) => "removed",
                            _ => continue,
                        };
                        
                        let _ = app_handle_clone.emit("files-changed", FileChangeEvent {
                            event_type: event_type.to_string(),
                            path: path.to_string_lossy().to_string(),
                        });
                    }
                }
            }
        },
        NotifyConfig::default().with_poll_interval(Duration::from_millis(300)),
    ).map_err(|e| AppError::with_details("WATCHER_ERROR", "Failed to create file watcher", &e.to_string()))?;
    
    *watcher_guard = Some(watcher);
    watched_paths.clear();
    
    // Watch each path
    if let Some(ref mut w) = *watcher_guard {
        for path_str in paths {
            let Ok(target) = expand_target(&path_str) else { continue };
            if access.check(&target, Use::List).is_err() {
                continue;
            }
            if w.watch(&target.real, RecursiveMode::Recursive).is_ok() {
                watched_paths.insert(target.real);
            }
        }
    }
    
    Ok(())
}

#[tauri::command]
async fn stop_watching(state: State<'_, AppState>) -> Result<(), AppError> {
    let mut watcher_guard = state.watcher.lock()
        .map_err(|_| AppError::new("STATE_ERROR", "Failed to access watcher"))?;
    let mut watched_paths = state.watched_paths.lock()
        .map_err(|_| AppError::new("STATE_ERROR", "Failed to access watched paths"))?;

    *watcher_guard = None;
    watched_paths.clear();

    Ok(())
}

#[tauri::command]
async fn open_in_explorer(path: String, access: State<'_, AccessState>) -> Result<(), AppError> {
    let target = expand_target(&path)?;
    access.check(&target, Use::Stat)?;
    reveal_in_file_manager(&target.real)
}

/// Select `path` in Finder / Explorer; on Linux, open its folder.
fn reveal_in_file_manager(expanded: &Path) -> Result<(), AppError> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg("/select,")
            .arg(expanded)
            .spawn()
            .map_err(|e| AppError::with_details("SHELL_ERROR", "Failed to open explorer", &e.to_string()))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(expanded)
            .spawn()
            .map_err(|e| AppError::with_details("SHELL_ERROR", "Failed to open Finder", &e.to_string()))?;
    }

    #[cfg(target_os = "linux")]
    {
        // Open the parent directory (works on all Linux DEs)
        let target = if expanded.is_dir() {
            expanded
        } else {
            expanded.parent().unwrap_or(expanded)
        };
        std::process::Command::new("xdg-open")
            .arg(target)
            .spawn()
            .map_err(|e| AppError::with_details("SHELL_ERROR", "Failed to open file manager", &e.to_string()))?;
    }

    Ok(())
}

/// What the frontend does after `follow_local_link`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "lowercase")]
enum LinkOutcome {
    /// A document the app may now read: open it in a tab.
    Open,
    /// Shown in the file manager.
    Revealed,
    /// The user declined.
    Cancelled,
}

/// A click on a link to a local file. Documents open in the app, anything
/// else is shown in the file manager. A target outside what the user opened is
/// only followed after they confirm it in a native dialog, which a script in
/// the webview can't answer; a confirmed document is added to the access list.
#[tauri::command]
async fn follow_local_link(
    path: String,
    app: AppHandle,
    access: State<'_, AccessState>,
) -> Result<LinkOutcome, AppError> {
    let target = expand_target(&path)?;
    let document = target.real.is_file() && is_viewable_file(&target.real, true);
    let use_ = if document { Use::Open } else { Use::Stat };

    if access.check(&target, use_).is_err() {
        let reveal_label = if cfg!(target_os = "macos") {
            "Show in Finder"
        } else if cfg!(target_os = "windows") {
            "Show in Explorer"
        } else {
            "Show in Folder"
        };
        let (title, action) = if document {
            ("Open linked file?", "Open")
        } else {
            ("Show linked file?", reveal_label)
        };
        let mut dialog = app.dialog()
            .message(format!(
                "The document links to a file outside the folders and files you opened:\n\n{}",
                target.real.display()
            ))
            .title(title)
            .kind(MessageDialogKind::Warning)
            .buttons(MessageDialogButtons::OkCancelCustom(action.to_string(), "Cancel".to_string()));
        if let Some(window) = app.get_webview_window("main") {
            dialog = dialog.parent(&window);
        }
        if !dialog.blocking_show() {
            return Ok(LinkOutcome::Cancelled);
        }
        if document {
            access.grant([&target.real]);
        }
    }

    if document {
        Ok(LinkOutcome::Open)
    } else {
        reveal_in_file_manager(&target.real)?;
        Ok(LinkOutcome::Revealed)
    }
}

/// Open a web or mail link from a document in the default browser / mail app.
#[tauri::command]
async fn open_external(url: String, app: AppHandle) -> Result<(), AppError> {
    let parsed = tauri::Url::parse(&url)
        .map_err(|e| AppError::with_details("URL_ERROR", "Invalid link", &e.to_string()))?;
    if !matches!(parsed.scheme(), "http" | "https" | "mailto") {
        return Err(AppError::with_details("URL_ERROR", "Only web and mail links can be opened", &url));
    }
    app.opener()
        .open_url(parsed.as_str(), None::<&str>)
        .map_err(|e| AppError::with_details("SHELL_ERROR", "Failed to open link", &e.to_string()))
}

// ============================================================
// Agent workspace
// ============================================================

/// The agent files (instructions, memory, plans, skills) with their read
/// state. Empty while the workspace is off.
#[tauri::command]
async fn agent_workspace(access: State<'_, AccessState>) -> Result<agent::AgentWorkspace, AppError> {
    let (enabled, directories) = access.agent_scope();
    if !enabled {
        return Ok(agent::AgentWorkspace { enabled, entries: Vec::new() });
    }
    static PRUNED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
    let prune = !PRUNED.swap(true, std::sync::atomic::Ordering::Relaxed);
    let entries = tauri::async_runtime::spawn_blocking(move || {
        let entries = agent::scan(&directories);
        // Once per run: drop read state of files that are gone
        if prune {
            agent::prune_read_state(&entries);
        }
        entries
    })
        .await
        .map_err(|e| AppError::with_details("SCAN_ERROR", "Failed to list agent files", &e.to_string()))?;
    Ok(agent::AgentWorkspace { enabled, entries })
}

/// Turn the agent workspace on after the user confirms it in a native dialog
/// (the webview can't answer it). Returns whether it is on.
#[tauri::command]
async fn enable_agent_workspace(app: AppHandle, access: State<'_, AccessState>) -> Result<bool, AppError> {
    let locations = agent::found_locations();
    let found = if locations.is_empty() {
        "No agent folders were found yet. Agent files in the folders you open are still listed.".to_string()
    } else {
        format!("MDViewer will read the markdown files coding agents keep in:\n\n{}", locations.join("\n"))
    };
    let mut dialog = app.dialog()
        .message(format!(
            "{}\n\nThat is instructions (CLAUDE.md, AGENTS.md), memory, plans, skills, agents and commands. Settings, keys and session transcripts are not read.",
            found
        ))
        .title("Show agent files?")
        .kind(MessageDialogKind::Info)
        .buttons(MessageDialogButtons::OkCancelCustom("Show agent files".to_string(), "Cancel".to_string()));
    if let Some(window) = app.get_webview_window("main") {
        dialog = dialog.parent(&window);
    }
    if !dialog.blocking_show() {
        return Ok(false);
    }
    access.set_agent_workspace(true);
    let (_, directories) = access.agent_scope();
    // Everything there now counts as read: only later changes are highlighted
    tauri::async_runtime::spawn_blocking(move || agent::mark_all_read(&agent::scan(&directories)));
    Ok(true)
}

#[tauri::command]
fn disable_agent_workspace(access: State<'_, AccessState>) {
    access.set_agent_workspace(false);
}

/// The copy of a document kept when it was last read, for "what changed".
#[tauri::command]
fn read_snapshot(path: String, access: State<'_, AccessState>) -> Result<Option<agent::Snapshot>, AppError> {
    let target = expand_target(&path)?;
    access.check(&target, Use::Open)?;
    Ok(agent::load_snapshot(&path))
}

/// Remember documents as read, as they are now.
#[tauri::command]
async fn mark_read(paths: Vec<String>, access: State<'_, AccessState>) -> Result<(), AppError> {
    let mut allowed = Vec::new();
    for path in paths {
        let target = expand_target(&path)?;
        access.check(&target, Use::Open)?;
        allowed.push(path);
    }
    tauri::async_runtime::spawn_blocking(move || {
        allowed.iter().try_for_each(|path| agent::mark_read(path))
    })
    .await
    .map_err(|e| AppError::with_details("WRITE_ERROR", "Failed to save read state", &e.to_string()))?
}

// ============================================================
// Updates
// ============================================================

/// The update found by `check_for_update`, kept for `install_update`.
#[derive(Default)]
pub struct PendingUpdate(Mutex<Option<tauri_plugin_updater::Update>>);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    version: String,
    current_version: String,
    notes: Option<String>,
}

/// Ask the release server (`plugins.updater.endpoints` in tauri.conf.json)
/// for a newer version. `None` when this one is the latest.
#[tauri::command]
async fn check_for_update(app: AppHandle, pending: State<'_, PendingUpdate>) -> Result<Option<UpdateInfo>, AppError> {
    let update = app.updater()
        .map_err(|e| AppError::with_details("UPDATE_ERROR", "Updater unavailable", &e.to_string()))?
        .check()
        .await
        .map_err(|e| AppError::with_details("UPDATE_ERROR", "Could not check for updates", &e.to_string()))?;
    let info = update.as_ref().map(|update| UpdateInfo {
        version: update.version.clone(),
        current_version: update.current_version.clone(),
        notes: update.body.clone(),
    });
    *pending.0.lock().map_err(|_| AppError::new("STATE_ERROR", "Failed to store the update"))? = update;
    Ok(info)
}

/// Download the update found by `check_for_update`, verify its signature
/// against `plugins.updater.pubkey`, install it and restart.
#[tauri::command]
async fn install_update(app: AppHandle, pending: State<'_, PendingUpdate>) -> Result<(), AppError> {
    let update = pending.0.lock()
        .map_err(|_| AppError::new("STATE_ERROR", "Failed to read the update"))?
        .take()
        .ok_or_else(|| AppError::new("UPDATE_ERROR", "No update to install"))?;
    update.download_and_install(|_, _| {}, || {})
        .await
        .map_err(|e| AppError::with_details("UPDATE_ERROR", "Failed to install the update", &e.to_string()))?;
    app.restart()
}

// ============================================================
// Navigation Guard
// ============================================================

/// The app's own pages: `tauri://localhost` (macOS/Linux),
/// `http(s)://tauri.localhost` (Windows), the Vite dev server in debug builds.
fn is_app_url(url: &tauri::Url) -> bool {
    let (scheme, host) = (url.scheme(), url.host_str());
    matches!((scheme, host), ("tauri", Some("localhost")) | ("http" | "https", Some("tauri.localhost")))
        || (cfg!(debug_assertions) && scheme == "http" && host == Some("localhost"))
}

/// Keeps the window on the app: a link or script can't navigate it to a
/// remote page or a local file. Links are opened by the frontend instead.
fn navigation_guard<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("navigation-guard")
        .on_navigation(|_webview, url| {
            let allowed = is_app_url(url);
            if !allowed {
                eprintln!("Blocked navigation to {}", url);
            }
            allowed
        })
        .build()
}

// ============================================================
// Local File Protocol (for serving images in markdown)
// ============================================================

/// Largest image the `localfile://` protocol serves.
const MAX_IMAGE_SIZE: u64 = 50 * 1024 * 1024;

/// Decode `%XX` escapes (UTF-8). Invalid escapes are kept as they are.
fn percent_decode(input: &str) -> String {
    fn hex(b: u8) -> Option<u8> {
        (b as char).to_digit(16).map(|d| d as u8)
    }

    let bytes = input.as_bytes();
    let mut result = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(hi), Some(lo)) = (hex(bytes[i + 1]), hex(bytes[i + 2])) {
                result.push(hi << 4 | lo);
                i += 3;
                continue;
            }
        }
        result.push(bytes[i]);
        i += 1;
    }
    String::from_utf8(result).unwrap_or_else(|_| input.to_string())
}

fn image_mime(path: &Path) -> Option<&'static str> {
    let ext = path.extension()?.to_str()?.to_lowercase();
    Some(match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        "avif" => "image/avif",
        _ => return None,
    })
}

fn is_image_file(path: &Path) -> bool {
    image_mime(path).is_some()
}

/// Serve an image referenced by a document. The URL path is the
/// percent-encoded absolute file path (see `convertFileSrc` in the frontend):
/// `localfile://localhost/<path>` on macOS/Linux,
/// `http://localfile.localhost/<path>` on Windows.
fn serve_local_image(access: &AccessState, url_path: &str) -> HttpResponse<Vec<u8>> {
    let respond = |status: StatusCode, mime: &str, body: Vec<u8>| {
        HttpResponse::builder()
            .status(status)
            .header("Content-Type", mime)
            .header("X-Content-Type-Options", "nosniff")
            .body(body)
            .unwrap()
    };

    let decoded = percent_decode(url_path.trim_start_matches('/'));
    let Ok(target) = resolve_target(Path::new(&decoded)) else {
        return respond(StatusCode::NOT_FOUND, "text/plain", Vec::new());
    };
    if access.check(&target, Use::Image).is_err() {
        return respond(StatusCode::FORBIDDEN, "text/plain", Vec::new());
    }
    let path = target.real;
    let Some(mime) = image_mime(&path) else {
        return respond(StatusCode::FORBIDDEN, "text/plain", Vec::new());
    };
    match fs::metadata(&path) {
        Ok(metadata) if metadata.len() > MAX_IMAGE_SIZE => {
            return respond(StatusCode::PAYLOAD_TOO_LARGE, "text/plain", Vec::new());
        }
        Err(_) => return respond(StatusCode::NOT_FOUND, "text/plain", Vec::new()),
        _ => {}
    }
    match fs::read(&path) {
        Ok(data) => respond(StatusCode::OK, mime, data),
        Err(_) => respond(StatusCode::NOT_FOUND, "text/plain", Vec::new()),
    }
}

// ============================================================
// Main Entry Point
// ============================================================

/// Files/folders passed on the command line (e.g. "Open with" from a file
/// manager). Taken once by the frontend after it has restored the session.
#[derive(Default)]
pub struct LaunchPaths(Mutex<Vec<String>>);

/// Resolve command-line arguments to absolute paths, skipping flags.
/// Relative paths are resolved against `cwd` (the launching process' cwd).
fn resolve_cli_paths(args: &[String], cwd: &Path) -> Vec<String> {
    args.iter()
        .skip(1) // argv[0] is the executable
        .filter(|arg| !arg.starts_with('-'))
        .map(|arg| {
            let path = match arg.strip_prefix("file://") {
                Some(uri) => PathBuf::from(percent_decode(uri)),
                None => PathBuf::from(arg),
            };
            let path = if path.is_absolute() { path } else { cwd.join(path) };
            path.canonicalize().unwrap_or(path).to_string_lossy().to_string()
        })
        .collect()
}

#[tauri::command]
fn take_launch_paths(launch: State<'_, LaunchPaths>) -> Vec<String> {
    std::mem::take(&mut *launch.0.lock().unwrap())
}

/// Workaround for the torn / corrupted rendering seen on Raspberry Pi and other
/// ARM GL drivers: https://github.com/tauri-apps/tauri/issues/9289
///
/// WebKitGTK reads these on startup, so they have to be set before the webview
/// is created. Anything the user already exported wins, and setting
/// `MDVIEWER_ENABLE_DMABUF=1` opts back into the default WebKit renderer.
#[cfg(target_os = "linux")]
fn apply_linux_rendering_workarounds() {
    let dmabuf_forced_on = std::env::var_os("MDVIEWER_ENABLE_DMABUF").is_some();

    if !dmabuf_forced_on && std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }

    // Heavier fallback for GPUs where disabling DMA-BUF is not enough. Opt-in,
    // because turning off accelerated compositing also slows scrolling down.
    if std::env::var_os("MDVIEWER_DISABLE_COMPOSITING").is_some()
        && std::env::var_os("WEBKIT_DISABLE_COMPOSITING_MODE").is_none()
    {
        std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
    }
}

fn main() {
    #[cfg(target_os = "linux")]
    apply_linux_rendering_workarounds();

    let args: Vec<String> = std::env::args().collect();
    let cwd = std::env::current_dir().unwrap_or_default();
    let launch_paths = resolve_cli_paths(&args, &cwd);

    // Files the app was launched with were chosen by the user
    let access = AccessState::load();
    access.grant(&launch_paths);

    tauri::Builder::default()
        // Must be the first plugin: a second launch ("Open with" while the app
        // is already running) hands its files to this instance and exits.
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            let paths = resolve_cli_paths(&argv, Path::new(&cwd));
            app.state::<AccessState>().grant(&paths);
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
            if !paths.is_empty() {
                let _ = app.emit("open-paths", paths);
            }
        }))
        .manage(AppState::default())
        .manage(access)
        .manage(LaunchPaths(Mutex::new(launch_paths)))
        .manage(PendingUpdate::default())
        .plugin(tauri_plugin_dialog::init())
        // Used from Rust only (`check_for_update`, `install_update`)
        .plugin(tauri_plugin_updater::Builder::new().build())
        // Used from Rust only (`open_external`); no JS permissions are granted
        .plugin(tauri_plugin_opener::init())
        .plugin(navigation_guard())
        // Dropped files and folders were chosen by the user. Tauri runs this
        // listener in the same event-loop turn that queues the drop event for
        // the webview, so the paths are granted before the frontend sees them.
        .on_window_event(|window, event| {
            if let WindowEvent::DragDrop(DragDropEvent::Drop { paths, .. }) = event {
                window.state::<AccessState>().grant(paths);
            }
        })
        .register_uri_scheme_protocol("localfile", |ctx, request| {
            serve_local_image(&ctx.app_handle().state::<AccessState>(), request.uri().path())
        })
        .invoke_handler(tauri::generate_handler![
            scan_directories,
            read_file,
            write_file,
            pick_directory,
            export_file,
            adopt_session_access,
            get_file_info,
            start_watching,
            stop_watching,
            open_in_explorer,
            follow_local_link,
            open_external,
            check_for_update,
            install_update,
            get_history_path,
            read_history,
            append_to_history,
            clear_history,
            take_launch_paths,
            agent_workspace,
            enable_agent_workspace,
            disable_agent_workspace,
            read_snapshot,
            mark_read,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Fresh empty folder under the system temp dir.
    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("mdviewer-test-{}-{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        canonicalize(&dir).unwrap()
    }

    #[test]
    fn percent_decode_handles_trailing_escape_and_non_ascii() {
        assert_eq!(percent_decode("a%41"), "aA");
        assert_eq!(percent_decode("%2Ftmp%2Fx%20y.md"), "/tmp/x y.md");
        assert_eq!(percent_decode("%D0%BF%D1%80%D0%B8"), "при");
        // Used to panic: slicing into the middle of a multi-byte character
        assert_eq!(percent_decode("%Ж1"), "%Ж1");
        assert_eq!(percent_decode("100%"), "100%");
        assert_eq!(percent_decode("%4"), "%4");
        assert_eq!(percent_decode("%zz"), "%zz");
    }

    #[test]
    fn access_list_limits_reads_to_opened_folders_and_files() {
        let root = temp_dir("access");
        let docs = root.join("docs");
        let other = root.join("other");
        fs::create_dir_all(docs.join("img")).unwrap();
        fs::create_dir_all(&other).unwrap();
        for file in ["docs/a.md", "docs/.bashrc", "docs/id_rsa", "docs/img/p.png", "other/b.md", "other/c.md", "other/pic.png", "other/sub.png"] {
            fs::write(root.join(file), "x").unwrap();
        }

        let mut access = Access::default();
        assert!(access.grant(&docs));
        assert!(access.grant(&other.join("b.md")));

        assert!(access.can_open(&docs.join("a.md")));
        assert!(!access.can_open(&docs.join(".bashrc")), "dotfiles aren't documents");
        assert!(!access.can_open(&docs.join("id_rsa")), "keys aren't documents");
        assert!(access.can_open(&other.join("b.md")));
        assert!(!access.can_open(&other.join("c.md")), "only the opened file, not its siblings");
        assert!(!access.can_open(&root.join("docs-evil/a.md")), "prefix match is per component");

        assert!(access.can_list(&docs));
        assert!(!access.can_list(&other));

        assert!(access.can_read_image(&docs.join("img/p.png")));
        assert!(access.can_read_image(&other.join("pic.png")), "images next to an opened file");
        assert!(!access.can_read_image(&docs.join("a.md")), "not an image");

        // Opening the parent folder replaces what's inside it
        assert!(access.grant(&root));
        assert_eq!(access.directories, vec![root.clone()]);
        assert!(access.files.is_empty());
        assert!(!access.grant(&docs), "already covered");

        let _ = fs::remove_dir_all(&root);
    }

    #[cfg(unix)]
    #[test]
    fn symlinks_in_opened_folders_are_followed_to_documents_only() {
        use std::os::unix::fs::symlink;

        let root = temp_dir("symlinks");
        let docs = root.join("docs");
        let outside = root.join("outside");
        fs::create_dir_all(&docs).unwrap();
        fs::create_dir_all(outside.join("guide")).unwrap();
        for file in ["outside/notes.md", "outside/id_rsa", "outside/pic.png", "outside/guide/a.md"] {
            fs::write(root.join(file), "x").unwrap();
        }
        symlink(outside.join("notes.md"), docs.join("notes.md")).unwrap();
        symlink(outside.join("id_rsa"), docs.join("key.md")).unwrap();
        symlink(outside.join("pic.png"), docs.join("pic.png")).unwrap();
        symlink(outside.join("guide"), docs.join("guide")).unwrap();
        symlink(&docs, docs.join("loop")).unwrap();

        let state = AccessState {
            access: Mutex::new(Access::default()),
            file: None,
            migration_pending: Mutex::new(false),
        };
        state.grant([&docs]);
        let check = |path: PathBuf, use_| state.check(&resolve_target(&path).unwrap(), use_).is_ok();

        assert!(check(docs.join("notes.md"), Use::Open), "link to a document");
        assert!(check(docs.join("guide/a.md"), Use::Open), "document in a linked folder");
        assert!(check(docs.join("guide"), Use::List));
        assert!(check(docs.join("pic.png"), Use::Image));
        assert!(!check(docs.join("key.md"), Use::Open), "a .md name doesn't make a key a document");
        assert!(!check(outside.join("notes.md"), Use::Open), "the target itself isn't opened");
        assert!(!check(docs.join("guide/../notes.md"), Use::Open), "no `..` through a link");

        // A link back to the folder is listed once
        let mut visited = HashSet::new();
        let tree = scan_directory_recursive(&docs, 0, &mut 0, false, &mut visited).unwrap();
        let names: Vec<_> = tree.children.unwrap().iter().map(|c| c.name.clone()).collect();
        assert_eq!(names, ["guide", "notes.md"], "no link to a non-document, no loop");

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn atomic_write_replaces_content_and_keeps_permissions() {
        let dir = temp_dir("atomic");
        let file = dir.join("note.md");
        fs::write(&file, "old").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&file, fs::Permissions::from_mode(0o640)).unwrap();
        }

        atomic_write(&file, b"new").unwrap();

        assert_eq!(fs::read_to_string(&file).unwrap(), "new");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(fs::metadata(&file).unwrap().permissions().mode() & 0o777, 0o640);
        }
        let leftovers: Vec<_> = fs::read_dir(&dir).unwrap().filter_map(|e| e.ok()).map(|e| e.file_name()).collect();
        assert_eq!(leftovers, vec![std::ffi::OsString::from("note.md")], "no temp file left behind");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn history_links_survive_spaces_brackets_and_round_trip() {
        let path = "/Users/me/My Notes (old)/[draft] 100%.md";
        let entry = format!("- 10:00 [{}]({})", markdown_link_text("[draft] 100%.md"), markdown_link_destination(path));
        assert_eq!(
            entry,
            r"- 10:00 [\[draft\] 100\%\.md](/Users/me/My%20Notes%20%28old%29/%5Bdraft%5D%20100%25.md)"
        );
        assert_eq!(history_link_destinations(&entry), vec![path.to_string()]);
    }

    #[test]
    fn only_app_pages_are_navigable() {
        let url = |s: &str| tauri::Url::parse(s).unwrap();
        assert!(is_app_url(&url("tauri://localhost/index.html")));
        assert!(is_app_url(&url("http://tauri.localhost/")));
        assert!(is_app_url(&url("https://tauri.localhost/")));
        assert!(!is_app_url(&url("https://example.com/")));
        assert!(!is_app_url(&url("http://tauri.localhost.evil.com/")));
        assert!(!is_app_url(&url("file:///etc/passwd")));
        assert!(!is_app_url(&url("localfile://localhost/x.png")));
    }

    #[test]
    fn history_is_capped_and_newest_first_within_a_day() {
        let mut content = String::from("# History\n");
        for i in 0..5 {
            content = add_history_entry(&content, "2026-10-09", &format!("- old {}", i), 4);
        }
        content = add_history_entry(&content, "2026-10-10", "- new", 4);

        assert_eq!(
            content,
            "# History\n\n## 2026-10-09\n- old 4\n- old 3\n- old 2\n\n## 2026-10-10\n- new\n"
        );

        // A full day is dropped once its entries are gone
        for i in 0..3 {
            content = add_history_entry(&content, "2026-10-10", &format!("- newer {}", i), 4);
        }
        assert!(!content.contains("2026-10-09"));
    }
}
