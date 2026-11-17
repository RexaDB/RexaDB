//! Port of components/studio/sql-editor.tsx (toolbar, editor / results split,
//! result tabs, results header with copy / export menus, error, empty, plan
//! and loading states, Save Snippet and Version History dialogs) together
//! with the per-tab query execution of hooks/use-studio.ts
//! (`handleRunQuery`, `runSqlContextQuery`, `stopSqlContextQuery`, result-tab
//! close helpers, `addHistoryEntry`, snippet add/update/version handlers).

use crate::ai::{commented_snippet, sql_ai_generator, SqlAiRequest};
use crate::editor_theme::{CompiledTheme, EditorSettings};
use crate::explain::{extract_explain_plan, plan_node, plan_node_card, ToggleHandler};
use crate::export::{format_results, ExportFormat};
use crate::format::{format_query, FormatSettings};
use crate::monaco_input::{MonacoEvent, MonacoSqlInput};
use crate::results_grid::ResultsGrid;
use crate::sql_text::{editor_badge, get_sql_ai_prompt, is_sql_ai_prompt, split_sql_statements};
use crate::store::{now_millis, random_id, uid, Folder, HistoryEntry, Snippet, SnippetVersion, SqlStore};
use crate::suggestions::SchemaEntry;
use gpui::{
    canvas, div, linear_color_stop, linear_gradient, prelude::*, px, AnyElement, App, Bounds, ClipboardItem, Context,
    Entity, FocusHandle, Focusable, FontWeight, Hsla, MouseButton, MouseMoveEvent, MouseUpEvent, Pixels, Rgba,
    SharedString, Subscription, Task, WeakEntity, Window,
};
use gpui_component::Icon;
use rexa_core::{runtime, Session, StudioEvent, TabSpec};
use rexa_drivers::{explain_sql, Kind, QueryResult, DEFAULT_ROW_LIMIT};
use rexa_ui::widgets::InputState;
use rexa_ui::{
    tight, toast, tw, white, with_alpha, ActiveTokens, Align, Button, ButtonSize, ContextMenu, Dialog, DropdownMenu,
    IconName, Label, MenuItem, Select, SelectOption, Spinner, TextInput, Tokens, Tooltip, Tw, MONO,
};
use serde_json::Value;
use std::cell::Cell;
use std::collections::{HashMap, HashSet};
use std::rc::Rc;
use std::sync::Arc;
use std::time::{Duration, Instant};

const DEFAULT_EDITOR_PLACEHOLDER: &str = "Type your query or do / to ask AI";
const AI_EDITOR_PLACEHOLDER: &str = "Describe what you want AI to generate or press esc to exit AI mode";

/// `formatShortcutForPlatform`
pub fn shortcut(combo: &str) -> String {
    let mac = cfg!(target_os = "macos");
    let mapped: Vec<String> = combo
        .split('+')
        .map(|t| t.trim())
        .filter(|t| !t.is_empty())
        .map(|t| {
            let (m, o) = match t {
                "Cmd" => ("⌘", "Ctrl"),
                "Ctrl" | "Control" => ("⌃", "Ctrl"),
                "Shift" => ("⇧", "Shift"),
                "Alt" | "Option" => ("⌥", "Alt"),
                "Enter" | "Return" => ("↩", "Enter"),
                other => (other, other),
            };
            (if mac { m } else { o }).to_string()
        })
        .collect();
    if mac { mapped.concat() } else { mapped.join("+") }
}

/// `ResultTabInfo`
#[derive(Clone)]
pub struct ResultTab {
    pub id: String,
    pub label: String,
    pub query: String,
    pub error: Option<String>,
    pub results: Option<Arc<QueryResult>>,
    pub execution_time: f64,
}

/// The grid's `resultRowCount`: `rowCount` (affected rows for DML) else rows.
fn row_count(r: &QueryResult) -> usize {
    if r.rows.is_empty() {
        r.affected.map(|a| a as usize).unwrap_or(0)
    } else {
        r.rows.len()
    }
}

/// `overlay` from rexa-ui's raised buttons (white sheen over a color).
fn sheen(base: Hsla, alpha: f32) -> Hsla {
    let b: Rgba = base.into();
    let mix = |c: f32| c + (1. - c) * alpha;
    Rgba { r: mix(b.r), g: mix(b.g), b: mix(b.b), a: b.a.max(alpha) }.into()
}

pub struct SqlEditor {
    session: Arc<Session>,
    pub connection_id: i64,
    pub db_type: String,
    kind: Kind,
    pub tab_id: String,
    title: String,
    input: Entity<MonacoSqlInput>,
    pub query: String,
    baseline: String,
    ai_mode: bool,
    generating: bool,
    has_selection: bool,
    selected_query: String,
    split_ratio: f32,
    dragging: bool,
    sash_hovered: bool,
    split_bounds: Rc<Cell<Bounds<Pixels>>>,
    pub hide_results: bool,
    // ---- SqlTabData ----
    loading: bool,
    request_id: u64,
    active_query_id: Option<String>,
    started: Option<Instant>,
    execution_time: f64,
    results: Option<Arc<QueryResult>>,
    error: Option<String>,
    result_tabs: Vec<ResultTab>,
    active_result_tab: Option<String>,
    grid: Entity<ResultsGrid>,
    explain_plan: Option<Value>,
    show_plan_view: bool,
    plan_toggled: HashSet<String>,
    // ---- snippets ----
    snippets: Vec<Snippet>,
    folders: Vec<Folder>,
    latest_version_query: Option<String>,
    // ---- settings ----
    #[allow(dead_code)]
    settings: EditorSettings,
    format_settings: FormatSettings,
    result_tabs_enabled: bool,
    slash_ai_trigger: bool,
    auto_save_queries: bool,
    /// Text to push into the editor on the next render (needs a `Window`).
    pending_set_query: Option<String>,
    _tick: Option<Task<()>>,
    _subs: Vec<Subscription>,
}

impl Focusable for SqlEditor {
    fn focus_handle(&self, cx: &App) -> FocusHandle {
        self.input.read(cx).focus_handle(cx)
    }
}

impl SqlEditor {
    pub fn new(session: Arc<Session>, tab_id: String, title: String, sql: String, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let kind = session.driver.kind();
        let db_type = kind.as_str().to_string();
        let settings = EditorSettings::load();
        let theme = CompiledTheme::new(&settings.theme(cx.tokens()));
        let input = cx.new(|cx| {
            let mut i = MonacoSqlInput::new(&db_type, &sql, theme, settings.font_size, settings.font_family.clone(), window, cx);
            i.placeholder = DEFAULT_EDITOR_PLACEHOLDER.into();
            i.slash_ai_trigger = settings.bool("slashAiTrigger", true);
            i
        });
        let grid = cx.new(|cx| ResultsGrid::new(Arc::new(QueryResult::default()), cx));
        let connection_id = session.connection.id;
        let (snippets, folders) = SqlStore::open()
            .and_then(|s| Ok((s.snippets(connection_id)?, s.folders(connection_id)?)))
            .unwrap_or_default();
        let mut subs = vec![
            cx.subscribe_in(&input, window, |this, _, ev: &MonacoEvent, window, cx| this.on_input_event(ev.clone(), window, cx)),
            cx.observe(&input, |this, input, cx| {
                // `onSelectionChange(selectedText)`
                let sel = input.read(cx).selected_text(cx);
                let next = sel.trim().to_string();
                if this.has_selection != !next.is_empty() || this.selected_query != next {
                    this.has_selection = !next.is_empty();
                    this.selected_query = next;
                    cx.notify();
                }
            }),
        ];
        subs.push(cx.subscribe_in(&rexa_core::studio_bus(cx), window, |this, _, ev: &StudioEvent, window, cx| match ev {
            StudioEvent::TabCommand { tab: TabSpec::Query { id, .. }, command } if *id == this.tab_id => match command.as_str() {
                "RUN_ACTIVE_QUERY" => this.handle_run(window, cx),
                "STOP_ACTIVE_QUERY" => this.handle_stop(cx),
                "FORMAT_QUERY" => this.handle_format(window, cx),
                "COPY_QUERY" => this.handle_copy_query(cx),
                _ => {}
            },
            StudioEvent::SchemaChanged => this.load_schema(cx),
            _ => {}
        }));
        let studio = settings.studio.clone();
        let mut this = SqlEditor {
            session,
            connection_id,
            db_type,
            kind,
            tab_id,
            title,
            input,
            baseline: sql.clone(),
            query: sql,
            ai_mode: false,
            generating: false,
            has_selection: false,
            selected_query: String::new(),
            split_ratio: 0.55,
            dragging: false,
            sash_hovered: false,
            split_bounds: Rc::new(Cell::new(Bounds::default())),
            hide_results: false,
            loading: false,
            request_id: 0,
            active_query_id: None,
            started: None,
            execution_time: 0.,
            results: None,
            error: None,
            result_tabs: Vec::new(),
            active_result_tab: None,
            grid,
            explain_plan: None,
            show_plan_view: false,
            plan_toggled: HashSet::new(),
            snippets,
            folders,
            latest_version_query: None,
            format_settings: FormatSettings::from_studio(&studio),
            result_tabs_enabled: studio["resultTabsEnabled"].as_bool().unwrap_or(true),
            slash_ai_trigger: studio["slashAiTrigger"].as_bool().unwrap_or(true),
            auto_save_queries: studio["autoSaveQueries"].as_bool().unwrap_or(false),
            settings,
            pending_set_query: None,
            _tick: None,
            _subs: subs,
        };
        this.refresh_latest_version();
        this.load_schema(cx);
        this
    }

