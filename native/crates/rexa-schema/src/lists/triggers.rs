//! Port of components/studio/database/triggers-list.tsx (+ `handleDeleteTrigger`,
//! `openEditTriggerTab`, `openDuplicateTriggerTab`, `triggerRowToFormValues` from
//! hooks/use-studio.ts) and select-filter.tsx (the "Table" filter).
//!
//! Approximation: the "Create with RexaDB Assistant" button uses a sparkles icon
//! instead of `/ai-agent.png` and opens the AI chat panel tab.

use super::{fetch, ListBase, ListView};
use crate::actions;
use crate::common;
use crate::data_table::{Align as ColAlign, Column, DataTable, Row};
use crate::prefill::{self, TriggerPrefill};
use gpui::{div, prelude::*, px, AnyElement, App, Context, FontWeight, SharedString, Window};
use rexa_core::{Session, TabSpec};
use rexa_drivers::{Kind, TriggerInfo};
use rexa_ui::widgets::Icon;
use rexa_ui::{with_alpha, ActiveTokens, Align, Badge, BadgeVariant, Button, ButtonSize, DropdownMenu, IconName, MenuItem, Side, Tooltip};
use std::sync::Arc;

pub struct TriggersList {
    base: ListBase,
    triggers: Vec<TriggerInfo>,
    tables_filter: Vec<String>,
}

impl ListView for TriggersList {
    fn base(&mut self) -> &mut ListBase {
        &mut self.base
    }
    fn load(&mut self, cx: &mut Context<Self>) {
        self.base.loading = true;
        let d = self.base.session.driver.clone();
        let schema = self.base.schema.clone();
        let fut = rexa_core::runtime::spawn(async move { d.triggers(Some(&schema)).await });
        fetch(cx, fut, |v: &mut Self, e| v.triggers = e);
    }
}

pub fn table_of(t: &TriggerInfo) -> String {
    t.table_name.clone().unwrap_or_default()
}

pub fn events_of(t: &TriggerInfo) -> Vec<String> {
    if !t.events.is_empty() {
        t.events.clone()
    } else {
        t.event.split(',').map(|e| e.trim().to_string()).filter(|e| !e.is_empty()).collect()
    }
}

/// `triggerRowToFormValues`.
pub fn to_prefill(t: &TriggerInfo) -> TriggerPrefill {
    let raw = t.timing.to_uppercase();
    let timing = if raw == "AFTER" || raw == "INSTEAD OF" { raw } else { "BEFORE".into() };
    let events: Vec<String> = events_of(t).into_iter().map(|e| e.to_uppercase()).filter(|e| ["INSERT", "UPDATE", "DELETE", "TRUNCATE"].contains(&e.as_str())).collect();
    let mut function = t.function_name.clone();
    if function.is_empty() {
        if let Some(def) = t.definition.as_deref().or(t.full_definition.as_deref()) {
            let up = def.to_uppercase();
            if let Some(i) = up.find("EXECUTE FUNCTION") {
                function = def[i + 16..].trim_start().split(|c: char| c.is_whitespace() || c == '(').next().unwrap_or("").to_string();
            }
        }
    }
    let function = function.rsplit('.').next().unwrap_or("").to_string();
    let orientation = if t.orientation.to_uppercase() == "STATEMENT" { "STATEMENT" } else { "ROW" };
    TriggerPrefill {
        schema: t.schema.clone(),
        table: table_of(t),
        name: t.name.clone(),
        timing,
        events: if events.is_empty() { vec!["INSERT".into()] } else { events },
        orientation: orientation.into(),
        function_schema: t.schema.clone(),
        function_name: function,
        enabled: t.enabled_mode != "DISABLED",
        edit: None,
    }
}

fn event_variant(e: &str) -> BadgeVariant {
    let e = e.to_uppercase();
    if e.contains("INSERT") {
        BadgeVariant::Success
    } else if e.contains("UPDATE") {
        BadgeVariant::Warning
    } else if e.contains("DELETE") || e.contains("TRUNCATE") {
        BadgeVariant::Destructive
    } else {
        BadgeVariant::Outline
    }
}

