//! Unified table watch (`watchTable` / `useTableRealtime`).

use super::neon_watch;
use super::supabase;
use super::types::{realtime_provider_for, RealtimeErrorCode, RealtimeProvider, TableRealtimeStatus, REALTIME_ERROR};
use rexa_drivers::{neon_oauth, SortConfig};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::mpsc;

const CHANGE_DEBOUNCE_MS: u64 = 300;
const CHANGE_MAX_WAIT_MS: u64 = 1000;

#[derive(Debug, Clone)]
pub struct TableWatchRequest {
    pub connection_string: String,
    pub schema: String,
    pub table: String,
    pub primary_key: Vec<String>,
    pub filter: String,
    pub sort: Option<SortConfig>,
    pub limit: usize,
    pub offset: usize,
}

#[derive(Debug, Clone)]
pub enum TableWatchEvent {
    Status(&'static str),
    Change { count: usize },
    Error { message: String, code: Option<RealtimeErrorCode> },
}

/// Abortable watch handle. Dropping or calling [`Self::abort`] stops the socket.
pub struct TableWatchHandle {
    stop: Arc<AtomicBool>,
}

impl TableWatchHandle {
    pub fn abort(&self) {
        self.stop.store(true, Ordering::Relaxed);
    }
}

impl Drop for TableWatchHandle {
    fn drop(&mut self) {
        self.abort();
    }
}

/// Spawn a watch. Debounced change flushes go to `on_change`; every event
/// (including Change) is also forwarded to `on_event`.
pub fn start_table_watch(
    request: TableWatchRequest,
    on_event: Arc<dyn Fn(TableWatchEvent) + Send + Sync>,
    on_change: Arc<dyn Fn() + Send + Sync>,
) -> TableWatchHandle {
    let stop = Arc::new(AtomicBool::new(false));
    let stop_task = stop.clone();
    // Task is already running on the I/O runtime; dropping the awaiter detaches it.
    let _ = rexa_core::runtime::spawn(async move {
        let (tx, mut rx) = mpsc::unbounded_channel::<TableWatchEvent>();
        let provider = realtime_provider_for(&request.connection_string);
        let watch_stop = stop_task.clone();
        let watch = async move {
            match provider {
                Some(RealtimeProvider::Neon) => {
                    let Some(pointer) = neon_oauth::parse_pointer(&request.connection_string) else {
                        let _ = tx.send(TableWatchEvent::Error {
                            message: "Invalid Neon connection pointer.".into(),
                            code: Some(REALTIME_ERROR.unsupported),
                        });
                        return;
                    };
                    match neon_watch::watch_neon_table(pointer, request, tx.clone(), watch_stop).await {
                        Ok(()) => {}
                        Err(err) => {
                            let _ = tx.send(TableWatchEvent::Error {
                                message: err.message,
                                code: Some(err.code),
                            });
                        }
                    }
                }
                Some(RealtimeProvider::Supabase) => {
                    if let Err(message) = supabase::watch_supabase_table(request, tx.clone(), watch_stop).await {
                        let code = if message.contains("supabase_realtime") {
                            Some(REALTIME_ERROR.not_published)
                        } else {
                            Some(REALTIME_ERROR.unsupported)
                        };
                        let _ = tx.send(TableWatchEvent::Error { message, code });
                    }
                }
                None => {
                    let _ = tx.send(TableWatchEvent::Error {
                        message: "Live updates need a Neon or Supabase connection signed in through its management API.".into(),
                        code: Some(REALTIME_ERROR.unsupported),
                    });
                }
            }
        };

        let on_event2 = on_event.clone();
        let on_change2 = on_change.clone();
        let stop_pump = stop_task.clone();
        let pump = async move {
            let mut timer: Option<tokio::time::Instant> = None;
            let mut first_pending: Option<Instant> = None;
            loop {
                if stop_pump.load(Ordering::Relaxed) {
                    break;
                }
                let recv = if let Some(deadline) = timer {
                    let wait = deadline.saturating_duration_since(tokio::time::Instant::now());
                    match tokio::time::timeout(wait.max(Duration::from_millis(1)), rx.recv()).await {
                        Ok(v) => v,
                        Err(_) => {
                            timer = None;
                            first_pending = None;
                            on_change2();
                            continue;
                        }
                    }
                } else {
                    rx.recv().await
                };
                let Some(event) = recv else { break };
                match &event {
                    TableWatchEvent::Change { .. } => {
                        let now = Instant::now();
                        if first_pending.is_none() {
                            first_pending = Some(now);
                        }
                        let max_left = first_pending
                            .map(|t| CHANGE_MAX_WAIT_MS.saturating_sub(t.elapsed().as_millis() as u64))
                            .unwrap_or(CHANGE_DEBOUNCE_MS);
                        let wait_ms = CHANGE_DEBOUNCE_MS.min(max_left);
                        timer = Some(tokio::time::Instant::now() + Duration::from_millis(wait_ms));
                        on_event2(event);
                    }
                    _ => on_event2(event),
                }
            }
            if timer.is_some() {
                on_change2();
            }
            on_event2(TableWatchEvent::Status("closed"));
        };

        tokio::select! {
            _ = watch => {}
            _ = pump => {}
        }
        Ok(())
    });
    TableWatchHandle { stop }
}

pub fn status_from_event(event: &TableWatchEvent, previous: TableRealtimeStatus) -> TableRealtimeStatus {
    match event {
        TableWatchEvent::Status("connecting") => TableRealtimeStatus::Connecting,
        TableWatchEvent::Status("live") => TableRealtimeStatus::Live,
        TableWatchEvent::Status("stale") => TableRealtimeStatus::Stale,
        TableWatchEvent::Status("closed") => {
            if previous == TableRealtimeStatus::Error {
                previous
            } else {
                TableRealtimeStatus::Off
            }
        }
        TableWatchEvent::Error { .. } => TableRealtimeStatus::Error,
        TableWatchEvent::Change { .. } | TableWatchEvent::Status(_) => previous,
    }
}