    fn spec(&self) -> TabSpec {
        TabSpec::Query { id: self.tab_id.clone(), title: self.title.clone(), sql: self.query.clone() }
    }

    /// `activeTabId.startsWith("sql-") ? activeTabId.slice(4) : null`
    fn current_snippet_id(&self) -> Option<&str> {
        let base = self.tab_id.split("::pane::").next().unwrap_or(&self.tab_id);
        base.strip_prefix("sql-")
    }

    fn existing_snippet(&self) -> Option<&Snippet> {
        let id = self.current_snippet_id()?;
        self.snippets.iter().find(|s| s.id == id)
    }

    fn refresh_latest_version(&mut self) {
        self.latest_version_query = self.existing_snippet().and_then(|s| {
            SqlStore::open().ok()?.snippet_versions(&s.id).ok()?.into_iter().next().map(|v| v.query)
        });
    }

    /// The editor's `schemaData` for autocomplete.
    fn load_schema(&mut self, cx: &mut Context<Self>) {
        let driver = self.session.driver.clone();
        let task = runtime::spawn(async move { driver.all_tables_with_columns(None).await });
        cx.spawn(async move |this, cx| {
            let Ok(columns) = task.await else { return };
            let mut map: Vec<SchemaEntry> = Vec::new();
            let mut index: HashMap<(String, String), usize> = HashMap::new();
            for c in columns {
                let key = (c.table_schema.clone(), c.table_name.clone());
                let ix = *index.entry(key).or_insert_with(|| {
                    map.push(SchemaEntry { schema: c.table_schema.clone(), name: c.table_name.clone(), columns: Vec::new() });
                    map.len() - 1
                });
                map[ix].columns.push((c.column_name, c.data_type));
            }
            this.update(cx, |this, cx| this.input.update(cx, |i, _| i.set_schema(map))).ok();
        })
        .detach();
    }

    // ---- query text --------------------------------------------------------------

    /// `setQuery` from outside (snippet browser, panels).
    pub fn set_query_text(&mut self, q: String, window: &mut Window, cx: &mut Context<Self>) {
        self.set_query(q, window, cx);
    }

    fn set_query(&mut self, q: String, window: &mut Window, cx: &mut Context<Self>) {
        self.input.update(cx, |i, cx| i.set_value(&q, window, cx));
        self.on_query_changed(q, cx);
    }

    fn on_query_changed(&mut self, q: String, cx: &mut Context<Self>) {
        if q == self.query {
            return;
        }
        self.query = q.clone();
        rexa_core::emit_studio(StudioEvent::QueryChanged { id: self.tab_id.clone(), sql: q.clone() }, cx);
        let dirty = match self.existing_snippet() {
            Some(s) => s.query != q,
            None => q != self.baseline,
        };
        rexa_core::emit_studio(StudioEvent::MarkDirty { tab: self.spec(), dirty }, cx);
        cx.notify();
    }

    /// `handleEditorChange`
    fn handle_editor_change(&mut self, next: String, window: &mut Window, cx: &mut Context<Self>) {
        if self.slash_ai_trigger && is_sql_ai_prompt(&next) {
            self.set_ai_mode(true, cx);
            self.set_query(get_sql_ai_prompt(&next), window, cx);
            return;
        }
        if self.slash_ai_trigger && self.ai_mode {
            let trimmed = next.trim_start();
            if let Some(rest) = trimmed.strip_prefix('/') {
                self.set_query(rest.trim_start().to_string(), window, cx);
                return;
            }
        }
        self.on_query_changed(next, cx);
    }

    fn set_ai_mode(&mut self, on: bool, cx: &mut Context<Self>) {
        self.ai_mode = on;
        self.input.update(cx, |i, cx| {
            i.set_ai_mode(on);
            i.placeholder = if on { AI_EDITOR_PLACEHOLDER } else { DEFAULT_EDITOR_PLACEHOLDER }.into();
            cx.notify();
        });
        cx.notify();
    }

    fn on_input_event(&mut self, ev: MonacoEvent, window: &mut Window, cx: &mut Context<Self>) {
        match ev {
            MonacoEvent::Changed(v) => self.handle_editor_change(v, window, cx),
            MonacoEvent::Run { selection } => {
                if self.ai_mode {
                    self.handle_generate_ai_snippet(window, cx)
                } else if selection {
                    self.handle_run_selected(window, cx)
                } else {
                    self.handle_run(window, cx)
                }
            }
            MonacoEvent::RunSelected => {
                if self.ai_mode {
                    self.handle_generate_ai_snippet(window, cx)
                } else {
                    self.handle_run_selected(window, cx)
                }
            }
            MonacoEvent::SaveSnippet => self.open_save_dialog(window, cx),
            MonacoEvent::CopyQuery => self.handle_copy_query(cx),
            MonacoEvent::Format => self.handle_format(window, cx),
            MonacoEvent::RequestAiMode => {
                // `handleRequestAiMode`
                self.set_ai_mode(true, cx);
                if !self.query.is_empty() {
                    self.set_query(String::new(), window, cx);
                }
            }
            MonacoEvent::ExitAiMode => {
                self.set_ai_mode(false, cx);
                self.set_query(String::new(), window, cx);
            }
            MonacoEvent::Stop => self.handle_stop(cx),
        }
    }

    // ---- toolbar actions ------------------------------------------------------

    pub fn handle_format(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(formatted) = format_query(&self.query, &self.db_type, &self.format_settings) {
            self.set_query(formatted, window, cx);
        }
    }

    pub fn handle_copy_query(&mut self, cx: &mut Context<Self>) {
        cx.write_to_clipboard(ClipboardItem::new_string(self.query.clone()));
        toast::success("Query copied to clipboard", cx);
    }

    fn handle_run(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.explain_plan = None;
        let _ = window;
        self.handle_run_query(None, cx);
    }

    fn handle_run_selected(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.explain_plan = None;
        let _ = window;
        // Cmd+Shift+Enter with nothing selected falls back to the whole query.
        let sel = self.input.read(cx).selected_text(cx);
        let q = (!sel.trim().is_empty()).then_some(sel);
        self.handle_run_query(q, cx);
    }

    fn handle_explain(&mut self, cx: &mut Context<Self>) {
        let trimmed = self.query.trim();
        if trimmed.is_empty() {
            toast::error("Enter a query first", cx);
            return;
        }
        let q = explain_sql(self.kind, trimmed, true);
        self.handle_run_query(Some(q), cx);
    }

    // ---- execution (use-studio.ts) -------------------------------------------------

    /// `handleRunQuery(overrideQuery?)`
    pub fn handle_run_query(&mut self, override_query: Option<String>, cx: &mut Context<Self>) {
        let query = override_query.filter(|q| !q.is_empty()).unwrap_or_else(|| self.query.clone());
        self.result_tabs.clear();
        self.active_result_tab = None;
        self.results = None;
        self.error = None;
        self.execution_time = 0.;
        self.set_results(None, cx);
        if !self.result_tabs_enabled {
            self.run_statements(vec![query], true, cx);
            return;
        }
        let statements = split_sql_statements(&query);
        if statements.len() <= 1 {
            self.run_statements(vec![query], false, cx);
        } else {
            self.run_statements(statements, false, cx);
        }
    }