/// The AI assistant shortcut next to "New …" buttons.
pub fn ask_ai_button(id: &'static str, session: &Session) -> AnyElement {
    let conn = session.connection.id;
    Tooltip::new("Create with RexaDB Assistant")
        .side(Side::Bottom)
        .child(Button::new(id).outline().size(ButtonSize::IconSm).icon(IconName::Sparkles).on_click(move |_, _, cx| {
            rexa_core::open_tab(TabSpec::View { view: "ai-chat".into(), params: serde_json::json!({ "connectionId": conn }) }, cx)
        }))
        .into_any_element()
}

impl TriggersList {
    pub fn new(spec: TabSpec, session: Arc<Session>, schema: Option<String>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let base = ListBase::new(spec, session, schema, "Search for a trigger", window, cx);
        let mut this = TriggersList { base, triggers: Vec::new(), tables_filter: Vec::new() };
        this.load(cx);
        this
    }

    fn read_only(&self) -> Option<&'static str> {
        match common::kind(&self.base.session) {
            Kind::Oracle => Some("Triggers are read-only for Oracle connections"),
            Kind::MySql => Some("Triggers are read-only for MySQL connections"),
            Kind::MsSql => Some("Editing MSSQL triggers coming soon"),
            _ => None,
        }
    }

    fn edit(t: &TriggerInfo, cx: &mut App) {
        let mut p = to_prefill(t);
        p.edit = Some((t.schema.clone(), p.table.clone(), t.name.clone()));
        let schema = p.schema.clone();
        prefill::set_trigger(p, cx);
        prefill::open_create("trigger", Some(&schema), cx);
    }

    fn duplicate(t: &TriggerInfo, cx: &mut App) {
        let mut p = to_prefill(t);
        p.name = format!("{}_copy", p.name);
        let schema = p.schema.clone();
        prefill::set_trigger(p, cx);
        prefill::open_create("trigger", Some(&schema), cx);
    }

    fn delete(&mut self, t: TriggerInfo, cx: &mut Context<Self>) {
        let table = table_of(&t);
        if table.is_empty() {
            rexa_ui::Toast::error("Could not find table name for trigger").show(cx);
            return;
        }
        let sql = format!("DROP TRIGGER IF EXISTS {} ON {}.{};", actions::dq(&t.name), actions::dq(&t.schema), actions::dq(&table));
        let this = cx.entity().downgrade();
        actions::confirm_run(
            &self.base.session,
            "Delete Trigger",
            format!("Are you sure you want to delete the trigger \"{}\".\"{}\"?", t.schema, t.name),
            "Delete",
            sql,
            "Trigger deleted successfully".into(),
            "Failed to delete trigger",
            cx,
            move |_, cx| {
                this.update(cx, |v, cx| v.load(cx)).ok();
            },
        );
    }

    /// select-filter.tsx: outline button "Table (n)" + checkbox list with Clear / Apply.
    fn table_filter(&self, tables: Vec<String>, cx: &mut Context<Self>) -> AnyElement {
        let t = cx.tokens().clone();
        let active = !self.tables_filter.is_empty();
        let label = if active { format!("Table ({})", self.tables_filter.len()) } else { "Table".into() };
        let this = cx.entity();
        let selected = self.tables_filter.clone();
        DropdownMenu::new("trg-table-filter")
            .align(Align::Start)
            .trigger(
                div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .gap_1()
                    .min_w(px(80.))
                    .h_8()
                    .px_3()
                    .tw_rounded_lg()
                    .border_1()
                    .border_color(t.border)
                    .when(active, |d| d.bg(t.muted))
                    .tw_text_sm()
                    .font_weight(FontWeight::MEDIUM)
                    .cursor_pointer()
                    .child(label)
                    .child(Icon::new(IconName::ChevronDown).size(px(14.)).ml_1()),
            )
            .menu(move |m, _, _| {
                let mut m = m.w(288.).max_h(288.);
                for tb in &tables {
                    let on = selected.contains(tb);
                    let (this, tb2) = (this.clone(), tb.clone());
                    m = m.item(MenuItem::checkbox(tb.clone(), on).text_xs().keep_open().on_select(move |_, cx| {
                        let tb = tb2.clone();
                        this.update(cx, |v, cx| {
                            if let Some(i) = v.tables_filter.iter().position(|x| *x == tb) {
                                v.tables_filter.remove(i);
                            } else {
                                v.tables_filter.push(tb);
                                v.tables_filter.sort();
                            }
                            v.base.table.update(cx, |s, _| s.reset_page());
                            cx.notify();
                        })
                    }));
                }
                let this = this.clone();
                m.separator().item(MenuItem::new("Clear").on_select(move |_, cx| {
                    this.update(cx, |v, cx| {
                        v.tables_filter.clear();
                        cx.notify();
                    })
                }))
            })
            .into_any_element()
    }
}

