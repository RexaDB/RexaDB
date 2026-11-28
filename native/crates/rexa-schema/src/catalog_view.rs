//! Port of components/studio/data-catalog-view.tsx (`database-catalog`): table cards
//! with descriptions (local dictionary or native comments), expandable column
//! tables with per-column descriptions and display decorators, coverage stats,
//! search over names + descriptions (loading every structure while a query is
//! active), coverage filter, native-comment reload and "Push to DB".
//!
//! Approximation: the description / decorator popovers are dialogs.

use crate::common;
use crate::data_table::{Column, DataTable, Row, TableState};
use crate::dictionary::{self as dict, CatalogSourceTable, CatalogTableEntry, DescriptionSource, DictionaryScope, NativeComments};
use gpui::{div, prelude::*, px, AnyElement, App, AppContext, Context, Entity, FontWeight, SharedString, Window};
use rexa_core::{runtime, studio_bus, Session, StudioEvent, TabSpec};
use rexa_drivers::{ColumnDetail, Kind, TableRef};
use rexa_ui::widgets::{Icon, InputEvent, InputState};
use rexa_ui::{tw, with_alpha, ActiveTokens, Align, Badge, BadgeVariant, Button, ButtonSize, Dialog, DropdownMenu, IconName, MenuItem, Side, Spinner, TextArea, TextInput, Toast, Tooltip, Tw, MONO};
use gpui_component::input::TextareaState;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

pub struct DataCatalogView {
    session: Arc<Session>,
    schema: String,
    schemas: Vec<String>,
    tables: Vec<String>,
    scope: DictionaryScope,
    native: NativeComments,
    native_loading: bool,
    structures: HashMap<String, Vec<ColumnDetail>>,
    loading_tables: HashSet<String>,
    expanded: HashSet<String>,
    coverage: Vec<&'static str>,
    search: Entity<InputState>,
    table_states: HashMap<String, Entity<TableState>>,
    loaded: bool,
    _subs: Vec<gpui::Subscription>,
}

fn supports_native(k: Kind) -> bool {
    matches!(k, Kind::Postgres | Kind::SupabaseMgmt | Kind::MySql)
}

impl DataCatalogView {
    pub fn new(spec: TabSpec, session: Arc<Session>, schema: Option<String>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let search = cx.new(|cx| InputState::new(window, cx).placeholder("Search tables, columns, descriptions"));
        let my = spec.clone();
        let subs = vec![
            cx.subscribe(&search, |v: &mut Self, _, _: &InputEvent, cx| {
                v.ensure_all_for_search(cx);
                cx.notify()
            }),
            cx.subscribe(&studio_bus(cx), move |v: &mut Self, _, e: &StudioEvent, cx| match e {
                StudioEvent::SchemaChanged => v.load(cx),
                StudioEvent::TabCommand { tab, command } if *tab == my && command == "REFRESH_CURRENT_TAB" => v.load(cx),
                _ => {}
            }),
        ];
        let schema = schema.unwrap_or_else(|| common::default_schema(&session));
        let mut this = DataCatalogView {
            session,
            schema,
            schemas: Vec::new(),
            tables: Vec::new(),
            scope: DictionaryScope::default(),
            native: NativeComments::default(),
            native_loading: false,
            structures: HashMap::new(),
            loading_tables: HashSet::new(),
            expanded: HashSet::new(),
            coverage: Vec::new(),
            search,
            table_states: HashMap::new(),
            loaded: false,
            _subs: subs,
        };
        let fut = common::load_schemas(&this.session);
        cx.spawn(async move |this, cx| {
            if let Ok(s) = fut.await {
                this.update(cx, |v, cx| {
                    v.schemas = s;
                    cx.notify();
                })
                .ok();
            }
        })
        .detach();
        this.load(cx);
        this
    }

    fn conn_id(&self) -> i64 {
        self.session.connection.id
    }

    fn load(&mut self, cx: &mut Context<Self>) {
        self.scope = dict::get_scope(self.conn_id());
        self.expanded.clear();
        self.structures.clear();
        let d = self.session.driver.clone();
        let s = self.schema.clone();
        let fut = runtime::spawn(async move { Ok(d.tables(&s).await?.into_iter().map(|t| t.name).collect::<Vec<_>>()) });
        cx.spawn(async move |this, cx| {
            let r = fut.await;
            this.update(cx, |v, cx| {
                v.loaded = true;
                if let Ok(t) = r {
                    v.tables = t;
                }
                v.ensure_all_for_search(cx);
                cx.notify();
            })
            .ok();
        })
        .detach();
        self.reload_native(cx);
    }