    /// `runSqlContextQuery` for each statement in turn.
    fn run_statements(&mut self, statements: Vec<String>, suppress_tab: bool, cx: &mut Context<Self>) {
        let statements: Vec<String> = statements.into_iter().filter(|s| !s.trim().is_empty()).collect();
        if statements.is_empty() {
            return;
        }
        self.request_id += 1;
        let request_id = self.request_id;
        self.loading = true;
        self.started = Some(Instant::now());
        self.start_ticker(cx);
        cx.notify();
        let driver = self.session.driver.clone();
        let connection_id = self.connection_id;
        let connection_name = self.session.connection.name.clone();
        cx.spawn(async move |this, cx| {
            for sql in statements {
                let query_id = format!("{}-{}", now_millis(), random_id(10));
                let stale = this
                    .update(cx, |this, cx| {
                        if this.request_id != request_id {
                            return true;
                        }
                        this.active_query_id = Some(query_id.clone());
                        this.loading = true;
                        this.started = Some(Instant::now());
                        cx.notify();
                        false
                    })
                    .unwrap_or(true);
                if stale {
                    return;
                }
                let started = Instant::now();
                let (d, s, q) = (driver.clone(), sql.clone(), query_id.clone());
                let res = runtime::spawn(async move { d.execute_cancellable(&s, DEFAULT_ROW_LIMIT, &q).await }).await;
                let elapsed = started.elapsed();
                let entry = match &res {
                    Ok(r) => HistoryEntry {
                        id: uid(),
                        connection_id: Some(connection_id),
                        query: sql.clone(),
                        executed_at: now_millis(),
                        duration: if r.elapsed.is_zero() { elapsed.as_millis() as i64 } else { r.elapsed.as_millis() as i64 },
                        status: "success".into(),
                        error: None,
                        rows_count: Some(r.rows.len() as i64),
                        caller: "user".into(),
                        executed_by: Some("local".into()),
                        executed_by_name: Some("Local".into()),
                        params: None,
                        connection_name: Some(connection_name.clone()),
                    },
                    Err(e) => HistoryEntry {
                        id: uid(),
                        connection_id: Some(connection_id),
                        query: sql.clone(),
                        executed_at: now_millis(),
                        duration: elapsed.as_millis() as i64,
                        status: "error".into(),
                        error: Some(format!("{e:#}")),
                        rows_count: None,
                        caller: "user".into(),
                        executed_by: Some("local".into()),
                        executed_by_name: Some("Local".into()),
                        params: None,
                        connection_name: Some(connection_name.clone()),
                    },
                };
                // `addHistoryEntry`: written straight to the app DB.
                let e2 = entry.clone();
                cx.background_executor()
                    .spawn(async move {
                        if let Ok(s) = SqlStore::open() {
                            s.insert_history(connection_id, &e2).ok();
                        }
                    })
                    .detach();
                let keep_going = this
                    .update(cx, |this, cx| {
                        if this.request_id != request_id {
                            return false;
                        }
                        let ok = res.is_ok();
                        let (results, error, time) = match res {
                            Ok(mut r) => {
                                if r.elapsed.is_zero() {
                                    r.elapsed = elapsed;
                                }
                                let t = r.elapsed.as_secs_f64() * 1000.;
                                (Some(Arc::new(r)), None, t)
                            }
                            Err(e) => (None, Some(format!("{e:#}")), elapsed.as_secs_f64() * 1000.),
                        };
                        if !suppress_tab {
                            let tab = ResultTab {
                                id: format!("result-{}-{}", now_millis(), random_id(6)),
                                label: format!("Result {}", this.result_tabs.len() + 1),
                                query: sql.clone(),
                                error: error.clone(),
                                results: results.clone(),
                                execution_time: time,
                            };
                            this.active_result_tab = Some(tab.id.clone());
                            this.result_tabs.push(tab);
                        }
                        this.error = error;
                        this.execution_time = time;
                        this.set_results(results, cx);
                        if ok {
                            this.after_success(&sql, cx);
                        }
                        cx.notify();
                        // The original keeps running the remaining statements after an error.
                        true
                    })
                    .unwrap_or(false);
                if !keep_going {
                    return;
                }
            }
            this.update(cx, |this, cx| {
                if this.request_id == request_id {
                    this.loading = false;
                    this.active_query_id = None;
                    this._tick = None;
                    cx.notify();
                }
            })
            .ok();
        })
        .detach();
    }

    /// Auto-save (`autoSaveQueries`) and schema refresh after DDL.
    fn after_success(&mut self, sql: &str, cx: &mut Context<Self>) {
        let normalized = sql.trim_start().to_ascii_lowercase();
        let ddl = ["alter", "create", "drop", "truncate", "comment", "rename"];
        if ddl.iter().any(|k| normalized.starts_with(k)) {
            rexa_core::emit_studio(StudioEvent::SchemaChanged, cx);
        }
        if self.auto_save_queries {
            if let Some(s) = self.existing_snippet().cloned() {
                if let Ok(store) = SqlStore::open() {
                    store.create_snippet_version(&s.id, &s.name, sql).ok();
                }
                self.update_snippet(&s.id, None, Some(sql.to_string()), cx);
            }
        }
        rexa_core::emit_studio(StudioEvent::MarkDirty { tab: self.spec(), dirty: false }, cx);
    }

    fn start_ticker(&mut self, cx: &mut Context<Self>) {
        // The original updates `executionTime` every 10ms while loading.
        self._tick = Some(cx.spawn(async move |this, cx| loop {
            cx.background_executor().timer(Duration::from_millis(16)).await;
            let go = this
                .update(cx, |this, cx| {
                    if !this.loading {
                        return false;
                    }
                    if let Some(s) = this.started {
                        this.execution_time = s.elapsed().as_secs_f64() * 1000.;
                    }
                    cx.notify();
                    true
                })
                .unwrap_or(false);
            if !go {
                break;
            }
        }));
    }

    /// `stopSqlContextQuery`
    pub fn handle_stop(&mut self, cx: &mut Context<Self>) {
        if !self.loading {
            return;
        }
        self.request_id += 1;
        self.loading = false;
        self.execution_time = 0.;
        self.error = Some("Query cancelled by user.".into());
        self._tick = None;
        let qid = self.active_query_id.take();
        cx.notify();
        if self.session.driver.capabilities().cancel {
            if let Some(qid) = qid {
                let driver = self.session.driver.clone();
                let task = runtime::spawn(async move { driver.cancel_query(&qid).await });
                cx.spawn(async move |this, cx| {
                    if let Err(e) = task.await {
                        this.update(cx, |this, cx| {
                            this.error = Some(format!("{e:#}"));
                            cx.notify();
                        })
                        .ok();
                    }
                })
                .detach();
            }
        }
    }

    /// Sets `results` and re-derives the explain plan (the `useEffect([results])`).
    fn set_results(&mut self, results: Option<Arc<QueryResult>>, cx: &mut Context<Self>) {
        self.results = results.clone();
        self.explain_plan = results.as_deref().and_then(extract_explain_plan);
        self.show_plan_view = self.explain_plan.is_some();
        self.plan_toggled.clear();
        if let Some(r) = results {
            self.grid.update(cx, |g, cx| g.set_result(r, cx));
        }
    }

    // ---- result tabs ------------------------------------------------------------

    fn select_result_tab(&mut self, id: Option<String>, cx: &mut Context<Self>) {
        let tab = id.as_ref().and_then(|id| self.result_tabs.iter().find(|t| &t.id == id)).cloned();
        self.active_result_tab = id;
        self.error = tab.as_ref().and_then(|t| t.error.clone());
        self.execution_time = tab.as_ref().map_or(0., |t| t.execution_time);
        self.set_results(tab.and_then(|t| t.results), cx);
        cx.notify();
    }

    fn rebuild_result_tabs(&mut self, tabs: Vec<ResultTab>, active: Option<String>, cx: &mut Context<Self>) {
        self.result_tabs = tabs;
        self.select_result_tab(active, cx);
    }

    fn close_result_tab(&mut self, id: &str, cx: &mut Context<Self>) {
        let Some(idx) = self.result_tabs.iter().position(|t| t.id == id) else { return };
        let mut tabs = self.result_tabs.clone();
        tabs.remove(idx);
        let mut active = self.active_result_tab.clone();
        if active.as_deref() == Some(id) {
            active = if tabs.is_empty() { None } else { Some(tabs[idx.min(tabs.len() - 1)].id.clone()) };
        }
        self.rebuild_result_tabs(tabs, active, cx);
    }

    fn close_all_result_tabs(&mut self, cx: &mut Context<Self>) {
        self.rebuild_result_tabs(Vec::new(), None, cx);
    }

