//! Port of `components/studio/toolbar/toolbar-realtime.tsx`.

use super::supabase::{self, SupabaseTableRealtimeStatus};
use super::types::{realtime_provider_for, RealtimeProvider, TableRealtimeStatus, REALTIME_ERROR};
use super::watch::{
    start_table_watch, status_from_event, TableWatchEvent, TableWatchHandle, TableWatchRequest,
};
use crate::view::TableEditor;
use gpui::{div, prelude::*, px, AnyElement, App, Context, EntityId, FontWeight, SharedString, Task, Window};
use rexa_core::runtime;
use rexa_drivers::neon_oauth::{self, NeonRealtimeState};
use rexa_ui::popup::Align;
use rexa_ui::widgets::Icon;
use rexa_ui::{
    tw, with_alpha, ActiveTokens, Button, ButtonSize, ConfirmOptions, IconName, Popover, Switch, Toast, Tw,
};
use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};

const POLL_MS: u64 = 3000;
const NEON_RLS_UNSUPPORTED: &str = "Not available: this table has row-level security";

#[derive(Default)]
pub struct RealtimeState {
    pub live: bool,
    pub status: TableRealtimeStatus,
    pub error: Option<(String, Option<&'static str>)>,
    pub busy: bool,
    pub neon: Option<NeonRealtimeState>,
    pub supabase: Option<SupabaseTableRealtimeStatus>,
    pub settings_error: Option<String>,
    pub attempt: u64,
    pub(crate) watch: Option<TableWatchHandle>,
    poll: Option<Task<()>>,
    pump: Option<Task<()>>,
}

impl Default for TableRealtimeStatus {
    fn default() -> Self {
        Self::Off
    }
}

struct EventQueues {
    events: Mutex<HashMap<EntityId, Vec<TableWatchEvent>>>,
    refreshes: Mutex<HashMap<EntityId, bool>>,
}

fn queues() -> &'static EventQueues {
    static Q: OnceLock<EventQueues> = OnceLock::new();
    Q.get_or_init(|| EventQueues {
        events: Mutex::new(HashMap::new()),
        refreshes: Mutex::new(HashMap::new()),
    })
}

fn push_event(id: EntityId, event: TableWatchEvent) {
    queues().events.lock().unwrap().entry(id).or_default().push(event);
}

fn push_refresh(id: EntityId) {
    queues().refreshes.lock().unwrap().insert(id, true);
}

fn take_events(id: EntityId) -> Vec<TableWatchEvent> {
    queues().events.lock().unwrap().remove(&id).unwrap_or_default()
}

fn take_refresh(id: EntityId) -> bool {
    queues().refreshes.lock().unwrap().remove(&id).unwrap_or(false)
}

