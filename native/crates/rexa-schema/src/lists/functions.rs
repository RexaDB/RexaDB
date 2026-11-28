//! Port of components/studio/database/functions-list.tsx (+ hooks/use-function-management.ts
//! `handleDeleteFunction` / `handleUpdateFunctionDefinition`, and
//! `renameRoutineDefinition` from lib/studio/database-objects.ts).
//!
//! The definition sheet uses gpui-component's tree-sitter SQL `Editor` in place of
//! Monaco (no schema-aware completion, no vim mode).

use super::triggers::ask_ai_button;
use super::{fetch, ListBase, ListView};
use crate::actions;
use crate::common;
use crate::data_table::{Column, DataTable, Row};
use crate::sheet::{title_pill, StudioSheet};
use gpui::{div, prelude::*, px, AnyElement, App, Context, Entity, FontWeight, SharedString, Window};
use rexa_core::{Session, TabSpec};
use rexa_drivers::{Kind, RoutineInfo};
use rexa_ui::widgets::{Editor, EditorState, Icon};
use rexa_ui::{with_alpha, ActiveTokens, Align, Badge, BadgeVariant, Button, ButtonSize, DropdownMenu, IconName, MenuItem, Side, Tooltip, Tw};
use std::sync::Arc;

#[derive(Clone)]
struct Viewer {
    func: RoutineInfo,
    is_duplicate: bool,
    editor: Entity<EditorState>,
    saving: bool,
}

pub struct FunctionsList {
    base: ListBase,
    functions: Vec<RoutineInfo>,
    return_filter: Vec<String>,
    type_filter: Vec<String>,
    security_filter: Vec<String>,
    viewer: Option<Viewer>,
}

impl ListView for FunctionsList {
    fn base(&mut self) -> &mut ListBase {
        &mut self.base
    }
    fn load(&mut self, cx: &mut Context<Self>) {
        self.base.loading = true;
        let d = self.base.session.driver.clone();
        let schema = self.base.schema.clone();
        let fut = rexa_core::runtime::spawn(async move { d.functions(&schema).await });
        fetch(cx, fut, |v: &mut Self, e| v.functions = e);
    }
}

/// `renameRoutineDefinition`: rename the routine in its `CREATE [OR REPLACE]
/// FUNCTION|PROCEDURE <name>` header; `None` when the header isn't recognised.
pub fn rename_routine_definition(definition: &str, name: &str, new_name: &str) -> Option<String> {
    let lower = definition.to_ascii_lowercase();
    let mut i = lower.len() - lower.trim_start().len();
    let expect_word = |i: &mut usize, w: &str| -> bool {
        if lower[*i..].starts_with(w) && lower[*i + w.len()..].starts_with(|c: char| c.is_whitespace()) {
            *i += w.len();
            *i += lower[*i..].len() - lower[*i..].trim_start().len();
            true
        } else {
            false
        }
    };
    if !expect_word(&mut i, "create") {
        return None;
    }
    if expect_word(&mut i, "or") && !expect_word(&mut i, "replace") {
        return None;
    }
    if !expect_word(&mut i, "function") && !expect_word(&mut i, "procedure") {
        return None;
    }
    let read_ident = |start: usize| -> Option<(usize, usize, String, bool)> {
        let s = &definition[start..];
        if !s.starts_with('"') {
            let len = s.find(|c: char| c.is_whitespace() || c == '.' || c == '"' || c == '(').unwrap_or(s.len());
            return (len > 0).then(|| (start, start + len, s[..len].to_string(), false));
        }
        let mut value = String::new();
        let bytes: Vec<char> = s.chars().collect();
        let mut k = 1;
        let mut off = 1;
        while k < bytes.len() {
            let c = bytes[k];
            if c != '"' {
                value.push(c);
            } else if bytes.get(k + 1) == Some(&'"') {
                value.push('"');
                k += 1;
                off += 1;
            } else {
                return Some((start, start + off + 1, value, true));
            }
            off += c.len_utf8();
            k += 1;
        }
        None
    };
    let mut ident = read_ident(i);
    while let Some((_, end, _, _)) = ident.clone() {
        let rest = &definition[end..];
        let trimmed = rest.trim_start();
        if !trimmed.starts_with('.') {
            break;
        }
        let after = &trimmed[1..];
        let next = end + (rest.len() - trimmed.len()) + 1 + (after.len() - after.trim_start().len());
        ident = read_ident(next);
    }
    let (start, end, value, quoted) = ident?;
    if value != name {
        return None;
    }
    let simple = new_name.chars().next().is_some_and(|c| c.is_ascii_lowercase() || c == '_')
        && new_name.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '$');
    let replacement = if !quoted && simple { new_name.to_string() } else { actions::dq(new_name) };
    Some(format!("{}{}{}", &definition[..start], replacement, &definition[end..]))
}

