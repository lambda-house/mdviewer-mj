// MDViewer - Tauri Backend
// Handles file system operations, watching, and configuration

#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use notify::{Config as NotifyConfig, RecommendedWatcher, RecursiveMode, Watcher, Event};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri::http::Response as HttpResponse;

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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub directories: Vec<String>,
    pub theme: String,
    pub zoom: u32,
    pub panel_width: u32,
    pub toc_visible: bool,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            directories: vec![],
            theme: "intellij-dark".to_string(),
            zoom: 100,
            panel_width: 280,
            toc_visible: true,
        }
    }
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

pub struct AppState {
    pub config: Arc<Mutex<AppConfig>>,
    pub file_cache: Arc<Mutex<HashMap<String, String>>>,
    pub watcher: Arc<Mutex<Option<RecommendedWatcher>>>,
    pub watched_paths: Arc<Mutex<HashSet<PathBuf>>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            config: Arc::new(Mutex::new(AppConfig::default())),
            file_cache: Arc::new(Mutex::new(HashMap::new())),
            watcher: Arc::new(Mutex::new(None)),
            watched_paths: Arc::new(Mutex::new(HashSet::new())),
        }
    }
}

// ============================================================
// Security: Path Validation
// ============================================================

const FORBIDDEN_PATHS: &[&str] = &[
    "/etc", "/sys", "/proc", "/dev", "/boot", "/root",
    "/var/log", "/var/run", "/tmp",
    "C:\\Windows", "C:\\Program Files", "C:\\ProgramData",
];

const MAX_SCAN_DEPTH: usize = 10;
const MAX_FILES_PER_DIRECTORY: usize = 10000;

fn is_path_allowed(path: &Path) -> bool {
    let path_str = path.to_string_lossy().to_lowercase();
    
    for forbidden in FORBIDDEN_PATHS {
        if path_str.starts_with(&forbidden.to_lowercase()) {
            return false;
        }
    }
    
    true
}