/// Renders nothing unless the connection is a Neon or Supabase management pointer.
pub fn render_realtime_control(editor: &mut TableEditor, cx: &mut Context<TableEditor>) -> Option<AnyElement> {
    let provider = realtime_provider_for(editor.connection_string())?;
    let t = cx.tokens().clone();
    let status = editor.realtime.status;
    let error = editor.realtime.error.clone();
    let neon_rls = provider == RealtimeProvider::Neon
        && (editor.access.security.is_some_and(|(rls, _)| rls)
            || error.as_ref().is_some_and(|(m, _)| m.to_ascii_lowercase().contains("row-level security")));
    let title: SharedString = if neon_rls {
        "Neon Realtime does not support tables with row-level security yet.".into()
    } else if let Some((message, _)) = &error {
        message.clone().into()
    } else {
        format!("Realtime: {}", status.label()).into()
    };
    let this = cx.entity().downgrade();
    let table = editor.table.name.clone();
    let live = editor.realtime.live;
    let busy = editor.realtime.busy;
    let neon_state = editor.realtime.neon.clone();
    let supabase_state = editor.realtime.supabase.clone();
    let settings_error = editor.realtime.settings_error.clone();
    let neon_ready = neon_state.as_ref().is_some_and(|s| s.enabled && !s.pending);
    let can_go_live = match provider {
        RealtimeProvider::Supabase => supabase_state.as_ref().is_some_and(|s| s.published),
        RealtimeProvider::Neon => neon_ready,
    };
    let primary_key = editor.primary_key_columns();
    let no_pk = provider == RealtimeProvider::Neon && primary_key.is_empty();
    let live_blocked: Option<&'static str> = if neon_rls {
        Some(NEON_RLS_UNSUPPORTED)
    } else if no_pk {
        Some("Needs a primary key")
    } else {
        None
    };
    let status_dot = match status {
        TableRealtimeStatus::Off => with_alpha(t.muted_foreground, 0.4),
        TableRealtimeStatus::Connecting | TableRealtimeStatus::Stale => tw("amber-400"),
        TableRealtimeStatus::Live => tw("emerald-500"),
        TableRealtimeStatus::Error => t.destructive,
    };

    Some(
        Popover::new("toolbar-realtime")
            .align(Align::End)
            .side_offset(8.)
            .w(Some(320.))
            .p(12.)
            .trigger(
                rexa_ui::Tooltip::studio(title).child(
                    Button::new("realtime-btn")
                        .outline()
                        .size(ButtonSize::Sm)
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .gap(px(6.))
                                .child(div().size(px(6.)).rounded_full().bg(status_dot))
                                .child(Icon::new(IconName::Activity).size(px(14.)))
                                .child(div().tw_text_xs().child("Realtime")),
                        ),
                ),
            )
            .content(move |_ctl, window, cx| {
                if let Some(this) = this.upgrade() {
                    this.update(cx, |this, cx| this.ensure_realtime_settings(window, cx));
                }
                let t = cx.tokens().clone();
                let this = this.clone();
                let status_label = status.label();
                div()
                    .flex()
                    .flex_col()
                    .gap_3()
                    .tw_text_xs()
                    .child(
                        div()
                            .child(
                                div()
                                    .tw_text_sm()
                                    .font_weight(FontWeight::MEDIUM)
                                    .child(if provider == RealtimeProvider::Neon {
                                        "Neon Realtime"
                                    } else {
                                        "Supabase Realtime"
                                    }),
                            )
                            .child(
                                div().mt_1().text_color(t.muted_foreground).child(
                                    if provider == RealtimeProvider::Neon {
                                        "Live queries for this branch. The grid watches the rows it is showing, with its filter and sort."
                                    } else {
                                        "Streams inserts, updates and deletes for tables in the supabase_realtime publication."
                                    },
                                ),
                            ),
                    )
                    .when(neon_rls, |d| {
                        d.child(
                            div()
                                .flex()
                                .gap_2()
                                .rounded(px(8.))
                                .border_1()
                                .border_color(with_alpha(tw("amber-500"), 0.4))
                                .bg(with_alpha(tw("amber-500"), 0.1))
                                .p_2()
                                .text_color(if t.dark { tw("amber-300") } else { tw("amber-700") })
                                .child(Icon::new(IconName::TriangleAlert).size(px(14.)).mt(px(2.)))
                                .child(
                                    div()
                                        .child(div().font_weight(FontWeight::MEDIUM).child(
                                            "Neon doesn't support row-level security in Realtime",
                                        ))
                                        .child(div().opacity(0.9).child(format!(
                                            "\"{table}\" has RLS enabled, and Neon Realtime (beta) rejects live queries on RLS tables. Live updates can't run here until Neon adds support. Use Auto-refresh, or disable RLS on this table if nothing relies on its policies."
                                        ))),
                                ),
                        )
                    })
                    .when_some(settings_error.clone(), |d, err| d.child(div().text_color(t.destructive).child(err)))
                    .child(match provider {
                        RealtimeProvider::Neon => neon_settings_panel(this.clone(), neon_state.clone(), busy, cx),
                        RealtimeProvider::Supabase => {
                            supabase_settings_panel(this.clone(), supabase_state.clone(), busy, cx)
                        }
                    })
                    .child({
                        let this = this.clone();
                        let blocked = live_blocked;
                        let subtitle = blocked.map(|s| s.to_string()).unwrap_or_else(|| {
                            format!("Refresh the grid on change · {status_label}")
                        });
                        div()
                            .flex()
                            .items_center()
                            .justify_between()
                            .gap_2()
                            .child(
                                div()
                                    .child(div().child("Live updates"))
                                    .child(div().text_color(t.muted_foreground).child(subtitle)),
                            )
                            .child(
                                Switch::new("realtime-live")
                                    .checked(live)
                                    .disabled(!live && (!can_go_live || blocked.is_some()))
                                    .on_change(move |v, window, cx| {
                                        if let Some(this) = this.upgrade() {
                                            this.update(cx, |this, cx| this.set_realtime_live(v, window, cx));
                                        }
                                    }),
                            )
                    })
                    .when(error.as_ref().is_some_and(|_| !neon_rls), |d| {
                        let this = this.clone();
                        let message = error.as_ref().map(|(m, _)| m.clone()).unwrap_or_default();
                        d.child(
                            div()
                                .flex()
                                .items_start()
                                .justify_between()
                                .gap_2()
                                .child(div().min_w_0().text_color(t.destructive).child(message))
                                .child(
                                    Button::new("realtime-retry")
                                        .ghost()
                                        .size(ButtonSize::Sm)
                                        .child(div().tw_text_xs().child("Retry"))
                                        .on_click(move |_, window, cx| {
                                            if let Some(this) = this.upgrade() {
                                                this.update(cx, |this, cx| this.retry_realtime(window, cx));
                                            }
                                        }),
                                ),
                        )
                    })
            })
            .into_any_element(),
    )
}

