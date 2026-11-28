//! Port of hooks/use-app-update.ts + components/providers/app-update-context.tsx
//! (read-only part): ask the same manifest the Tauri updater uses
//! (`plugins.updater.endpoints` in src-tauri/tauri.conf.json) for the latest
//! release and publish the result as the `rexa_core::update::UpdateState`
//! global (read by the connections-home update pill and Settings → Advanced).
//! Downloading / installing is not ported: the native build is not shipped
//! through the Tauri updater.

use gpui::App;
use rexa_core::update::UpdateState;
use std::time::Duration;

/// `tauri.conf.json` → `plugins.updater.endpoints[0]`.
pub const UPDATE_ENDPOINT: &str = "https://github.com/RexaDB/RexaDB/releases/latest/download/latest.json";
/// The bound on every check (CHECK_TIMEOUT_MS).
const CHECK_TIMEOUT: Duration = Duration::from_secs(15);
pub const DISMISSED_KEY: &str = "rexa-db-dismissed-update";

/// The app's version (`getVersion()`), from src-tauri/tauri.conf.json.
pub fn app_version() -> String {
    let conf: serde_json::Value = serde_json::from_str(include_str!("../../../../src-tauri/tauri.conf.json")).unwrap_or_default();
    conf.get("version").and_then(|v| v.as_str()).unwrap_or_default().to_string()
}

/// Semver-ish comparison of dotted numeric versions (pre-release suffixes ignored).
pub fn is_newer(latest: &str, current: &str) -> bool {
    let parse = |v: &str| -> Vec<u64> {
        v.trim_start_matches('v').split(['-', '+']).next().unwrap_or("").split('.').map(|p| p.parse().unwrap_or(0)).collect()
    };
    let (a, b) = (parse(latest), parse(current));
    for i in 0..a.len().max(b.len()) {
        let (x, y) = (a.get(i).copied().unwrap_or(0), b.get(i).copied().unwrap_or(0));
        if x != y {
            return x > y;
        }
    }
    false
}

fn dismissed_version() -> Option<String> {
    let raw = crate::persist::local_get(DISMISSED_KEY)?;
    match serde_json::from_str::<serde_json::Value>(&raw).ok()? {
        serde_json::Value::String(s) => Some(s),
        _ => None,
    }
}

/// isUpdateDismissed.
fn refresh_dismissed(state: &mut UpdateState) {
    state.dismissed = matches!((dismissed_version(), &state.latest_version), (Some(d), Some(l)) if &d == l);
}

pub fn state(cx: &App) -> UpdateState {
    cx.try_global::<UpdateState>().cloned().unwrap_or_default()
}

fn set_state(cx: &mut App, f: impl FnOnce(&mut UpdateState)) {
    let mut s = state(cx);
    f(&mut s);
    refresh_dismissed(&mut s);
    cx.set_global(s);
    cx.refresh_windows();
}

/// The provider's mount: version, then an automatic check unless the user
/// turned "Check for Updates Automatically" off.
pub fn init(cx: &mut App) {
    let version = app_version();
    set_state(cx, |s| s.current_version = version);
    if crate::persist::read_switch(crate::model::AUTO_UPDATE_CHECKS_STORAGE_KEY, true)
        && std::env::var("REXA_NO_UPDATE_CHECK").is_err()
    {
        check_for_updates(cx);
    }
}

#[derive(serde::Deserialize)]
struct Manifest {
    version: String,
    #[serde(default)]
    pub_date: Option<String>,
}

async fn fetch_manifest() -> anyhow::Result<Manifest> {
    let client = reqwest::Client::builder().timeout(CHECK_TIMEOUT).user_agent("RexaDB").build()?;
    let resp = client.get(UPDATE_ENDPOINT).send().await?.error_for_status()?;
    Ok(resp.json::<Manifest>().await?)
}

/// checkForUpdates.
pub fn check_for_updates(cx: &mut App) {
    set_state(cx, |s| {
        s.checking = true;
        s.error = None;
    });
    let task = rexa_core::runtime::spawn(async move {
        tokio::time::timeout(CHECK_TIMEOUT, fetch_manifest())
            .await
            .map_err(|_| anyhow::anyhow!("Update check timed out"))?
    });
    cx.spawn(async move |cx| {
        let result = task.await;
        cx.update(|cx| {
            set_state(cx, |s| {
                s.enabled = true;
                s.checking = false;
                match result {
                    Ok(m) => {
                        let latest = m.version.trim_start_matches('v').to_string();
                        s.update_available = is_newer(&latest, &s.current_version);
                        s.update_downloaded = false;
                        if s.update_available {
                            s.latest_version = Some(latest);
                            s.release_date = m.pub_date;
                        }
                    }
                    Err(e) => s.error = Some(e.to_string()),
                }
            })
        });
    })
    .detach();
}

/// Dismiss the notice for the current latest version (useLocalStorage JSON string).
pub fn dismiss(cx: &mut App) {
    if let Some(v) = state(cx).latest_version {
        crate::persist::local_set(DISMISSED_KEY, &serde_json::Value::from(v).to_string()).ok();
    }
    set_state(cx, |_| {});
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_compare() {
        assert!(is_newer("1.3.36", "1.3.35"));
        assert!(is_newer("v2.0.0", "1.9.9"));
        assert!(!is_newer("1.3.35", "1.3.35"));
        assert!(!is_newer("1.3.4", "1.3.35"));
        assert!(!app_version().is_empty());
    }
}
