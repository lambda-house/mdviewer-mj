use crate::{
    session_analysis::Grant, session_commands::SessionState, session_mcp::Service, AccessState,
};
use serde_json::Value;
use std::sync::Arc;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
#[derive(Default)]
pub struct AnalysisState(pub Arc<Service>);
#[tauri::command]
pub fn analysis_access(state: State<'_, AnalysisState>) -> Value {
    let mut status = state.0.status();
    status["executable"] = serde_json::json!(std::env::current_exe().ok());
    status
}
#[tauri::command]
pub fn revoke_analysis(state: State<'_, AnalysisState>) {
    state.0.revoke();
}
#[tauri::command]
pub async fn enable_analysis(
    app: AppHandle,
    grant: Grant,
    access: State<'_, AccessState>,
    state: State<'_, AnalysisState>,
    sessions: State<'_, SessionState>,
) -> Result<bool, String> {
    if !access
        .access
        .lock()
        .map_err(|_| "Access unavailable")?
        .session_workspace
    {
        return Err("Enable session access first".into());
    }
    if !grant.directory.is_empty()
        && (!std::path::Path::new(&grant.directory).is_absolute()
            || std::path::Path::new(&grant.directory)
                .components()
                .any(|c| matches!(c, std::path::Component::ParentDir)))
    {
        return Err("Choose an absolute directory without parent traversal".into());
    }
    let scope = if !grant.session.is_empty() {
        grant.session.clone()
    } else if !grant.directory.is_empty() {
        grant.directory.clone()
    } else {
        "All indexed sessions".into()
    };
    let confirmed=app.dialog().message(format!("Allow local MCP clients to query {scope}?\n\nDetailed transcript excerpts: {}. Clients can see models, usage, tool and skill activity, directory paths and ticket mentions. Other programs running as your user can connect to the private socket. Access lasts until you revoke it or close the app.",if grant.excerpts {"enabled"}else{"disabled"})).title("Share session analysis with local agents").buttons(MessageDialogButtons::OkCancel).blocking_show();
    if !confirmed {
        return Ok(false);
    }
    // Recheck after the dialog: revocation can happen while it is open.
    if !access
        .access
        .lock()
        .map_err(|_| "Access unavailable")?
        .session_workspace
    {
        return Err("Session access was revoked".into());
    }
    let path = crate::get_config_dir()
        .map_err(|e| e.message)?
        .join("analysis/mcp.sock");
    state.0.start(&path, sessions.index.clone())?;
    *state.0.grant.lock().map_err(|_| "Grant unavailable")? = Grant {
        enabled: true,
        ..grant
    };
    Ok(true)
}
#[tauri::command]
pub async fn run_session_analysis(
    name: String,
    arguments: Value,
    state: State<'_, AnalysisState>,
    sessions: State<'_, SessionState>,
) -> Result<Value, String> {
    let service = state.0.clone();
    let index = sessions.index.clone();
    tauri::async_runtime::spawn_blocking(move || service.call(&index, "MDViewer", &name, arguments))
        .await
        .map_err(|e| e.to_string())?
}
pub fn start_scanner(app: AppHandle) {
    // One app-owned index, also used by the workspace. No ingestion in the stdio bridge.
    std::thread::spawn(move || loop {
        let service = app.state::<AnalysisState>();
        let grant = service.0.grant.lock().expect("Analysis grant lock");
        if grant.enabled {
            if let (Some(home), Ok(config)) = (dirs::home_dir(), crate::get_config_dir()) {
                if let Ok(mut index) = app.state::<SessionState>().index.lock() {
                    match index.open_cache(&config.join("sessions/index.sqlite")) {
                        Ok(()) => {
                            let scan = index.scan(&home, None);
                            service.0.ingestion_error(scan.errors.first().cloned());
                        }
                        Err(e) => service.0.ingestion_error(Some(e)),
                    }
                }
            }
        }
        drop(grant);
        std::thread::sleep(std::time::Duration::from_secs(2));
    });
}