fn neon_settings_panel(
    this: gpui::WeakEntity<TableEditor>,
    neon_state: Option<NeonRealtimeState>,
    busy: bool,
    cx: &App,
) -> AnyElement {
    let t = cx.tokens().clone();
    let pending = neon_state.as_ref().is_some_and(|s| s.pending);
    let enabled = neon_state.as_ref().is_some_and(|s| s.enabled);
    let status_label = match &neon_state {
        None => "…".to_string(),
        Some(s) if s.pending => "Applying…".into(),
        Some(s) if s.enabled => "Enabled".into(),
        Some(_) => "Disabled".into(),
    };
    let invocation = neon_state.as_ref().and_then(|s| s.invocation_url.clone());
    div()
        .flex()
        .flex_col()
        .gap_2()
        .rounded(px(8.))
        .border_1()
        .border_color(with_alpha(t.border, 0.6))
        .p_2()
        .child(
            div()
                .flex()
                .items_center()
                .justify_between()
                .gap_2()
                .child(div().text_color(t.muted_foreground).child("Branch"))
                .child(div().font_weight(FontWeight::MEDIUM).child(status_label)),
        )
        .when_some(invocation, |d, url| {
            d.child(
                div()
                    .font_family(rexa_ui::MONO)
                    .text_size(px(11.))
                    .text_color(t.muted_foreground)
                    .whitespace_nowrap()
                    .overflow_hidden()
                    .text_ellipsis()
                    .child(url),
            )
        })
        .child(if enabled {
            let (this_a, this_b) = (this.clone(), this.clone());
            div()
                .flex()
                .gap_2()
                .child(
                    div().flex_1().child(
                        Button::new("neon-rotate")
                            .outline()
                            .size(ButtonSize::Sm)
                            .w_full()
                            .child(div().tw_text_xs().child("Rotate secret"))
                            .disabled(busy || pending)
                            .on_click(move |_, window, cx| {
                                if let Some(this) = this_a.upgrade() {
                                    this.update(cx, |this, cx| this.rotate_neon_realtime(window, cx));
                                }
                            }),
                    ),
                )
                .child(
                    div().flex_1().child(
                        Button::new("neon-disable")
                            .outline()
                            .size(ButtonSize::Sm)
                            .w_full()
                            .child(div().tw_text_xs().text_color(t.destructive).child("Disable"))
                            .disabled(busy || pending)
                            .on_click(move |_, window, cx| {
                                if let Some(this) = this_b.upgrade() {
                                    this.update(cx, |this, cx| this.disable_neon_realtime(window, cx));
                                }
                            }),
                    ),
                )
                .into_any_element()
        } else {
            let this = this.clone();
            Button::new("neon-enable")
                .size(ButtonSize::Sm)
                .w_full()
                .child(div().tw_text_xs().child(if busy { "Working…" } else { "Enable Realtime" }))
                .disabled(busy || neon_state.is_none() || pending)
                .on_click(move |_, window, cx| {
                    if let Some(this) = this.upgrade() {
                        this.update(cx, |this, cx| this.enable_neon_realtime(window, cx));
                    }
                })
                .into_any_element()
        })
        .into_any_element()
}

