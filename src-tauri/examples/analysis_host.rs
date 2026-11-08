//! Validation host: same service, SQLite and stdio bridge, with a socket pair instead of a GUI listener.
//! Only explicitly supplied transcript HOME and cache paths are read. Not a production daemon.
#[allow(dead_code)]
#[path = "../src/session_analysis.rs"]
mod session_analysis;
#[allow(dead_code)]
#[path = "../src/session_db.rs"]
mod session_db;
#[allow(dead_code)]
#[path = "../src/session_mcp.rs"]
mod session_mcp;
#[allow(dead_code)]
#[path = "../src/sessions.rs"]
mod sessions;
#[cfg(unix)]
fn main() {
    use std::{
        path::PathBuf,
        sync::{Arc, Mutex},
    };
    let args: Vec<_> = std::env::args().collect();
    assert_eq!(args.len(), 3, "analysis_host TRANSCRIPT_HOME CACHE_PATH");
    let home = PathBuf::from(&args[1]);
    let mut index = sessions::Index::default();
    index.open_cache(std::path::Path::new(&args[2])).unwrap();
    let mut bytes = 0;
    for batch in 0..1000 {
        let scan = index.scan(&home, None);
        bytes += scan.bytes_read;
        if !scan.errors.is_empty() {
            panic!("Index errors: {:?}", scan.errors);
        }
        if scan.pending_files == 0 {
            break;
        }
        assert!(batch < 999, "Ingestion did not finish");
    }
    eprintln!(
        "Validation index: {} sessions, {bytes} transcript bytes read",
        index.summaries().len()
    );
    let index = Arc::new(Mutex::new(index));
    let service = Arc::new(session_mcp::Service::default());
    *service.grant.lock().unwrap() = session_analysis::Grant {
        enabled: true,
        excerpts: true,
        ..Default::default()
    };
    let (client, server) = std::os::unix::net::UnixStream::pair().unwrap();
    std::thread::spawn(move || service.serve_stream(server, index, 1));
    session_mcp::bridge_stream(client).unwrap();
}
#[cfg(not(unix))]
fn main() {
    panic!("Validation host requires Unix sockets");
}