    fn close_other_result_tabs(&mut self, keep: &str, cx: &mut Context<Self>) {
        let kept: Vec<ResultTab> = self.result_tabs.iter().filter(|t| t.id == keep).cloned().collect();
        if kept.is_empty() {
            return;
        }
        self.rebuild_result_tabs(kept, Some(keep.to_string()), cx);
    }

    fn close_result_tabs_side(&mut self, anchor: &str, right: bool, cx: &mut Context<Self>) {
        let Some(idx) = self.result_tabs.iter().position(|t| t.id == anchor) else { return };
        let tabs: Vec<ResultTab> = if right {
            self.result_tabs[..=idx].to_vec()
        } else {
            self.result_tabs[idx..].to_vec()
        };
        let active = match &self.active_result_tab {
            Some(a) if tabs.iter().any(|t| &t.id == a) => Some(a.clone()),
            _ => Some(anchor.to_string()),
        };
        self.rebuild_result_tabs(tabs, active, cx);
    }

    // ---- export / copy ------------------------------------------------------------

    fn handle_copy(&mut self, format: ExportFormat, cx: &mut Context<Self>) {
        let Some(r) = self.results.clone() else { return };
        cx.write_to_clipboard(ClipboardItem::new_string(format_results(format, &r)));
    }

    fn handle_export(&mut self, format: ExportFormat, cx: &mut Context<Self>) {
        let Some(r) = self.results.clone() else { return };
        let content = format_results(format, &r);
        let name = format!("export-{}{}", now_millis(), format.extension());
        let dir = std::env::var("HOME").map(|h| std::path::PathBuf::from(h).join("Downloads")).unwrap_or_default();
        let rx = cx.prompt_for_new_path(&dir, Some(&name));
        cx.spawn(async move |_, cx| {
            if let Ok(Ok(Some(path))) = rx.await {
                let res = std::fs::write(&path, content);
                cx.update(|cx| match res {
                    Ok(()) => {
                        toast::success(format!("Exported to {}", path.display()), cx);
                    }
                    Err(e) => {
                        toast::error(format!("Export failed: {e}"), cx);
                    }
                });
            }
        })
        .detach();
    }

    // ---- snippets ------------------------------------------------------------------

    fn persist_snippets(&mut self) {
        let (id, list) = (self.connection_id, self.snippets.clone());
        if let Ok(mut s) = SqlStore::open() {
            if let Err(e) = s.save_snippets(id, &list) {
                eprintln!("Failed to save snippets: {e:#}");
            }
        }
    }

    /// `updateSnippet(id, { name?, query? })`
    fn update_snippet(&mut self, id: &str, name: Option<String>, query: Option<String>, cx: &mut Context<Self>) {
        // Re-read so edits from other tabs aren't overwritten.
        if let Ok(s) = SqlStore::open() {
            if let Ok(list) = s.snippets(self.connection_id) {
                self.snippets = list;
            }
        }
        if let Some(s) = self.snippets.iter_mut().find(|s| s.id == id) {
            if let Some(n) = name.clone() {
                s.name = n;
            }
            if let Some(q) = query.clone() {
                s.query = q;
            }
        }
        self.persist_snippets();
        if let Some(n) = name {
            if self.current_snippet_id() == Some(id) {
                self.title = n.clone();
                rexa_core::emit_studio(StudioEvent::RenameTab { tab: self.spec(), title: n }, cx);
            }
        }
        if query.is_some() {
            rexa_core::emit_studio(StudioEvent::MarkDirty { tab: self.spec(), dirty: false }, cx);
        }
        self.refresh_latest_version();
        cx.notify();
    }

    /// `addSnippet(name, query, folderId)`: persist, then open it in its own tab.
    fn add_snippet(&mut self, name: String, query: String, folder_id: Option<String>, cx: &mut Context<Self>) {
        if let Ok(s) = SqlStore::open() {
            if let Ok(list) = s.snippets(self.connection_id) {
                self.snippets = list;
            }
        }
        let snippet = Snippet { id: uid(), name: name.clone(), query: query.clone(), folder_id, created_at: now_millis(), is_shared: false, shared_entry_id: None };
        self.snippets.push(snippet.clone());
        self.persist_snippets();
        rexa_core::open_tab(TabSpec::Query { id: format!("sql-{}", snippet.id), title: name, sql: query }, cx);
        cx.notify();
    }

    /// `handleSaveExistingSnippet`
    fn handle_save_existing_snippet(&mut self, cx: &mut Context<Self>) {
        let Some(s) = self.existing_snippet().cloned() else { return };
        let ok = SqlStore::open().and_then(|st| st.create_snippet_version(&s.id, &s.name, &s.query)).is_ok();
        if !ok {
            toast::error("Failed to save version", cx);
            return;
        }
        let q = self.query.clone();
        self.update_snippet(&s.id, None, Some(q), cx);
        toast::success("New version saved", cx);
    }

    fn open_save_dialog(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let editor = cx.entity().downgrade();
        let folders = self.folders.clone();
        let content = cx.new(|cx| SaveSnippetDialog::new(editor, folders, window, cx));
        rexa_ui::open_dialog(cx, move |_, _| {
            Dialog::new().padding(0.).gap(0.).max_w(425.).hide_close().header(div()).child(content.clone())
        });
        let _ = window;
    }

    fn open_version_history(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(s) = self.existing_snippet().cloned() else { return };
        let editor = cx.entity().downgrade();
        let content = cx.new(|cx| VersionHistoryDialog::new(editor, s, cx));
        let c2 = content.clone();
        rexa_ui::open_dialog(cx, move |_, cx| {
            let n = c2.read(cx).versions.len();
            Dialog::new().max_w(if n <= 3 { 380. } else { 420. }).header(div()).child(c2.clone())
        });
        let _ = window;
    }

    // ---- AI ------------------------------------------------------------------------