fn supabase_settings_panel(
    this: gpui::WeakEntity<TableEditor>,
    state: Option<SupabaseTableRealtimeStatus>,
    busy: bool,
    cx: &App,
) -> AnyElement {
    let t = cx.tokens().clone();
    let published = state.as_ref().is_some_and(|s| s.published);
    let full = state.as_ref().is_some_and(|s| s.full_replica_identity);
    let ready = state.is_some();
    let (this_a, this_b) = (this.clone(), this.clone());
    div()
        .flex()
        .flex_col()
        .gap_2()
        .rounded(px(8.))
        .border_1()
        .border_color(with_alpha(t.border, 0.6))
        .p_2()
        .child(
            div()
                .flex()
                .items_center()
                .justify_between()
                .gap_2()
                .child(
                    div()
                        .child(div().child("Publish changes"))
                        .child(div().text_color(t.muted_foreground).child("Add to supabase_realtime")),
                )
                .child(
                    Switch::new("sb-publish")
                        .checked(published)
                        .disabled(busy || !ready)
                        .on_change(move |v, window, cx| {
                            if let Some(this) = this_a.upgrade() {
                                this.update(cx, |this, cx| this.set_supabase_realtime(Some(v), None, window, cx));
                            }
                        }),
                ),
        )
        .child(
            div()
                .flex()
                .items_center()
                .justify_between()
                .gap_2()
                .child(
                    div()
                        .child(div().child("Include old values"))
                        .child(div().text_color(t.muted_foreground).child("REPLICA IDENTITY FULL")),
                )
                .child(
                    Switch::new("sb-replica")
                        .checked(full)
                        .disabled(busy || !ready)
                        .on_change(move |v, window, cx| {
                            if let Some(this) = this_b.upgrade() {
                                this.update(cx, |this, cx| this.set_supabase_realtime(None, Some(v), window, cx));
                            }
                        }),
                ),
        )
        .into_any_element()
}

impl TableEditor {
    pub(crate) fn primary_key_columns(&self) -> Vec<String> {
        self.structure
            .iter()
            .filter(|c| c.is_primary_key)
            .map(|c| c.column_name.clone())
            .collect()
    }

    pub(crate) fn ensure_realtime_settings(&mut self, _window: &mut Window, cx: &mut Context<Self>) {
        if self.realtime.neon.is_some() || self.realtime.supabase.is_some() || self.realtime.busy {
            self.maybe_poll_neon_pending(cx);
            return;
        }
        self.load_realtime_settings(cx);
    }

    fn load_realtime_settings(&mut self, cx: &mut Context<Self>) {
        let Some(provider) = realtime_provider_for(self.connection_string()) else {
            return;
        };
        self.realtime.settings_error = None;
        match provider {
            RealtimeProvider::Neon => {
                let Some(pointer) = neon_oauth::parse_pointer(self.connection_string()) else {
                    return;
                };
                let task = runtime::spawn(async move {
                    neon_oauth::get_realtime_state(&pointer.profile, &pointer.project_id, &pointer.branch_id).await
                });
                cx.spawn(async move |this, cx| {
                    let result = task.await;
                    this.update(cx, |this, cx| {
                        match result {
                            Ok(state) => {
                                this.realtime.neon = Some(state);
                                this.maybe_poll_neon_pending(cx);
                                this.maybe_retry_after_pending(cx);
                            }
                            Err(e) => this.realtime.settings_error = Some(e.to_string()),
                        }
                        cx.notify();
                    })
                    .ok();
                })
                .detach();
            }
            RealtimeProvider::Supabase => {
                let driver = self.driver.clone();
                let (schema, table) = (self.table.schema.clone(), self.table.name.clone());
                let task = runtime::spawn(async move {
                    supabase::get_table_realtime_status(driver.as_ref(), &schema, &table).await
                });
                cx.spawn(async move |this, cx| {
                    let result = task.await;
                    this.update(cx, |this, cx| {
                        match result {
                            Ok(state) => this.realtime.supabase = Some(state),
                            Err(e) => this.realtime.settings_error = Some(e.to_string()),
                        }
                        cx.notify();
                    })
                    .ok();
                })
                .detach();
            }
        }
    }

    fn maybe_poll_neon_pending(&mut self, cx: &mut Context<Self>) {
        if !self.realtime.neon.as_ref().is_some_and(|s| s.pending) {
            self.realtime.poll = None;
            return;
        }
        if self.realtime.poll.is_some() {
            return;
        }
        self.realtime.poll = Some(cx.spawn(async move |this, cx| {
            cx.background_executor()
                .timer(std::time::Duration::from_millis(POLL_MS))
                .await;
            this.update(cx, |this, cx| {
                this.realtime.poll = None;
                this.load_realtime_settings(cx);
            })
            .ok();
        }));
    }