use rexa_ui::Tw;

impl Render for TriggersList {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if self.base.loading && self.triggers.is_empty() && !self.base.loaded_once {
            return common::list_skeleton("trg-sk", &[96., 80., 112., 112., 64.], cx);
        }
        let t = cx.tokens().clone();
        let read_only = self.read_only();
        let search = self.base.query(cx);
        let schema = self.base.schema.clone();
        let schema_triggers: Vec<TriggerInfo> = self.triggers.iter().filter(|x| x.schema == schema).cloned().collect();
        let mut tables: Vec<String> = schema_triggers.iter().map(table_of).collect();
        tables.sort();
        tables.dedup();
        let q = search.to_lowercase();
        let filtered: Vec<TriggerInfo> = schema_triggers
            .iter()
            .filter(|x| q.is_empty() || x.name.to_lowercase().contains(&q) || x.function_name.to_lowercase().contains(&q))
            .filter(|x| self.tables_filter.is_empty() || self.tables_filter.contains(&table_of(x)))
            .cloned()
            .collect();
        let create = {
            let schema = schema.clone();
            move |_: &mut Window, cx: &mut App| prefill::open_create("trigger", Some(&schema), cx)
        };

        let body = if schema_triggers.is_empty() {
            let (title, desc) = match read_only {
                Some(_) => (
                    format!("No triggers in {schema}"),
                    if common::kind(&self.base.session) == Kind::Oracle {
                        "Oracle triggers in this schema are browsable here; trigger writes are read-only for now."
                    } else {
                        "SQL Server DML triggers on tables in this schema will appear here."
                    },
                ),
                None => ("Add your first trigger".to_string(), "Make your database reactive. Send updates in realtime, call edge functions, or validate data as it comes in."),
            };
            let action = read_only.is_none().then(|| {
                let c = create.clone();
                div()
                    .flex()
                    .items_center()
                    .gap_2()
                    .child(ask_ai_button("trg-empty-ai", &self.base.session))
                    .child(Button::new("trg-empty-new").outline().size(ButtonSize::Sm).icon(IconName::Plus).label("New trigger").on_click(move |_, w, cx| c(w, cx)))
                    .into_any_element()
            });
            common::empty_state(IconName::Zap, title, Some(desc.into()), action, cx)
        } else {
            let this = cx.entity();
            let rows: Vec<Row> = filtered
                .into_iter()
                .enumerate()
                .map(|(i, tr)| {
                    let table = table_of(&tr);
                    let events = events_of(&tr);
                    let enabled = tr.enabled_mode != "DISABLED";
                    let (ts, tn) = (tr.schema.clone(), table.clone());
                    let row_id = format!("{}.{}-{i}", tr.schema, tr.name);
                    let menu_tr = tr.clone();
                    let this = this.clone();
                    let ro = read_only;
                    let menu = DropdownMenu::new(SharedString::from(format!("trg-menu-{row_id}")))
                        .side(Side::Bottom)
                        .align(Align::End)
                        .trigger(Tooltip::new("More options").side(Side::Bottom).child(Button::new(SharedString::from(format!("trg-more-{row_id}"))).outline().size(ButtonSize::IconSm).icon(IconName::EllipsisVertical)))
                        .menu(move |m, _, _| {
                            let (a, b, c) = (menu_tr.clone(), menu_tr.clone(), menu_tr.clone());
                            let this = this.clone();
                            m.w(208.)
                                .item(MenuItem::new("Edit trigger").icon(IconName::Pen).disabled(ro.is_some()).on_select(move |_, cx| Self::edit(&a, cx)))
                                .item(MenuItem::new("Duplicate trigger").icon(IconName::Copy).disabled(ro.is_some()).on_select(move |_, cx| Self::duplicate(&b, cx)))
                                .separator()
                                .item(MenuItem::new("Delete trigger").icon(IconName::Trash).disabled(ro.is_some()).on_select(move |_, cx| {
                                    let c = c.clone();
                                    this.update(cx, |v, cx| v.delete(c, cx));
                                }))
                        });
                    let timing = tr.timing.clone();
                    let mut row = Row::new(row_id.clone())
                        .sort("name", tr.name.clone())
                        .sort("table", table.clone())
                        .sort("function", tr.function_name.clone())
                        .sort("orientation", tr.orientation.clone())
                        .sort("enabled", if enabled { 1i64 } else { 0 })
                        .cell(div().truncate().font_weight(FontWeight::MEDIUM).child(tr.name.clone()))
                        .cell(common::table_link(SharedString::from(format!("trg-tl-{row_id}")), &table, move |_, cx| common::open_table(&ts, &tn, cx), cx))
                        .cell(div().truncate().text_color(t.muted_foreground).child(if tr.function_name.is_empty() { "-".to_string() } else { tr.function_name.clone() }))
                        .cell(div().flex().gap(px(6.)).overflow_hidden().children(events.iter().map(|e| div().flex_shrink_0().child(Badge::new(format!("{timing} {e}")).variant(event_variant(e))))))
                        .cell(div().truncate().text_color(t.muted_foreground).child(tr.orientation.clone()))
                        .cell(div().flex().items_center().justify_center().w_full().child(if enabled {
                            Icon::new(IconName::Check).size_4().text_color(t.primary)
                        } else {
                            Icon::new(IconName::X).size_4().text_color(with_alpha(t.muted_foreground, 0.4))
                        }))
                        .cell(div().flex().items_center().justify_end().child(menu));
                    if read_only.is_none() {
                        row = row.on_click(move |_, cx| Self::edit(&tr, cx));
                    }
                    row
                })
                .collect();
            div()
                .pb_8()
                .child(
                    DataTable::new("trg-table", &self.base.table)
                        .columns([
                            Column::new("name", "Name").fr(1.4).sortable(),
                            Column::new("table", "Table").fr(1.).sortable(),
                            Column::new("function", "Function").fr(1.),
                            Column::new("events", "Events").fr(1.2),
                            Column::new("orientation", "Orientation").fr(0.8),
                            Column { align: ColAlign::Center, ..Column::new("enabled", "Enabled").px(72.) },
                            Column::new("actions", "").px(48.).right(),
                        ])
                        .rows(rows)
                        .paginate(10, "triggers")
                        .empty(common::no_results(&search, cx)),
                )
                .into_any_element()
        };

