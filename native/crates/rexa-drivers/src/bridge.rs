//! JSON-lines stdio bridge client — the protocol of
//! `lib/db/jdbc-bridge-manager.ts` (`java -cp bridge.jar Bridge`) and
//! `lib/db/oracle-bridge-manager.ts` (`rexadb-oracle-bridge`):
//!
//! ```text
//! → {"reqId":"1","action":"connect","config":{…}}      ← {"ok":true,"session":1,"reqId":"1","data":{}}
//! → {"reqId":"2","action":"query","session":1,"sql":"…","params":[…]}
//!                                                       ← {"ok":true,…,"data":{"columns":[{name,type}],"rows":[[…]],"rowCount":n}}
//! → schemas | tables {schema} | structure {schema,table} | foreign-keys {schema,table} | disconnect
//! ```
//!
//! One process per bridge kind is shared by every connection (like the
//! original's module-level singleton) and restarted when it exits.

use anyhow::{anyhow, bail, Context, Result};
use serde_json::{json, Value as J};
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{oneshot, Mutex as AsyncMutex};

type Pending = Arc<Mutex<HashMap<String, oneshot::Sender<Result<J>>>>>;

pub(crate) struct Bridge {
    label: &'static str,
    stdin: AsyncMutex<ChildStdin>,
    pending: Pending,
    next: AtomicU64,
    alive: Arc<std::sync::atomic::AtomicBool>,
    _child: Mutex<Child>,
}

impl Bridge {
    async fn spawn(label: &'static str, program: PathBuf, args: Vec<String>) -> Result<Arc<Bridge>> {
        let mut child = Command::new(&program)
            .args(&args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .with_context(|| format!("Failed to spawn {label} ({})", program.display()))?;
        let stdin = child.stdin.take().ok_or_else(|| anyhow!("no stdin"))?;
        let stdout = child.stdout.take().ok_or_else(|| anyhow!("no stdout"))?;
        let mut stderr = child.stderr.take().ok_or_else(|| anyhow!("no stderr"))?;
        let pending: Pending = Arc::default();
        let alive = Arc::new(std::sync::atomic::AtomicBool::new(true));
        let stderr_buf = Arc::new(Mutex::new(String::new()));
        {
            let buf = stderr_buf.clone();
            tokio::spawn(async move {
                let mut s = String::new();
                let _ = stderr.read_to_string(&mut s).await;
                buf.lock().unwrap().push_str(&s);
            });
        }
        {
            let pending = pending.clone();
            let alive = alive.clone();
            tokio::spawn(async move {
                let mut lines = BufReader::new(stdout).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    let Ok(resp) = serde_json::from_str::<J>(line.trim()) else { continue };
                    let Some(id) = resp.get("reqId").and_then(|v| v.as_str().map(str::to_string).or_else(|| v.as_u64().map(|n| n.to_string())))
                    else {
                        continue;
                    };
                    if let Some(tx) = pending.lock().unwrap().remove(&id) {
                        let r = if resp.get("ok").and_then(J::as_bool) == Some(true) {
                            Ok(resp)
                        } else {
                            Err(anyhow!("{}", resp.pointer("/data/error").and_then(J::as_str).unwrap_or(&format!("{label} error"))))
                        };
                        let _ = tx.send(r);
                    }
                }
                alive.store(false, Ordering::SeqCst);
                tokio::time::sleep(std::time::Duration::from_millis(50)).await;
                let err = stderr_buf.lock().unwrap().trim().to_string();
                let msg = if err.is_empty() { format!("{label} process terminated") } else { format!("{label} process terminated. Stderr: {err}") };
                for (_, tx) in pending.lock().unwrap().drain() {
                    let _ = tx.send(Err(anyhow!("{msg}")));
                }
            });
        }
        Ok(Arc::new(Bridge { label, stdin: AsyncMutex::new(stdin), pending, next: AtomicU64::new(1), alive, _child: Mutex::new(child) }))
    }

    /// `sendCommand`: one request, await its response by `reqId`.
    pub(crate) async fn send(&self, mut cmd: J) -> Result<J> {
        if !self.alive.load(Ordering::SeqCst) {
            bail!("{} is not running", self.label);
        }
        let id = self.next.fetch_add(1, Ordering::SeqCst).to_string();
        cmd["reqId"] = J::String(id.clone());
        let (tx, rx) = oneshot::channel();
        self.pending.lock().unwrap().insert(id.clone(), tx);
        let line = format!("{cmd}\n");
        {
            let mut stdin = self.stdin.lock().await;
            if let Err(e) = async {
                stdin.write_all(line.as_bytes()).await?;
                stdin.flush().await
            }
            .await
            {
                self.pending.lock().unwrap().remove(&id);
                return Err(anyhow!("{} write failed: {e}", self.label));
            }
        }
        rx.await.map_err(|_| anyhow!("{} process terminated", self.label))?
    }