    /// `handleGenerateAiSnippet`
    fn handle_generate_ai_snippet(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if !self.ai_mode {
            return;
        }
        let generator = sql_ai_generator(cx).filter(|g| g.has_any_models(cx));
        let Some(generator) = generator else {
            toast::error("Select a signed-in local CLI or configure an API provider and model first.", cx);
            rexa_core::emit_studio(StudioEvent::OpenSettings { section: Some("ai".into()) }, cx);
            return;
        };
        let request = SqlAiRequest {
            connection_id: self.connection_id,
            db_type: self.db_type.clone(),
            prompt: self.query.trim().to_string(),
            provider: String::new(),
            model: String::new(),
            selected_namespace: None,
            schema: self.input.read(cx).schema.borrow().clone(),
        };
        self.generating = true;
        cx.notify();
        let task = generator.generate(request, cx);
        cx.spawn_in(window, async move |this, cx| {
            let res = task.await;
            this.update_in(cx, |this, window, cx| {
                this.generating = false;
                match res {
                    Ok(reply) => {
                        let next = commented_snippet(&this.db_type, &reply);
                        this.set_ai_mode(false, cx);
                        this.set_query(next, window, cx);
                    }
                    Err(e) => {
                        toast::error(format!("{e:#}"), cx);
                    }
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }
}

// ---- rendering -------------------------------------------------------------------

/// The primary toolbar buttons: `h-8 text-xs px-3 font-semibold gap-2`
/// on the raised default button look.
fn primary_button(id: &'static str, icon: IconName, label: String, kbd: String, disabled: bool, t: &Tokens) -> gpui::Stateful<gpui::Div> {
    let fg = t.var("--primary-foreground").unwrap_or(gpui::white());
    let (bg, hover) = if t.dark { (sheen(t.primary, 0.0525), sheen(with_alpha(t.primary, 0.9), 0.08)) } else { (t.primary, with_alpha(t.primary, 0.9)) };
    div()
        .id(id)
        .flex()
        .flex_shrink_0()
        .items_center()
        .gap_2()
        .h_8()
        .px_3()
        .tw_rounded_lg()
        .border_1()
        .border_color(if t.dark { white(0.2) } else { gpui::transparent_black() })
        .bg(bg)
        .text_color(fg)
        .tw_text_xs()
        .font_weight(FontWeight::SEMIBOLD)
        .whitespace_nowrap()
        .when(disabled, |d| d.opacity(0.5))
        .when(!disabled, |d| d.cursor_pointer().hover(move |s| s.bg(hover)))
        .child(Icon::new(icon).size(px(14.)))
        .child(label)
        .child(div().ml_1().opacity(0.6).tw_text_xs().child(kbd))
}

/// lucide `History` (not in the bundled Lucide set; assets/ui/history.svg).
pub fn history_icon(size: f32) -> impl IntoElement {
    Icon::empty().path("ui/history.svg").size(px(size))
}

fn vrule(t: &Tokens) -> impl IntoElement {
    div().w(px(1.)).h_4().mx_1().bg(t.border)
}

fn ghost_icon(
    id: &'static str,
    icon: IconName,
    title: impl Into<SharedString>,
    disabled: bool,
    on_click: impl Fn(&gpui::ClickEvent, &mut Window, &mut App) + 'static,
) -> Tooltip {
    Tooltip::new(title).child(Button::new(id).ghost().size(ButtonSize::Icon).icon(icon).disabled(disabled).on_click(on_click))
}

impl SqlEditor {
    fn render_toolbar(&mut self, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        let is_mongo = self.db_type == "mongodb";
        let is_redis = self.db_type == "redis";
        let badge = editor_badge(&self.db_type);
        let existing = self.existing_snippet().cloned();
        let nothing_changed = existing.as_ref().is_some_and(|s| s.query == self.query);
        let duplicate = existing.as_ref().is_some_and(|s| self.latest_version_query.as_deref() == Some(s.query.as_str()));

        let run: AnyElement = if self.ai_mode {
            primary_button(
                "gen-ai",
                IconName::WandSparkles,
                if self.generating { "Generating...".into() } else { "Generate Snippet".into() },
                shortcut("Cmd+Enter"),
                self.generating,
                &t,
            )
            .on_click(cx.listener(|this, _, w, cx| this.handle_generate_ai_snippet(w, cx)))
            .into_any_element()
        } else if self.has_selection {
            primary_button("run-sel", IconName::Play, "Run Selected".into(), shortcut("Cmd+Shift+Enter"), false, &t)
                .on_click(cx.listener(|this, _, w, cx| this.handle_run_selected(w, cx)))
                .into_any_element()
        } else {
            let label = if is_mongo { "Run Shell" } else if is_redis { "Run Command" } else { "Run Query" };
            primary_button("run", IconName::Play, label.into(), shortcut("Cmd+Enter"), false, &t)
                .on_click(cx.listener(|this, _, w, cx| this.handle_run(w, cx)))
                .into_any_element()
        };

        let can_stop = self.loading;
        let stop = self.loading.then(|| {
            div()
                .id("stop")
                .flex()
                .items_center()
                .gap_2()
                .h_8()
                .px_3()
                .tw_rounded_lg()
                .border_1()
                .border_color(with_alpha(t.destructive, 0.4))
                .text_color(t.destructive)
                .tw_text_xs()
                .font_weight(FontWeight::SEMIBOLD)
                .when(!can_stop, |d| d.opacity(0.5))
                .cursor_pointer()
                .hover(|s| s.bg(with_alpha(t.destructive, 0.1)))
                .on_click(cx.listener(|this, _, _, cx| this.handle_stop(cx)))
                .child(Icon::new(IconName::Square).size(px(12.)))
                .child("Stop")
                .child(div().ml_1().opacity(0.6).child(shortcut("Cmd+.")))
        });

        let left = div()
            .flex()
            .items_center()
            .gap_2()
            .child(run)
            .children(stop)
            .child(vrule(&t))
            .when(!is_redis && !is_mongo, |d| {
                d.child(
                    ghost_icon(
                        "explain",
                        IconName::Brain,
                        format!("Explain Plan ({})", shortcut("Cmd+E")),
                        self.loading || self.query.trim().is_empty(),
                        cx.listener(|this, _, _, cx| this.handle_explain(cx)),
                    )
                    .id("explain-tt"),
                )
            })
            .child(vrule(&t))
            .when(!is_redis, |d| {
                d.child(
                    ghost_icon("format", IconName::WandSparkles, format!("Format {badge}"), false, cx.listener(|this, _, w, cx| this.handle_format(w, cx)))
                        .id("format-tt"),
                )
            })
            .child(ghost_icon("copy", IconName::Copy, "Copy Query", false, cx.listener(|this, _, _, cx| this.handle_copy_query(cx))).id("copy-tt"))
            .child(if existing.is_some() {
                ghost_icon(
                    "save",
                    IconName::Save,
                    if nothing_changed { "No changes to save" } else { "Save Snippet" },
                    nothing_changed || duplicate,
                    cx.listener(|this, _, _, cx| this.handle_save_existing_snippet(cx)),
                )
                .id("save-tt")
            } else {
                ghost_icon("save", IconName::Save, "Save Snippet", false, cx.listener(|this, _, w, cx| this.open_save_dialog(w, cx))).id("save-tt")
            })
            .when(existing.is_some(), |d| {
                d.child(
                    Tooltip::new("Version History")
                        .child(
                            Button::new("history")
                                .ghost()
                                .size(ButtonSize::Icon)
                                .child(history_icon(16.))
                                .on_click(cx.listener(|this, _, w, cx| this.open_version_history(w, cx))),
                        )
                        .id("hist-tt"),
                )
            })
            .when(self.ai_mode, |d| {
                d.child(vrule(&t)).child(
                    Button::new("add-models")
                        .ghost()
                        .size(ButtonSize::Sm)
                        .label("Add Models")
                        .on_click(|_, _, cx| rexa_core::emit_studio(StudioEvent::OpenSettings { section: Some("ai".into()) }, cx)),
                )
            });

        let mode_on = self.ai_mode;
        let chart2 = t.var("--chart-2").unwrap_or(t.primary);
        let right = div()
            .flex()
            .items_center()
            .gap_4()
            .child(
                div()
                    .id("mode")
                    .h_7()
                    .px_3()
                    .flex()
                    .items_center()
                    .tw_rounded_lg()
                    .tw_text_xs()
                    .cursor_pointer()
                    .when(mode_on, |d| {
                        d.bg(with_alpha(chart2, 0.1))
                            .border_1()
                            .border_color(with_alpha(chart2, 0.2))
                            .text_color(chart2)
                            .hover(move |s| s.bg(with_alpha(chart2, 0.2)))
                    })
                    .when(!mode_on, |d| d.text_color(t.muted_foreground).hover(|s| s.text_color(t.foreground)))
                    .on_click(cx.listener(|this, _, _, cx| {
                        let on = !this.ai_mode;
                        this.set_ai_mode(on, cx);
                    }))
                    .child(if mode_on { "AI Mode" } else { "SQL Mode" }),
            )
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(6.))
                    .px_2()
                    .py_1()
                    .rounded(px(4.))
                    .bg(with_alpha(t.var("--secondary").unwrap_or(t.muted), 0.3))
                    .border_1()
                    .border_color(t.studio_border)
                    .child(div().tw_text_xs().font_weight(FontWeight::BOLD).text_color(t.muted_foreground).child(badge)),
            )
            .when(self.loading || self.results.is_some(), |d| {
                d.child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(6.))
                        .text_color(t.muted_foreground)
                        .min_w(px(80.))
                        .justify_end()
                        .child(Icon::new(IconName::Clock).size(px(14.)))
                        .child(div().tw_text_xs().font_family(MONO).child(format!("{:.0}ms", self.execution_time))),
                )
            });

        // Wire the ghost buttons (Tooltip wraps them, so clicks are attached here by id).
        div()
            .h_12()
            .flex_shrink_0()
            .border_b_1()
            .border_color(t.border)
            .bg(t.studio_header_bg)
            .flex()
            .items_center()
            .justify_between()
            .px_4()
            .child(left)
            .child(right)
    }

    fn render_result_tabs(&mut self, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        let n = self.result_tabs.len();
        let active_bg = t.var("--studio-tab-active").unwrap_or(t.studio_bg);
        let inactive_bg = t.var("--studio-tab-inactive").unwrap_or(t.studio_bg);
        div()
            .id("result-tabs")
            .h_10()
            .flex_shrink_0()
            .border_b_1()
            .border_color(t.studio_border)
            .bg(t.studio_bg)
            .flex()
            .items_center()
            .overflow_x_scroll()
            .children(self.result_tabs.iter().enumerate().map(|(idx, tab)| {
                let active = self.active_result_tab.as_deref() == Some(tab.id.as_str());
                let id = tab.id.clone();
                let (id1, id2, id3, id4, id5, id6) = (id.clone(), id.clone(), id.clone(), id.clone(), id.clone(), id.clone());
                let weak = cx.entity().downgrade();
                let group: SharedString = format!("rt-{}", tab.id).into();
                let body = div()
                    .id(SharedString::from(format!("rtab-{}", tab.id)))
                    .group(group.clone())
                    .h_10()
                    .flex()
                    .items_center()
                    .gap_2()
                    .px_3()
                    .tw_text_xs()
                    .relative()
                    .cursor_pointer()
                    .when(active, |d| d.bg(active_bg).text_color(t.foreground))
                    .when(!active, |d| {
                        d.bg(inactive_bg)
                            .text_color(with_alpha(t.muted_foreground, 0.4))
                            .hover(|s| s.bg(t.studio_row_hover).text_color(with_alpha(t.muted_foreground, 0.6)))
                    })
                    .on_click(cx.listener(move |this, _, _, cx| this.select_result_tab(Some(id1.clone()), cx)))
                    .child(div().whitespace_nowrap().child(tab.label.clone()))
                    .child(
                        Tooltip::studio("Close Tab").child(
                            div()
                                .id(SharedString::from(format!("rtab-x-{}", tab.id)))
                                .p(px(2.))
                                .tw_rounded_lg()
                                .hover(|s| s.bg(with_alpha(t.muted, 0.4)))
                                .when(!active, |d| d.invisible().group_hover(group.clone(), |s| s.visible()))
                                .on_click(cx.listener(move |this, _, _, cx| {
                                    cx.stop_propagation();
                                    this.close_result_tab(&id2, cx)
                                }))
                                .child(Icon::new(IconName::X).size(px(10.))),
                        ),
                    )
                    .when(active, |d| {
                        d.child(div().absolute().top_0().left_0().right_0().h(px(1.)).bg(t.primary).shadow(vec![gpui::BoxShadow {
                            color: t.ring,
                            offset: gpui::point(px(0.), px(0.)),
                            blur_radius: px(8.),
                            spread_radius: px(0.),
                            inset: false,
                        }]))
                    });
                ContextMenu::new(SharedString::from(format!("rtab-menu-{}", tab.id)))
                    .menu(move |m, _, _| {
                        let (w1, w2, w3, w4, w5) = (weak.clone(), weak.clone(), weak.clone(), weak.clone(), weak.clone());
                        let (a, b, c, d) = (id3.clone(), id4.clone(), id5.clone(), id6.clone());
                        m.w(176.)
                            .item(MenuItem::new("Close").icon(IconName::X).text_xs().on_select(move |_, cx| {
                                w1.update(cx, |this, cx| this.close_result_tab(&a, cx)).ok();
                            }))
                            .separator()
                            .item(MenuItem::new("Close Others").text_xs().disabled(n <= 1).on_select(move |_, cx| {
                                w2.update(cx, |this, cx| this.close_other_result_tabs(&b, cx)).ok();
                            }))
                            .item(MenuItem::new("Close All").text_xs().on_select(move |_, cx| {
                                w3.update(cx, |this, cx| this.close_all_result_tabs(cx)).ok();
                            }))
                            .separator()
                            .item(MenuItem::new("Close Tabs To Right").icon(IconName::ArrowRight).text_xs().disabled(idx == n - 1).on_select(
                                move |_, cx| {
                                    w4.update(cx, |this, cx| this.close_result_tabs_side(&c, true, cx)).ok();
                                },
                            ))
                            .item(MenuItem::new("Close Tabs To Left").icon(IconName::ArrowLeft).text_xs().disabled(idx == 0).on_select(
                                move |_, cx| {
                                    w5.update(cx, |this, cx| this.close_result_tabs_side(&d, false, cx)).ok();
                                },
                            ))
                    })
                    .child(body)
            }))
    }

    fn export_menu(&self, id: &'static str, icon: IconName, verb: &'static str, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        let sql = !matches!(self.db_type.as_str(), "mongodb" | "redis");
        let weak = cx.entity().downgrade();
        let copy = verb == "Copy";
        let group: SharedString = format!("{id}-g").into();
        DropdownMenu::new(id)
            .align(Align::Start)
            .trigger(
                div()
                    .id(SharedString::from(format!("{id}-trigger")))
                    .group(group.clone())
                    .flex()
                    .items_center()
                    .gap_1()
                    .text_color(t.muted_foreground)
                    .hover(|s| s.text_color(t.foreground))
                    .cursor_pointer()
                    .child(Icon::new(icon).size(px(14.)))
                    .child(div().opacity(0.5).group_hover(group, |s| s.opacity(1.)).child(Icon::new(IconName::ChevronDown).size(px(12.)))),
            )
            .menu(move |m, _, _| {
                let item = |label: String, f: ExportFormat| {
                    let w = weak.clone();
                    MenuItem::new(label).text_xs().on_select(move |_, cx| {
                        w.update(cx, |this, cx| if copy { this.handle_copy(f, cx) } else { this.handle_export(f, cx) }).ok();
                    })
                };
                let as_ = if copy { "Copy as" } else { "Export as" };
                m.w(160.)
                    .item(item(format!("{as_} CSV"), ExportFormat::Csv))
                    .item(item(format!("{as_} JSON"), ExportFormat::Json))
                    .when(sql, |m| m.item(item(format!("{as_} SQL Inserts"), ExportFormat::Sql)))
                    .item(item(format!("{as_} Markdown"), ExportFormat::Markdown))
            })
    }

    fn render_results_pane(&mut self, cx: &mut Context<Self>) -> AnyElement {
        let t = cx.tokens().clone();
        let has_any = self.error.is_some() || self.results.is_some() || !self.result_tabs.is_empty();
        let beam = div().h(px(1.)).w_full().flex_shrink_0().relative().when(self.loading, |d| {
            // `bg-gradient-to-r from-transparent via-blue-500/40 via-blue-400 … animate-progress-beam`
            // (approximation: a static centered gradient).
            d.bg(linear_gradient(90., linear_color_stop(with_alpha(tw("blue-400"), 0.0), 0.), linear_color_stop(tw("blue-400"), 0.5)))
        });
        let empty = |text: &'static str| {
            div()
                .flex_1()
                .flex()
                .items_center()
                .justify_center()
                .bg(t.studio_bg)
                .child(div().tw_text_xs().text_color(with_alpha(t.muted_foreground, 0.4)).child(text))
                .into_any_element()
        };
        let mut pane = div().flex().size_full().min_h_0().flex_col().bg(t.studio_bg).overflow_hidden().relative().child(beam);
        if !has_any {
            if !self.loading {
                pane = pane.child(empty("No results to display"));
            }
            return pane.into_any_element();
        }
        let mut inner = div().flex_1().flex().flex_col().overflow_hidden().min_h_0();
        if !self.result_tabs.is_empty() {
            inner = inner.child(self.render_result_tabs(cx));
        }
        if self.error.is_some() || self.results.is_some() {
            let left: AnyElement = if let Some(err) = self.error.clone() {
                div()
                    .id("copy-error")
                    .flex()
                    .items_center()
                    .gap_1()
                    .tw_text_xs()
                    .text_color(t.muted_foreground)
                    .hover(|s| s.text_color(t.foreground))
                    .cursor_pointer()
                    .on_click(move |_, _, cx| {
                        cx.write_to_clipboard(ClipboardItem::new_string(err.clone()));
                        toast::success("Error copied to clipboard", cx);
                    })
                    .child(Icon::new(IconName::Copy).size(px(14.)))
                    .into_any_element()
            } else {
                div()
                    .flex()
                    .items_center()
                    .gap_4()
                    .child(self.export_menu("copy-menu", IconName::Copy, "Copy", cx))
                    .child(self.export_menu("export-menu", IconName::Download, "Export", cx))
                    .into_any_element()
            };
            let count = self.results.as_deref().map(row_count).unwrap_or(0);
            inner = inner.child(
                div()
                    .h_10()
                    .flex_shrink_0()
                    .border_b_1()
                    .border_color(t.studio_border)
                    .flex()
                    .items_center()
                    .justify_between()
                    .px_4()
                    .bg(t.studio_header_bg)
                    .child(div().flex().items_center().gap_4().child(left))
                    .child(div().tw_text_xs().text_color(t.muted_foreground).child(if self.error.is_some() {
                        div().text_color(t.destructive).child("Query Error")
                    } else {
                        div().child(format!("{count} {}", if count == 1 { "row" } else { "rows" }))
                    })),
            );
        }
        let body: AnyElement = if let Some(err) = &self.error {
            div()
                .id("error-body")
                .flex_1()
                .p_4()
                .text_color(t.destructive)
                .bg(with_alpha(t.destructive, 0.05))
                .flex()
                .items_start()
                .gap_3()
                .overflow_y_scroll()
                .child(div().mt(px(2.)).flex_shrink_0().child(Icon::new(IconName::CircleAlert).size(px(20.))))
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .gap_1()
                        .min_w_0()
                        .child(div().tw_text_sm().font_weight(FontWeight::SEMIBOLD).child("Query Error"))
                        .child(div().tw_text_xs().font_family(MONO).opacity(0.8).whitespace_normal().child(err.clone())),
                )
                .into_any_element()
        } else if let Some(r) = self.results.clone().filter(|r| row_count(r) == 0) {
            let _ = r;
            div()
                .flex_1()
                .flex()
                .items_center()
                .justify_center()
                .bg(t.studio_bg)
                .child(div().tw_text_xs().text_color(with_alpha(t.muted_foreground, 0.6)).child("Success. No rows returned"))
                .into_any_element()
        } else if let (Some(_), Some(plan), true) = (&self.results, self.explain_plan.clone(), self.show_plan_view) {
            self.render_plan(plan, cx)
        } else if self.results.is_some() {
            if self.explain_plan.is_some() {
                div()
                    .flex_1()
                    .flex()
                    .flex_col()
                    .min_h_0()
                    .child(
                        div().flex().items_center().justify_end().px_4().py_1().border_b_1().border_color(t.studio_border).child(
                            Button::new("show-plan").ghost().size(ButtonSize::Xs).label("Show Plan").on_click(cx.listener(|this, _, _, cx| {
                                this.show_plan_view = true;
                                cx.notify();
                            })),
                        ),
                    )
                    .child(self.grid.clone())
                    .into_any_element()
            } else {
                div().flex_1().flex().min_h_0().child(self.grid.clone()).into_any_element()
            }
        } else if self.loading {
            div()
                .flex()
                .items_center()
                .gap_2()
                .child(Spinner::new(16.))
                .child(div().tw_text_xs().font_weight(FontWeight::MEDIUM).child("Running query..."))
                .into_any_element()
        } else {
            empty("No results to display")
        };
        inner = inner.child(body);
        pane.child(inner).into_any_element()
    }

    fn render_plan(&mut self, plan: Value, cx: &mut Context<Self>) -> AnyElement {
        let t = cx.tokens().clone();
        let weak = cx.entity().downgrade();
        let toggle: ToggleHandler = Rc::new(move |path, _, cx| {
            weak.update(cx, |this, cx| {
                if !this.plan_toggled.remove(&path) {
                    this.plan_toggled.insert(path);
                }
                cx.notify();
            })
            .ok();
        });
        let timing = plan.get("Planning Time").and_then(Value::as_f64).map(|p| {
            div()
                .flex()
                .items_center()
                .gap_3()
                .tw_text_xs()
                .text_color(t.muted_foreground)
                .child(format!("Planning: {}ms", crate::explain::js_num(p)))
                .children(plan.get("Execution Time").and_then(Value::as_f64).map(|e| format!("Execution: {}ms", crate::explain::js_num(e))))
        });
        let node = plan_node(&plan).map(|n| plan_node_card(n, 0, "0".into(), &self.plan_toggled, toggle, cx));
        div()
            .id("plan-view")
            .flex_1()
            .overflow_y_scroll()
            .p_4()
            .bg(t.studio_bg)
            .child(
                div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .mb_3()
                    .child(div().tw_text_xs().font_weight(FontWeight::SEMIBOLD).text_color(t.foreground).child("Query Plan"))
                    .child(Button::new("show-table").ghost().size(ButtonSize::Xs).label("Show Table").on_click(cx.listener(|this, _, _, cx| {
                        this.show_plan_view = false;
                        cx.notify();
                    }))),
            )
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap_3()
                    .children(timing)
                    .child(div().bg(with_alpha(t.background, 0.2)).border_1().border_color(t.studio_border).tw_rounded_lg().children(node)),
            )
            .into_any_element()
    }
}