    fn maybe_retry_after_pending(&mut self, cx: &mut Context<Self>) {
        if self.realtime.live
            && self
                .realtime
                .error
                .as_ref()
                .is_some_and(|(_, c)| *c == Some(REALTIME_ERROR.pending))
            && self.realtime.neon.as_ref().is_some_and(|s| s.enabled && !s.pending)
        {
            self.retry_realtime_inner(cx);
        }
    }

    pub(crate) fn set_realtime_live(&mut self, live: bool, _window: &mut Window, cx: &mut Context<Self>) {
        if live == self.realtime.live {
            return;
        }
        self.realtime.live = live;
        if live {
            self.start_realtime_watch(cx);
        } else {
            self.stop_realtime_watch(cx);
        }
        cx.notify();
    }

    pub(crate) fn retry_realtime(&mut self, _window: &mut Window, cx: &mut Context<Self>) {
        self.retry_realtime_inner(cx);
    }

    fn retry_realtime_inner(&mut self, cx: &mut Context<Self>) {
        self.realtime.attempt = self.realtime.attempt.wrapping_add(1);
        if self.realtime.live {
            self.start_realtime_watch(cx);
        }
        cx.notify();
    }

    pub(crate) fn stop_realtime_watch(&mut self, cx: &mut Context<Self>) {
        self.realtime.watch = None;
        self.realtime.pump = None;
        self.realtime.status = TableRealtimeStatus::Off;
        self.realtime.error = None;
        take_events(cx.entity().entity_id());
        take_refresh(cx.entity().entity_id());
        cx.notify();
    }

    pub(crate) fn start_realtime_watch(&mut self, cx: &mut Context<Self>) {
        self.realtime.watch = None;
        self.realtime.pump = None;
        self.realtime.status = TableRealtimeStatus::Connecting;
        self.realtime.error = None;
        let request = TableWatchRequest {
            connection_string: self.connection_string().to_string(),
            schema: self.table.schema.clone(),
            table: self.table.name.clone(),
            primary_key: self.primary_key_columns(),
            filter: self.filter_query.clone(),
            sort: self.sort.clone(),
            limit: self.page_size,
            offset: self.page.saturating_mul(self.page_size),
        };
        if realtime_provider_for(&request.connection_string) == Some(RealtimeProvider::Supabase) {
            if let Some(state) = &self.realtime.supabase {
                if !state.published {
                    let (code, message) = supabase::not_published_error(&request.schema, &request.table);
                    self.realtime.status = TableRealtimeStatus::Error;
                    self.realtime.error = Some((message, Some(code)));
                    cx.notify();
                    return;
                }
            }
        }

        let id = cx.entity().entity_id();
        let handle = start_table_watch(
            request,
            Arc::new(move |event| push_event(id, event)),
            Arc::new(move || push_refresh(id)),
        );
        self.realtime.watch = Some(handle);
        self.realtime.pump = Some(cx.spawn(async move |this, cx| loop {
            cx.background_executor()
                .timer(std::time::Duration::from_millis(50))
                .await;
            let stop = this
                .update(cx, |this, cx| {
                    if this.realtime.watch.is_none() {
                        return true;
                    }
                    let id = cx.entity().entity_id();
                    for event in take_events(id) {
                        this.realtime.status = status_from_event(&event, this.realtime.status);
                        if let TableWatchEvent::Error { message, code } = event {
                            this.realtime.error = Some((message, code));
                        }
                    }
                    if take_refresh(id) && !this.loading && !this.fetching_structure {
                        this.refresh_current_tab(cx);
                    }
                    cx.notify();
                    false
                })
                .unwrap_or(true);
            if stop {
                break;
            }
        }));
        cx.notify();
    }

