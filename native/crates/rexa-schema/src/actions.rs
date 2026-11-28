//! The studio's create/delete runners from hooks/use-studio.ts (`runCreateAction`,
//! `runDeleteWithConfirm`, the `handleDelete*` / `handleCreate*` bodies): run SQL on
//! the session, toast the outcome, then refresh. Errors go to a toast (the
//! original sets the studio error banner via `setError`).
//!
//! Review mode: `addReviewAction` queues the statement in the studio-level review
//! queue (`rexa_core::review`) instead of running it; the action type is derived
//! from the statement (`create_table`, `drop_index`, …) and the description from
//! the success message.

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

/// `runCreateAction`: run, toast success (skipped when empty) or the error, then `on_done`.
pub fn run(
    session: &Arc<Session>,
    sql: String,
    success: String,
    fallback_error: &'static str,
    cx: &mut App,
    on_done: impl FnOnce(bool, &mut AsyncApp) + 'static,
) {
    let description = if success.is_empty() { sql.lines().next().unwrap_or_default().to_string() } else { success.clone() };
    if rexa_core::review::add_review_action(rexa_core::review::ReviewAction::new(review_kind(&sql), description, sql.clone()), cx) {
        cx.spawn(async move |cx| on_done(true, cx)).detach();
        return;
    }
    let task = exec(session, sql);
    cx.spawn(async move |cx| {
        let r = task.await;
        let ok = r.is_ok();
        cx.update(|cx| match r {
            Ok(()) => {
                if !success.is_empty() {
                    Toast::success(success).show(cx);
                }
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

/// The review action `type` for a DDL statement: `CREATE TABLE …` → `create_table`.
pub fn review_kind(sql: &str) -> String {
    let words: Vec<String> = sql
        .split_whitespace()
        .map(|w| w.to_lowercase())
        .filter(|w| !matches!(w.as_str(), "or" | "replace" | "unique" | "materialized" | "if" | "not" | "exists" | "temporary" | "temp"))
        .take(2)
        .collect();
    let kind = match words.first().map(String::as_str) {
        Some("drop") => format!("delete_{}", words.get(1).map(String::as_str).unwrap_or("object")),
        Some(verb) => format!("{verb}_{}", words.get(1).map(String::as_str).unwrap_or("object")),
        None => "sql".into(),
    };
    kind.trim_end_matches(';').to_string()
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