impl Render for SqlEditor {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if let Some(q) = self.pending_set_query.take() {
            self.set_query(q, window, cx);
        }
        let t = cx.tokens().clone();
        let toolbar = self.render_toolbar(cx);
        let editor_pane = div().flex().flex_col().size_full().min_h_0().overflow_hidden().bg(t.studio_bg).child(self.input.clone());

        let content: AnyElement = if self.hide_results {
            div().flex_1().relative().min_h_0().child(editor_pane).into_any_element()
        } else {
            let ratio = self.split_ratio;
            let bounds_cell = self.split_bounds.clone();
            let active = self.sash_hovered || self.dragging;
            let results = self.render_results_pane(cx);
            div()
                .flex_1()
                .min_h_0()
                .flex()
                .flex_col()
                .relative()
                .overflow_hidden()
                .child(canvas(move |b, _, _| bounds_cell.set(b), |_, _, _, _| {}).absolute().size_full())
                .child(div().flex_shrink_0().h(gpui::relative(ratio)).min_h_0().flex().flex_col().overflow_hidden().child(editor_pane))
                .child(div().flex_shrink_0().h(gpui::relative(1. - ratio)).min_h_0().flex().flex_col().overflow_hidden().child(results))
                .child(
                    // SASH_HIT_PX = 8, centered on the 1px rule.
                    div()
                        .id("sql-sash")
                        .absolute()
                        .left_0()
                        .right_0()
                        .top(gpui::relative(ratio))
                        .mt(px(-4.))
                        .h(px(8.))
                        .cursor_row_resize()
                        .on_hover(cx.listener(|this, h: &bool, _, cx| {
                            this.sash_hovered = *h;
                            cx.notify();
                        }))
                        .on_mouse_down(
                            MouseButton::Left,
                            cx.listener(|this, _, _, cx| {
                                this.dragging = true;
                                cx.stop_propagation();
                                cx.notify();
                            }),
                        )
                        .child(div().absolute().left_0().right_0().top(px(3.5)).h(px(1.)).bg(t.border).when(active, |d| d.invisible()))
                        .child(div().absolute().size_full().rounded_full().when(self.dragging, |d| d.bg(t.border)).when(
                            self.sash_hovered && !self.dragging,
                            |d| d.bg(with_alpha(t.border, 0.5)),
                        )),
                )
                .when(self.dragging, |d| {
                    d.on_mouse_move(cx.listener(|this, ev: &MouseMoveEvent, _, cx| {
                        let b = this.split_bounds.get();
                        let h = f32::from(b.size.height);
                        if h > 0. {
                            let r = (f32::from(ev.position.y - b.origin.y) / h).clamp(0.2, 0.8);
                            this.split_ratio = r;
                            cx.notify();
                        }
                    }))
                    .on_mouse_up(
                        MouseButton::Left,
                        cx.listener(|this, _: &MouseUpEvent, _, cx| {
                            this.dragging = false;
                            cx.notify();
                        }),
                    )
                })
                .into_any_element()
        };