    pub(crate) fn is_alive(&self) -> bool {
        self.alive.load(Ordering::SeqCst)
    }
}

/// Process-wide bridge per kind, restarted when dead.
pub(crate) struct BridgeSlot {
    slot: AsyncMutex<Option<Arc<Bridge>>>,
}

impl BridgeSlot {
    pub(crate) const fn new() -> Self {
        BridgeSlot { slot: AsyncMutex::const_new(None) }
    }

    pub(crate) async fn get(&self, label: &'static str, locate: impl FnOnce() -> Result<(PathBuf, Vec<String>)>) -> Result<Arc<Bridge>> {
        let mut g = self.slot.lock().await;
        if let Some(b) = g.as_ref().filter(|b| b.is_alive()) {
            return Ok(b.clone());
        }
        let (program, args) = locate()?;
        let b = Bridge::spawn(label, program, args).await?;
        *g = Some(b.clone());
        Ok(b)
    }
}

/// A connected bridge session (`withSession`), disconnected on drop.
pub(crate) struct Session {
    pub bridge: Arc<Bridge>,
    pub id: J,
}

impl Session {
    pub(crate) async fn open(bridge: Arc<Bridge>, config: J) -> Result<Session> {
        let resp = bridge.send(json!({ "action": "connect", "config": config })).await?;
        let id = resp.get("session").cloned().filter(|s| !s.is_null()).ok_or_else(|| {
            anyhow!("{}", resp.pointer("/data/error").and_then(J::as_str).unwrap_or("Failed to connect"))
        })?;
        Ok(Session { bridge, id })
    }

    pub(crate) async fn call(&self, action: &str, extra: J) -> Result<J> {
        let mut cmd = json!({ "action": action, "session": self.id });
        if let (Some(o), J::Object(e)) = (cmd.as_object_mut(), extra) {
            o.extend(e);
        }
        Ok(self.bridge.send(cmd).await?.get("data").cloned().unwrap_or(J::Null))
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        let bridge = self.bridge.clone();
        let id = self.id.clone();
        if let Ok(h) = tokio::runtime::Handle::try_current() {
            h.spawn(async move {
                let _ = bridge.send(json!({ "action": "disconnect", "session": id })).await;
            });
        }
    }
}

/// Bridge `{columns, rows}` → [`crate::QueryResult`].
pub(crate) fn to_result(data: &J, row_limit: usize) -> crate::QueryResult {
    let cols = data.get("columns").and_then(J::as_array).cloned().unwrap_or_default();
    let mut r = crate::QueryResult::from_columns(cols.iter().map(|c| c.get("name").and_then(J::as_str).unwrap_or("").to_string()).collect());
    r.column_types = cols
        .iter()
        .map(|c| crate::ColumnMeta::new(c.get("name").and_then(J::as_str).unwrap_or(""), c.get("type").and_then(J::as_str).unwrap_or("unknown")))
        .collect();
    for row in data.get("rows").and_then(J::as_array).into_iter().flatten() {
        if r.rows.len() >= row_limit {
            r.truncated = true;
            break;
        }
        r.rows.push(row.as_array().into_iter().flatten().map(crate::http::json_to_cell).collect());
    }
    if r.columns.is_empty() {
        r.affected = data.get("affectedRows").or_else(|| data.get("rowCount")).and_then(J::as_u64);
    }
    r
}

/// `rows` of a metadata action as arrays of text.
pub(crate) fn rows(data: &J) -> Vec<Vec<Option<String>>> {
    data.get("rows")
        .and_then(J::as_array)
        .into_iter()
        .flatten()
        .map(|r| {
            r.as_array()
                .into_iter()
                .flatten()
                .map(|v| match v {
                    J::Null => None,
                    J::String(s) => Some(s.clone()),
                    other => Some(other.to_string()),
                })
                .collect()
        })
        .collect()
}

pub(crate) fn col(r: &[Option<String>], i: usize) -> String {
    r.get(i).cloned().flatten().unwrap_or_default()
}

/// Resource directories the original searches (`RESOURCEDIR`, next to the
/// executable, the bundle `Resources`, the working directory).
pub(crate) fn resource_dirs() -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Ok(r) = std::env::var("RESOURCEDIR") {
        out.push(PathBuf::from(r.trim_start_matches(r"\\?\")));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            out.extend([dir.to_path_buf(), dir.join("../Resources"), dir.join("../../Resources"), dir.join("../share/rexa-db"), dir.join("../lib/RexaDB")]);
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        out.push(cwd.clone());
        // Repository checkout (dev): native/… → ../resources, ../src-tauri.
        for up in [cwd.clone(), cwd.join(".."), cwd.join("../..")] {
            out.push(up.join("resources/java-bridge/dist"));
            out.push(up.join("resources"));
        }
    }
    // The installed desktop app's bundle (macOS).
    out.push(PathBuf::from("/Applications/RexaDB.app/Contents/Resources"));
    out
}
