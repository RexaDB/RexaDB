//! The studio's create/delete runners from hooks/use-studio.ts (`runCreateAction`,
//! `runDeleteWithConfirm`, the `handleDelete*` / `handleCreate*` bodies): run SQL on
//! the session, toast the outcome, then refresh. Errors go to a toast (the
//! original sets the studio error banner via `setError`).
//!
//! Not ported: review mode (`addReviewAction` queues the statement for the
//! review sheet instead of running it).

use gpui::{App, AsyncApp};
use rexa_core::{emit_studio, runtime, Session, StudioEvent};
use rexa_ui::{confirm, ConfirmOptions, Toast};
use std::sync::Arc;

/// Run one statement (or script) off the UI thread.
pub fn exec(session: &Arc<Session>, sql: String) -> impl std::future::Future<Output = anyhow::Result<()>> {
    let d = session.driver.clone();
    runtime::spawn(async move {
        let r = d.execute_script(&sql, 1000).await?;
        if let Some(e) = r.error {
            anyhow::bail!(e.message);
        }
        Ok(())
    })
}

/// Run a query and return its result.
pub fn query(session: &Arc<Session>, sql: String) -> impl std::future::Future<Output = anyhow::Result<rexa_drivers::QueryResult>> {
    let d = session.driver.clone();
    runtime::spawn(async move { d.execute(&sql, rexa_drivers::DEFAULT_ROW_LIMIT).await })
}

/// `runCreateAction`: run, toast success (or error), then `on_success`.
pub fn run(
    session: &Arc<Session>,
    sql: String,
    success: String,
    fallback_error: &'static str,
    cx: &mut App,
    on_done: impl FnOnce(bool, &mut AsyncApp) + 'static,
) {
    let task = exec(session, sql);
    cx.spawn(async move |cx| {
        let r = task.await;
        let ok = r.is_ok();
        cx.update(|cx| match r {
            Ok(()) => {
                Toast::success(success).show(cx);
                emit_studio(StudioEvent::SchemaChanged, cx);
            }
            Err(e) => {
                let msg = format!("{e:#}");
                Toast::error(if msg.is_empty() { fallback_error.to_string() } else { msg }).show(cx);
            }
        });
        on_done(ok, cx);
    })
    .detach();
}

/// `runDeleteWithConfirm`: destructive confirm, then [`run`].
pub fn confirm_run(
    session: &Arc<Session>,
    title: &str,
    description: String,
    confirm_text: &str,
    sql: String,
    success: String,
    fallback_error: &'static str,
    cx: &mut App,
    on_done: impl FnOnce(bool, &mut AsyncApp) + 'static,
) {
    let fut = confirm(ConfirmOptions::destructive(title.to_string()).description(description).confirm_text(confirm_text.to_string()), cx);
    let session = session.clone();
    cx.spawn(async move |cx| {
        if !fut.await {
            return;
        }
        cx.update(|cx| run(&session, sql, success, fallback_error, cx, on_done));
    })
    .detach();
}

/// Double-quote an identifier the way the original's template strings do (`"${name}"`).
pub fn dq(s: &str) -> String {
    format!("\"{}\"", s.replace('"', "\"\""))
}

/// Single-quote a SQL string literal.
pub fn sq(s: &str) -> String {
    format!("'{}'", s.replace('\'', "''"))
}
