mod spacetimedb;

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::process::Command;
use std::sync::Mutex;
use tauri::Emitter;
use tauri::Listener;
use tauri::Manager;
use tauri_plugin_shell::ShellExt;
use tauri_plugin_updater;

fn rust_log(msg: &str) {
    let line = format!("[{}] [rust] {}\n", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0), msg);
    let _ = std::fs::OpenOptions::new().create(true).append(true).open("/tmp/rexadb-rust.log")
        .and_then(|mut f| f.write_all(line.as_bytes()));
}

struct SidecarState {
    port: Mutex<u16>,
    child: Mutex<Option<tauri_plugin_shell::process::CommandChild>>,
    ready: Mutex<bool>,
    log: Mutex<String>,
    restart_count: Mutex<u32>,
    last_exit_code: Mutex<Option<i32>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct EditorEntry {
    id: String,
    label: String,
    app_path: Option<String>,
    icon: Option<String>,
}

fn get_app_data_dir(app: &tauri::AppHandle) -> PathBuf {
    let electron_dir = get_electron_data_dir();
    if electron_dir.exists() {
        return electron_dir;
    }
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
}

fn get_electron_data_dir() -> PathBuf {
    #[allow(unused_variables)]
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    #[cfg(target_os = "macos")]
    {
        PathBuf::from(home).join("Library/Application Support/rexa-db")
    }
    #[cfg(target_os = "windows")]
    {
        let appdata = std::env::var("APPDATA").unwrap_or_else(|_| ".".to_string());
        PathBuf::from(appdata).join("rexa-db")
    }
    #[cfg(target_os = "linux")]
    {
        let xdg = std::env::var("XDG_CONFIG_HOME")
            .unwrap_or_else(|_| format!("{}/.config", home));
        PathBuf::from(xdg).join("rexa-db")
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        PathBuf::from(".")
    }
}

fn get_auth_storage_path(app: &tauri::AppHandle) -> PathBuf {
    let dir = get_app_data_dir(app);
    fs::create_dir_all(&dir).ok();
    dir.join("auth-storage.json")
}

fn read_auth_storage(app: &tauri::AppHandle) -> serde_json::Value {
    let path = get_auth_storage_path(app);
    fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(serde_json::json!({}))
}

fn write_auth_storage(app: &tauri::AppHandle, data: &serde_json::Value) -> Result<(), String> {
    let path = get_auth_storage_path(app);
    let json = serde_json::to_string_pretty(data).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())
}

#[tauri::command]
fn auth_storage_get(app: tauri::AppHandle, key: String) -> Result<Option<String>, String> {
    let storage = read_auth_storage(&app);
    Ok(storage
        .get(&key)
        .and_then(|v| v.as_str())
        .map(|s| s.to_string()))
}

#[tauri::command]
fn auth_storage_set(app: tauri::AppHandle, key: String, value: String) -> Result<(), String> {
    let mut storage = read_auth_storage(&app);
    storage[key] = serde_json::json!(value);
    write_auth_storage(&app, &storage)
}

#[tauri::command]
fn auth_storage_remove(app: tauri::AppHandle, key: String) -> Result<(), String> {
    let mut storage = read_auth_storage(&app);
    storage.as_object_mut().map(|obj| obj.remove(&key));
    write_auth_storage(&app, &storage)
}

#[tauri::command]
fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[tauri::command]
fn get_api_base_url(state: tauri::State<SidecarState>) -> String {
    let port = *state.port.lock().unwrap();
    format!("http://127.0.0.1:{}", port)
}

#[tauri::command]
fn is_sidecar_ready(state: tauri::State<SidecarState>) -> bool {
    *state.ready.lock().unwrap()
}

#[derive(Serialize)]
struct SidecarStatus {
    ready: bool,
    port: u16,
    restart_count: u32,
    last_exit_code: Option<i32>,
    has_child: bool,
}

#[tauri::command]
fn get_sidecar_status(state: tauri::State<SidecarState>) -> SidecarStatus {
    SidecarStatus {
        ready: *state.ready.lock().unwrap(),
        port: *state.port.lock().unwrap(),
        restart_count: *state.restart_count.lock().unwrap(),
        last_exit_code: *state.last_exit_code.lock().unwrap(),
        has_child: state.child.lock().unwrap().is_some(),
    }
}