        let this2 = cx.entity();
        let new_btn = match read_only {
            Some(title) => Tooltip::new(title).side(Side::Bottom).child(Button::new("trg-new").outline().size(ButtonSize::Sm).icon(IconName::Plus).label("New trigger").disabled(true)).into_any_element(),
            None => Button::new("trg-new").outline().size(ButtonSize::Sm).icon(IconName::Plus).label("New trigger").on_click(move |_, w, cx| create(w, cx)).into_any_element(),
        };
        let filter = (!tables.is_empty()).then(|| self.table_filter(tables, cx));
        common::page(cx)
            .child(common::list_header("Database Triggers", "Make your database reactive. Send updates in realtime, call edge functions, or validate data as it comes in.", cx))
            .child(
                common::toolbar()
                    .child(
                        common::filters()
                            .child(common::schema_dropdown("trg-schema", &self.base.schemas, &schema, false, move |s, _, cx| this2.update(cx, |v, cx| ListBase::set_schema(v, s, cx)), cx))
                            .child(common::search_input(&self.base.search, cx))
                            .children(filter),
                    )
                    .child(div().flex().items_center().gap_2().child(ask_ai_button("trg-ai", &self.base.session)).child(new_btn)),
            )
            .child(div().id("trg-scroll").px_8().flex_1().min_h_0().overflow_y_scroll().child(body))
            .into_any_element()
    }
}