fn expand_path(path_str: &str) -> Result<PathBuf, AppError> {
    let path = if path_str.starts_with("~/") {
        let home = dirs::home_dir()
            .ok_or_else(|| AppError::new("PATH_ERROR", "Cannot determine home directory"))?;
        home.join(&path_str[2..])
    } else if path_str.starts_with('~') {
        return Err(AppError::new("PATH_ERROR", "~user syntax not supported"));
    } else {
        PathBuf::from(path_str)
    };
    
    // Canonicalize to resolve .. and symlinks
    let canonical = path.canonicalize().map_err(|e| {
        AppError::with_details("PATH_ERROR", "Invalid path", &e.to_string())
    })?;
    
    // Security check
    if !is_path_allowed(&canonical) {
        return Err(AppError::new("ACCESS_DENIED", "Access to this path is not allowed"));
    }
    
    Ok(canonical)
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

fn scan_directory_recursive(
    dir_path: &Path,
    depth: usize,
    file_count: &mut usize,
    include_text: bool,
) -> Option<FileNode> {
    if depth > MAX_SCAN_DEPTH || *file_count > MAX_FILES_PER_DIRECTORY {
        return None;
    }
    
    if !dir_path.is_dir() {
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
            if let Some(child) = scan_directory_recursive(&entry_path, depth + 1, file_count, include_text) {
                children.push(child);
            }
        } else if is_viewable_file(&entry_path, include_text) {
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
async fn append_to_history(file_path: String, file_name: String) -> Result<(), AppError> {
    let history_path = ensure_history_dir()?;

    // Get current date
    let now = chrono::Local::now();
    let date_str = now.format("%Y-%m-%d").to_string();
    let time_str = now.format("%H:%M").to_string();

    // Read existing content or start fresh
    let mut content = if history_path.exists() {
        fs::read_to_string(&history_path).unwrap_or_default()
    } else {
        String::from("# History\n\n")
    };

    // Check if we need to add a date header
    let date_header = format!("## {}\n", date_str);
    if !content.contains(&date_header) {
        // Add date header
        content.push_str(&format!("\n{}", date_header));
    }

    // Format the new entry
    let entry = format!("- {} [{}]({})\n", time_str, file_name, file_path);

    // Find the position right after the date header and insert the new entry there
    if let Some(pos) = content.find(&date_header) {
        let insert_pos = pos + date_header.len();
        content.insert_str(insert_pos, &entry);
    } else {
        // Fallback: append at end
        content.push_str(&entry);
    }

    fs::write(&history_path, &content)
        .map_err(|e| AppError::with_details("FILE_ERROR", "Failed to write history", &e.to_string()))
}

#[tauri::command]
async fn clear_history() -> Result<(), AppError> {
    let history_path = ensure_history_dir()?;
    let content = "# History\n\nHistory cleared.\n";

    fs::write(&history_path, content)
        .map_err(|e| AppError::with_details("FILE_ERROR", "Failed to clear history", &e.to_string()))
}

#[tauri::command]
async fn scan_directories(
    paths: Vec<String>,
    include_text_files: Option<bool>,
) -> Result<Vec<FileNode>, AppError> {
    let include_text = include_text_files.unwrap_or(false);
    let mut results = Vec::new();
    
    for path_str in paths {
        let expanded_path = match expand_path(&path_str) {
            Ok(p) => p,
            Err(e) => {
                eprintln!("Skipping invalid path '{}': {}", path_str, e.message);
                continue;
            }
        };
        
        if expanded_path.exists() {
            let mut file_count = 0;
            if let Some(node) = scan_directory_recursive(&expanded_path, 0, &mut file_count, include_text) {
                results.push(node);
            }
        }
    }
    
    Ok(results)
}

#[tauri::command]
async fn read_file(path: String) -> Result<String, AppError> {
    let expanded = expand_path(&path)?;
    
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

/// Expand path for write operations (file may not exist yet)
fn expand_path_for_write(path_str: &str) -> Result<PathBuf, AppError> {
    let path = if path_str.starts_with("~/") {
        let home = dirs::home_dir()
            .ok_or_else(|| AppError::new("PATH_ERROR", "Cannot determine home directory"))?;
        home.join(&path_str[2..])
    } else if path_str.starts_with('~') {
        return Err(AppError::new("PATH_ERROR", "~user syntax not supported"));
    } else {
        PathBuf::from(path_str)
    };

    // For new files, check that parent directory exists and is allowed
    let parent = path.parent()
        .ok_or_else(|| AppError::new("PATH_ERROR", "Invalid path: no parent directory"))?;

    let canonical_parent = parent.canonicalize().map_err(|e| {
        AppError::with_details("PATH_ERROR", "Parent directory does not exist", &e.to_string())
    })?;

    // Security check on parent directory
    if !is_path_allowed(&canonical_parent) {
        return Err(AppError::new("ACCESS_DENIED", "Access to this path is not allowed"));
    }

    // Return the full path with canonical parent + filename
    let file_name = path.file_name()
        .ok_or_else(|| AppError::new("PATH_ERROR", "Invalid path: no filename"))?;

    Ok(canonical_parent.join(file_name))
}

#[tauri::command]
async fn write_file(path: String, content: String) -> Result<(), AppError> {
    let expanded = expand_path_for_write(&path)?;

    let previous = if expanded.exists() { fs::read(&expanded).ok() } else { None };
    let bytes = encode_text(&content, previous.as_deref())?;

    // Create backup before overwriting existing file ("notes.md" -> "notes.md.backup")
    if previous.is_some() {
        let mut backup_name = expanded.file_name().unwrap_or_default().to_os_string();
        backup_name.push(".backup");
        let _ = fs::copy(&expanded, expanded.with_file_name(backup_name));
    }

    fs::write(&expanded, &bytes)
        .map_err(|e| AppError::with_details("FILE_ERROR", "Failed to write file", &e.to_string()))
}

#[tauri::command]
async fn get_file_info(path: String) -> Result<serde_json::Value, AppError> {
    let expanded = expand_path(&path)?;
    
    let metadata = fs::metadata(&expanded)
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
async fn load_config(state: State<'_, AppState>) -> Result<AppConfig, AppError> {
    let config = state.config.lock()
        .map_err(|_| AppError::new("STATE_ERROR", "Failed to access configuration"))?;
    Ok(config.clone())
}

#[tauri::command]
async fn save_config(config: AppConfig, state: State<'_, AppState>) -> Result<(), AppError> {
    let mut current_config = state.config.lock()
        .map_err(|_| AppError::new("STATE_ERROR", "Failed to access configuration"))?;
    *current_config = config;
    Ok(())
}

#[tauri::command]
async fn start_watching(
    paths: Vec<String>,
    app_handle: AppHandle,
    state: State<'_, AppState>,
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
    
    // Watch each path
    if let Some(ref mut w) = *watcher_guard {
        for path_str in paths {
            if let Ok(expanded) = expand_path(&path_str) {
                if w.watch(&expanded, RecursiveMode::Recursive).is_ok() {
                    watched_paths.insert(expanded);
                }
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
async fn open_in_explorer(path: String) -> Result<(), AppError> {
    let expanded = expand_path(&path)?;

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg("/select,")
            .arg(&expanded)
            .spawn()
            .map_err(|e| AppError::with_details("SHELL_ERROR", "Failed to open explorer", &e.to_string()))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(&expanded)
            .spawn()
            .map_err(|e| AppError::with_details("SHELL_ERROR", "Failed to open Finder", &e.to_string()))?;
    }

    #[cfg(target_os = "linux")]
    {
        // Open the parent directory (works on all Linux DEs)
        let target = if expanded.is_dir() {
            expanded.clone()
        } else {
            expanded.parent().unwrap_or(&expanded).to_path_buf()
        };
        std::process::Command::new("xdg-open")
            .arg(&target)
            .spawn()
            .map_err(|e| AppError::with_details("SHELL_ERROR", "Failed to open file manager", &e.to_string()))?;
    }

    Ok(())
}

// ============================================================
// Local File Protocol (for serving images in markdown)
// ============================================================

fn percent_decode(input: &str) -> String {
    let mut result = Vec::new();
    let bytes = input.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(byte) = u8::from_str_radix(
                &input[i + 1..i + 3],
                16,
            ) {
                result.push(byte);
                i += 3;
                continue;
            }
        }
        result.push(bytes[i]);
        i += 1;
    }
    String::from_utf8(result).unwrap_or_else(|_| input.to_string())
}

fn guess_mime(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase().as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        "avif" => "image/avif",
        "pdf" => "application/pdf",
        _ => "application/octet-stream",
    }
}

// ============================================================
// Main Entry Point
// ============================================================

/// Workaround for the torn / corrupted rendering seen on Raspberry Pi and other
/// ARM GL drivers: https://github.com/tauri-apps/tauri/issues/9289
///
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

    tauri::Builder::default()
        // Must be the first plugin: a second launch ("Open with" while the app
        // is already running) hands its files to this instance and exits.
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            let paths = resolve_cli_paths(&argv, Path::new(&cwd));
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
            if !paths.is_empty() {
                let _ = app.emit("open-paths", paths);
            }
        }))
        .manage(AppState::default())
        .manage(LaunchPaths(Mutex::new(launch_paths)))
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .register_uri_scheme_protocol("localfile", |_app, request| {
            let uri = request.uri().to_string();
            // URI format: localfile://localhost/<encoded-path>
            let path_str = uri
                .strip_prefix("localfile://localhost/")
                .or_else(|| uri.strip_prefix("localfile:///"))
                .unwrap_or("");
            let decoded = percent_decode(path_str);
            let path = PathBuf::from(&decoded);

            match fs::read(&path) {
                Ok(data) => {
                    let mime = guess_mime(&path);
                    HttpResponse::builder()
                        .header("Content-Type", mime)
                        .header("Access-Control-Allow-Origin", "*")
                        .status(200)
                        .body(data)
                        .unwrap()
                }
                Err(_) => {
                    HttpResponse::builder()
                        .status(404)
                        .body(Vec::new())
                        .unwrap()
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            scan_directories,
            read_file,
            write_file,
            get_file_info,
            load_config,
            save_config,
            start_watching,
            stop_watching,
            open_in_explorer,
            get_history_path,
            read_history,
            append_to_history,
            clear_history,
            take_launch_paths,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
