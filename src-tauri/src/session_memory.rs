//! Read-only memory discovery. Every file read is revalidated against fixed memory locations.
use crate::{session_db::Database, sessions::Session};
use serde::Serialize;
use std::{
    collections::BTreeSet,
    fs,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};
const LIMIT: u64 = 1024 * 1024;
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryItem {
    pub key: String,
    pub title: String,
    pub provider: String,
    pub scope: String,
    pub path: String,
    pub modified: u64,
    pub description: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Catalog {
    pub entries: Vec<MemoryItem>,
    pub notes: Vec<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryDocument {
    pub title: String,
    pub content: String,
    pub provenance: String,
    pub note: String,
}
fn regular(path: &Path, root: &Path) -> bool {
    path.starts_with(root)
        && path
            .ancestors()
            .take_while(|p| p.starts_with(root))
            .all(|p| fs::symlink_metadata(p).is_ok_and(|m| !m.file_type().is_symlink()))
        && path.is_file()
}
fn add_file(
    out: &mut Vec<MemoryItem>,
    path: &Path,
    root: &Path,
    provider: &str,
    scope: &str,
    description: &str,
) {
    if !regular(path, root) || out.len() >= 1000 || !path.extension().is_some_and(|e| e == "md") {
        return;
    }
    let modified = path
        .metadata()
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let path = path.to_string_lossy().to_string();
    if out.iter().any(|e| e.key == path) {
        return;
    }
    out.push(MemoryItem {
        key: path.clone(),
        title: Path::new(&path)
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into(),
        provider: provider.into(),
        scope: scope.into(),
        path,
        modified,
        description: description.into(),
    });
}
fn tree(
    out: &mut Vec<MemoryItem>,
    dir: &Path,
    root: &Path,
    provider: &str,
    scope: &str,
    description: &str,
    depth: u8,
) {
    if depth == 0
        || out.len() >= 1000
        || fs::symlink_metadata(dir).is_ok_and(|m| m.file_type().is_symlink())
    {
        return;
    }
    if let Ok(entries) = fs::read_dir(dir) {
        for e in entries.flatten() {
            let p = e.path();
            if e.file_type().is_ok_and(|t| t.is_dir()) {
                tree(out, &p, root, provider, scope, description, depth - 1);
            } else {
                add_file(out, &p, root, provider, scope, description);
            }
        }
    }
}
fn codex_db(home: &Path) -> Result<(Database, String), String> {
    let path = home.join(".codex/memories_1.sqlite");
    if !regular(&path, home) {
        return Err("No readable Codex memory database found".into());
    }
    match Database::open(&path,true,false).and_then(|mut db|{db.rows("SELECT thread_id FROM stage1_outputs LIMIT 1",&[])?;Ok(db)}) {
        Ok(db)=>Ok((db,String::new())),
        Err(_)=>Database::open(&path,true,true).map(|db|(db,"Checkpointed Codex memory only: the live WAL could not be opened read-only. Recent uncheckpointed records may be absent.".into()))
    }
}
pub fn catalog(home: &Path, session: Option<&Session>) -> Catalog {
    let mut entries = vec![];
    let mut notes = vec![];
    for (provider, dir, instructions) in [
        ("claude", ".claude", "CLAUDE.md"),
        ("codex", ".codex", "AGENTS.md"),
    ] {
        let root = home.join(dir);
        add_file(
            &mut entries,
            &root.join(instructions),
            &root,
            provider,
            "user",
            "User-wide instructions; shared by sessions, not a session snapshot.",
        );
        for name in ["memory", "memories"] {
            tree(
                &mut entries,
                &root.join(name),
                &root,
                provider,
                "user",
                "User-wide memory files; current contents.",
                4,
            );
        }
    }
    if let Some(s) = session {
        let mut dirs = s.directories.clone();
        dirs.insert(s.cwd.clone());
        // Claude's transcript project folder is authoritative, including worktree sessions.
        if s.provider == "claude" {
            let source = Path::new(&s.source);
            let root = home.join(".claude/projects");
            if let Ok(relative) = source.strip_prefix(&root) {
                if let Some(project) = relative.components().next() {
                    tree(&mut entries,&root.join(project.as_os_str()).join("memory"),home,"claude","project","Shared project memory associated with this transcript; not private to this session.",3);
                }
            }
        }
        let mut seen = BTreeSet::new();
        for cwd in dirs {
            let dir = Path::new(&cwd);
            // Limit instruction traversal to ancestors in the user's home and a known repository boundary.
            for ancestor in dir.ancestors().take_while(|p| p.starts_with(home)) {
                if !seen.insert(ancestor.to_path_buf()) {
                    continue;
                }
                for (provider, file) in [("claude", "CLAUDE.md"), ("codex", "AGENTS.md")] {
                    add_file(&mut entries,&ancestor.join(file),home,provider,"project","Instructions from the session's recorded directory or ancestors; current contents.");
                }
                for (provider, sub) in [("claude", ".claude/memory"), ("codex", ".codex/memories")]
                {
                    tree(
                        &mut entries,
                        &ancestor.join(sub),
                        home,
                        provider,
                        "project",
                        "Shared memory associated with a recorded session directory.",
                        3,
                    );
                }
                if ancestor.join(".git").exists() {
                    break;
                }
            }
        }
        if s.provider == "codex" {
            match codex_db(home).and_then(|(mut db,note)|{let rows=db.rows("SELECT thread_id,COALESCE(rollout_slug,''),generated_at FROM stage1_outputs WHERE thread_id=?1",&[&s.id])?;Ok((rows,note))}) {
                Ok((rows,note))=>{if !note.is_empty(){notes.push(note);}for row in rows {entries.push(MemoryItem{key:format!("codex-memory:{}",row[0]),title:if row[1].is_empty(){"Codex session memory".into()}else{row[1].clone()},provider:"codex".into(),scope:"session".into(),path:home.join(".codex/memories_1.sqlite").to_string_lossy().into(),modified:row[2].parse::<u64>().unwrap_or(0)*1000,description:"Codex stage1 memory and rollout summary explicitly linked by thread_id.".into()});}}
                Err(e)=>notes.push(e)
            }
        }
        entries.push(MemoryItem{key:"transcript-memory".into(),title:"Session memory and compaction context".into(),provider:s.provider.clone(),scope:"session".into(),path:s.source.clone(),modified:s.modified,description:"Recorded memory-tool calls and compaction summaries in this session. Their presence does not prove a memory write succeeded.".into()});
    } else {
        notes.push("Select a session to see its project memory, Codex thread-linked memory and recorded compaction context.".into());
    }
    if entries.len() >= 1000 {
        notes.push("Memory listing limited to 1,000 files.".into());
    }
    Catalog { entries, notes }
}
pub fn read(home: &Path, session: Option<&Session>, key: &str) -> Result<MemoryDocument, String> {
    let c = catalog(home, session);
    let item = c
        .entries
        .iter()
        .find(|e| e.key == key)
        .ok_or("Memory is not in the permitted catalog")?;
    if key.starts_with("codex-memory:") {
        let s = session.ok_or("Select a session")?;
        let (mut db, note) = codex_db(home)?;
        let rows=db.rows("SELECT substr(raw_memory,1,524288),substr(rollout_summary,1,524288) FROM stage1_outputs WHERE thread_id=?1",&[&s.id])?;
        let row = rows.first().ok_or("No memory recorded for this session")?;
        return Ok(MemoryDocument {
            title: item.title.clone(),
            content: format!(
                "# Extracted memory\n\n{}\n\n# Rollout summary\n\n{}",
                row[0], row[1]
            ),
            provenance: format!("{} · stage1_outputs.thread_id = {}", item.path, s.id),
            note: format!("{note} Fields are limited to 524,288 characters each."),
        });
    }
    if key == "transcript-memory" {
        return Err("Transcript memory is read from the session index".into());
    }
    let path = PathBuf::from(&item.path);
    if path.metadata().map_err(|e| e.to_string())?.len() > LIMIT {
        return Err("Memory document exceeds 1 MiB".into());
    }
    use std::io::Read;
    let mut content = String::new();
    fs::File::open(&path)
        .map_err(|e| e.to_string())?
        .take(LIMIT + 1)
        .read_to_string(&mut content)
        .map_err(|e| e.to_string())?;
    if content.len() as u64 > LIMIT {
        return Err("Memory document exceeds 1 MiB".into());
    }
    Ok(MemoryDocument {
        title: item.title.clone(),
        content,
        provenance: item.path.clone(),
        note: item.description.clone(),
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn codex_memory_is_matched_to_the_selected_thread() {
        let home = std::env::temp_dir().join(format!("mdviewer-memory-db-{}", std::process::id()));
        fs::create_dir_all(home.join(".codex")).unwrap();
        let mut db = Database::open(&home.join(".codex/memories_1.sqlite"), false, false).unwrap();
        db.batch("CREATE TABLE stage1_outputs(thread_id TEXT, raw_memory TEXT, rollout_summary TEXT, rollout_slug TEXT, generated_at INTEGER);
            INSERT INTO stage1_outputs VALUES('selected','remember selected','selected summary','selected rollout',100),('other','other memory','other summary','other rollout',200);").unwrap();
        let mut session = Session::default();
        session.id = "selected".into();
        session.provider = "codex".into();
        let c = catalog(&home, Some(&session));
        let memories: Vec<_> = c
            .entries
            .iter()
            .filter(|e| e.key.starts_with("codex-memory:"))
            .collect();
        assert_eq!(memories.len(), 1);
        assert_eq!(memories[0].scope, "session");
        let document = read(&home, Some(&session), &memories[0].key).unwrap();
        assert!(document.content.contains("remember selected"));
        assert!(!document.content.contains("other memory"));
        assert!(read(&home, Some(&session), "codex-memory:other").is_err());
        assert!(!catalog(&home, None)
            .entries
            .iter()
            .any(|e| e.scope == "session"));
        drop(db);
        fs::remove_dir_all(home).unwrap();
    }
    #[test]
    fn arbitrary_files_are_not_memory() {
        let home = std::env::temp_dir().join(format!("mdviewer-memory-{}", std::process::id()));
        fs::create_dir_all(home.join(".claude")).unwrap();
        fs::write(home.join(".claude/CLAUDE.md"), "user instructions").unwrap();
        fs::write(home.join(".claude/auth.md"), "not memory").unwrap();
        let c = catalog(&home, None);
        assert_eq!(c.entries.len(), 1);
        assert!(read(&home, None, home.join(".claude/auth.md").to_str().unwrap()).is_err());
        assert_eq!(
            read(&home, None, &c.entries[0].key).unwrap().content,
            "user instructions"
        );
        fs::remove_dir_all(home).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn memory_symlinks_are_not_followed() {
        let home =
            std::env::temp_dir().join(format!("mdviewer-memory-links-{}", std::process::id()));
        fs::create_dir_all(home.join(".claude")).unwrap();
        fs::write(home.join("secret.md"), "secret").unwrap();
        std::os::unix::fs::symlink(home.join("secret.md"), home.join(".claude/CLAUDE.md")).unwrap();
        assert!(catalog(&home, None).entries.is_empty());
        fs::remove_dir_all(home).unwrap();
    }
}