    fn reload_native(&mut self, cx: &mut Context<Self>) {
        if !supports_native(self.session.driver.kind()) {
            self.native = NativeComments::default();
            return;
        }
        self.native_loading = true;
        let d = self.session.driver.clone();
        let s = self.schema.clone();
        let fut = runtime::spawn(async move { dict::fetch_native_comments(d.as_ref(), &s).await });
        cx.spawn(async move |this, cx| {
            let r = fut.await;
            this.update(cx, |v, cx| {
                v.native_loading = false;
                v.native = r.unwrap_or_default();
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    fn ensure_structure(&mut self, table: &str, cx: &mut Context<Self>) {
        let key = dict::table_key(&self.schema, table);
        if self.structures.contains_key(&key) || self.loading_tables.contains(&key) {
            return;
        }
        self.loading_tables.insert(key.clone());
        let d = self.session.driver.clone();
        let tr = TableRef::new(self.schema.clone(), table.to_string());
        let fut = runtime::spawn(async move { d.table_structure(&tr).await });
        cx.spawn(async move |this, cx| {
            let r = fut.await;
            this.update(cx, |v, cx| {
                v.loading_tables.remove(&key);
                v.structures.insert(key, r.unwrap_or_default());
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    fn ensure_all_for_search(&mut self, cx: &mut Context<Self>) {
        if self.search.read(cx).value().trim().is_empty() {
            return;
        }
        for t in self.tables.clone() {
            self.ensure_structure(&t, cx);
        }
    }

    fn entries(&self) -> Vec<CatalogTableEntry> {
        let src: Vec<CatalogSourceTable> = self
            .tables
            .iter()
            .map(|t| CatalogSourceTable { schema: self.schema.clone(), table: t.clone(), columns: self.structures.get(&dict::table_key(&self.schema, t)).cloned().unwrap_or_default() })
            .collect();
        dict::build_catalog_entries(&src, &self.scope, &self.native)
    }

    fn save(&mut self, table: String, column: Option<String>, value: String, cx: &mut Context<Self>) -> bool {
        let r = match &column {
            Some(c) => dict::set_column_description(self.conn_id(), &self.schema, &table, c, &value),
            None => dict::set_table_description(self.conn_id(), &self.schema, &table, &value),
        };
        match r {
            Ok(()) => {
                self.scope = dict::get_scope(self.conn_id());
                cx.notify();
                true
            }
            Err(e) => {
                Toast::error(format!("{e:#}")).show(cx);
                false
            }
        }
    }

    fn push(&mut self, table: String, column: Option<String>, value: String, cx: &mut Context<Self>) {
        let sql = dict::postgres_comment_sql(&self.schema, &table, column.as_deref(), &value);
        let this = cx.entity().downgrade();
        crate::actions::run(&self.session, sql, String::new(), "Failed to write comment", cx, move |_, cx| {
            this.update(cx, |v, cx| v.reload_native(cx)).ok();
        });
    }

    /// `DescriptionPopover` (as a dialog).
    fn edit_description(&mut self, table: String, column: Option<String>, value: Option<String>, source: Option<DescriptionSource>, window: &mut Window, cx: &mut Context<Self>) {
        let state = cx.new(|cx| {
            let mut s = TextareaState::new(window, cx).auto_grow(3, 12).placeholder(if column.is_some() { "Add…" } else { "Add a table description…" });
            s.set_value(value.clone().unwrap_or_default(), window, cx);
            s
        });
        let this = cx.entity();
        let can_push = matches!(self.session.driver.kind(), Kind::Postgres | Kind::SupabaseMgmt) && value.is_some() && source == Some(DescriptionSource::Local);
        rexa_ui::open_dialog(cx, move |_, cx| {
            let (t1, t2) = (this.clone(), this.clone());
            let (tb1, c1, s1) = (table.clone(), column.clone(), state.clone());
            let (tb2, c2, v2) = (table.clone(), column.clone(), value.clone().unwrap_or_default());
            let muted = cx.tokens().muted_foreground;
            Dialog::new()
                .w(320.)
                .padding(12.)
                .gap(10.)
                .hide_close()
                .child(div().flex().items_center().justify_between().child(div().tw_text_xs().font_weight(FontWeight::MEDIUM).child("Description")).children(source_badge(source)))
                .child(div().tw_text_xs().child(TextArea::new(&state)))
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap_2()
                        .when(can_push, |d| {
                            d.child(Button::new("cat-push").outline().size(ButtonSize::Sm).icon(IconName::Database).label("Push to DB").on_click(move |_, _, cx| {
                                let (tb, c, v) = (tb2.clone(), c2.clone(), v2.clone());
                                t2.update(cx, |s, cx| s.push(tb, c, v, cx));
                            }))
                        })
                        .child(div().flex_1())
                        .child(Button::new("cat-cancel").ghost().size(ButtonSize::Sm).label("Cancel").on_click(|_, _, cx| rexa_ui::close_top(cx)))
                        .child(Button::new("cat-save").size(ButtonSize::Sm).icon(IconName::Check).label("Save").on_click(move |_, _, cx| {
                            let v = s1.read(cx).value().trim().to_string();
                            let (tb, c) = (tb1.clone(), c1.clone());
                            if t1.update(cx, |s, cx| s.save(tb, c, v, cx)) {
                                rexa_ui::close_top(cx);
                            }
                        })),
                )
                .child(div().text_size(px(11.)).text_color(muted).child("\u{2318}\u{23ce} to save"))
        });
    }

    /// `DecoratorCell` parameter editor (as a dialog).
    fn edit_decorator(&mut self, table: String, column: String, kind: &'static str, initial: Option<serde_json::Value>, window: &mut Window, cx: &mut Context<Self>) {
        if kind == "none" {
            if initial.is_some() {
                if let Err(e) = dict::set_column_decorator(self.conn_id(), &self.schema, &table, &column, None) {
                    Toast::error(format!("{e:#}")).show(cx);
                }
                self.scope = dict::get_scope(self.conn_id());
                cx.notify();
            }
            return;
        }
        let params = initial.as_ref().filter(|d| d.get("kind").and_then(|k| k.as_str()) == Some(kind)).map(serialize_params).unwrap_or_default();
        let state = cx.new(|cx| {
            let mut s = TextareaState::new(window, cx).auto_grow(1, 6).placeholder(param_placeholder(kind));
            s.set_value(params, window, cx);
            s
        });
        cx.observe(&state, |_, _, cx| cx.notify()).detach();
        let this = cx.entity();
        let had = initial.is_some();
        rexa_ui::open_dialog(cx, move |_, cx| {
            let t = cx.tokens().clone();
            let text = state.read(cx).value().to_string();
            let built = build_decorator(kind, &text);
            let preview = built.as_ref().ok().map(|d| dict::apply_column_decorator(Some(&column), Some(d)).display);
            let (t1, t2, s1) = (this.clone(), this.clone(), state.clone());
            let (tb1, c1, tb2, c2) = (table.clone(), column.clone(), table.clone(), column.clone());
            Dialog::new()
                .w(320.)
                .padding(12.)
                .gap(10.)
                .hide_close()
                .child(div().flex().items_center().tw_text_xs().font_weight(FontWeight::MEDIUM).child(format!("{} \u{b7}\u{a0}", kind_label(kind))).child(div().bg(t.muted).px_1().rounded(px(4.)).font_family(MONO).child(column.clone())))
                .child(div().text_size(px(11.)).text_color(t.muted_foreground).child(kind_hint(kind)))
                .child(div().tw_text_xs().font_family(MONO).child(TextArea::new(&state)))
                .child(div().tw_rounded_md().bg(t.muted).px(px(10.)).py_2().tw_text_xs().flex().child(div().text_color(t.muted_foreground).child("Preview:\u{a0}")).child(div().font_family(MONO).child(preview.unwrap_or_else(|| "\u{2014}".into()))))
                .children(built.as_ref().err().filter(|_| !text.trim().is_empty()).map(|e| div().tw_text_xs().text_color(t.destructive).child(e.clone())))
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap_2()
                        .when(had, |d| {
                            d.child(Button::new("dec-remove").ghost().size(ButtonSize::Sm).colors(gpui::transparent_black(), t.muted, t.destructive).label("Remove").on_click(move |_, _, cx| {
                                let (tb, c) = (tb2.clone(), c2.clone());
                                t2.update(cx, |s, cx| {
                                    dict::set_column_decorator(s.conn_id(), &s.schema, &tb, &c, None).ok();
                                    s.scope = dict::get_scope(s.conn_id());
                                    cx.notify();
                                });
                                rexa_ui::close_top(cx);
                            }))
                        })
                        .child(div().flex_1())
                        .child(Button::new("dec-cancel").ghost().size(ButtonSize::Sm).label("Cancel").on_click(|_, _, cx| rexa_ui::close_top(cx)))
                        .child(Button::new("dec-save").size(ButtonSize::Sm).icon(IconName::Check).label("Save").on_click(move |_, _, cx| {
                            let text = s1.read(cx).value().to_string();
                            match build_decorator(kind, &text) {
                                Ok(d) => {
                                    let (tb, c) = (tb1.clone(), c1.clone());
                                    t1.update(cx, |s, cx| {
                                        match dict::set_column_decorator(s.conn_id(), &s.schema, &tb, &c, Some(d)) {
                                            Ok(()) => s.scope = dict::get_scope(s.conn_id()),
                                            Err(e) => {
                                                Toast::error(format!("{e:#}")).show(cx);
                                            }
                                        }
                                        cx.notify();
                                    });
                                    rexa_ui::close_top(cx);
                                }
                                Err(e) => {
                                    Toast::error(e).show(cx);
                                }
                            }
                        })),
                )
        });
    }

    fn table_state(&mut self, key: &str, cx: &mut Context<Self>) -> Entity<TableState> {
        if let Some(s) = self.table_states.get(key) {
            return s.clone();
        }
        let s = cx.new(|_| TableState { sort: None, page: 1 });
        cx.observe(&s, |_, _, cx| cx.notify()).detach();
        self.table_states.insert(key.to_string(), s.clone());
        s
    }
}

const KINDS: [(&str, &str, &str); 6] = [
    ("none", "None", ""),
    ("enum-map", "Value labels", "Map raw values to friendly labels"),
    ("mask", "Mask (PII)", "Hide leading characters"),
    ("prefix-suffix", "Prefix / suffix", "Units, currency, affixes"),
    ("truncate", "Truncate", "Shorten long text"),
    ("date-format", "Date format", "Relative or calendar dates"),
];

fn kind_label(k: &str) -> &'static str {
    KINDS.iter().find(|x| x.0 == k).map_or("None", |x| x.1)
}
fn kind_hint(k: &str) -> &'static str {
    KINDS.iter().find(|x| x.0 == k).map_or("", |x| x.2)
}

fn param_placeholder(k: &str) -> &'static str {
    match k {
        "enum-map" => "active = Active\nbanned = Banned",
        "mask" => "Visible trailing chars, e.g. 4",
        "prefix-suffix" => "prefix|suffix, e.g. $ | USD",
        "truncate" => "Max length, e.g. 80",
        _ => "relative, date, datetime, or time",
    }
}

fn serialize_params(d: &serde_json::Value) -> String {
    let s = |k: &str| d.get(k).map(|v| v.as_str().map(str::to_string).unwrap_or_else(|| v.to_string())).unwrap_or_default();
    match d.get("kind").and_then(|k| k.as_str()) {
        Some("enum-map") => d.get("mapping").and_then(|m| m.as_object()).map(|m| m.iter().map(|(k, v)| format!("{k} = {}", v.as_str().unwrap_or(""))).collect::<Vec<_>>().join("\n")).unwrap_or_default(),
        Some("mask") => {
            let v = s("visibleChars");
            if v.is_empty() {
                "0".into()
            } else {
                v
            }
        }
        Some("prefix-suffix") => format!("{}|{}", s("prefix"), s("suffix")),
        Some("truncate") => s("maxLength"),
        Some("date-format") => s("format"),
        _ => String::new(),
    }
}

/// `buildDecorator`.
fn build_decorator(kind: &str, params: &str) -> Result<serde_json::Value, String> {
    match kind {
        "enum-map" => {
            let mut m = serde_json::Map::new();
            for line in params.lines() {
                if let Some(i) = line.find('=').filter(|i| *i > 0) {
                    let (raw, label) = (line[..i].trim(), line[i + 1..].trim());
                    if !raw.is_empty() && !label.is_empty() {
                        m.insert(raw.into(), label.into());
                    }
                }
            }
            if m.is_empty() {
                return Err("Add at least one `value = Label` line.".into());
            }
            Ok(serde_json::json!({"kind": "enum-map", "mapping": m}))
        }
        "mask" => Ok(serde_json::json!({"kind": "mask", "visibleChars": params.trim().parse::<i64>().unwrap_or(0).max(0)})),
        "prefix-suffix" => {
            let mut it = params.splitn(2, '|');
            Ok(serde_json::json!({"kind": "prefix-suffix", "prefix": it.next().unwrap_or(""), "suffix": it.next().unwrap_or("")}))
        }
        "truncate" => match params.trim().parse::<i64>() {
            Ok(n) if (1..=10_000).contains(&n) => Ok(serde_json::json!({"kind": "truncate", "maxLength": n})),
            _ => Err("maxLength must be between 1 and 10000.".into()),
        },
        _ => {
            let f = if params.trim().is_empty() { "datetime".to_string() } else { params.trim().to_lowercase() };
            if !["relative", "date", "datetime", "time"].contains(&f.as_str()) {
                return Err("Format must be relative, date, datetime, or time.".into());
            }
            Ok(serde_json::json!({"kind": "date-format", "format": f}))
        }
    }
}

/// `SourceBadge`.
fn source_badge(source: Option<DescriptionSource>) -> Option<AnyElement> {
    let s = source?;
    let local = s == DescriptionSource::Local;
    Some(
        Tooltip::new(if local { "Described in RexaDB (local to this connection)" } else { "From the database (native comment)" })
            .side(Side::Top)
            .child(Badge::new(if local { "RexaDB" } else { "Database" }).variant(if local { BadgeVariant::Secondary } else { BadgeVariant::Outline }))
            .into_any_element(),
    )
}

impl Render for DataCatalogView {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        if !self.loaded {
            return common::page(cx)
                .child(div().p_8().pb_4().flex().flex_col().gap_2().child(div().bg(t.muted).rounded(px(6.)).h_4().w(px(160.))).child(div().bg(t.muted).rounded(px(6.)).h_3().w(px(288.))))
                .into_any_element();
        }
        let query = self.search.read(cx).value().to_string();
        let q = query.trim().to_string();
        let entries = self.entries();
        let hits = dict::search_catalog(&entries, &q);
        let mut column_filter: HashMap<String, HashSet<String>> = HashMap::new();
        let mut visible: Vec<CatalogTableEntry> = entries.clone();
        if !q.is_empty() {
            let keys: HashSet<String> = hits.iter().map(|h| dict::table_key(&h.schema, &h.table)).collect();
            visible.retain(|e| keys.contains(&dict::table_key(&e.schema, &e.table)));
            for h in hits.iter().filter(|h| h.kind == "column") {
                if let Some(c) = &h.column {
                    column_filter.entry(dict::table_key(&h.schema, &h.table)).or_default().insert(c.clone());
                }
            }
        }
        if !self.coverage.is_empty() {
            let cov = self.coverage.clone();
            visible.retain(|e| (cov.contains(&"described") && e.description.is_some()) || (cov.contains(&"undescribed") && e.description.is_none()) || (cov.contains(&"decorated") && e.columns.iter().any(|c| c.decorator.is_some())));
        }
        let documented_tables = entries.iter().filter(|e| e.description.is_some()).count();
        let documented_cols: usize = entries.iter().map(|e| e.columns.iter().filter(|c| c.description.is_some()).count()).sum();
        let total_cols: usize = entries.iter().map(|e| e.columns.len()).sum();
        let all_loaded = self.tables.iter().all(|tb| self.structures.contains_key(&dict::table_key(&self.schema, tb)));
        let kind = self.session.driver.kind();

        let mut desc_line = div().flex().flex_wrap().items_center().tw_text_sm().text_color(t.muted_foreground).mt_1().child("Describe tables and columns in\u{a0}").child(div().bg(t.muted).px_1().rounded(px(4.)).font_family(MONO).child(self.schema.clone())).child(format!("\u{a0}\u{b7} {documented_tables}/{} tables", self.tables.len()));
        if total_cols > 0 {
            desc_line = desc_line.child(format!("\u{a0}\u{b7} {documented_cols}/{total_cols} columns"));
        }
        desc_line = desc_line.child("\u{a0}documented");

        let this = cx.entity();
        let cov_active = !self.coverage.is_empty();
        let cov_label = if cov_active { format!("Coverage ({})", self.coverage.len()) } else { "Coverage".to_string() };
        let cov_sel = self.coverage.clone();
        let cov_this = this.clone();
        let coverage = DropdownMenu::new("cat-coverage")
            .align(Align::Start)
            .trigger(div().flex().items_center().gap_1().min_w(px(80.)).h_8().px_3().tw_rounded_lg().border_1().border_color(t.border).when(cov_active, |d| d.bg(t.muted)).tw_text_sm().font_weight(FontWeight::MEDIUM).cursor_pointer().child(cov_label).child(Icon::new(IconName::ChevronDown).size(px(14.)).ml_1()))
            .menu(move |mut m, _, _| {
                for (v, l) in [("described", "Described"), ("undescribed", "Undescribed"), ("decorated", "Decorated")] {
                    let th = cov_this.clone();
                    m = m.item(MenuItem::checkbox(l, cov_sel.contains(&v)).text_xs().keep_open().on_select(move |_, cx| {
                        th.update(cx, |s, cx| {
                            if let Some(i) = s.coverage.iter().position(|x| *x == v) {
                                s.coverage.remove(i);
                            } else {
                                s.coverage.push(v);
                            }
                            cx.notify();
                        })
                    }));
                }
                m
            });
        let toolbar = common::toolbar()
            .child(
                common::filters()
                    .child({
                        let th = this.clone();
                        common::schema_dropdown("cat-schema", &self.schemas, &self.schema, false, move |s, _, cx| {
                            th.update(cx, |v, cx| {
                                if v.schema != s {
                                    v.schema = s;
                                    v.load(cx);
                                }
                            })
                        }, cx)
                    })
                    .child(div().w(px(256.)).tw_text_xs().child(TextInput::new(&self.search).prefix(Icon::new(IconName::Search).size(px(14.)).text_color(with_alpha(t.muted_foreground, 0.4)))))
                    .child(coverage),
            )
            .when(supports_native(kind), |d| {
                d.child(Tooltip::new("Reload native database comments").side(Side::Bottom).child(Button::new("cat-reload").outline().size(ButtonSize::Icon).icon(IconName::RefreshCw).disabled(self.native_loading).on_click(cx.listener(|v, _, _, cx| v.reload_native(cx)))))
            });

        let body: AnyElement = if visible.is_empty() {
            if !q.is_empty() && !all_loaded {
                div().flex_1().flex().flex_col().items_center().justify_center().gap_2().text_color(t.muted_foreground).child(Spinner::new(20.)).child(div().tw_text_sm().font_weight(FontWeight::MEDIUM).child("Searching columns\u{2026}")).child(div().tw_text_xs().child("Loading table structures to match columns.")).into_any_element()
            } else if !q.is_empty() {
                common::empty_state(IconName::Search, "No matching tables or columns", Some("Try a different search term, or clear the coverage filter.".into()), None, cx)
            } else {
                common::empty_state(IconName::Database, format!("No tables in {}", self.schema), Some("Tables in this schema will appear here once they exist.".into()), None, cx)
            }
        } else {
            let can_push = matches!(kind, Kind::Postgres | Kind::SupabaseMgmt);
            let _ = can_push;
            let mut list = div().flex().flex_col().gap_3().pb_8();
            for e in visible {
                let key = dict::table_key(&e.schema, &e.table);
                let open = self.expanded.contains(&key) || column_filter.contains_key(&key);
                let shown: Vec<_> = match column_filter.get(&key) {
                    Some(f) => e.columns.iter().filter(|c| f.contains(&c.column)).cloned().collect(),
                    None => e.columns.clone(),
                };
                let n = e.columns.len();
                let described = e.columns.iter().filter(|c| c.description.is_some()).count();
                let pct = (n > 0).then(|| ((described as f32 / n as f32) * 100.).round() as u32);
                let (tbl, tbl2, tbl3) = (e.table.clone(), e.table.clone(), e.table.clone());
                let (desc, src) = (e.description.clone(), e.source);
                let schema = e.schema.clone();
                let header = div()
                    .flex()
                    .w_full()
                    .items_center()
                    .gap_3()
                    .px_4()
                    .py_3()
                    .hover(|s| s.bg(with_alpha(t.muted, 0.4)))
                    .child(
                        div()
                            .id(SharedString::from(format!("cat-exp-{key}")))
                            .flex()
                            .min_w_0()
                            .flex_1()
                            .items_center()
                            .gap_3()
                            .cursor_pointer()
                            .on_click(cx.listener(move |v, _, _, cx| {
                                let k = dict::table_key(&v.schema, &tbl);
                                if !v.expanded.remove(&k) {
                                    v.expanded.insert(k);
                                    v.ensure_structure(&tbl, cx);
                                }
                                cx.notify();
                            }))
                            .child(Icon::new(if open { IconName::ChevronDown } else { IconName::ChevronRight }).size_4().text_color(t.muted_foreground))
                            .child(div().p(px(6.)).bg(with_alpha(t.primary, 0.1)).tw_rounded_lg().child(Icon::new(IconName::Table2).size_4().text_color(t.primary)))
                            .child(
                                div()
                                    .min_w_0()
                                    .flex_1()
                                    .child(div().truncate().tw_text_sm().font_weight(FontWeight::SEMIBOLD).child(rexa_ui::tight(e.table.clone())))
                                    .child(match &e.description {
                                        Some(d) => div().mt(px(2.)).truncate().tw_text_xs().text_color(t.muted_foreground).child(d.clone()),
                                        None => div().mt(px(2.)).truncate().tw_text_xs().text_color(with_alpha(t.muted_foreground, 0.5)).child("No description yet"),
                                    }),
                            ),
                    )
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(6.))
                            .flex_shrink_0()
                            .child(Badge::new(format!("{n} {}", if n == 1 { "column" } else { "columns" })).variant(BadgeVariant::Secondary))
                            .children(pct.map(|p| Badge::new(format!("{p}% described")).variant(if p == 100 { BadgeVariant::Default } else { BadgeVariant::Outline })))
                            .children(source_badge(e.source)),
                    )
                    .child(
                        div()
                            .id(SharedString::from(format!("cat-open-{key}")))
                            .flex()
                            .flex_shrink_0()
                            .items_center()
                            .gap_1()
                            .tw_text_xs()
                            .text_color(t.muted_foreground)
                            .hover(|s| s.text_color(t.foreground))
                            .cursor_pointer()
                            .on_click(move |_, _, cx| common::open_table(&schema, &tbl2, cx))
                            .child("Open")
                            .child(Icon::new(IconName::ArrowRight).size(px(14.))),
                    );
                let desc_row = div()
                    .border_t_1()
                    .border_color(with_alpha(t.border, 0.6))
                    .px_4()
                    .py(px(10.))
                    .bg(with_alpha(t.muted, 0.2))
                    .child(desc_button(SharedString::from(format!("cat-d-{key}")), desc.clone(), "Add a table description…", cx).on_click(cx.listener(move |v, _, w, cx| v.edit_description(tbl3.clone(), None, desc.clone(), src, w, cx))));
                let mut card = div().tw_rounded_lg().border_1().border_color(t.border).overflow_hidden().child(header).child(desc_row);
                if open {
                    let inner: AnyElement = if self.loading_tables.contains(&key) {
                        div().px_4().py_3().flex().flex_col().gap_2().children((0..3).map(|_| div().bg(t.muted).rounded(px(6.)).h_8().w_full())).into_any_element()
                    } else if shown.is_empty() {
                        div().px_4().py_4().tw_text_xs().text_color(t.muted_foreground).child(if q.is_empty() { "No columns loaded for this table." } else { "No columns match your search." }).into_any_element()
                    } else {
                        let state = self.table_state(&key, cx);
                        let rows: Vec<Row> = shown
                            .iter()
                            .map(|c| {
                                let (tb, col, d, s) = (e.table.clone(), c.column.clone(), c.description.clone(), c.source);
                                let (tb2, col2, dec) = (e.table.clone(), c.column.clone(), c.decorator.clone());
                                let this = this.clone();
                                let cur_kind = c.decorator.as_ref().and_then(|d| d.get("kind")).and_then(|k| k.as_str()).map(|k| kind_label(k)).unwrap_or("None");
                                let dec_menu = DropdownMenu::new(SharedString::from(format!("cat-dec-{key}-{}", c.column)))
                                    .align(Align::End)
                                    .trigger(div().h_7().w_full().px_2().flex().items_center().justify_between().tw_rounded_md().border_1().border_color(t.input).tw_text_xs().cursor_pointer().child(cur_kind).child(Icon::new(IconName::ChevronDown).size(px(14.)).text_color(t.muted_foreground)))
                                    .menu(move |mut m, _, _| {
                                        for (k, l, _) in KINDS {
                                            let (this, tb, col, dec) = (this.clone(), tb2.clone(), col2.clone(), dec.clone());
                                            m = m.item(MenuItem::new(l).on_select(move |w, cx| {
                                                let (tb, col, dec) = (tb.clone(), col.clone(), dec.clone());
                                                this.update(cx, |v, cx| v.edit_decorator(tb, col, k, dec, w, cx));
                                            }));
                                        }
                                        m
                                    });
                                Row::new(c.column.clone())
                                    .cell(
                                        div()
                                            .flex()
                                            .items_center()
                                            .gap(px(6.))
                                            .min_w_0()
                                            .child(if c.is_primary { Icon::new(IconName::KeyRound).size(px(14.)).text_color(tw("amber-400")) } else { Icon::new(IconName::Hash).size(px(14.)).text_color(with_alpha(t.muted_foreground, 0.5)) })
                                            .child(div().truncate().tw_text_xs().font_weight(FontWeight::MEDIUM).child(c.column.clone()))
                                            .when(c.is_foreign_key, |d| d.child(Tooltip::new("Foreign key").side(Side::Top).child(Icon::new(IconName::Link).size_3().text_color(with_alpha(t.muted_foreground, 0.6))))),
                                    )
                                    .cell(div().bg(t.muted).px(px(6.)).py(px(2.)).rounded(px(4.)).font_family(MONO).tw_text_xs().truncate().child(c.data_type.clone()))
                                    .cell(div().tw_text_xs().text_color(t.muted_foreground).child(if c.is_nullable { "NULL" } else { "NOT NULL" }))
                                    .cell(
                                        div()
                                            .flex()
                                            .items_center()
                                            .gap(px(6.))
                                            .w_full()
                                            .child(div().min_w_0().flex_1().child(desc_button(SharedString::from(format!("cat-cd-{key}-{}", c.column)), d.clone(), "Add…", cx).on_click(cx.listener(move |v, _, w, cx| v.edit_description(tb.clone(), Some(col.clone()), d.clone(), s, w, cx)))))
                                            .children(source_badge(c.source)),
                                    )
                                    .cell(div().w_full().child(dec_menu))
                            })
                            .collect();
                        div()
                            .p_2()
                            .child(
                                DataTable::new(SharedString::from(format!("cat-cols-{key}")), &state)
                                    .columns([Column::new("column", "Column").px(208.), Column::new("type", "Type").px(144.), Column::new("nullable", "Nullable").px(96.), Column::new("description", "Description").fr(1.), Column::new("display", "Display").px(160.).right()])
                                    .rows(rows),
                            )
                            .into_any_element()
                    };
                    card = card.child(div().border_t_1().border_color(with_alpha(t.border, 0.6)).child(inner));
                }
                list = list.child(card);
            }
            list.into_any_element()
        };

        common::page(cx)
            .child(div().flex_shrink_0().p_8().pb_4().child(div().tw_text_sm().font_weight(FontWeight::SEMIBOLD).child(rexa_ui::tight("Data Catalog"))).child(desc_line))
            .child(toolbar)
            .child(div().id("cat-scroll").px_8().flex_1().min_h_0().overflow_y_scroll().flex().flex_col().child(body))
            .into_any_element()
    }
}

/// The `DescriptionPopover` trigger button.
fn desc_button(id: SharedString, value: Option<String>, placeholder: &str, cx: &App) -> gpui::Stateful<gpui::Div> {
    let t = cx.tokens();
    let gid: SharedString = format!("{id}-g").into();
    div()
        .id(id)
        .group(gid.clone())
        .flex()
        .w_full()
        .items_center()
        .gap(px(6.))
        .rounded(px(4.))
        .px_1()
        .py(px(2.))
        .tw_text_xs()
        .cursor_pointer()
        .hover(|s| s.bg(with_alpha(t.muted, 0.6)))
        .child(match value {
            Some(v) => div().min_w_0().flex_1().truncate().text_color(with_alpha(t.foreground, 0.8)).child(v),
            None => div().min_w_0().flex_1().truncate().text_color(with_alpha(t.muted_foreground, 0.45)).child(placeholder.to_string()),
        })
        .child(div().opacity(0.).group_hover(gid, |s| s.opacity(1.)).child(Icon::new(IconName::Pencil).size_3().text_color(with_alpha(t.muted_foreground, 0.4))))
}

#[cfg(test)]
mod tests {
    #[test]
    fn decorator_params_roundtrip() {
        let d = super::build_decorator("enum-map", "a = A\nb=B\nbad").unwrap();
        assert_eq!(super::serialize_params(&d), "a = A\nb = B");
        assert!(super::build_decorator("truncate", "0").is_err());
        assert_eq!(super::build_decorator("prefix-suffix", "$|USD").unwrap()["suffix"], "USD");
    }
}