impl FunctionsList {
    pub fn new(spec: TabSpec, session: Arc<Session>, schema: Option<String>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let base = ListBase::new(spec, session, schema, "Search for a function", window, cx);
        let mut this = FunctionsList { base, functions: Vec::new(), return_filter: Vec::new(), type_filter: Vec::new(), security_filter: Vec::new(), viewer: None };
        this.load(cx);
        this
    }

    fn kind(&self) -> Kind {
        common::kind(&self.base.session)
    }

    fn read_only(&self) -> Option<&'static str> {
        match self.kind() {
            Kind::Oracle => Some("Routines are read-only for Oracle connections"),
            Kind::MySql => Some("Routines are read-only for MySQL connections"),
            Kind::MsSql => Some("Editing MSSQL routines coming soon"),
            _ => None,
        }
    }

    fn open_viewer(&mut self, func: RoutineInfo, is_duplicate: bool, window: &mut Window, cx: &mut Context<Self>) {
        let def = func.definition.clone().unwrap_or_default();
        let editor = cx.new(|cx| {
            let mut s = EditorState::new(window, cx).language("sql");
            s.set_value(def, window, cx);
            s
        });
        cx.observe(&editor, |_, _, cx| cx.notify()).detach();
        self.viewer = Some(Viewer { func, is_duplicate, editor, saving: false });
        cx.notify();
    }

    fn new_function(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let f = RoutineInfo {
            schema: self.base.schema.clone(),
            r#type: "function".into(),
            return_type: "void".into(),
            language: "plpgsql".into(),
            ..Default::default()
        };
        self.open_viewer(f, false, window, cx);
    }

    fn duplicate(&mut self, f: RoutineInfo, window: &mut Window, cx: &mut Context<Self>) {
        let name = format!("{}_duplicate", f.name);
        match rename_routine_definition(f.definition.as_deref().unwrap_or(""), &f.name, &name) {
            Some(def) => self.open_viewer(RoutineInfo { name, definition: Some(def), ..f }, true, window, cx),
            None => {
                rexa_ui::Toast::error(format!("Could not duplicate {}: its definition could not be renamed.", f.name)).show(cx);
            }
        }
    }

    fn delete(&mut self, f: RoutineInfo, cx: &mut Context<Self>) {
        let sig = f.arguments.trim().to_string();
        let q = format!("{}.{}", actions::dq(&f.schema), actions::dq(&f.name));
        let sql = if sig.is_empty() { format!("DROP FUNCTION {q}") } else { format!("DROP FUNCTION {q}({sig})") };
        let this = cx.entity().downgrade();
        let suffix = if sig.is_empty() { String::new() } else { format!("({sig})") };
        actions::confirm_run(
            &self.base.session,
            "Delete Function",
            format!("Are you sure you want to delete function \"{}\".\"{}\"{suffix}? This action cannot be undone.", f.schema, f.name),
            "Delete",
            sql,
            "Function deleted successfully".into(),
            "Failed to delete function",
            cx,
            move |_, cx| {
                this.update(cx, |v, cx| v.load(cx)).ok();
            },
        );
    }

    fn draft(&self, cx: &App) -> String {
        self.viewer.as_ref().map(|v| v.editor.read(cx).value().to_string()).unwrap_or_default()
    }

    fn has_changes(&self, cx: &App) -> bool {
        self.viewer.as_ref().is_some_and(|v| v.is_duplicate || self.draft(cx) != v.func.definition.clone().unwrap_or_default())
    }

    /// `handleUpdateFunctionDefinition`.
    fn save(&mut self, cx: &mut Context<Self>) {
        if self.read_only().is_some() || !self.has_changes(cx) {
            return;
        }
        let draft = self.draft(cx);
        let normalized = draft.trim().to_string();
        if normalized.is_empty() {
            rexa_ui::Toast::error("Function definition cannot be empty").show(cx);
            return;
        }
        let lower = normalized.to_ascii_lowercase();
        let sql = if lower.starts_with("create") && lower[6..].trim_start().starts_with("function") {
            let rest = lower[6..].trim_start();
            let skip = normalized.len() - rest.len() + "function".len();
            format!("CREATE OR REPLACE FUNCTION{}", &normalized[skip..])
        } else {
            normalized
        };
        if let Some(v) = self.viewer.as_mut() {
            v.saving = true;
        }
        cx.notify();
        let this = cx.entity().downgrade();
        actions::run(&self.base.session, sql, "Function updated successfully".into(), "Failed to update function", cx, move |ok, cx| {
            this.update(cx, |v, cx| {
                if let Some(viewer) = v.viewer.as_mut() {
                    viewer.saving = false;
                    if ok {
                        viewer.func.definition = Some(draft.clone());
                        viewer.is_duplicate = false;
                    }
                }
                v.load(cx);
            })
            .ok();
        });
    }

    fn filter_menu(&self, id: &'static str, label: &'static str, options: Vec<(String, String)>, field: fn(&mut Self) -> &mut Vec<String>, current: Vec<String>, cx: &mut Context<Self>) -> AnyElement {
        let t = cx.tokens().clone();
        let active = !current.is_empty();
        let text = if active { format!("{label} ({})", current.len()) } else { label.to_string() };
        let this = cx.entity();
        DropdownMenu::new(id)
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
                    .child(text)
                    .child(Icon::new(IconName::ChevronDown).size(px(14.)).ml_1()),
            )
            .menu(move |m, _, _| {
                let mut m = m.w(288.).max_h(288.);
                for (value, label) in &options {
                    let on = current.contains(value);
                    let (this, value) = (this.clone(), value.clone());
                    m = m.item(MenuItem::checkbox(label.clone(), on).text_xs().keep_open().on_select(move |_, cx| {
                        let value = value.clone();
                        this.update(cx, |v, cx| {
                            let list = field(v);
                            if let Some(i) = list.iter().position(|x| *x == value) {
                                list.remove(i);
                            } else {
                                list.push(value);
                                list.sort();
                            }
                            v.base.table.update(cx, |s, _| s.reset_page());
                            cx.notify();
                        })
                    }));
                }
                let this = this.clone();
                m.separator().item(MenuItem::new("Clear").on_select(move |_, cx| {
                    this.update(cx, |v, cx| {
                        field(v).clear();
                        cx.notify();
                    })
                }))
            })
            .into_any_element()
    }

    fn viewer_sheet(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
        let v = self.viewer.as_ref()?;
        let t = cx.tokens().clone();
        let read_only = self.read_only();
        let kind = self.kind();
        let has_changes = self.has_changes(cx);
        let draft_empty = self.draft(cx).is_empty();
        let f = &v.func;
        let this = cx.entity();
        let close = {
            let this = this.clone();
            move |_: &mut Window, cx: &mut App| {
                this.update(cx, |v, cx| {
                    v.viewer = None;
                    cx.notify();
                })
            }
        };
        let close2 = close.clone();
        let title = div()
            .flex()
            .min_w_0()
            .flex_1()
            .items_center()
            .gap_2()
            .overflow_hidden()
            .child(div().size_7().flex_shrink_0().flex().items_center().justify_center().tw_rounded_md().bg(with_alpha(t.primary, 0.1)).child(Icon::new(IconName::SquareFunction).size_4().text_color(t.primary)))
            .child(title_pill(f.name.clone().into()))
            .child(div().flex_shrink_0().h_5().px(px(6.)).flex().items_center().tw_rounded_md().bg(with_alpha(t.primary, 0.1)).text_color(t.primary).tw_text_xs().child(f.r#type.clone()))
            .child(div().flex().flex_shrink_0().items_center().gap_1().tw_text_xs().text_color(t.muted_foreground).child(Icon::new(IconName::Terminal).size_3()).child(f.language.clone()));
        let editor: AnyElement = if draft_empty && matches!(kind, Kind::MsSql | Kind::MySql) {
            div().absolute().inset_0().flex().items_center().justify_center().p_6().text_center().child(div().tw_text_sm().text_color(t.muted_foreground).child("No permission to view this definition, or the object is encrypted.")).into_any_element()
        } else {
            Editor::new(&v.editor).h(gpui::relative(1.)).bordered(false).disabled(read_only.is_some()).into_any_element()
        };
        let save = cx.listener(|v, _, _, cx| v.save(cx));
        Some(
            StudioSheet::new("fn-viewer")
                .width(768.)
                .contained(close)
                .title_el(title)
                .flush_body()
                .child(
                    div().size_full().p_6().pt_4().flex().flex_col().gap_4().child(
                        div()
                            .flex_1()
                            .min_h(px(320.))
                            .flex()
                            .flex_col()
                            .tw_rounded_lg()
                            .border_1()
                            .border_color(t.border)
                            .overflow_hidden()
                            .bg(with_alpha(t.card, 0.6))
                            .child(
                                div()
                                    .px_4()
                                    .py(px(10.))
                                    .border_b_1()
                                    .border_color(t.border)
                                    .bg(with_alpha(t.muted, 0.4))
                                    .flex()
                                    .items_center()
                                    .justify_between()
                                    .child(
                                        div()
                                            .flex()
                                            .items_center()
                                            .gap_2()
                                            .tw_text_xs()
                                            .font_weight(FontWeight::BOLD)
                                            .text_color(t.muted_foreground)
                                            .child(Icon::new(IconName::Code).size(px(14.)))
                                            .child(rexa_ui::tracked_text::tracked("Source Definition", 0.1)),
                                    )
                                    .child(div().tw_text_xs().text_color(t.muted_foreground).child(f.language.clone())),
                            )
                            .child(div().flex_1().relative().overflow_hidden().child(editor)),
                    ),
                )
                .when_some(read_only, |s, _| {
                    let msg = match kind {
                        Kind::Oracle => "Oracle routines are read-only in this view.",
                        Kind::MySql => "MySQL routines are read-only in this view.",
                        _ => "MSSQL routines are read-only in this view.",
                    };
                    s.footer(div().mr_auto().tw_text_xs().text_color(t.muted_foreground).child(msg))
                })
                .footer(Button::new("fn-cancel").outline().size(ButtonSize::Sm).icon(IconName::X).label(if read_only.is_some() { "Close" } else { "Cancel" }).disabled(v.saving).on_click(move |_, w, cx| close2(w, cx)))
                .footer(Button::new("fn-save").size(ButtonSize::Sm).icon(IconName::Save).label(if v.saving { "Saving..." } else { "Save" }).disabled(read_only.is_some() || !has_changes || v.saving).on_click(save))
                .into_any_element(),
        )
    }
}

impl Render for FunctionsList {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if self.base.loading && self.functions.is_empty() && !self.base.loaded_once {
            return common::list_skeleton("fn-sk", &[96., 64., 128., 80., 48.], cx);
        }
        let t = cx.tokens().clone();
        let kind = self.kind();
        let is_mssql = kind == Kind::MsSql;
        let read_only = self.read_only();
        let search = self.base.query(cx);
        let schema = self.base.schema.clone();
        let schema_fns: Vec<RoutineInfo> = self.functions.iter().filter(|f| f.schema == schema).cloned().collect();
        let mut return_types: Vec<String> = schema_fns.iter().map(|f| f.return_type.clone()).filter(|s| !s.is_empty()).collect();
        return_types.sort();
        return_types.dedup();
        let mut routine_types: Vec<String> = schema_fns.iter().map(|f| f.r#type.to_uppercase()).filter(|s| !s.is_empty()).collect();
        routine_types.sort();
        routine_types.dedup();
        let has_definer = !is_mssql && schema_fns.iter().any(|f| f.security_definer.unwrap_or(false));
        let has_invoker = !is_mssql && schema_fns.iter().any(|f| !f.security_definer.unwrap_or(false));
        let q = search.to_lowercase();
        let filtered: Vec<RoutineInfo> = schema_fns
            .iter()
            .filter(|f| q.is_empty() || f.name.to_lowercase().contains(&q))
            .filter(|f| self.return_filter.is_empty() || self.return_filter.contains(&f.return_type))
            .filter(|f| self.type_filter.is_empty() || self.type_filter.contains(&f.r#type.to_uppercase()))
            .filter(|f| self.security_filter.is_empty() || self.security_filter.contains(&(if f.security_definer.unwrap_or(false) { "definer" } else { "invoker" }).to_string()))
            .cloned()
            .collect();

        let new_btn = |id: &'static str, cx: &mut Context<Self>| -> AnyElement {
            match read_only {
                Some(title) => Tooltip::new(title).side(Side::Bottom).child(Button::new(id).outline().size(ButtonSize::Sm).icon(IconName::Plus).label("New function").disabled(true)).into_any_element(),
                None => Button::new(id).outline().size(ButtonSize::Sm).icon(IconName::Plus).label("New function").on_click(cx.listener(|v, _, w, cx| v.new_function(w, cx))).into_any_element(),
            }
        };

        let body = if schema_fns.is_empty() {
            let (title, desc) = match read_only {
                Some(_) => (
                    format!("No procedures or functions in {schema}"),
                    match kind {
                        Kind::Oracle => "Oracle procedures, functions and package members in this schema are browsable here; routine writes are read-only for now.",
                        Kind::MySql => "MySQL stored procedures and functions in this database will appear here.",
                        _ => "SQL Server stored procedures and functions in this schema will appear here.",
                    },
                ),
                None => ("Add your first function".to_string(), "PostgreSQL functions are a set of SQL and procedural commands such as declarations, assignments, loops, or flow-of-control."),
            };
            let mut actions_row = div().flex().items_center().gap_2().child(ask_ai_button("fn-empty-ai", &self.base.session));
            if read_only.is_none() {
                actions_row = actions_row.child(new_btn("fn-empty-new", cx));
            }
            common::empty_state(IconName::Database, title, Some(desc.into()), Some(actions_row.into_any_element()), cx)
        } else {
            let this = cx.entity();
            let rows: Vec<Row> = filtered
                .into_iter()
                .enumerate()
                .map(|(i, f)| {
                    let args = f.arguments.clone();
                    let id = format!("{}.{}({})-{i}", f.schema, f.name, f.arguments);
                    let definer = f.security_definer.unwrap_or(false);
                    let (fa, fb, fc, fd) = (f.clone(), f.clone(), f.clone(), f.clone());
                    let this_m = this.clone();
                    let ro = read_only;
                    let menu = DropdownMenu::new(SharedString::from(format!("fn-menu-{id}")))
                        .side(Side::Bottom)
                        .align(Align::End)
                        .trigger(Button::new(SharedString::from(format!("fn-more-{id}"))).outline().size(ButtonSize::IconSm).icon(IconName::EllipsisVertical))
                        .menu(move |m, _, _| {
                            let (a, b, c) = (fa.clone(), fb.clone(), fc.clone());
                            let (t1, t2, t3) = (this_m.clone(), this_m.clone(), this_m.clone());
                            m.w(208.)
                                .item(MenuItem::new(if ro.is_some() { "View definition" } else { "Edit function" }).icon(IconName::Pen).on_select(move |w, cx| {
                                    let a = a.clone();
                                    t1.update(cx, |v, cx| v.open_viewer(a, false, w, cx));
                                }))
                                .item(MenuItem::new("Duplicate function").icon(IconName::Copy).disabled(ro.is_some()).on_select(move |w, cx| {
                                    let b = b.clone();
                                    t2.update(cx, |v, cx| v.duplicate(b, w, cx));
                                }))
                                .separator()
                                .item(MenuItem::new("Delete function").icon(IconName::Trash).disabled(ro.is_some()).on_select(move |_, cx| {
                                    let c = c.clone();
                                    t3.update(cx, |v, cx| v.delete(c, cx));
                                }))
                        });
                    let this_r = this.clone();
                    let mut row = Row::new(id)
                        .sort("name", f.name.clone())
                        .sort("type", f.r#type.clone())
                        .sort("arguments", args.clone())
                        .sort("return_type", f.return_type.clone())
                        .sort("security", if definer { "Definer" } else { "Invoker" })
                        .cell(div().truncate().font_weight(FontWeight::MEDIUM).child(f.name.clone()))
                        .cell(div().text_color(t.muted_foreground).child(capitalize(&f.r#type)))
                        .cell(div().truncate().text_color(if args.is_empty() { with_alpha(t.muted_foreground, 0.6) } else { t.muted_foreground }).child(if args.is_empty() { "\u{2013}".to_string() } else { args }))
                        .cell(if f.return_type == "trigger" {
                            div().text_color(t.primary).cursor_pointer().child(f.return_type.clone())
                        } else {
                            div().truncate().text_color(if f.return_type.is_empty() { with_alpha(t.muted_foreground, 0.6) } else { t.muted_foreground }).child(if f.return_type.is_empty() { "\u{2013}".to_string() } else { f.return_type.clone() })
                        });
                    if !is_mssql {
                        row = row.cell(Badge::new(if definer { "Definer" } else { "Invoker" }).variant(if definer { BadgeVariant::Warning } else { BadgeVariant::Outline }));
                    }
                    row.cell(div().flex().items_center().justify_end().child(menu)).on_click(move |w, cx| {
                        let fd = fd.clone();
                        this_r.update(cx, |v, cx| v.open_viewer(fd, false, w, cx));
                    })
                })
                .collect();
            let mut cols = vec![
                Column::new("name", "Name").fr(1.2).sortable(),
                Column::new("type", "Type").fr(0.7).sortable(),
                Column::new("arguments", "Arguments").fr(1.2),
                Column::new("return_type", "Return type").fr(0.9).sortable(),
            ];
            if !is_mssql {
                cols.push(Column::new("security", "Security").fr(0.7));
            }
            cols.push(Column::new("actions", "").px(48.).right());
            div()
                .pb_8()
                .child(DataTable::new("fn-table", &self.base.table).columns(cols).rows(rows).paginate(10, "functions").empty(common::no_results(&search, cx)))
                .into_any_element()
        };

        let mut filters = common::filters()
            .child({
                let this = cx.entity();
                common::schema_dropdown("fn-schema", &self.base.schemas, &schema, false, move |s, _, cx| this.update(cx, |v, cx| ListBase::set_schema(v, s, cx)), cx)
            })
            .child(common::search_input(&self.base.search, cx));
        if !return_types.is_empty() {
            let opts = return_types.iter().map(|r| (r.clone(), r.clone())).collect();
            filters = filters.child(self.filter_menu("fn-f-ret", "Return Type", opts, |v| &mut v.return_filter, self.return_filter.clone(), cx));
        }
        if matches!(kind, Kind::MsSql | Kind::MySql) && routine_types.len() > 1 {
            let opts = routine_types.iter().map(|r| (r.clone(), if r == "PROCEDURE" { "Procedure".to_string() } else { "Function".to_string() })).collect();
            filters = filters.child(self.filter_menu("fn-f-type", "Type", opts, |v| &mut v.type_filter, self.type_filter.clone(), cx));
        }
        if !is_mssql && (has_definer || has_invoker) {
            let mut opts = Vec::new();
            if has_definer {
                opts.push(("definer".to_string(), "Definer".to_string()));
            }
            if has_invoker {
                opts.push(("invoker".to_string(), "Invoker".to_string()));
            }
            filters = filters.child(self.filter_menu("fn-f-sec", "Security", opts, |v| &mut v.security_filter, self.security_filter.clone(), cx));
        }
        let sheet = self.viewer_sheet(cx);
        let header = div()
            .flex_shrink_0()
            .p_8()
            .pb_4()
            .child(div().tw_text_sm().font_weight(FontWeight::SEMIBOLD).child(rexa_ui::tight("Database Functions")))
            .child(
                div()
                    .flex()
                    .items_center()
                    .flex_wrap()
                    .tw_text_sm()
                    .text_color(t.muted_foreground)
                    .mt_1()
                    .child("View and manage stored routines in the\u{a0}")
                    .child(div().bg(t.muted).px_1().rounded(px(4.)).font_family(rexa_ui::MONO).child(schema.clone()))
                    .child("\u{a0}schema"),
            );
        common::page(cx)
            .relative()
            .child(header)
            .child(common::toolbar().child(filters).child(div().flex().items_center().gap_2().child(ask_ai_button("fn-ai", &self.base.session)).child(new_btn("fn-new", cx))))
            .child(div().id("fn-scroll").px_8().flex_1().min_h_0().overflow_y_scroll().child(body).child(div().h_8()))
            .children(sheet)
            .into_any_element()
    }
}

fn capitalize(s: &str) -> String {
    let mut c = s.chars();
    match c.next() {
        Some(f) => f.to_uppercase().collect::<String>() + &c.as_str().to_lowercase(),
        None => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::rename_routine_definition as r;
    #[test]
    fn renames_routine() {
        assert_eq!(r("CREATE OR REPLACE FUNCTION public.add(a int) RETURNS int", "add", "add_duplicate").unwrap(), "CREATE OR REPLACE FUNCTION public.add_duplicate(a int) RETURNS int");
        assert_eq!(r("create function \"Add\"()", "Add", "Add_duplicate").unwrap(), "create function \"Add_duplicate\"()");
        assert!(r("SELECT 1", "x", "y").is_none());
        assert!(r("CREATE FUNCTION other()", "x", "y").is_none());
    }
}
