//! Port of components/transfer/transfer-project-screen.tsx and
//! components/transfer/transfer-wizard.tsx (+ the polling half of
//! lib/transfer/transfer-client.ts).
//!
//! `Route::ConnectionScreen("transfer" | "transfer:<source id>")`: the
//! connections home stays rendered behind a `bg-black/40` overlay and the
//! wizard sits in a `DialogContent p-4 sm:max-w-[472px] max-h-[88vh]`
//! (Escape / outside clicks do nothing, as in the original).
//!
//! Approximations: the connection-type badge inside Select items is not
//! drawn (the rexa-ui Select has no item slot); `rounded-full` select
//! triggers keep the Select primitive's radius; progress is pushed from the
//! transfer task and repainted every 250 ms instead of the 1 s HTTP poll.

use super::adapters::Endpoint;
use super::service::{claim_destination, export_package, new_transfer_id, release_destination, transfer_project, ProgressSink};
use super::types::*;
use gpui::{div, percentage, prelude::*, px, Animation, AnimationExt, AnyView, App, AppContext, Context, Entity, FocusHandle, FontWeight, Hsla, SharedString, Window};
use rexa_core::{runtime, Registry, Route};
use rexa_store::SavedConnection;
use rexa_ui::widgets::Icon;
use rexa_ui::{tight, tw, with_alpha, ActiveTokens, Button, ButtonSize, Checkbox, Dialog, IconName, Select, SelectOption, Toast, Tooltip, Tw, MONO};
use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use std::time::Duration;

#[derive(Clone, Copy, PartialEq, Debug)]
enum WizardStep {
    SelectSources,
    SelectOptions,
    Confirm,
    Transferring,
    Complete,
    Error,
}

#[derive(Clone)]
struct LogEntry {
    step: TransferStep,
    message: String,
    at: i64,
    time: String,
    item: Option<String>,
}

#[derive(Default)]
struct Shared {
    progress: Option<TransferProgress>,
    log: Vec<LogEntry>,
}

/// `recordProgress`: one rolling entry per (step, message), capped at 300.
fn record(shared: &mut Shared, p: TransferProgress) {
    let now = chrono::Local::now();
    let at = now.timestamp_millis();
    let time = now.format("%H:%M:%S").to_string();
    match shared.log.last_mut() {
        Some(last) if last.step == p.current_step && last.message == p.message => {
            last.at = at;
            last.time = time;
            if p.item.is_some() {
                last.item = p.item.clone();
            }
        }
        _ => {
            shared.log.push(LogEntry { step: p.current_step, message: p.message.clone(), at, time, item: p.item.clone() });
            if shared.log.len() > 300 {
                let drop = shared.log.len() - 300;
                shared.log.drain(..drop);
            }
        }
    }
    shared.progress = Some(p);
}

fn format_elapsed(ms: i64) -> String {
    let s = ((ms.max(0) as f64) / 1000.0).round() as i64;
    if s < 60 {
        format!("{s}s")
    } else {
        format!("{}m {}s", s / 60, s % 60)
    }
}

#[derive(Clone, Copy)]
enum Component {
    Database,
    Storage,
    Auth,
    Settings,
    Functions,
}

/// `COMPONENTS`
const COMPONENTS: [(Component, IconName, &str, &str); 5] = [
    (Component::Database, IconName::Database, "Database schema & data", "Tables, schemas and row data up to the per-table cap — including Neon Auth's neon_auth tables."),
    (Component::Storage, IconName::HardDrive, "Storage buckets & files", "Supabase buckets plus file metadata. File contents never migrate over SQL."),
    (Component::Auth, IconName::Shield, "Authentication users & providers", "Supabase GoTrue users with password hashes when readable, identity links and OAuth providers."),
    (Component::Settings, IconName::Settings, "Project settings", "Project-level settings snapshot."),
    (Component::Functions, IconName::Zap, "Edge functions", "Sources migrate with git-style compat diffs. Cross-runtime drafts stage for review, not auto-deployed."),
];

fn flag(o: &mut TransferOptions, c: Component) -> &mut bool {
    match c {
        Component::Database => &mut o.include_database,
        Component::Storage => &mut o.include_storage,
        Component::Auth => &mut o.include_auth,
        Component::Settings => &mut o.include_settings,
        Component::Functions => &mut o.include_edge_functions,
    }
}

pub struct TransferScreen {
    home: Option<AnyView>,
    connections: Vec<SavedConnection>,
    step: WizardStep,
    source: Option<i64>,
    destination: Option<i64>,
    options: TransferOptions,
    shared: Arc<Mutex<Shared>>,
    progress: Option<TransferProgress>,
    log: Vec<LogEntry>,
    expanded: Option<TransferStep>,
    expanded_diffs: HashSet<usize>,
    error: Option<String>,
    result: Option<TransferResult>,
    transferring: bool,
    focus: FocusHandle,
}