    pub(crate) fn enable_neon_realtime(&mut self, _window: &mut Window, cx: &mut Context<Self>) {
        let Some(pointer) = neon_oauth::parse_pointer(self.connection_string()) else {
            return;
        };
        let ok = rexa_ui::confirm(
            ConfirmOptions::new("Enable Neon Realtime?")
                .description("This permanently sets wal_level to logical for the whole project and restarts every compute on all branches, dropping active connections. Disabling Realtime later does not turn logical replication off.")
                .confirm_text("Enable Realtime"),
            cx,
        );
        cx.spawn(async move |this, cx| {
            if !ok.await {
                return;
            }
            this.update(cx, |this, cx| {
                this.realtime.busy = true;
                cx.notify();
            })
            .ok();
            let task = runtime::spawn(async move {
                neon_oauth::enable_realtime(&pointer.profile, &pointer.project_id, &pointer.branch_id, None).await
            });
            let result = task.await;
            this.update(cx, |this, cx| {
                this.realtime.busy = false;
                match result {
                    Ok(()) => {
                        Toast::success("Realtime is being enabled on this branch.").show(cx);
                        this.load_realtime_settings(cx);
                    }
                    Err(e) => {
                        Toast::error(e.to_string()).show(cx);
                    }
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    pub(crate) fn disable_neon_realtime(&mut self, _window: &mut Window, cx: &mut Context<Self>) {
        let Some(pointer) = neon_oauth::parse_pointer(self.connection_string()) else {
            return;
        };
        let ok = rexa_ui::confirm(
            ConfirmOptions::destructive("Disable Neon Realtime?")
                .description("Live queries on this branch stop and the shared secret is discarded.")
                .confirm_text("Disable"),
            cx,
        );
        cx.spawn(async move |this, cx| {
            if !ok.await {
                return;
            }
            this.update(cx, |this, cx| {
                this.realtime.live = false;
                this.stop_realtime_watch(cx);
                this.realtime.busy = true;
                cx.notify();
            })
            .ok();
            let task = runtime::spawn(async move {
                neon_oauth::disable_realtime(&pointer.profile, &pointer.project_id, &pointer.branch_id).await
            });
            let result = task.await;
            this.update(cx, |this, cx| {
                this.realtime.busy = false;
                match result {
                    Ok(()) => {
                        Toast::success("Realtime disabled.").show(cx);
                        this.load_realtime_settings(cx);
                    }
                    Err(e) => {
                        Toast::error(e.to_string()).show(cx);
                    }
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    pub(crate) fn rotate_neon_realtime(&mut self, _window: &mut Window, cx: &mut Context<Self>) {
        let Some(pointer) = neon_oauth::parse_pointer(self.connection_string()) else {
            return;
        };
        let ok = rexa_ui::confirm(
            ConfirmOptions::new("Rotate the Realtime secret?")
                .description("Apps sealing queries with the current NEON_REALTIME_SECRET must be updated once rotation finishes.")
                .confirm_text("Rotate"),
            cx,
        );
        cx.spawn(async move |this, cx| {
            if !ok.await {
                return;
            }
            this.update(cx, |this, cx| {
                this.realtime.busy = true;
                cx.notify();
            })
            .ok();
            let task = runtime::spawn(async move {
                neon_oauth::rotate_realtime_secret(&pointer.profile, &pointer.project_id, &pointer.branch_id).await
            });
            let result = task.await;
            this.update(cx, |this, cx| {
                this.realtime.busy = false;
                match result {
                    Ok(()) => {
                        Toast::success("Secret rotation requested.").show(cx);
                        this.load_realtime_settings(cx);
                    }
                    Err(e) => {
                        Toast::error(e.to_string()).show(cx);
                    }
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    pub(crate) fn set_supabase_realtime(
        &mut self,
        published: Option<bool>,
        full_replica_identity: Option<bool>,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.realtime.busy = true;
        cx.notify();
        let driver = self.driver.clone();
        let (schema, table) = (self.table.schema.clone(), self.table.name.clone());
        let task = runtime::spawn(async move {
            supabase::set_table_realtime(driver.as_ref(), &schema, &table, published, full_replica_identity).await
        });
        let turn_off = published == Some(false);
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |this, cx| {
                this.realtime.busy = false;
                match result {
                    Ok(state) => {
                        this.realtime.supabase = Some(state);
                        if turn_off {
                            this.realtime.live = false;
                            this.stop_realtime_watch(cx);
                        } else if this.realtime.live
                            && this
                                .realtime
                                .error
                                .as_ref()
                                .is_some_and(|(_, c)| *c == Some(REALTIME_ERROR.not_published))
                        {
                            this.retry_realtime_inner(cx);
                        }
                    }
                    Err(e) => {
                        Toast::error(e.to_string()).show(cx);
                    }
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    /// Live is per table: switching tables starts with it off.
    #[allow(dead_code)]
    pub(crate) fn reset_realtime_for_table(&mut self, cx: &mut Context<Self>) {
        self.realtime.live = false;
        self.realtime.neon = None;
        self.realtime.supabase = None;
        self.realtime.settings_error = None;
        self.stop_realtime_watch(cx);
    }
}
