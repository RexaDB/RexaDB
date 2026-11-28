//! Port of the studio-level review queue of hooks/use-studio.ts: `addReviewAction`
//! (only when `executionMode === "review"`), `pendingActions`, and the flag that
//! opens the review sheet. DDL from the schema views is queued here; the studio
//! shell shows and commits it.

use gpui::{App, Global};

#[derive(Debug, Clone, PartialEq)]
pub struct ReviewAction {
    pub id: u64,
    /// The original's `type` ("add_fk", "enable_rls", "create_table", …).
    pub kind: String,
    pub description: String,
    pub sql: String,
}

impl ReviewAction {
    pub fn new(kind: impl Into<String>, description: impl Into<String>, sql: impl Into<String>) -> Self {
        Self { id: 0, kind: kind.into(), description: description.into(), sql: sql.into() }
    }
}

#[derive(Default)]
struct ReviewQueue {
    actions: Vec<ReviewAction>,
    next: u64,
    open: bool,
}

impl Global for ReviewQueue {}

/// `executionMode === "review"` (studio_settings).
pub fn review_mode() -> bool {
    rexa_store::Store::open()
        .ok()
        .and_then(|s| s.setting("studio_settings").ok().flatten())
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .and_then(|v| v.get("executionMode").and_then(|m| m.as_str()).map(|m| m == "review"))
        .unwrap_or(false)
}

/// `addReviewAction`: queue and open the review sheet; false in direct mode.
pub fn add_review_action(action: ReviewAction, cx: &mut App) -> bool {
    add_review_actions(vec![action], cx)
}

pub fn add_review_actions(actions: Vec<ReviewAction>, cx: &mut App) -> bool {
    if !review_mode() {
        return false;
    }
    let q = cx.default_global::<ReviewQueue>();
    for mut a in actions {
        q.next += 1;
        a.id = q.next;
        q.actions.push(a);
    }
    q.open = true;
    crate::emit_studio(crate::StudioEvent::ReviewQueueChanged, cx);
    true
}

pub fn actions(cx: &App) -> Vec<ReviewAction> {
    cx.try_global::<ReviewQueue>().map(|q| q.actions.clone()).unwrap_or_default()
}

pub fn is_open(cx: &App) -> bool {
    cx.try_global::<ReviewQueue>().is_some_and(|q| q.open)
}

pub fn set_open(open: bool, cx: &mut App) {
    cx.default_global::<ReviewQueue>().open = open;
    crate::emit_studio(crate::StudioEvent::ReviewQueueChanged, cx);
}

pub fn remove(id: u64, cx: &mut App) {
    cx.default_global::<ReviewQueue>().actions.retain(|a| a.id != id);
    crate::emit_studio(crate::StudioEvent::ReviewQueueChanged, cx);
}

pub fn clear(cx: &mut App) {
    cx.default_global::<ReviewQueue>().actions.clear();
    crate::emit_studio(crate::StudioEvent::ReviewQueueChanged, cx);
}