pub fn build(route: &Route, window: &mut Window, cx: &mut App) -> Option<AnyView> {
    let Route::ConnectionScreen(s) = route else { return None };
    let initial = if s == "transfer" {
        None
    } else {
        Some(s.strip_prefix("transfer:")?.parse::<i64>().ok())
    };
    let home = Registry::build_screen(&Route::Connections, window, cx);
    let view: Entity<TransferScreen> = cx.new(|cx| TransferScreen::new(home, initial.flatten(), window, cx));
    Some(view.into())
}

impl TransferScreen {
    fn new(home: Option<AnyView>, initial_source: Option<i64>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let connections = rexa_store::Store::open().and_then(|s| s.connections()).unwrap_or_default();
        let source = initial_source.filter(|id| connections.iter().any(|c| c.id == *id));
        let focus = cx.focus_handle();
        window.focus(&focus, cx);
        Self {
            home,
            connections,
            step: WizardStep::SelectSources,
            source,
            destination: None,
            options: TransferOptions::default(),
            shared: Default::default(),
            progress: None,
            log: Vec::new(),
            expanded: None,
            expanded_diffs: HashSet::new(),
            error: None,
            result: None,
            transferring: false,
            focus,
        }
    }

    fn conn(&self, id: Option<i64>) -> Option<&SavedConnection> {
        self.connections.iter().find(|c| Some(c.id) == id)
    }

    fn dest_provider(&self) -> Option<ProviderType> {
        self.conn(self.destination).map(|c| ProviderType::from_connection_type(&c.kind))
    }

    /// `unsupportedNotice`
    fn unsupported_notice(&self) -> Option<String> {
        let p = self.dest_provider()?;
        if matches!(p, ProviderType::Supabase | ProviderType::Neon) {
            return None;
        }
        let parts: Vec<&str> = [self.options.include_storage.then_some("storage buckets/files"), self.options.include_auth.then_some("GoTrue users/providers")]
            .into_iter()
            .flatten()
            .collect();
        if parts.is_empty() {
            return None;
        }
        let name = if p == ProviderType::Generic { "This destination".to_string() } else { format!("A {} destination", p.as_str()) };
        Some(format!(
            "{name} has no Supabase-compatible storage or auth schemas: {} will be skipped with a warning, not transferred. Ordinary tables migrate with the database.",
            parts.join(" and ")
        ))
    }

    fn can_proceed(&self) -> bool {
        if self.step == WizardStep::SelectSources {
            return self.source.is_some() && self.destination.is_some() && self.source != self.destination;
        }
        true
    }

    fn next(&mut self, cx: &mut Context<Self>) {
        match self.step {
            WizardStep::SelectSources => self.step = WizardStep::SelectOptions,
            WizardStep::SelectOptions => self.step = WizardStep::Confirm,
            WizardStep::Confirm => return self.start(cx),
            _ => {}
        }
        cx.notify();
    }

    fn prev(&mut self, cx: &mut Context<Self>) {
        match self.step {
            WizardStep::SelectOptions => self.step = WizardStep::SelectSources,
            WizardStep::Confirm => self.step = WizardStep::SelectOptions,
            _ => {}
        }
        cx.notify();
    }

    fn reset(&mut self, cx: &mut Context<Self>) {
        self.shared = Default::default();
        self.log.clear();
        self.expanded = None;
        self.step = WizardStep::SelectSources;
        self.progress = None;
        self.error = None;
        self.result = None;
        self.transferring = false;
        cx.notify();
    }

    fn close(cx: &mut App) {
        rexa_core::navigate(Route::Connections, cx);
    }

    /// Resolve credentials + dedicated drivers for one side.
    fn endpoint_task(c: SavedConnection, vault: Option<Arc<rexa_store::Vault>>) -> impl std::future::Future<Output = anyhow::Result<Endpoint>> + Send {
        async move {
            let creds = tokio::task::spawn_blocking({
                let c = c.clone();
                move || rexa_store::resolve_credentials(&c, vault.as_deref())
            })
            .await??;
            let db = rexa_drivers::connect_detect(&c.kind, &creds.connection_string).await?;
            Ok(Endpoint { provider: ProviderType::from_connection_type(&c.kind), connection_string: creds.connection_string, db })
        }
    }