        div()
            .id("sql-editor")
            .flex_1()
            .size_full()
            .flex()
            .flex_col()
            .min_w_0()
            .bg(t.studio_bg)
            .relative()
            .font_family(rexa_ui::SANS)
            .text_color(t.foreground)
            .child(toolbar)
            .child(content)
    }
}

// ---- Save Snippet dialog -----------------------------------------------------------

struct SaveSnippetDialog {
    editor: WeakEntity<SqlEditor>,
    name: Entity<InputState>,
    folders: Vec<Folder>,
    folder: SharedString,
    _sub: Subscription,
}

impl SaveSnippetDialog {
    fn new(editor: WeakEntity<SqlEditor>, folders: Vec<Folder>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let name = cx.new(|cx| InputState::new(window, cx).placeholder("e.g. Fetch all users"));
        name.update(cx, |s, cx| s.focus(window, cx));
        let sub = cx.observe(&name, |_, _, cx| cx.notify());
        SaveSnippetDialog { editor, name, folders, folder: "none".into(), _sub: sub }
    }

    fn save(&mut self, cx: &mut Context<Self>) {
        let name = self.name.read(cx).value().to_string();
        if name.trim().is_empty() {
            return;
        }
        let folder = (self.folder != "none").then(|| self.folder.to_string());
        self.editor
            .update(cx, |e, cx| {
                let q = e.query.clone();
                e.add_snippet(name, q, folder, cx)
            })
            .ok();
        rexa_ui::close_top(cx);
    }
}