#[tauri::command]
fn get_sidecar_log(state: tauri::State<SidecarState>) -> String {
    state.log.lock().unwrap().clone()
}

#[tauri::command]
async fn open_in_editor(path: String, app_name: Option<String>) -> Result<bool, String> {
    let resolved_app = app_name.filter(|a| !a.trim().is_empty());
    let platform = std::env::consts::OS;

    let result = if platform == "macos" {
        if let Some(app) = resolved_app {
            Command::new("open")
                .args(["-a", &app, &path])
                .spawn()
        } else {
            Command::new("open").arg(&path).spawn()
        }
    } else if platform == "windows" {
        if let Some(app) = resolved_app {
            Command::new("cmd")
                .args(["/c", "start", "", &app, &path])
                .spawn()
        } else {
            Command::new("cmd")
                .args(["/c", "start", "", &path])
                .spawn()
        }
    } else {
        if let Some(app) = resolved_app {
            Command::new(&app).arg(&path).spawn()
        } else {
            Command::new("xdg-open").arg(&path).spawn()
        }
    };

    match result {
        Ok(_) => Ok(true),
        Err(e) => Err(format!("Failed to open editor: {}", e)),
    }
}

#[tauri::command]
async fn list_editors() -> Result<Vec<EditorEntry>, String> {
    let platform = std::env::consts::OS;
    if platform != "macos" {
        return Ok(vec![]);
    }

    let candidates: Vec<(&str, &str, &str)> = vec![
        ("vscode", "VS Code", "Visual Studio Code.app"),
        ("cursor", "Cursor", "Cursor.app"),
        ("sublime", "Sublime Text", "Sublime Text.app"),
        ("webstorm", "WebStorm", "WebStorm.app"),
        ("intellij", "IntelliJ IDEA", "IntelliJ IDEA.app"),
        ("xcode", "Xcode", "Xcode.app"),
    ];

    let search_dirs = vec![
        PathBuf::from("/Applications"),
        PathBuf::from(format!(
            "{}/Applications",
            std::env::var("HOME").unwrap_or_default()
        )),
    ];

    let mut results = vec![];
    for (id, label, mac_name) in candidates {
        let mut app_path = None;
        for dir in &search_dirs {
            let full = dir.join(mac_name);
            if full.exists() {
                app_path = Some(full.to_string_lossy().to_string());
                break;
            }
        }
        results.push(EditorEntry {
            id: id.to_string(),
            label: label.to_string(),
            app_path,
            icon: None,
        });
    }

    Ok(results)
}

#[tauri::command]
async fn download_jdbc_driver(
    app: tauri::AppHandle,
    url: String,
    output_path: String,
) -> Result<String, String> {
    let response = reqwest::get(&url)
        .await
        .map_err(|e| format!("Download failed: {}", e))?;
    let total = response.content_length().unwrap_or(0);
    let path = std::path::PathBuf::from(&output_path);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Dir creation failed: {}", e))?;
    }
    let mut file = fs::File::create(&path).map_err(|e| format!("File create failed: {}", e))?;
    let mut stream = response.bytes_stream();
    let mut downloaded: u64 = 0;

    use futures_util::StreamExt;
    while let Some(item) = stream.next().await {
        let chunk = item.map_err(|e| format!("Stream error: {}", e))?;
        file.write_all(&chunk).map_err(|e| format!("Write error: {}", e))?;
        downloaded += chunk.len() as u64;
        if total > 0 {
            let _ = app.emit(
                "jdbc-download-progress",
                serde_json::json!({
                    "downloaded": downloaded,
                    "total": total,
                    "percent": (downloaded as f64 / total as f64) * 100.0,
                }),
            );
        }
    }

    Ok(output_path)
}