    /// `handleStartTransfer` + `handleTransferStart` / `executeTransfer`.
    fn start(&mut self, cx: &mut Context<Self>) {
        if self.transferring {
            return;
        }
        let (Some(src), Some(dst)) = (self.conn(self.source).cloned(), self.conn(self.destination).cloned()) else {
            self.error = Some("Please select both source and destination connections".into());
            self.step = WizardStep::Error;
            cx.notify();
            return;
        };
        self.transferring = true;
        self.step = WizardStep::Transferring;
        self.error = None;
        self.shared = Default::default();
        cx.notify();
        let shared = self.shared.clone();
        let options = self.options.clone();
        let vault = rexa_core::credential_vault(cx);
        let sink_shared = shared.clone();
        let sink: ProgressSink = Arc::new(move |p| record(&mut sink_shared.lock().unwrap(), p));
        sink(TransferProgress {
            current_step: TransferStep::Validating,
            total_steps: 1,
            current_step_index: 0,
            percentage: 0,
            message: "Starting transfer...".into(),
            item: None,
            error: None,
        });
        let task = runtime::spawn(async move {
            let lock_key = format!("conn:{}", dst.id);
            let id = new_transfer_id();
            if let Err(clash) = claim_destination(&lock_key, &id) {
                return Ok(TransferResult { success: false, error: Some(clash), ..Default::default() });
            }
            let result = async {
                let s = match Self::endpoint_task(src, vault.clone()).await {
                    Ok(s) => s,
                    Err(_) => return TransferResult { success: false, error: Some("Source connection validation failed".into()), ..Default::default() },
                };
                let d = match Self::endpoint_task(dst, vault).await {
                    Ok(d) => d,
                    Err(_) => return TransferResult { success: false, error: Some("Destination connection validation failed".into()), ..Default::default() },
                };
                transfer_project(&s, &d, &options, sink).await
            }
            .await;
            release_destination(&lock_key, &id);
            Ok(result)
        });
        cx.spawn(async move |this, cx| {
            let done = Arc::new(Mutex::new(None::<anyhow::Result<TransferResult>>));
            let d2 = done.clone();
            let io = cx.background_executor().spawn(async move {
                let r = task.await;
                *d2.lock().unwrap() = Some(r);
            });
            loop {
                cx.background_executor().timer(Duration::from_millis(250)).await;
                let finished = done.lock().unwrap().take();
                let alive = this
                    .update(cx, |this, cx| {
                        let s = shared.lock().unwrap();
                        this.progress = s.progress.clone();
                        this.log = s.log.clone();
                        drop(s);
                        if let Some(r) = &finished {
                            match r {
                                Ok(r) if r.success => this.step = WizardStep::Complete,
                                Ok(r) => {
                                    this.error = Some(r.error.clone().unwrap_or_else(|| "Transfer failed".into()));
                                    this.step = WizardStep::Error;
                                }
                                Err(e) => {
                                    this.error = Some(format!("{e:#}"));
                                    this.step = WizardStep::Error;
                                }
                            }
                            this.result = r.as_ref().ok().cloned();
                            this.transferring = false;
                        }
                        cx.notify();
                    })
                    .is_ok();
                if finished.is_some() || !alive {
                    break;
                }
            }
            drop(io);
        })
        .detach();
    }