impl Render for SaveSnippetDialog {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        let can_save = !self.name.read(cx).value().trim().is_empty();
        let mut options = vec![SelectOption::new("none", "No Folder")];
        options.extend(self.folders.iter().map(|f| SelectOption::new(f.id.clone(), f.name.clone()).icon(IconName::Folder)));
        let weak = cx.entity().downgrade();
        div()
            .flex()
            .flex_col()
            .bg(t.studio_bg)
            .tw_rounded_lg()
            .overflow_hidden()
            .child(
                div().p_6().pb_2().flex().items_center().gap_2().child(Icon::new(IconName::Save).size(px(20.)).text_color(tw("blue-500"))).child(
                    div().tw_text_sm().font_weight(FontWeight::BOLD).child(tight("Save Query Snippet")),
                ),
            )
            .child(
                div()
                    .p_6()
                    .flex()
                    .flex_col()
                    .gap_6()
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap_2()
                            .child(div().tw_text_xs().text_color(t.muted_foreground).child(Label::new("Snippet Name")))
                            .child(
                                div()
                                    .on_key_down(cx.listener(|this, ev: &gpui::KeyDownEvent, _, cx| {
                                        if ev.keystroke.key == "enter" {
                                            this.save(cx);
                                        }
                                    }))
                                    .child(TextInput::new(&self.name).h(32.)),
                            ),
                    )
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap_2()
                            .child(div().tw_text_xs().text_color(t.muted_foreground).child(Label::new("Folder (Optional)")))
                            .child(Select::new("snippet-folder").w_full().options(options).value(Some(self.folder.clone())).placeholder("Select a folder").on_change(
                                move |v, _, cx| {
                                    weak.update(cx, |this, cx| {
                                        this.folder = v;
                                        cx.notify();
                                    })
                                    .ok();
                                },
                            )),
                    ),
            )
            .child(
                div()
                    .bg(t.studio_header_bg)
                    .p_4()
                    .border_t_1()
                    .border_color(t.studio_border)
                    .flex()
                    .justify_end()
                    .gap_2()
                    .child(Button::new("snip-cancel").ghost().label("Cancel").on_click(|_, _, cx| rexa_ui::close_top(cx)))
                    .child(Button::new("snip-save").label("Save Snippet").disabled(!can_save).on_click(cx.listener(|this, _, _, cx| this.save(cx)))),
            )
    }
}

// ---- Version History dialog ---------------------------------------------------------

struct VersionHistoryDialog {
    editor: WeakEntity<SqlEditor>,
    snippet: Snippet,
    versions: Vec<SnippetVersion>,
    loading: bool,
}

impl VersionHistoryDialog {
    fn new(editor: WeakEntity<SqlEditor>, snippet: Snippet, _cx: &mut Context<Self>) -> Self {
        let versions = SqlStore::open().and_then(|s| s.snippet_versions(&snippet.id)).unwrap_or_default();
        VersionHistoryDialog { editor, snippet, versions, loading: false }
    }

    /// `handleRestoreVersion`: back up the current state, then restore.
    fn restore(&mut self, v: SnippetVersion, cx: &mut Context<Self>) {
        let Some(current) = self
            .editor
            .upgrade()
            .and_then(|e| e.read(cx).snippets.iter().find(|s| s.id == self.snippet.id).cloned())
        else {
            return;
        };
        let Ok(store) = SqlStore::open() else { return };
        if store.create_snippet_version(&current.id, &current.name, &current.query).is_err() {
            toast::error("Failed to backup current state", cx);
            return;
        }
        if let Ok((name, query)) = store.restore_snippet_version(&current.id, &v.id) {
            let id = current.id.clone();
            self.editor
                .update(cx, |e, cx| {
                    // `updateSnippet` also pushes the query into the active editor tab.
                    e.update_snippet(&id, Some(name), Some(query.clone()), cx);
                    e.pending_set_query = Some(query);
                    cx.notify();
                })
                .ok();
            toast::success(format!("Restored v{}", v.version_number), cx);
        }
        self.versions = store.snippet_versions(&self.snippet.id).unwrap_or_default();
        cx.notify();
    }
}

/// `formatVersionDate`: "Mar 4, 2026 09:15 AM"
fn format_version_date(ms: i64) -> String {
    use chrono::TimeZone;
    match chrono::Local.timestamp_millis_opt(ms).single() {
        Some(d) => d.format("%b %-d, %Y %I:%M %p").to_string(),
        None => String::new(),
    }
}

impl Render for VersionHistoryDialog {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        let header = div()
            .flex()
            .flex_col()
            .gap(px(6.))
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap_2()
                    .tw_text_sm()
                    .font_weight(FontWeight::SEMIBOLD)
                    .child(history_icon(16.))
                    .child(tight(format!("Version History: {}", self.snippet.name))),
            )
            .child(div().tw_text_sm().text_color(t.muted_foreground).child("Previous versions of this snippet. Restoring creates a backup first."));
        let body: AnyElement = if self.loading {
            div().flex().items_center().justify_center().py_12().tw_text_xs().text_color(t.muted_foreground).child("Loading versions...").into_any_element()
        } else if self.versions.is_empty() {
            div()
                .flex()
                .flex_col()
                .items_center()
                .justify_center()
                .py_12()
                .gap_2()
                .child(Icon::new(IconName::Clock).size(px(32.)).text_color(with_alpha(t.muted_foreground, 0.3)))
                .child(div().tw_text_xs().text_color(t.muted_foreground).child("No version history yet."))
                .child(
                    div()
                        .tw_text_xs()
                        .text_color(with_alpha(t.muted_foreground, 0.6))
                        .child("Versions are created when you save changes to an existing snippet."),
                )
                .into_any_element()
        } else {
            let versions = self.versions.clone();
            div()
                .id("versions")
                .max_h(px(360.))
                .overflow_y_scroll()
                .pr_3()
                .flex()
                .flex_col()
                .gap_1()
                .children(versions.iter().enumerate().map(|(idx, v)| {
                    // `computeVersionDiff(nextVersion.query, version.query)`
                    let diff = versions.get(idx + 1).and_then(|next| {
                        let (cur, cmp) = (next.query.split('\n').count() as i64, v.query.split('\n').count() as i64);
                        let (added, removed) = ((cmp - cur).max(0), (cur - cmp).max(0));
                        (added != 0 || removed != 0).then_some((added, removed))
                    });
                    let group: SharedString = format!("ver-{}", v.id).into();
                    let (v1, v2) = (v.clone(), v.clone());
                    let editor = self.editor.clone();
                    let name = self.snippet.name.clone();
                    div()
                        .id(SharedString::from(format!("ver-row-{}", v.id)))
                        .group(group.clone())
                        .flex()
                        .items_center()
                        .gap_3()
                        .px_3()
                        .py(px(10.))
                        .tw_rounded_lg()
                        .hover(|s| s.bg(with_alpha(t.accent, 0.5)))
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .gap_2()
                                .min_w_0()
                                .flex_1()
                                .child(div().tw_text_xs().font_weight(FontWeight::SEMIBOLD).text_color(t.foreground).w_7().flex_shrink_0().child(format!("v{}", v.version_number)))
                                .child(div().tw_text_xs().text_color(t.muted_foreground).overflow_hidden().whitespace_nowrap().text_ellipsis().child(format_version_date(v.created_at)))
                                .children(diff.map(|(a, r)| {
                                    div()
                                        .tw_text_xs()
                                        .flex_shrink_0()
                                        .font_family(MONO)
                                        .flex()
                                        .when(a > 0, |d| d.child(div().text_color(tw("emerald-500")).child(format!("+{a}"))))
                                        .when(a > 0 && r > 0, |d| d.child(div().mx(px(2.)).text_color(with_alpha(t.muted_foreground, 0.4)).child("/")))
                                        .when(r > 0, |d| d.child(div().text_color(tw("red-500")).child(format!("-{r}"))))
                                })),
                        )
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .gap_1()
                                .invisible()
                                .group_hover(group, |s| s.visible())
                                .child(Tooltip::new("Open in new tab").child(
                                    Button::new(SharedString::from(format!("ver-open-{}", v.id))).ghost().size(ButtonSize::IconSm).icon(IconName::FileCode).on_click(
                                        move |_, _, cx| {
                                            let _ = &editor;
                                            rexa_core::open_tab(
                                                TabSpec::Query {
                                                    id: format!("sql-new-{}", now_millis()),
                                                    title: format!("{name} v{}", v1.version_number),
                                                    sql: v1.query.clone(),
                                                },
                                                cx,
                                            );
                                        },
                                    ),
                                ))
                                .child(Tooltip::new("Restore this version").child(
                                    Button::new(SharedString::from(format!("ver-restore-{}", v.id)))
                                        .ghost()
                                        .size(ButtonSize::IconSm)
                                        .icon(IconName::RotateCcw)
                                        .on_click(cx.listener(move |this, _, _, cx| this.restore(v2.clone(), cx))),
                                )),
                        )
                }))
                .into_any_element()
        };
        div().flex().flex_col().gap_4().max_h(px(560.)).child(header).child(div().flex_1().min_h_0().overflow_hidden().child(body))
    }
}