#[tauri::command]
fn get_resource_dir(app: tauri::AppHandle) -> Result<String, String> {
    rust_log("get_resource_dir called");
    match app.path().resource_dir() {
        Ok(p) => {
            let s = p.to_string_lossy().to_string();
            rust_log(&format!("get_resource_dir OK: {}", s));
            Ok(s)
        }
        Err(e) => {
            rust_log(&format!("get_resource_dir FAILED: {}", e));
            Err(e.to_string())
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
struct JdbcDriverManifest {
    name: String,
    driver_class: String,
    jar_paths: Vec<String>,
    installed_at: u64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct JdbcDriverEntry {
    name: String,
    driver_class: String,
    jar_paths: Vec<String>,
    installed_at: u64,
}

fn get_jdbc_drivers_dir(app: &tauri::AppHandle) -> PathBuf {
    get_app_data_dir(app).join("jdbc-drivers")
}

#[tauri::command]
fn save_jdbc_driver_manifest(
    app: tauri::AppHandle,
    name: String,
    driver_class: String,
    jar_paths: Vec<String>,
) -> Result<(), String> {
    let dir = get_jdbc_drivers_dir(&app).join(&name);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let manifest = JdbcDriverManifest {
        name: name.clone(),
        driver_class,
        jar_paths,
        installed_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0),
    };
    let json = serde_json::to_string_pretty(&manifest).map_err(|e| e.to_string())?;
    fs::write(dir.join("manifest.json"), json).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn load_jdbc_drivers(app: tauri::AppHandle) -> Result<Vec<JdbcDriverEntry>, String> {
    let dir = get_jdbc_drivers_dir(&app);
    if !dir.exists() {
        return Ok(vec![]);
    }
    let mut result = vec![];
    let entries = fs::read_dir(&dir).map_err(|e| e.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        let manifest_path = entry.path().join("manifest.json");
        let manifest: JdbcDriverManifest = if manifest_path.exists() {
            fs::read_to_string(&manifest_path)
                .ok()
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or(JdbcDriverManifest {
                    name: name.clone(),
                    driver_class: String::new(),
                    jar_paths: vec![],
                    installed_at: 0,
                })
        } else {
            JdbcDriverManifest {
                name: name.clone(),
                driver_class: String::new(),
                jar_paths: vec![],
                installed_at: 0,
            }
        };
        let mut jar_paths: Vec<String> = vec![];
        if let Ok(sub_entries) = fs::read_dir(entry.path()) {
            for sub in sub_entries.flatten() {
                if sub.path().extension().map(|e| e == "jar").unwrap_or(false) {
                    jar_paths.push(sub.path().to_string_lossy().to_string());
                }
            }
        }
        result.push(JdbcDriverEntry {
            name,
            driver_class: manifest.driver_class,
            jar_paths,
            installed_at: manifest.installed_at,
        });
    }
    Ok(result)
}

#[tauri::command]
fn remove_jdbc_driver(app: tauri::AppHandle, name: String) -> Result<(), String> {
    let dir = get_jdbc_drivers_dir(&app).join(&name);
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
impl SidecarState {
    fn new() -> Self {
        Self {
            port: Mutex::new(3867),
            child: Mutex::new(None),
            ready: Mutex::new(false),
            log: Mutex::new(String::new()),
            restart_count: Mutex::new(0),
            last_exit_code: Mutex::new(None),
        }
    }
}

fn extract_port(line: &str) -> Option<u16> {
    let needle = "listening on port ";
    let i = line.find(needle)?;
    let rest = &line[i + needle.len()..];
    let port_str = rest.split_whitespace().next().unwrap_or("");
    port_str.parse().ok()
}

fn spawn_sidecar(app: &tauri::AppHandle) {
    use tauri_plugin_shell::process::CommandEvent;

    let data_dir = get_app_data_dir(app);
    let resource_dir = app.path().resource_dir().ok();
    let mut sidecar_command = app.shell().sidecar("rexadb-server")
        .expect("failed to create sidecar command")
        .env("REXADB_USER_DATA_DIR", data_dir.to_string_lossy().as_ref());
    if let Some(rd) = &resource_dir {
        sidecar_command = sidecar_command.env("RESOURCEDIR", rd.to_string_lossy().as_ref());
    }

    let (mut rx, child) = sidecar_command
        .spawn()
        .expect("failed to spawn sidecar");

    *app.state::<SidecarState>().child.lock().unwrap() = Some(child);
    *app.state::<SidecarState>().restart_count.lock().unwrap() += 1;

    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut buf = String::new();
        loop {
            match rx.recv().await {
                Some(CommandEvent::Stderr(data)) => {
                    let text = String::from_utf8_lossy(&data);
                    buf.push_str(&text);
                    app_handle.state::<SidecarState>().log.lock().unwrap().push_str(&text);
                    if !*app_handle.state::<SidecarState>().ready.lock().unwrap() {
                        if let Some(port) = extract_port(&buf) {
                            let state = app_handle.state::<SidecarState>();
                            *state.port.lock().unwrap() = port;
                            *state.ready.lock().unwrap() = true;
                        }
                    }
                }
                Some(CommandEvent::Terminated(status)) => {
                    let state = app_handle.state::<SidecarState>();
                    *state.ready.lock().unwrap() = false;
                    *state.last_exit_code.lock().unwrap() = status.code;
                    let exit_info = format!("\n[sidecar] Terminated: code={:?} signal={:?}\n", status.code, status.signal);
                    state.log.lock().unwrap().push_str(&exit_info);
                    let _ = state.child.lock().unwrap().take();
                    drop(state);
                    tauri::async_runtime::spawn(async move {
                        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                        spawn_sidecar(&app_handle);
                    });
                    break;
                }
                _ => {}
            }
        }
    });

    // Fallback: health-check probe instead of blind ready=true
    let app_handle2 = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(5)).await;
        for attempt in 0..30 {
            let state = app_handle2.state::<SidecarState>();
            if *state.ready.lock().unwrap() {
                return;
            }
            let port = *state.port.lock().unwrap();
            let url = format!("http://127.0.0.1:{}/health", port);
            drop(state);
            let client = reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(2))
                .build().unwrap();
            match client.get(&url).send().await {
                Ok(resp) if resp.status().is_success() => {
                    rust_log(&format!("sidecar fallback: confirmed alive at {}", url));
                    let state = app_handle2.state::<SidecarState>();
                    *state.ready.lock().unwrap() = true;
                    state.log.lock().unwrap().push_str(
                        &format!("\n[sidecar] confirmed alive via health-check (attempt {})\n", attempt + 1)
                    );
                    return;
                }
                _ => {
                    rust_log(&format!("sidecar fallback: health check failed (attempt {}) on {}", attempt + 1, url));
                }
            }
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        }
        let msg = "\n[sidecar] fallback: health check exhausted after 60s — sidecar never started\n";
        rust_log("sidecar fallback: exhausted retries, sidecar never started");
        app_handle2.state::<SidecarState>().log.lock().unwrap().push_str(msg);
    });
}

