//! Read-only extraction using the same index as the desktop workspace.
#[allow(dead_code)]
#[path = "../src/session_db.rs"]
mod session_db;
#[allow(dead_code)]
#[path = "../src/sessions.rs"]
mod sessions;
fn main() {
    let home = std::env::args()
        .nth(3)
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| dirs::home_dir().expect("home directory"));
    let mut index = sessions::Index::default();
    if let Some(cache) = std::env::args().nth(2) {
        index
            .open_cache(std::path::Path::new(&cache))
            .expect("open SQLite index");
    }
    let mut snapshot = index.scan(&home, None);
    let batches = std::env::args()
        .nth(1)
        .and_then(|s| s.parse::<usize>().ok())
        .unwrap_or(1000);
    for _ in 0..batches {
        if snapshot.pending_files == 0 {
            break;
        }
        eprintln!(
            "{} sessions indexed, {} files pending",
            snapshot.sessions.len(),
            snapshot.pending_files
        );
        snapshot = index.scan(&home, None);
    }
    // Exercise the detail path as well as summaries without exporting message text.
    if let Some(s) = snapshot.sessions.first() {
        if let Ok(path) = index.source(&s.provider, &s.id) {
            let _ = sessions::events_before(&path, &s.provider, 1);
        }
        let _ = index.detail(&s.provider, &s.id);
    }
    println!(
        "{}",
        serde_json::to_string(&snapshot).expect("serialize snapshot")
    );
}