    /// `handleExportPackage`
    fn export_package(&mut self, cx: &mut Context<Self>) {
        let Some(src) = self.conn(self.source).cloned() else { return };
        let options = self.options.clone();
        let vault = rexa_core::credential_vault(cx);
        let suggested = format!("transfer-package-{}-{}.json", src.name, chrono::Utc::now().timestamp_millis());
        let dir = std::env::var("HOME").map(|h| std::path::PathBuf::from(h).join("Downloads")).unwrap_or_default();
        let prompt = cx.prompt_for_new_path(&dir, Some(&suggested));
        self.transferring = true;
        self.error = None;
        cx.notify();
        cx.spawn(async move |this, cx| {
            let result: anyhow::Result<bool> = async {
                let Ok(Ok(Some(path))) = prompt.await else { return Ok(false) };
                let json = runtime::spawn(async move {
                    let ep = Self::endpoint_task(src, vault).await?;
                    export_package(&ep, &options).await
                })
                .await?;
                std::fs::write(path, json)?;
                Ok(true)
            }
            .await;
            this.update(cx, |this, cx| {
                this.transferring = false;
                match result {
                    Ok(true) => {
                        Toast::success("Transfer package exported successfully").show(cx);
                    }
                    Ok(false) => {}
                    Err(e) => {
                        this.error = Some(format!("{e:#}"));
                        this.step = WizardStep::Error;
                    }
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    fn handle_done(&mut self, cx: &mut Context<Self>) {
        // onComplete / onCancel both return to the connections list.
        let _ = self.result.as_ref().is_some_and(|r| r.success);
        Self::close(cx);
    }
}

// ---- rendering -----------------------------------------------------------------

fn card(t: &rexa_ui::Tokens) -> gpui::Div {
    div().overflow_hidden().rounded(px(16.)).border_1().border_color(t.border).bg(t.card).shadow(rexa_ui::popup::shadow_sm())
}

/// `statusPill`
fn status_pill(t: &rexa_ui::Tokens, text: impl Into<SharedString>, tone: Option<(Hsla, Hsla)>, radius: f32) -> impl IntoElement {
    let (border, bg, fg) = match tone {
        Some((c, fg)) => (with_alpha(c, 0.3), with_alpha(c, if c == t.destructive { 0.05 } else { 0.1 }), fg),
        None => (t.border, t.card, t.muted_foreground),
    };
    div()
        .mx_auto()
        .mt_5()
        .flex()
        .w_full()
        .max_w(px(440.))
        .items_center()
        .justify_center()
        .rounded(px(radius))
        .border_1()
        .border_color(border)
        .bg(bg)
        .px_8()
        .py_3()
        .shadow(rexa_ui::popup::shadow_sm())
        .child(div().text_center().tw_text_xs().line_height(px(19.5)).text_color(fg).child(text.into()))
}

/// `pillButton`: rexa-raised h-11 flex-1 rounded-full border bg-card px-8 text-sm font-medium.
fn pill_button(id: &'static str, t: &rexa_ui::Tokens, disabled: bool, content: impl IntoElement, on: impl Fn(&mut Window, &mut App) + 'static) -> impl IntoElement {
    let raised = t.dark;
    div()
        .id(id)
        .h_11()
        .flex_1()
        .flex()
        .items_center()
        .justify_center()
        .gap_2()
        .rounded_full()
        .border_1()
        .border_color(if raised { rexa_ui::white(0.2) } else { t.border })
        .bg(t.card)
        .px_8()
        .tw_text_sm()
        .font_weight(FontWeight::MEDIUM)
        .text_color(t.foreground)
        .shadow(rexa_ui::popup::shadow_sm())
        .when(disabled, |d| d.opacity(0.5))
        .when(!disabled, |d| d.cursor_pointer().hover(|s| s.bg(with_alpha(t.muted, 0.5))).on_click(move |_, w, cx| on(w, cx)))
        .child(content)
}

fn small_badge(text: &'static str, color: &str) -> impl IntoElement {
    let c = tw(color);
    div()
        .flex_shrink_0()
        .px_2()
        .py(px(1.))
        .rounded_full()
        .border_1()
        .border_color(with_alpha(tw(&color.replace("600", "500")), 0.4))
        .text_size(px(10.))
        .line_height(px(15.))
        .font_weight(FontWeight::MEDIUM)
        .text_color(c)
        .child(text)
}

fn spin_icon(color: Hsla) -> impl IntoElement {
    Icon::new(IconName::LoaderCircle)
        .size_4()
        .flex_shrink_0()
        .text_color(color)
        .with_animation("transfer-spin", Animation::new(Duration::from_secs(1)).repeat(), |i, t| i.rotate(percentage(t)))
}

impl TransferScreen {
    fn render_progress(&self, t: &rexa_ui::Tokens, cx: &mut Context<Self>) -> impl IntoElement {
        let steps = transfer_steps(&self.options);
        let run_index = self.progress.as_ref().and_then(|p| steps.iter().position(|s| *s == p.current_step));
        let complete = self.progress.as_ref().is_some_and(|p| p.current_step == TransferStep::Complete);
        let errored = self.progress.as_ref().is_some_and(|p| p.error.is_some());
        let green = tw("green-500");
        card(t).children(steps.iter().enumerate().map(|(i, step)| {
            let step = *step;
            let done = complete || run_index.is_some_and(|r| r > i);
            let failed = errored && run_index == Some(i);
            let active = run_index == Some(i) && !done && !failed;
            let entries: Vec<&LogEntry> = self.log.iter().filter(|e| e.step == step).collect();
            let elapsed = entries.first().zip(entries.last()).map(|(a, b)| format_elapsed(b.at - a.at));
            let expanded = self.expanded == Some(step);
            let has = !entries.is_empty();
            let icon = if failed {
                Icon::new(IconName::CircleX).size_4().flex_shrink_0().text_color(t.destructive).into_any_element()
            } else if done {
                Icon::new(IconName::CircleCheck).size_4().flex_shrink_0().text_color(green).into_any_element()
            } else if active {
                spin_icon(t.primary).into_any_element()
            } else {
                Icon::new(IconName::Circle).size_4().flex_shrink_0().opacity(0.4).into_any_element()
            };
            div()
                .when(i > 0, |d| d.border_t_1().border_color(with_alpha(t.border, 0.6)))
                .child(
                    div()
                        .id(("transfer-step", i))
                        .flex()
                        .w_full()
                        .items_center()
                        .gap(px(10.))
                        .px_4()
                        .py(px(10.))
                        .cursor_pointer()
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.expanded = if this.expanded == Some(step) { None } else { Some(step) };
                            cx.notify();
                        }))
                        .child(icon)
                        .child(
                            div()
                                .min_w_0()
                                .flex_1()
                                .truncate()
                                .tw_text_sm()
                                .when(active, |d| d.font_weight(FontWeight::MEDIUM).text_color(t.foreground))
                                .when(!active, |d| d.text_color(t.muted_foreground))
                                .child(step.label()),
                        )
                        .children(elapsed.map(|e| div().flex_shrink_0().font_family(MONO).text_size(px(10.)).text_color(t.muted_foreground).child(e)))
                        .when(active, |d| d.child(small_badge("In progress", if t.dark { "amber-400" } else { "amber-600" })))
                        .when(done, |d| d.child(small_badge("Done", if t.dark { "green-400" } else { "green-600" })))
                        .when(has, |d| {
                            d.child(Icon::new(if expanded { IconName::ChevronUp } else { IconName::ChevronDown }).size(px(14.)).flex_shrink_0().text_color(t.muted_foreground))
                        }),
                )
                .when(expanded && has, |d| {
                    let start = entries.len().saturating_sub(25);
                    d.child(
                        div().border_t_1().border_color(with_alpha(t.border, 0.4)).bg(with_alpha(t.muted, 0.2)).px_4().py_2().children(entries[start..].iter().map(|e| {
                            div()
                                .flex()
                                .items_start()
                                .gap_2()
                                .py(px(2.))
                                .font_family(MONO)
                                .text_size(px(11.))
                                .line_height(px(16.5))
                                .child(div().flex_shrink_0().text_color(with_alpha(t.muted_foreground, 0.6)).child(e.time.clone()))
                                .child(
                                    div()
                                        .min_w_0()
                                        .flex_1()
                                        .text_color(t.muted_foreground)
                                        .child(e.message.clone())
                                        .children(e.item.clone().map(|it| div().text_color(with_alpha(t.foreground, 0.8)).child(format!(" — {it}")))),
                                )
                        })),
                    )
                })
        }))
    }

    fn select_card(&self, t: &rexa_ui::Tokens, label: &'static str, id: &'static str, exclude: Option<i64>, value: Option<i64>, placeholder: &'static str, cx: &mut Context<Self>) -> impl IntoElement {
        let this = cx.entity().downgrade();
        let is_source = id == "transfer-source";
        card(t).p_4().child(div().mb(px(6.)).tw_text_xs().font_weight(FontWeight::MEDIUM).text_color(t.muted_foreground).child(label)).child(
            Select::new(id)
                .small()
                .w_full()
                .placeholder(placeholder)
                .options(
                    self.connections
                        .iter()
                        .filter(|c| Some(c.id) != exclude)
                        .map(|c| SelectOption::new(c.id.to_string(), c.name.clone()).icon(IconName::Database)),
                )
                .value(value.map(|v| v.to_string()))
                .on_change(move |v, _, cx| {
                    let id = v.parse::<i64>().ok();
                    this.update(cx, |s, cx| {
                        if is_source {
                            s.source = id;
                            if s.destination == id {
                                s.destination = None;
                            }
                        } else {
                            s.destination = id;
                        }
                        cx.notify();
                    })
                    .ok();
                }),
        )
    }

    fn render_body(&mut self, t: &rexa_ui::Tokens, cx: &mut Context<Self>) -> gpui::AnyElement {
        let amber_fg = if t.dark { tw("amber-300") } else { tw("amber-700") };
        match self.step {
            WizardStep::SelectSources => div()
                .mx_auto()
                .flex()
                .w_full()
                .max_w(px(440.))
                .flex_col()
                .gap_3()
                .child(self.select_card(t, "Source", "transfer-source", None, self.source, "Select source database", cx))
                .child(self.select_card(t, "Destination", "transfer-destination", self.source, self.destination, "Select destination database", cx))
                .when(self.source.is_some() && self.source == self.destination, |d| {
                    d.child(status_pill(t, "Source and destination cannot be the same connection.", Some((t.destructive, t.destructive)), 9999.))
                })
                .into_any_element(),
            WizardStep::SelectOptions => {
                let notice = self.unsupported_notice();
                let can_export = !self.transferring && self.source.is_some();
                div()
                    .flex()
                    .flex_col()
                    .gap_3()
                    .child(card(t).children(COMPONENTS.iter().enumerate().map(|(i, (c, icon, label, desc))| {
                        let c = *c;
                        let checked = *flag(&mut self.options.clone(), c);
                        let toggle = cx.listener(move |this, _: &gpui::ClickEvent, _, cx| {
                            let f = flag(&mut this.options, c);
                            *f = !*f;
                            cx.notify();
                        });
                        let this = cx.entity().downgrade();
                        div()
                            .id(("transfer-component", i))
                            .flex()
                            .items_start()
                            .gap_3()
                            .px_4()
                            .py_3()
                            .cursor_pointer()
                            .hover(|s| s.bg(with_alpha(t.muted, 0.2)))
                            .when(i > 0, |d| d.border_t_1().border_color(with_alpha(t.border, 0.6)))
                            .on_click(toggle)
                            .child(div().mt(px(2.)).child(Checkbox::new(("transfer-check", i)).checked(checked).on_change(move |v, _, cx| {
                                this.update(cx, |s, cx| {
                                    *flag(&mut s.options, c) = v;
                                    cx.notify();
                                })
                                .ok();
                            })))
                            .child(Icon::new(*icon).size_4().mt(px(2.)).flex_shrink_0().text_color(t.muted_foreground))
                            .child(
                                div()
                                    .min_w_0()
                                    .child(div().tw_text_sm().font_weight(FontWeight::MEDIUM).child(*label))
                                    .child(div().mt(px(2.)).tw_text_xs().text_color(t.muted_foreground).child(*desc)),
                            )
                    })))
                    // amber-700 / dark:amber-300 text on an amber-500 tint.
                    .children(notice.map(|n| status_pill(t, n, Some((tw("amber-500"), amber_fg)), 16.)))
                    .child(
                        div().flex().justify_center().child(
                            Button::new("transfer-export-package")
                                .outline()
                                .size(ButtonSize::Sm)
                                .icon(IconName::Download)
                                .label("Export package only")
                                .disabled(!can_export)
                                .on_click(cx.listener(|this, _, _, cx| this.export_package(cx))),
                        ),
                    )
                    .into_any_element()
            }
            WizardStep::Confirm => {
                let dest = self.dest_provider();
                let unsupported = dest.is_some_and(|p| !matches!(p, ProviderType::Supabase | ProviderType::Neon));
                let o = self.options.clone();
                let mut rows: Vec<(IconName, &str, &str)> = Vec::new();
                if o.include_database {
                    rows.push((IconName::Database, "Database", "Schemas are dropped and recreated inside one transaction — a failure rolls back. Row data migrates up to the per-table cap."));
                }
                if o.include_storage {
                    rows.push((
                        IconName::HardDrive,
                        "Storage",
                        if unsupported { "Skipped on this destination: no Supabase-compatible storage schema." } else { "Buckets + metadata migrate. File contents copy when both sides allow it, otherwise skipped with a warning." },
                    ));
                }
                if o.include_auth {
                    rows.push((
                        IconName::Shield,
                        "Auth",
                        if unsupported { "Skipped on this destination: no GoTrue-compatible auth schema." } else { "Passwords migrate when readable, else reset required. OAuth providers need matching config on the destination." },
                    ));
                }
                if o.include_settings {
                    rows.push((IconName::Settings, "Settings", "Project settings snapshot migrates as-is."));
                }
                if o.include_edge_functions {
                    rows.push((IconName::Zap, "Edge functions", "Cross-runtime drafts stage for review only — they deploy only with the opt-in below."));
                }
                let amber_q = if t.dark { tw("amber-400") } else { tw("amber-600") };
                let kv = |k: &'static str, v: String, top: bool| {
                    div()
                        .flex()
                        .items_center()
                        .justify_between()
                        .px_4()
                        .py(px(10.))
                        .when(top, |d| d.border_t_1().border_color(with_alpha(t.border, 0.6)))
                        .child(div().tw_text_xs().text_color(t.muted_foreground).child(k))
                        .child(div().tw_text_xs().font_weight(FontWeight::MEDIUM).child(v))
                };
                let allow = o.allow_auto_ported_deploy;
                let this = cx.entity().downgrade();
                div()
                    .flex()
                    .flex_col()
                    .gap_3()
                    .child(
                        card(t)
                            .child(kv("Source", self.conn(self.source).map(|c| c.name.clone()).unwrap_or_default(), false))
                            .child(kv("Destination", self.conn(self.destination).map(|c| c.name.clone()).unwrap_or_default(), true))
                            .child(
                                div()
                                    .flex()
                                    .flex_col()
                                    .gap_1()
                                    .border_t_1()
                                    .border_color(with_alpha(t.border, 0.6))
                                    .px_4()
                                    .py(px(10.))
                                    .child(div().tw_text_xs().text_color(t.muted_foreground).child("Components"))
                                    .child(div().flex().flex_col().children(rows.into_iter().enumerate().map(|(i, (icon, label, warning))| {
                                        div()
                                            .flex()
                                            .items_center()
                                            .gap_2()
                                            .py_1()
                                            .tw_text_xs()
                                            .child(Icon::new(icon).size(px(14.)).flex_shrink_0().text_color(t.muted_foreground))
                                            .child(div().font_weight(FontWeight::MEDIUM).child(label))
                                            .child(
                                                Tooltip::new(warning).id(("transfer-caveat", i)).delay(150).child(
                                                    div()
                                                        .flex()
                                                        .size_4()
                                                        .flex_shrink_0()
                                                        .items_center()
                                                        .justify_center()
                                                        .rounded_full()
                                                        .border_1()
                                                        .border_color(with_alpha(tw("amber-500"), 0.5))
                                                        .text_size(px(10.))
                                                        .line_height(px(10.))
                                                        .font_weight(FontWeight::MEDIUM)
                                                        .text_color(amber_q)
                                                        .cursor(gpui::CursorStyle::Arrow)
                                                        .child("?"),
                                                ),
                                            )
                                    }))),
                            )
                            .when(o.include_edge_functions, |d| {
                                d.child(
                                    div()
                                        .id("transfer-allow-auto-ported")
                                        .flex()
                                        .items_start()
                                        .gap_3()
                                        .border_t_1()
                                        .border_color(with_alpha(t.border, 0.6))
                                        .px_4()
                                        .py(px(10.))
                                        .cursor_pointer()
                                        .hover(|s| s.bg(with_alpha(t.muted, 0.2)))
                                        .on_click(cx.listener(|this, _, _, cx| {
                                            this.options.allow_auto_ported_deploy = !this.options.allow_auto_ported_deploy;
                                            cx.notify();
                                        }))
                                        .child(div().mt(px(2.)).child(Checkbox::new("transfer-allow-auto-ported-check").checked(allow).on_change(move |v, _, cx| {
                                            this.update(cx, |s, cx| {
                                                s.options.allow_auto_ported_deploy = v;
                                                cx.notify();
                                            })
                                            .ok();
                                        })))
                                        .child(
                                            div()
                                                .min_w_0()
                                                .child(div().tw_text_xs().font_weight(FontWeight::MEDIUM).child("Deploy auto-ported drafts"))
                                                .child(div().mt(px(2.)).tw_text_xs().text_color(t.muted_foreground).child("Cross-runtime rewrites deploy immediately — runtime APIs may differ.")),
                                        ),
                                )
                            }),
                    )
                    .into_any_element()
            }
            WizardStep::Transferring => {
                let p = self.progress.clone();
                match p {
                    Some(p) if !p.message.is_empty() || p.error.is_some() => match &p.error {
                        Some(e) => status_pill(t, e.clone(), Some((t.destructive, t.destructive)), 9999.).into_any_element(),
                        None => status_pill(t, format!("{} — {}%", p.current_step.label(), p.percentage), None, 9999.).into_any_element(),
                    },
                    _ => div().into_any_element(),
                }
            }
            WizardStep::Complete => {
                let r = self.result.clone().unwrap_or_default();
                let stats = r.stats.clone();
                let stat_rows: Vec<(&str, i64)> = stats
                    .map(|s| {
                        vec![
                            ("Tables", s.tables_transferred),
                            ("Rows", s.rows_transferred),
                            ("Storage buckets", s.storage_buckets_transferred),
                            ("Storage files", s.storage_files_transferred),
                            ("Auth users", s.auth_users_transferred),
                            ("Auth providers", s.auth_providers_transferred),
                            ("Edge functions", s.functions_transferred),
                        ]
                    })
                    .unwrap_or_default();
                let amber = tw("amber-500");
                let warn_head = if t.dark { tw("amber-200") } else { tw("amber-800") };
                div()
                    .flex()
                    .flex_col()
                    .gap_4()
                    .when(!stat_rows.is_empty(), |d| {
                        d.child(card(t).children(stat_rows.into_iter().enumerate().map(|(i, (label, v))| {
                            div()
                                .flex()
                                .items_center()
                                .justify_between()
                                .px_4()
                                .py_2()
                                .when(i > 0, |d| d.border_t_1().border_color(with_alpha(t.border, 0.4)))
                                .child(div().tw_text_xs().text_color(t.muted_foreground).child(label))
                                .child(div().font_family(MONO).tw_text_xs().font_weight(FontWeight::SEMIBOLD).child(v.to_string()))
                        })))
                    })
                    .when(!r.warnings.is_empty(), |d| {
                        d.child(
                            div()
                                .overflow_hidden()
                                .rounded(px(16.))
                                .border_1()
                                .border_color(with_alpha(amber, 0.3))
                                .bg(with_alpha(amber, 0.05))
                                .shadow(rexa_ui::popup::shadow_sm())
                                .child(
                                    div()
                                        .border_b_1()
                                        .border_color(with_alpha(amber, 0.2))
                                        .px_4()
                                        .py_2()
                                        .tw_text_xs()
                                        .font_weight(FontWeight::MEDIUM)
                                        .text_color(warn_head)
                                        .child(format!("Warnings ({})", r.warnings.len())),
                                )
                                .child(
                                    div().id("transfer-warnings").max_h(px(224.)).overflow_y_scroll().px_4().py(px(10.)).flex().flex_col().gap(px(6.)).children(
                                        r.warnings.iter().map(|w| {
                                            div()
                                                .flex()
                                                .gap_2()
                                                .tw_text_xs()
                                                .line_height(px(19.5))
                                                .text_color(amber_fg)
                                                .child("•")
                                                .child(div().min_w_0().flex_1().child(w.clone()))
                                        }),
                                    ),
                                ),
                        )
                    })
                    .when(!r.function_diffs.is_empty(), |d| {
                        d.child(
                            card(t)
                                .child(div().border_b_1().border_color(with_alpha(t.border, 0.6)).px_4().py(px(10.)).tw_text_xs().font_weight(FontWeight::MEDIUM).child("Runtime compat diffs — review before deploying"))
                                .children(r.function_diffs.iter().take(10).enumerate().map(|(i, fd)| {
                                    let open = self.expanded_diffs.contains(&i);
                                    div()
                                        .border_b_1()
                                        .border_color(with_alpha(t.border, 0.4))
                                        .px_4()
                                        .py(px(10.))
                                        .child(
                                            div()
                                                .id(("transfer-diff", i))
                                                .flex()
                                                .gap_1()
                                                .cursor_pointer()
                                                .tw_text_xs()
                                                .font_weight(FontWeight::MEDIUM)
                                                .on_click(cx.listener(move |this, _, _, cx| {
                                                    if !this.expanded_diffs.remove(&i) {
                                                        this.expanded_diffs.insert(i);
                                                    }
                                                    cx.notify();
                                                }))
                                                .child(Icon::new(if open { IconName::ChevronDown } else { IconName::ChevronRight }).size_3())
                                                .child(fd.slug.clone())
                                                .child(div().text_color(t.muted_foreground).child(format!("→ {}", fd.target_provider))),
                                        )
                                        .when(open, |d| {
                                            d.when(!fd.notes.is_empty(), |d| {
                                                d.child(div().mt(px(6.)).flex().flex_col().gap(px(2.)).text_size(px(11.)).text_color(t.muted_foreground).children(fd.notes.iter().map(|n| div().child(format!("• {n}")))))
                                            })
                                            .child(
                                                div()
                                                    .id(("transfer-diff-body", i))
                                                    .mt_2()
                                                    .overflow_x_scroll()
                                                    .rounded(px(12.))
                                                    .bg(with_alpha(t.muted, 0.3))
                                                    .p_3()
                                                    .font_family(MONO)
                                                    .text_size(px(11.))
                                                    .line_height(px(17.875))
                                                    .whitespace_nowrap()
                                                    .children(fd.diff.lines().map(|l| div().child(l.to_string()))),
                                            )
                                        })
                                })),
                        )
                    })
                    .into_any_element()
            }
            WizardStep::Error => status_pill(t, self.error.clone().unwrap_or_else(|| "An unknown error occurred".into()), Some((t.destructive, t.destructive)), 12.).into_any_element(),
        }
    }

    fn render_nav(&mut self, t: &rexa_ui::Tokens, cx: &mut Context<Self>) -> Option<gpui::AnyElement> {
        let row = || div().mx_auto().mt_7().flex().w_full().max_w(px(440.)).items_center().gap_2();
        let this = cx.entity().downgrade();
        let call = move |f: fn(&mut TransferScreen, &mut Context<TransferScreen>)| {
            let this = this.clone();
            move |_: &mut Window, cx: &mut App| {
                this.update(cx, |s, cx| f(s, cx)).ok();
            }
        };
        match self.step {
            WizardStep::SelectSources | WizardStep::SelectOptions | WizardStep::Confirm => {
                let first = self.step == WizardStep::SelectSources;
                let back = if first {
                    pill_button("transfer-cancel", t, false, "Cancel", |_, cx| Self::close(cx)).into_any_element()
                } else {
                    pill_button("transfer-back", t, false, "Back", call(|s, cx| s.prev(cx))).into_any_element()
                };
                let next_label: gpui::AnyElement = if self.transferring {
                    spin_icon(t.foreground).into_any_element()
                } else if self.step == WizardStep::Confirm {
                    "Start transfer".into_any_element()
                } else {
                    "Next".into_any_element()
                };
                let disabled = !self.can_proceed() || self.transferring;
                Some(row().child(back).child(pill_button("transfer-next", t, disabled, next_label, call(|s, cx| s.next(cx)))).into_any_element())
            }
            WizardStep::Transferring if !self.transferring && self.progress.as_ref().is_none_or(|p| p.error.is_none()) => {
                Some(row().child(pill_button("transfer-close", t, false, "Close", |_, cx| Self::close(cx))).into_any_element())
            }
            WizardStep::Complete => Some(
                row()
                    .child(pill_button("transfer-done", t, false, div().flex().items_center().gap_2().child(Icon::new(IconName::Check).size_4()).child("Done"), call(|s, cx| s.handle_done(cx))))
                    .into_any_element(),
            ),
            WizardStep::Error => Some(row().child(pill_button("transfer-start-over", t, false, "Start over", call(|s, cx| s.reset(cx)))).into_any_element()),
            _ => None,
        }
    }
}

impl Render for TransferScreen {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        let title = if self.step == WizardStep::Complete { "Transfer complete" } else { "Transfer Project" };
        let progress = (self.step == WizardStep::Transferring).then(|| self.render_progress(&t, cx).into_any_element());
        let body = self.render_body(&t, cx);
        let nav = self.render_nav(&t, cx);
        let max_h = window.viewport_size().height * 0.88;
        div()
            .id("transfer-screen")
            .track_focus(&self.focus)
            .size_full()
            .relative()
            .bg(t.background)
            .children(self.home.clone())
            .child(
                div()
                    .id("transfer-overlay")
                    .absolute()
                    .inset_0()
                    .bg(gpui::hsla(0., 0., 0., 0.4))
                    .flex()
                    .items_center()
                    .justify_center()
                    .occlude()
                    .child(
                        Dialog::new().max_w(472.).padding(0.).gap(0.).hide_close().child(
                            div().id("transfer-dialog-scroll").max_h(max_h).overflow_y_scroll().p_4().child(
                                div()
                                    .flex()
                                    .w_full()
                                    .min_w_0()
                                    .flex_col()
                                    .gap_6()
                                    .child(div().flex().items_center().justify_center().gap_3().child(div().tw_text_2xl().font_weight(FontWeight::SEMIBOLD).child(tight(title))))
                                    .children(progress)
                                    .child(div().px_1().py_2().child(body).children(nav)),
                            ),
                        ),
                    ),
            )
    }
}