pub fn run() {
    let app = tauri::Builder::default()
        .manage(SidecarState::new())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_frame::FramePluginBuilder::new().auto_titlebar(true).build())
        .setup(|app| {
            #[cfg(target_os = "linux")]
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");

            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(if cfg!(debug_assertions) { log::LevelFilter::Info } else { log::LevelFilter::Warn })
                    .build(),
            )?;

            #[cfg(desktop)]
            app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;

            let data_dir = get_app_data_dir(app.handle());
            fs::create_dir_all(&data_dir).ok();
            spawn_sidecar(app.handle());

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            auth_storage_get,
            auth_storage_set,
            auth_storage_remove,
            get_app_version,
            get_api_base_url,
            is_sidecar_ready,
            get_sidecar_status,
            get_sidecar_log,
            open_in_editor,
            list_editors,
            spacetimedb::spacetimedb_query,
            spacetimedb::spacetimedb_fetch_schema,
            spacetimedb::spacetimedb_ping,
            spacetimedb::spacetimedb_call_reducer,
            spacetimedb::spacetimedb_fetch_logs,
            spacetimedb::spacetimedb_get_database_info,
            get_resource_dir,
            download_jdbc_driver,
            save_jdbc_driver_manifest,
            load_jdbc_drivers,
            remove_jdbc_driver,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            if let Some(state) = app_handle.try_state::<SidecarState>() {
                if let Some(child) = state.child.lock().unwrap().take() {
                    let _ = child.kill();
                }
            }
        }
    });
}
