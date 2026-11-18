//! Port of components/studio/database/{rls-policies-list,add-rls-policy-sheet,
//! rls-policy-form-fields,rls-policy-editor-view,table-definition-view,
//! highlighted-textarea}.tsx, lib/db/rls-utils.ts, lib/studio/rls-utils.ts and the
//! studio's `handleSaveRlsPolicy` / `handleDeleteRlsPolicy` / `handleAddRlsPolicy`.
//!
//! `HighlightedTextarea` (overlayed `highlightSql`) is a tree-sitter SQL editor.
//! The `rlsPolicyTabEditor` setting (studio_settings) switches edit/create to the
//! `rls-policy-edit` tab like the original.

use super::{fetch, ListBase, ListView};
use crate::actions::{self, dq};
use crate::common;
use crate::data_table::{Column, DataTable, Row, TableState};
use crate::sheet::StudioSheet;
use gpui::{div, prelude::*, px, AnyElement, App, Context, Entity, FontWeight, Hsla, SharedString, Window};
use rexa_core::{open_tab, Session, TabSpec};
use rexa_drivers::{ColumnDetail, RlsPolicy, TableRef};
use rexa_ui::widgets::{Editor, EditorState, Icon, InputEvent, InputState};
use rexa_ui::{tw, with_alpha, ActiveTokens, Align, Badge, BadgeVariant, Button, ButtonSize, Combobox, DropdownMenu, IconName, MenuItem, Select, SelectOption, TextInput, Tw, MONO};
use std::sync::Arc;

// ---- rls-utils ------------------------------------------------------------------------------

pub fn supports_with_check(command: &str) -> bool {
    matches!(command.to_lowercase().as_str(), "all" | "insert" | "update")
}

pub fn quote_roles(roles: &[String]) -> String {
    if roles.is_empty() {
        return "PUBLIC".into();
    }
    roles.iter().map(|r| if r.eq_ignore_ascii_case("public") { "PUBLIC".to_string() } else { dq(r) }).collect::<Vec<_>>().join(", ")
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct PolicyPayload {
    pub name: String,
    pub command: String,
    pub permissive: String,
    pub roles: Vec<String>,
    pub using: Option<String>,
    pub with_check: Option<String>,
}

/// `buildCreateSql`.
pub fn build_create_sql(schema: &str, table: &str, v: &PolicyPayload) -> String {
    let command = if v.command.is_empty() { "ALL".to_string() } else { v.command.to_uppercase() };
    let using = v.using.as_ref().map(|u| format!(" USING ({u})")).unwrap_or_default();
    let check = match (&v.with_check, supports_with_check(if v.command.is_empty() { "all" } else { &v.command })) {
        (Some(c), true) => format!(" WITH CHECK ({c})"),
        _ => String::new(),
    };
    format!("CREATE POLICY {} ON {}.{} AS {} FOR {command} TO {}{using}{check};", dq(&v.name), dq(schema), dq(table), v.permissive, quote_roles(&v.roles))
}

/// `handleSaveRlsPolicy`'s statements.
pub fn build_update_sql(original: &RlsPolicy, u: &PolicyPayload) -> Vec<String> {
    let orig_cmd = if original.command.is_empty() { "all".into() } else { original.command.to_lowercase() };
    let orig_perm = if original.permissive.is_empty() { "PERMISSIVE".into() } else { original.permissive.to_uppercase() };
    let on = format!("{}.{}", dq(&original.schema), dq(&original.table_name));
    if orig_cmd != u.command || orig_perm != u.permissive {
        return vec![format!("DROP POLICY IF EXISTS {} ON {on};", dq(&original.name)), build_create_sql(&original.schema, &original.table_name, u)];
    }
    let mut out = Vec::new();
    if u.name != original.name {
        out.push(format!("ALTER POLICY {} ON {on} RENAME TO {};", dq(&original.name), dq(&u.name)));
    }
    let using = u.using.as_ref().map(|x| format!(" USING ({x})")).unwrap_or_else(|| " USING (true)".into());
    let check = if supports_with_check(&u.command) { u.with_check.as_ref().map(|x| format!(" WITH CHECK ({x})")).unwrap_or_else(|| " WITH CHECK (true)".into()) } else { String::new() };
    out.push(format!("ALTER POLICY {} ON {on} TO {}{using}{check};", dq(&u.name), quote_roles(&u.roles)));
    out
}

fn split_roles(s: &str) -> Vec<String> {
    s.split(',').map(|r| r.trim().to_string()).filter(|r| !r.is_empty()).collect()
}

fn rls_tab_editor() -> bool {
    rexa_store::Store::open()
        .ok()
        .and_then(|s| s.setting("studio_settings").ok().flatten())
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .and_then(|v| v.get("rlsPolicyTabEditor").and_then(|b| b.as_bool()))
        .unwrap_or(false)
}

fn policy_to_json(p: &RlsPolicy) -> serde_json::Value {
    serde_json::json!({
        "schema": p.schema, "table_name": p.table_name, "name": p.name, "permissive": p.permissive,
        "roles": p.roles, "command": p.command, "using_expression": p.using_expression,
        "with_check_expression": p.with_check_expression, "rls_enabled": p.rls_enabled, "rls_forced": p.rls_forced,
    })
}

fn policy_from_json(v: &serde_json::Value) -> Option<RlsPolicy> {
    let s = |k: &str| v.get(k).and_then(|x| x.as_str()).map(str::to_string);
    let roles = match v.get("roles") {
        Some(serde_json::Value::Array(a)) => a.iter().filter_map(|x| x.as_str().map(str::to_string)).collect(),
        Some(serde_json::Value::String(t)) => to_roles_array(t),
        _ => Vec::new(),
    };
    Some(RlsPolicy {
        schema: s("schema")?,
        table_name: s("table_name")?,
        name: s("name")?,
        permissive: s("permissive").unwrap_or_default(),
        roles,
        command: s("command").unwrap_or_default(),
        using_expression: s("using_expression"),
        with_check_expression: s("with_check_expression"),
        rls_enabled: v.get("rls_enabled").and_then(|b| b.as_bool()).unwrap_or(false),
        rls_forced: v.get("rls_forced").and_then(|b| b.as_bool()).unwrap_or(false),
    })
}

/// `toRolesArray` for a text value (`{a,b}` or `a, b`).
pub fn to_roles_array(text: &str) -> Vec<String> {
    let t = text.trim();
    if t.starts_with('{') && t.ends_with('}') {
        return t[1..t.len() - 1].split(',').map(|r| r.trim().trim_matches('"').to_string()).filter(|r| !r.is_empty()).collect();
    }
    split_roles(t)
}

/// `openRlsPolicyEditTab`.
pub fn open_edit_tab(p: &RlsPolicy, cx: &mut App) {
    let id = format!("rls-policy-edit-{}-{}-{}", p.schema, p.table_name, p.name);
    open_tab(TabSpec::View { view: "rls-policy-edit".into(), params: serde_json::json!({ "id": id, "name": format!("Policy: {}", p.name), "policy": policy_to_json(p) }) }, cx);
}

/// `openRlsPolicyCreateTab`.
pub fn open_create_tab(schema: &str, table: Option<&str>, cx: &mut App) {
    let ms = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis());
    let id = format!("rls-policy-create-{schema}-{}-{ms}", table.unwrap_or("new"));
    open_tab(
        TabSpec::View { view: "rls-policy-edit".into(), params: serde_json::json!({ "id": id, "name": "New RLS Policy", "prefillSchema": schema, "prefillTable": table }) },
        cx,
    );
}

fn sql_editor(placeholder: &str, value: &str, window: &mut Window, cx: &mut App) -> Entity<EditorState> {
    let (p, v) = (placeholder.to_string(), value.to_string());
    cx.new(|cx| {
        let mut s = EditorState::new(window, cx).language("sql").line_number(false).placeholder(p);
        s.set_value(v, window, cx);
        s
    })
}

fn label(text: &str, cx: &App) -> gpui::Div {
    div().tw_text_xs().font_weight(FontWeight::MEDIUM).text_color(cx.tokens().muted_foreground).child(text.to_string())
}

// ---- RlsPolicyFormFields ---------------------------------------------------------------------

/// The shared fields of the edit sheet and the editor tab.
pub struct PolicyForm {
    pub name: Entity<InputState>,
    pub command: String,
    pub permissive: String,
    pub roles: Entity<InputState>,
    pub using: Entity<EditorState>,
    pub with_check: Entity<EditorState>,
}

impl PolicyForm {
    pub fn new<V: 'static>(p: Option<&RlsPolicy>, window: &mut Window, cx: &mut Context<V>) -> Self {
        let name_v = p.map(|p| p.name.clone()).unwrap_or_default();
        let roles_v = p.map(|p| p.roles.join(", ")).unwrap_or_default();
        let name = cx.new(|cx| {
            let mut s = InputState::new(window, cx);
            s.set_value(name_v, window, cx);
            s
        });
        let roles = cx.new(|cx| {
            let mut s = InputState::new(window, cx).placeholder("public, authenticated");
            s.set_value(roles_v, window, cx);
            s
        });
        let using = sql_editor("auth.uid() = user_id", p.and_then(|p| p.using_expression.as_deref()).unwrap_or(""), window, cx);
        let with_check = sql_editor("auth.uid() = user_id", p.and_then(|p| p.with_check_expression.as_deref()).unwrap_or(""), window, cx);
        for e in [&name, &roles] {
            cx.subscribe(e, |_, _, _: &InputEvent, cx| cx.notify()).detach();
        }
        for e in [&using, &with_check] {
            cx.observe(e, |_, _, cx| cx.notify()).detach();
        }
        PolicyForm {
            name,
            command: p.map(|p| if p.command.is_empty() { "all".into() } else { p.command.to_lowercase() }).unwrap_or_else(|| "all".into()),
            permissive: if p.is_some_and(|p| p.permissive.eq_ignore_ascii_case("RESTRICTIVE")) { "RESTRICTIVE".into() } else { "PERMISSIVE".into() },
            roles,
            using,
            with_check,
        }
    }

    /// `buildRlsPolicyPayload`.
    pub fn payload(&self, cx: &App) -> PolicyPayload {
        let t = |s: String| Some(s.trim().to_string()).filter(|s| !s.is_empty());
        PolicyPayload {
            name: self.name.read(cx).value().trim().to_string(),
            command: self.command.clone(),
            permissive: self.permissive.clone(),
            roles: split_roles(&self.roles.read(cx).value()),
            using: t(self.using.read(cx).value().to_string()),
            with_check: t(self.with_check.read(cx).value().to_string()),
        }
    }

    pub fn is_dirty(&self, p: &RlsPolicy, cx: &App) -> bool {
        let pl = self.payload(cx);
        self.name.read(cx).value() != p.name.as_str()
            || pl.command != if p.command.is_empty() { "all".to_string() } else { p.command.to_lowercase() }
            || self.roles.read(cx).value() != p.roles.join(", ").as_str()
            || self.using.read(cx).value() != p.using_expression.clone().unwrap_or_default().as_str()
            || self.with_check.read(cx).value() != p.with_check_expression.clone().unwrap_or_default().as_str()
    }

    pub fn render<V: 'static>(&self, id: &str, entity: Entity<V>, field: fn(&mut V) -> Option<&mut PolicyForm>, cx: &App) -> AnyElement {
        let t = cx.tokens().clone();
        let code_box = |e: &Entity<EditorState>| {
            div()
                .min_h(px(96.))
                .h(px(96.))
                .tw_rounded_lg()
                .border_1()
                .border_color(t.input)
                .shadow(rexa_ui::popup::shadow_xs())
                .p_3()
                .font_family(MONO)
                .tw_text_xs()
                .child(Editor::new(e).h(gpui::relative(1.)).bordered(false).appearance(false))
        };
        let (e1, e2) = (entity.clone(), entity.clone());
        div()
            .flex()
            .flex_col()
            .gap_4()
            .child(div().flex().flex_col().gap_2().child(label("Policy Name", cx)).child(div().tw_text_xs().child(TextInput::new(&self.name).h(36.))))
            .child(
                div()
                    .flex()
                    .gap_3()
                    .child(
                        div().flex_1().flex().flex_col().gap_2().child(label("Command", cx)).child(
                            Select::new(SharedString::from(format!("{id}-cmd")))
                                .w_full()
                                .options(["all", "select", "insert", "update", "delete"].map(|c| SelectOption::new(c, c.to_uppercase())))
                                .value(Some(self.command.clone()))
                                .on_change(move |v, _, cx| {
                                    e1.update(cx, |s, cx| {
                                        if let Some(f) = field(s) {
                                            f.command = v.to_string();
                                        }
                                        cx.notify();
                                    })
                                }),
                        ),
                    )
                    .child(
                        div().flex_1().flex().flex_col().gap_2().child(label("Policy Mode", cx)).child(
                            Select::new(SharedString::from(format!("{id}-mode")))
                                .w_full()
                                .options(["PERMISSIVE", "RESTRICTIVE"].map(SelectOption::simple))
                                .value(Some(self.permissive.clone()))
                                .on_change(move |v, _, cx| {
                                    e2.update(cx, |s, cx| {
                                        if let Some(f) = field(s) {
                                            f.permissive = v.to_string();
                                        }
                                        cx.notify();
                                    })
                                }),
                        ),
                    ),
            )
            .child(div().flex().flex_col().gap_2().child(label("Roles (comma-separated)", cx)).child(div().tw_text_xs().child(TextInput::new(&self.roles).h(36.))))
            .child(div().flex().flex_col().gap_2().child(label("USING expression", cx)).child(code_box(&self.using)))
            .child(div().flex().flex_col().gap_2().child(label("WITH CHECK expression", cx)).child(code_box(&self.with_check)))
            .into_any_element()
    }
}

/// `TableDefinitionView` (Columns / SQL toggle).
pub fn table_definition(id: &str, table_key: &str, columns: &[ColumnDetail], sql_mode: bool, on_mode: impl Fn(bool, &mut App) + 'static, cx: &App) -> AnyElement {
    let t = cx.tokens().clone();
    let on_mode = std::rc::Rc::new(on_mode);
    let tab = |key: &str, label: &'static str, active: bool, value: bool| {
        let f = on_mode.clone();
        div()
            .id(SharedString::from(format!("{id}-{key}")))
            .tw_text_xs()
            .px_2()
            .py(px(2.))
            .tw_rounded_lg()
            .cursor_pointer()
            .when(active, |d| d.bg(t.background).text_color(t.foreground).shadow(rexa_ui::popup::shadow_sm()).font_weight(FontWeight::MEDIUM))
            .when(!active, |d| d.text_color(t.muted_foreground).hover(|s| s.text_color(t.foreground)))
            .on_click(move |_, _, cx| f(value, cx))
            .child(label)
    };
    let n = columns.len();
    let body = if !sql_mode {
        let mut list = div().flex().flex_col();
        for (i, c) in columns.iter().enumerate() {
            list = list.child(
                div()
                    .flex()
                    .items_center()
                    .gap_2()
                    .px_3()
                    .py(px(6.))
                    .tw_text_xs()
                    .when(i > 0, |d| d.border_t_1().border_color(with_alpha(t.border, 0.3)))
                    .child(if c.is_primary_key { Icon::new(IconName::KeyRound).size_3().text_color(tw("amber-400")) } else { Icon::new(IconName::Hash).size_3().text_color(with_alpha(t.foreground, 0.45)) })
                    .child(div().font_weight(FontWeight::MEDIUM).text_color(with_alpha(t.foreground, 0.9)).truncate().child(c.column_name.clone()))
                    .child(div().ml_auto().text_color(with_alpha(t.foreground, 0.5)).truncate().child(c.display_type().to_string()))
                    .when(c.is_nullable, |d| d.child(div().flex_shrink_0().text_color(with_alpha(t.muted_foreground, 0.6)).child("nullable"))),
            );
        }
        list.into_any_element()
    } else {
        let parts: Vec<String> = columns
            .iter()
            .map(|c| {
                let mut p = vec![format!("  {} {}", c.column_name, c.display_type())];
                if c.is_primary_key {
                    p.push("PRIMARY KEY".into());
                }
                if !c.is_nullable {
                    p.push("NOT NULL".into());
                }
                p.join(" ")
            })
            .collect();
        div().p_3().font_family(MONO).tw_text_xs().child(format!("CREATE TABLE {table_key} (\n{}\n);", parts.join(",\n"))).into_any_element()
    };
    div()
        .flex_1()
        .min_h_0()
        .flex()
        .flex_col()
        .gap_2()
        .child(
            div()
                .flex()
                .items_center()
                .justify_between()
                .child(label(&format!("Table: {table_key} ({n} {})", if n == 1 { "column" } else { "columns" }), cx))
                .child(div().flex().items_center().gap(px(2.)).bg(with_alpha(t.muted, 0.4)).tw_rounded_lg().p(px(2.)).child(tab("cols", "Columns", !sql_mode, false)).child(tab("sql", "SQL", sql_mode, true))),
        )
        .child(div().id(SharedString::from(format!("{id}-def"))).tw_rounded_lg().border_1().border_color(t.border).bg(with_alpha(t.muted, 0.2)).flex_1().min_h(px(120.)).overflow_y_scroll().child(body))
        .into_any_element()
}

fn load_columns<V: 'static>(session: &Arc<Session>, schema: &str, table: &str, cx: &mut Context<V>, apply: impl FnOnce(&mut V, Vec<ColumnDetail>) + 'static) {
    let d = session.driver.clone();
    let tr = TableRef::new(schema, table);
    let fut = rexa_core::runtime::spawn(async move { d.table_structure(&tr).await });
    cx.spawn(async move |this, cx| {
        if let Ok(cols) = fut.await {
            this.update(cx, |v, cx| {
                apply(v, cols);
                cx.notify();
            })
            .ok();
        }
    })
    .detach();
}

// ---- AddRlsPolicySheet -----------------------------------------------------------------------

struct Template {
    id: &'static str,
    command: &'static str,
    title: &'static str,
    description: &'static str,
    using: &'static str,
    with_check: &'static str,
}

const TEMPLATES: [Template; 6] = [
    Template { id: "read-all", command: "SELECT", title: "Enable read access for all users", description: "This policy gives read access to your table for all users via the SELECT operation.", using: "true", with_check: "" },
    Template { id: "insert-auth", command: "INSERT", title: "Enable insert for authenticated users only", description: "This policy gives insert access to your table for all authenticated users only.", using: "", with_check: "auth.role() = 'authenticated'" },
    Template { id: "delete-user-id", command: "DELETE", title: "Enable delete for users based on user_id", description: "This policy assumes that your table has a column \"user_id\", and allows users to delete rows which the \"user_id\" column matches their ID.", using: "auth.uid() = user_id", with_check: "" },
    Template { id: "insert-user-id", command: "INSERT", title: "Enable insert for users based on user_id", description: "This policy assumes that your table has a column \"user_id\", and allows users to insert rows which the \"user_id\" column matches their ID.", using: "", with_check: "auth.uid() = user_id" },
    Template { id: "update-user-id", command: "UPDATE", title: "Enable update for users based on user_id", description: "This policy assumes that your table has a column \"user_id\", and allows users to update rows which the \"user_id\" column matches their ID.", using: "auth.uid() = user_id", with_check: "auth.uid() = user_id" },
    Template { id: "all-user-id", command: "ALL", title: "Grant all operations for users based on user_id", description: "Allows full access to rows where \"user_id\" matches the authenticated user. Combines USING and WITH CHECK.", using: "auth.uid() = user_id", with_check: "auth.uid() = user_id" },
];

fn command_style(cmd: &str, cx: &App) -> (Hsla, Hsla) {
    let d = cx.tokens().dark;
    let p = cx.tokens().primary;
    match cmd {
        "SELECT" => (tw(if d { "emerald-400" } else { "emerald-500" }), with_alpha(tw("emerald-500"), 0.15)),
        "INSERT" => (tw(if d { "amber-400" } else { "amber-600" }), with_alpha(tw("amber-500"), 0.15)),
        "UPDATE" => (p, with_alpha(p, 0.15)),
        "DELETE" => (tw(if d { "red-400" } else { "red-600" }), with_alpha(tw("red-500"), 0.15)),
        _ => (tw(if d { "violet-400" } else { "violet-600" }), with_alpha(tw("violet-500"), 0.15)),
    }
}

pub struct AddPolicy {
    name: Entity<InputState>,
    table: String,
    permissive: String,
    command: String,
    roles: String,
    using: Entity<EditorState>,
    with_check: Entity<EditorState>,
    templates: bool,
    template_search: Entity<InputState>,
    saving: bool,
}

impl AddPolicy {
    fn new<V: 'static>(initial_table: String, window: &mut Window, cx: &mut Context<V>) -> Self {
        let name = cx.new(|cx| InputState::new(window, cx).placeholder("Provide a name for your policy"));
        let template_search = cx.new(|cx| InputState::new(window, cx).placeholder("Search templates"));
        for e in [&name, &template_search] {
            cx.subscribe(e, |_, _, _: &InputEvent, cx| cx.notify()).detach();
        }
        let using = sql_editor("-- Provide a SQL expression for the using statement", "", window, cx);
        let with_check = sql_editor("-- Provide a SQL expression for the with check statement", "", window, cx);
        AddPolicy { name, table: initial_table, permissive: "PERMISSIVE".into(), command: "SELECT".into(), roles: String::new(), using, with_check, templates: false, template_search, saving: false }
    }
}

// ---- RlsPoliciesList -------------------------------------------------------------------------

pub struct RlsPoliciesList {
    base: ListBase,
    policies: Vec<RlsPolicy>,
    roles: Vec<String>,
    tables: Vec<String>,
    policy_filter: Entity<InputState>,
    tables_state: Vec<(String, Entity<TableState>)>,
    editing: Option<(RlsPolicy, PolicyForm)>,
    edit_columns: Vec<ColumnDetail>,
    def_sql: bool,
    saving: bool,
    adding: Option<AddPolicy>,
}

impl ListView for RlsPoliciesList {
    fn base(&mut self) -> &mut ListBase {
        &mut self.base
    }
    fn load(&mut self, cx: &mut Context<Self>) {
        self.base.loading = true;
        let d = self.base.session.driver.clone();
        let schema = self.base.schema.clone();
        let fut = rexa_core::runtime::spawn(async move {
            let policies = d.rls_policies(Some(&schema), None).await?;
            let roles = d.roles().await.unwrap_or_default();
            let tables = d.tables(&schema).await.unwrap_or_default().into_iter().filter(|t| !t.is_view).map(|t| t.name).collect::<Vec<_>>();
            Ok((policies, roles, tables))
        });
        fetch(cx, fut, |v: &mut Self, (p, r, t)| {
            v.policies = p;
            v.roles = r;
            v.tables = t;
        });
    }
}

impl RlsPoliciesList {
    pub fn new(spec: TabSpec, session: Arc<Session>, schema: Option<String>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let base = ListBase::new(spec, session, schema, "Filter by table", window, cx);
        let policy_filter = cx.new(|cx| InputState::new(window, cx).placeholder("Filter by policy"));
        cx.subscribe(&policy_filter, |_, _, _: &InputEvent, cx| cx.notify()).detach();
        let mut this = RlsPoliciesList {
            base,
            policies: Vec::new(),
            roles: Vec::new(),
            tables: Vec::new(),
            policy_filter,
            tables_state: Vec::new(),
            editing: None,
            edit_columns: Vec::new(),
            def_sql: false,
            saving: false,
            adding: None,
        };
        this.load(cx);
        this
    }

    fn table_state(&mut self, table: &str, cx: &mut Context<Self>) -> Entity<TableState> {
        if let Some((_, s)) = self.tables_state.iter().find(|(t, _)| t == table) {
            return s.clone();
        }
        let s = cx.new(|_| TableState { sort: None, page: 1 });
        cx.observe(&s, |_, _, cx| cx.notify()).detach();
        self.tables_state.push((table.to_string(), s.clone()));
        s
    }

    fn start_edit(&mut self, p: RlsPolicy, window: &mut Window, cx: &mut Context<Self>) {
        if rls_tab_editor() {
            open_edit_tab(&p, cx);
            return;
        }
        let form = PolicyForm::new(Some(&p), window, cx);
        self.edit_columns.clear();
        load_columns(&self.base.session, &p.schema, &p.table_name, cx, |v: &mut Self, c| v.edit_columns = c);
        self.editing = Some((p, form));
        cx.notify();
    }

    fn start_create(&mut self, table: Option<(String, String)>, window: &mut Window, cx: &mut Context<Self>) {
        if rls_tab_editor() {
            let (s, t) = table.map(|(s, t)| (s, Some(t))).unwrap_or((self.base.schema.clone(), None));
            open_create_tab(&s, t.as_deref(), cx);
            return;
        }
        let initial = table.map(|(s, t)| format!("{s}.{t}")).unwrap_or_default();
        self.adding = Some(AddPolicy::new(initial, window, cx));
        cx.notify();
    }

    fn save_edit(&mut self, cx: &mut Context<Self>) {
        let Some((orig, form)) = self.editing.as_ref() else { return };
        let payload = form.payload(cx);
        if payload.name.is_empty() {
            return;
        }
        let stmts = build_update_sql(orig, &payload);
        self.saving = true;
        cx.notify();
        let this = cx.entity().downgrade();
        actions::run(&self.base.session, stmts.join("\n"), "RLS policy updated".into(), "Failed to update policy", cx, move |ok, cx| {
            this.update(cx, |v, cx| {
                v.saving = false;
                if ok {
                    v.editing = None;
                }
                v.load(cx);
            })
            .ok();
        });
    }

    fn delete(&mut self, p: RlsPolicy, cx: &mut Context<Self>) {
        let sql = format!("DROP POLICY IF EXISTS {} ON {}.{};", dq(&p.name), dq(&p.schema), dq(&p.table_name));
        let this = cx.entity().downgrade();
        let key = (p.schema.clone(), p.table_name.clone(), p.name.clone());
        actions::confirm_run(
            &self.base.session,
            "Delete RLS Policy",
            format!("Delete policy \"{}\" from \"{}\".\"{}\"?", p.name, p.schema, p.table_name),
            "Delete",
            sql,
            "RLS policy deleted".into(),
            "Failed to delete policy",
            cx,
            move |_, cx| {
                this.update(cx, |v, cx| {
                    if v.editing.as_ref().is_some_and(|(e, _)| (e.schema.clone(), e.table_name.clone(), e.name.clone()) == key) {
                        v.editing = None;
                    }
                    v.load(cx);
                })
                .ok();
            },
        );
    }

    fn save_add(&mut self, cx: &mut Context<Self>) {
        let Some(a) = self.adding.as_mut() else { return };
        let name = a.name.read(cx).value().trim().to_string();
        if name.is_empty() || a.table.is_empty() {
            return;
        }
        let (schema, table) = match a.table.split_once('.') {
            Some((s, t)) => (s.to_string(), t.to_string()),
            None => (self.base.schema.clone(), a.table.clone()),
        };
        let t = |s: String| Some(s.trim().to_string()).filter(|s| !s.is_empty());
        let payload = PolicyPayload {
            name,
            command: a.command.to_lowercase(),
            permissive: a.permissive.clone(),
            roles: split_roles(&a.roles),
            using: t(a.using.read(cx).value().to_string()),
            with_check: t(a.with_check.read(cx).value().to_string()),
        };
        a.saving = true;
        let sql = build_create_sql(&schema, &table, &payload);
        let this = cx.entity().downgrade();
        actions::run(&self.base.session, sql, "RLS policy created".into(), "Failed to create policy", cx, move |ok, cx| {
            this.update(cx, |v, cx| {
                if let Some(a) = v.adding.as_mut() {
                    a.saving = false;
                }
                if ok {
                    v.adding = None;
                }
                v.load(cx);
            })
            .ok();
        });
    }

    fn edit_sheet(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
        let (p, form) = self.editing.as_ref()?;
        let t = cx.tokens().clone();
        let this = cx.entity();
        let disabled_input = |v: &str| div().h_9().px(px(10.)).flex().items_center().tw_rounded_lg().border_1().border_color(t.input).bg(with_alpha(t.input, if t.dark { 0.8 } else { 0.5 })).tw_text_xs().opacity(0.5).child(v.to_string());
        let close = {
            let this = this.clone();
            move |_: &mut Window, cx: &mut App| {
                this.update(cx, |v, cx| {
                    v.editing = None;
                    cx.notify();
                })
            }
        };
        let close2 = close.clone();
        let name_empty = form.name.read(cx).value().trim().is_empty();
        let key = format!("{}.{}", p.schema, p.table_name);
        let this_m = this.clone();
        let def = (!self.edit_columns.is_empty()).then(|| table_definition("rls-edit", &key, &self.edit_columns, self.def_sql, move |sql, cx| this_m.update(cx, |v, cx| {
            v.def_sql = sql;
            cx.notify();
        }), cx));
        Some(
            StudioSheet::new("rls-edit")
                .width(720.)
                .contained(close)
                .title_el(div().flex().flex_col().child(div().tw_text_sm().font_weight(FontWeight::SEMIBOLD).child("Edit RLS Policy")))
                .description("Update command, permissive mode, roles, and expressions for this policy.")
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .gap_4()
                        .child(
                            div()
                                .flex()
                                .gap_3()
                                .child(div().flex_1().flex().flex_col().gap_2().child(label("Schema", cx)).child(disabled_input(&p.schema)))
                                .child(div().flex_1().flex().flex_col().gap_2().child(label("Table", cx)).child(disabled_input(&p.table_name))),
                        )
                        .child(form.render("rls-edit-form", this.clone(), |v: &mut Self| v.editing.as_mut().map(|(_, f)| f), cx))
                        .children(def),
                )
                .footer(Button::new("rls-edit-cancel").secondary().label("Cancel").disabled(self.saving).on_click(move |_, w, cx| close2(w, cx)))
                .footer(Button::new("rls-edit-save").label(if self.saving { "Saving..." } else { "Save policy" }).disabled(self.saving || name_empty).on_click(cx.listener(|v, _, _, cx| v.save_edit(cx))))
                .into_any_element(),
        )
    }

    fn add_sheet(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
        let a = self.adding.as_ref()?;
        let t = cx.tokens().clone();
        let this = cx.entity();
        let close = {
            let this = this.clone();
            move |_: &mut Window, cx: &mut App| {
                this.update(cx, |v, cx| {
                    v.adding = None;
                    cx.notify();
                })
            }
        };
        let set = |f: fn(&mut AddPolicy, String)| {
            let this = this.clone();
            move |v: SharedString, _: &mut Window, cx: &mut App| {
                this.update(cx, |s, cx| {
                    if let Some(a) = s.adding.as_mut() {
                        f(a, v.to_string());
                    }
                    cx.notify();
                })
            }
        };
        let schema = self.base.schema.clone();
        let (schema_from, table_from) = match a.table.split_once('.') {
            Some((s, t)) => (s.to_string(), t.to_string()),
            None => (schema.clone(), a.table.clone()),
        };
        let header_btn = if a.templates {
            Button::new("rls-add-back").ghost().size(ButtonSize::Sm).icon(IconName::ArrowLeft).label("Back").on_click(cx.listener(|v, _, _, cx| {
                if let Some(a) = v.adding.as_mut() {
                    a.templates = false;
                }
                cx.notify();
            }))
        } else {
            Button::new("rls-add-tpl").outline().size(ButtonSize::Sm).icon(IconName::Search).label("Templates").on_click(cx.listener(|v, _, _, cx| {
                if let Some(a) = v.adding.as_mut() {
                    a.templates = true;
                }
                cx.notify();
            }))
        };
        let title = div()
            .flex()
            .items_center()
            .gap(px(10.))
            .min_w_0()
            .child(div().p(px(6.)).tw_rounded_lg().bg(with_alpha(t.primary, 0.1)).child(Icon::new(IconName::Shield).size_4().text_color(t.primary)))
            .child(div().tw_text_sm().font_weight(FontWeight::SEMIBOLD).truncate().child(if a.templates { "Choose a template" } else { "Create a new Row Level Security policy" }));
        let sheet = StudioSheet::new("rls-add").width(1020.).contained(close.clone()).title_el(title).header_child(div().mr_8().child(header_btn)).flush_body();
        if a.templates {
            let q = a.template_search.read(cx).value().to_lowercase();
            let tpls: Vec<&Template> = TEMPLATES.iter().filter(|tp| q.is_empty() || tp.title.to_lowercase().contains(&q) || tp.description.to_lowercase().contains(&q) || tp.command.to_lowercase().contains(&q)).collect();
            let mut grid = div().flex().flex_col().gap_3();
            for pair in tpls.chunks(2) {
                let mut row = div().flex().gap_3();
                for tp in pair {
                    let (fg, bg) = command_style(tp.command, cx);
                    let (cmd, using, check) = (tp.command, tp.using, tp.with_check);
                    row = row.child(
                        div()
                            .id(tp.id)
                            .flex_1()
                            .min_w_0()
                            .p(px(14.))
                            .tw_rounded_lg()
                            .border_1()
                            .border_color(t.border)
                            .bg(t.background)
                            .cursor_pointer()
                            .hover(|s| s.border_color(with_alpha(t.primary, 0.3)).bg(with_alpha(t.primary, 0.03)))
                            .on_click(cx.listener(move |v, _, window, cx| {
                                if let Some(a) = v.adding.as_mut() {
                                    a.command = cmd.into();
                                    a.using.update(cx, |s, cx| s.set_value(using, window, cx));
                                    a.with_check.update(cx, |s, cx| s.set_value(check, window, cx));
                                    a.templates = false;
                                }
                                cx.notify();
                            }))
                            .child(
                                div()
                                    .flex()
                                    .items_start()
                                    .gap_3()
                                    .child(div().flex_shrink_0().mt(px(2.)).px(px(6.)).py(px(2.)).tw_rounded_md().border_1().border_color(with_alpha(fg, 0.2)).bg(bg).text_color(fg).tw_text_xs().font_weight(FontWeight::BOLD).child(tp.command))
                                    .child(
                                        div()
                                            .min_w_0()
                                            .child(div().tw_text_xs().font_weight(FontWeight::SEMIBOLD).child(tp.title))
                                            .child(div().tw_text_xs().text_color(t.muted_foreground).mt_1().child(tp.description))
                                            .when(!using.is_empty() || !check.is_empty(), |d| {
                                                d.child(
                                                    div()
                                                        .mt_2()
                                                        .flex()
                                                        .flex_col()
                                                        .gap_1()
                                                        .when(!using.is_empty(), |d| d.child(div().tw_text_xs().font_family(MONO).text_color(with_alpha(t.primary, 0.7)).bg(with_alpha(t.primary, 0.05)).px_2().py(px(2.)).rounded(px(4.)).child(format!("USING ({using})"))))
                                                        .when(!check.is_empty(), |d| d.child(div().tw_text_xs().font_family(MONO).text_color(common::tone(cx, "emerald-600", "emerald-400")).bg(with_alpha(tw("emerald-500"), 0.05)).px_2().py(px(2.)).rounded(px(4.)).child(format!("WITH CHECK ({check})")))),
                                                )
                                            }),
                                    ),
                            ),
                    );
                }
                if pair.len() == 1 {
                    row = row.child(div().flex_1());
                }
                grid = grid.child(row);
            }
            return Some(
                sheet
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .size_full()
                            .child(div().px_6().pt_5().pb_3().border_b_1().border_color(t.border).child(div().max_w(px(384.)).tw_text_xs().child(TextInput::new(&a.template_search).prefix(Icon::new(IconName::Search).size(px(14.)).text_color(with_alpha(t.muted_foreground, 0.4))))))
                            .child(div().p_6().child(grid).when(tpls.is_empty(), |d| d.child(div().py_10().text_center().tw_text_xs().text_color(with_alpha(t.muted_foreground, 0.5)).child("No templates match your search.")))),
                    )
                    .into_any_element(),
            );
        }
        let field_label = |text: &str, hint: &str| {
            div()
                .flex()
                .gap_1()
                .tw_text_xs()
                .child(div().font_weight(FontWeight::SEMIBOLD).text_color(t.muted_foreground).child(text.to_string()))
                .child(div().text_color(with_alpha(t.muted_foreground, 0.5)).child(hint.to_string()))
        };
        let commands = ["SELECT", "INSERT", "UPDATE", "DELETE", "ALL"];
        let mut cmd_row = div().flex().items_center().gap(px(6.)).flex_wrap();
        for c in commands {
            let on = a.command == c;
            cmd_row = cmd_row.child(
                div()
                    .id(SharedString::from(format!("rls-cmd-{c}")))
                    .h_8()
                    .px_3()
                    .tw_rounded_lg()
                    .tw_text_xs()
                    .font_weight(FontWeight::MEDIUM)
                    .border_1()
                    .flex()
                    .items_center()
                    .gap_2()
                    .cursor_pointer()
                    .when(on, |d| d.bg(with_alpha(t.muted, 0.5)).border_color(with_alpha(t.foreground, 0.3)).text_color(t.foreground).shadow(vec![rexa_ui::popup::ring(with_alpha(t.foreground, 0.2))]))
                    .when(!on, |d| d.border_color(t.border).text_color(t.muted_foreground).hover(|s| s.bg(t.muted).text_color(t.foreground)))
                    .on_click(cx.listener(move |v, _, _, cx| {
                        if let Some(a) = v.adding.as_mut() {
                            a.command = c.into();
                        }
                        cx.notify();
                    }))
                    .child(div().size(px(10.)).tw_rounded_lg().border_1().border_color(if on { t.foreground } else { with_alpha(t.muted_foreground, 0.5) }).flex().items_center().justify_center().when(on, |d| d.child(div().size(px(5.)).rounded_full().bg(t.foreground))))
                    .child(c),
            );
        }
        let wc = supports_with_check(&a.command);
        let kw = |s: &str| div().text_color(t.primary).child(s.to_string());
        let fg = |s: String| div().text_color(t.foreground).child(s);
        let green = common::tone(cx, "emerald-500", "emerald-400");
        let line = || div().flex().items_center().gap_2().h_6();
        let code_editor = |e: &Entity<EditorState>| div().min_h_6().h(px(48.)).child(Editor::new(e).h(gpui::relative(1.)).bordered(false).appearance(false));
        let n_lines = if wc { 11 } else { 8 };
        let name = a.name.read(cx).value().to_string();
        let can_save = !a.saving && !name.trim().is_empty() && !a.table.is_empty();
        let roles_opts: Vec<SelectOption> = if self.roles.is_empty() { vec![SelectOption::simple("public")] } else { self.roles.iter().map(|r| SelectOption::simple(r.clone())).collect() };
        let table_opts: Vec<SelectOption> = self.tables.iter().map(|tb| SelectOption::simple(format!("{schema}.{tb}"))).collect();
        let editor = div()
            .tw_rounded_lg()
            .bg(with_alpha(t.card, 0.6))
            .border_1()
            .border_color(t.border)
            .overflow_hidden()
            .font_family(MONO)
            .tw_text_xs()
            .min_h(px(280.))
            .flex()
            .child(div().w_10().bg(with_alpha(t.muted, 0.05)).border_r_1().border_color(with_alpha(t.border, 0.5)).flex().flex_col().items_center().py_4().text_color(with_alpha(t.muted_foreground, 0.3)).children((1..=n_lines).map(|i| div().h_6().flex().items_center().child(i.to_string()))))
            .child(
                div()
                    .flex_1()
                    .py_4()
                    .px_4()
                    .child(line().child(kw("create")).child(fg("policy".into())).child(div().text_color(green).child(format!("\"{}\"", if name.is_empty() { "policy_name".to_string() } else { name.clone() }))))
                    .child(line().child(kw("on")).child(div().text_color(green).child(format!("\"{schema_from}\".\"{}\"", if table_from.is_empty() { "table_name".to_string() } else { table_from.clone() }))))
                    .child(line().child(kw("as")).child(fg(a.permissive.clone())))
                    .child(line().child(kw("for")).child(fg(a.command.clone())))
                    .child(line().child(kw("to")).child(fg(if a.roles.is_empty() { "public".into() } else { a.roles.clone() })))
                    .child(line().child(kw("using")).child(fg("(".into())))
                    .child(code_editor(&a.using))
                    .child(line().child(fg(if wc { ")".into() } else { ");".into() })))
                    .when(wc, |d| d.child(line().child(kw("with check")).child(fg("(".into()))).child(code_editor(&a.with_check)).child(line().child(fg(");".into())))),
            );
        Some(
            sheet
                .child(
                    div()
                        .p_6()
                        .flex()
                        .flex_col()
                        .gap_5()
                        .child(
                            div()
                                .flex()
                                .gap_4()
                                .child(div().flex_1().flex().flex_col().gap(px(6.)).child(field_label("Policy Name", "")).child(div().tw_text_xs().child(TextInput::new(&a.name).h(36.))))
                                .child(
                                    div().flex_1().flex().flex_col().gap(px(6.)).child(field_label("Table", "on clause")).child(
                                        Select::with_search("rls-add-table").w_full().search_threshold(10).placeholder("Select a table...").search_placeholder("Search table...").empty_text("No tables found.").options(table_opts).value(Some(a.table.clone()).filter(|s| !s.is_empty())).on_change(set(|a, v| a.table = v)),
                                    ),
                                ),
                        )
                        .child(
                            div()
                                .flex()
                                .flex_col()
                                .gap(px(6.))
                                .child(field_label("Policy Behavior", "as clause"))
                                .child(div().w(px(192.)).child(Select::new("rls-add-perm").w_full().options([SelectOption::new("PERMISSIVE", "Permissive"), SelectOption::new("RESTRICTIVE", "Restrictive")]).value(Some(a.permissive.clone())).on_change(set(|a, v| a.permissive = v))))
                                .child(div().tw_text_xs().text_color(with_alpha(t.muted_foreground, 0.6)).max_w(px(384.)).child("Permissive policies allow access when any one policy grants it; restrictive policies require all applicable policies to pass.")),
                        )
                        .child(div().flex().flex_col().gap(px(6.)).child(field_label("Policy Command", "for clause")).child(cmd_row))
                        .child(
                            div().flex().flex_col().gap(px(6.)).child(field_label("Target Roles", "to clause")).child(
                                Combobox::searchable("rls-add-roles")
                                    .search_threshold(10)
                                    .placeholder("Defaults to all (public) roles if none selected")
                                    .search_placeholder("Search role...")
                                    .empty_text("No roles found.")
                                    .options(roles_opts)
                                    .value(Some(a.roles.clone()).filter(|s| !s.is_empty()))
                                    .on_change(set(|a, v| a.roles = v)),
                            ),
                        )
                        .child(
                            div()
                                .pt_2()
                                .flex()
                                .flex_col()
                                .gap(px(6.))
                                .child(div().flex().items_center().gap(px(6.)).px_1().child(Icon::new(IconName::Lock).size(px(14.)).text_color(with_alpha(t.muted_foreground, 0.4))).child(div().tw_text_xs().font_weight(FontWeight::SEMIBOLD).text_color(with_alpha(t.muted_foreground, 0.4)).child("USE OPTIONS ABOVE TO EDIT")))
                                .child(editor),
                        ),
                )
                .footer(Button::new("rls-add-cancel").outline().size(ButtonSize::Sm).label("Cancel").disabled(a.saving).on_click(move |_, w, cx| close(w, cx)))
                .footer(Button::new("rls-add-save").size(ButtonSize::Sm).label(if a.saving { "Saving\u{2026}" } else { "Save policy" }).disabled(!can_save).on_click(cx.listener(|v, _, _, cx| v.save_add(cx))))
                .into_any_element(),
        )
    }
}

impl Render for RlsPoliciesList {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        let schema = self.base.schema.clone();
        let tf = self.base.query(cx).to_lowercase();
        let pf = self.policy_filter.read(cx).value().to_lowercase();
        let filtered: Vec<RlsPolicy> = self.policies.iter().filter(|p| p.table_name.to_lowercase().contains(&tf) && p.name.to_lowercase().contains(&pf)).cloned().collect();
        let mut groups: Vec<(String, Vec<RlsPolicy>)> = Vec::new();
        for p in &filtered {
            match groups.iter_mut().find(|(t, _)| *t == p.table_name) {
                Some((_, v)) => v.push(p.clone()),
                None => groups.push((p.table_name.clone(), vec![p.clone()])),
            }
        }
        groups.sort_by(|a, b| a.0.cmp(&b.0));
        let loading = self.base.loading;
        let this = cx.entity();

        let mut sections = div().pb_8().flex().flex_col().gap_6();
        if loading && self.policies.is_empty() {
            sections = sections.child(div().py_20().text_center().tw_text_sm().text_color(t.muted_foreground).child("Loading RLS policies..."));
        }
        if !loading || !self.policies.is_empty() {
            for (table, pols) in groups {
                let state = self.table_state(&table, cx);
                let tschema = pols.first().map(|p| p.schema.clone()).unwrap_or_else(|| schema.clone());
                let n = pols.len();
                let rows: Vec<Row> = pols
                    .into_iter()
                    .map(|p| {
                        let key = format!("{}.{}.{}.{}", p.schema, p.table_name, p.name, p.command);
                        let perm = p.permissive.to_uppercase();
                        let (pe, pd, pc) = (p.clone(), p.clone(), p.clone());
                        let tm = this.clone();
                        let menu = DropdownMenu::new(SharedString::from(format!("rls-menu-{key}")))
                            .align(Align::End)
                            .trigger(Button::new(SharedString::from(format!("rls-more-{key}"))).ghost().size(ButtonSize::IconSm).child(Icon::new(IconName::EllipsisVertical).size(px(14.)).text_color(with_alpha(t.muted_foreground, 0.4))))
                            .menu(move |m, _, _| {
                                let (a, b) = (pe.clone(), pd.clone());
                                let (t1, t2) = (tm.clone(), tm.clone());
                                m.w(176.)
                                    .item(MenuItem::new("Edit policy").icon(IconName::Pencil).text_xs().on_select(move |w, cx| {
                                        let a = a.clone();
                                        t1.update(cx, |v, cx| v.start_edit(a, w, cx));
                                    }))
                                    .item(MenuItem::new("Delete policy").icon(IconName::Trash).text_xs().destructive().on_select(move |_, cx| {
                                        let b = b.clone();
                                        t2.update(cx, |v, cx| v.delete(b, cx));
                                    }))
                            });
                        let tr = this.clone();
                        Row::new(key)
                            .sort("policy", p.name.clone())
                            .sort("command", p.command.clone())
                            .sort("mode", perm.clone())
                            .sort("rls", if p.rls_enabled { 1i64 } else { 0 })
                            .cell(div().truncate().tw_text_xs().font_weight(FontWeight::MEDIUM).child(p.name.clone()))
                            .cell(div().tw_text_xs().text_color(with_alpha(t.primary, 0.8)).child(rexa_ui::tracked_text::tracked(p.command.clone(), 0.05)))
                            .cell(Badge::new(perm).variant(BadgeVariant::Outline))
                            .cell(
                                div()
                                    .flex()
                                    .items_center()
                                    .gap_1()
                                    .child(Badge::new(if p.rls_enabled { "Enabled" } else { "Disabled" }).variant(if p.rls_enabled { BadgeVariant::Success } else { BadgeVariant::Outline }))
                                    .when(p.rls_forced, |d| d.child(Badge::new("Forced").variant(BadgeVariant::Warning))),
                            )
                            .cell(div().flex().justify_end().child(menu))
                            .on_click(move |w, cx| {
                                let pc = pc.clone();
                                tr.update(cx, |v, cx| v.start_edit(pc, w, cx));
                            })
                    })
                    .collect();
                let (ls, lt) = (tschema.clone(), table.clone());
                let (cs, ct) = (tschema.clone(), table.clone());
                sections = sections.child(
                    div()
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .justify_between()
                                .gap_2()
                                .pb_2()
                                .child(
                                    div()
                                        .flex()
                                        .items_center()
                                        .gap_2()
                                        .min_w_0()
                                        .child(Icon::new(IconName::Shield).size(px(14.)).text_color(with_alpha(t.primary, 0.6)))
                                        .child(div().tw_text_xs().font_weight(FontWeight::SEMIBOLD).child(common::table_link(SharedString::from(format!("rls-tl-{table}")), &table, move |_, cx| common::open_table(&ls, &lt, cx), cx)))
                                        .child(Badge::new(format!("{n} {}", if n == 1 { "policy" } else { "policies" })).variant(BadgeVariant::Secondary)),
                                )
                                .child(Button::new(SharedString::from(format!("rls-new-{table}"))).outline().size(ButtonSize::Sm).icon(IconName::Plus).label("New Policy").on_click(cx.listener(move |v, _, w, cx| v.start_create(Some((cs.clone(), ct.clone())), w, cx)))),
                        )
                        .child(
                            DataTable::new(SharedString::from(format!("rls-table-{table}")), &state)
                                .columns([
                                    Column::new("policy", "Policy").fr(1.2).sortable(),
                                    Column::new("command", "Command").fr(0.7).sortable(),
                                    Column::new("mode", "Mode").fr(0.8),
                                    Column::new("rls", "RLS").fr(0.9),
                                    Column::new("actions", "").px(48.).right(),
                                ])
                                .rows(rows),
                        ),
                );
            }
            if filtered.is_empty() {
                sections = sections.child(
                    div()
                        .flex()
                        .flex_col()
                        .items_center()
                        .justify_center()
                        .py_20()
                        .text_center()
                        .child(Icon::new(IconName::Shield).size_10().mb_4().text_color(with_alpha(t.muted_foreground, 0.1)))
                        .child(div().tw_text_sm().font_weight(FontWeight::MEDIUM).child("No RLS policies found"))
                        .child(div().tw_text_xs().text_color(t.muted_foreground).mt_1().max_w(px(260.)).child("Try a different table/policy filter or choose another schema.")),
                );
            }
        }

        let schemas = self.base.schemas.clone();
        let ts = this.clone();
        let schema_menu = DropdownMenu::new("rls-schema")
            .align(Align::Start)
            .trigger(
                div()
                    .flex()
                    .items_center()
                    .gap_2()
                    .h_8()
                    .px_3()
                    .tw_rounded_lg()
                    .border_1()
                    .border_color(t.border)
                    .bg(t.background)
                    .tw_text_xs()
                    .text_color(t.muted_foreground)
                    .cursor_pointer()
                    .hover(|s| s.bg(with_alpha(t.muted, 0.4)))
                    .child(div().opacity(0.5).child("schema"))
                    .child(div().text_color(t.foreground).font_weight(FontWeight::MEDIUM).child(schema.clone()))
                    .child(Icon::new(IconName::ChevronDown).size(px(14.)).opacity(0.5)),
            )
            .menu(move |m, _, _| {
                let mut m = m.w(192.);
                for s in &schemas {
                    let (ts, s2) = (ts.clone(), s.clone());
                    m = m.item(MenuItem::new(s.clone()).text_xs().on_select(move |_, cx| {
                        let s = s2.clone();
                        ts.update(cx, |v, cx| ListBase::set_schema(v, s, cx));
                    }));
                }
                m
            });
        let filter_input = |state: &Entity<InputState>| div().flex_1().max_w(px(320.)).tw_text_xs().child(TextInput::new(state).h(28.).prefix(Icon::new(IconName::Search).size(px(14.)).text_color(with_alpha(t.muted_foreground, 0.4))));
        let edit = self.edit_sheet(cx);
        let add = self.add_sheet(cx);
        common::page(cx)
            .relative()
            .child(
                div()
                    .flex_shrink_0()
                    .p_8()
                    .pb_4()
                    .child(div().tw_text_sm().font_weight(FontWeight::SEMIBOLD).child(rexa_ui::tight("RLS Policies")))
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .tw_text_sm()
                            .text_color(t.muted_foreground)
                            .mt_1()
                            .child("View and manage Row Level Security policies in the\u{a0}")
                            .child(div().bg(t.muted).px_1().rounded(px(4.)).font_family(MONO).child(schema.clone()))
                            .child("\u{a0}schema"),
                    ),
            )
            .child(
                div()
                    .flex_shrink_0()
                    .px_8()
                    .py_4()
                    .flex()
                    .items_center()
                    .justify_between()
                    .gap_4()
                    .child(div().flex().items_center().gap_3().flex_1().child(schema_menu).child(filter_input(&self.base.search)).child(filter_input(&self.policy_filter)))
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap_2()
                            .child(Button::new("rls-refresh").outline().size(ButtonSize::Sm).icon(IconName::RefreshCw).label("Refresh").disabled(loading).on_click(cx.listener(|v, _, _, cx| v.load(cx))))
                            .child(Button::new("rls-new").outline().size(ButtonSize::Sm).icon(IconName::Plus).label("New Policy").on_click(cx.listener(|v, _, w, cx| v.start_create(None, w, cx)))),
                    ),
            )
            .child(div().id("rls-scroll").px_8().flex_1().min_h_0().overflow_y_scroll().child(sections))
            .children(edit)
            .children(add)
            .into_any_element()
    }
}

// ---- rls-policy-edit tab ---------------------------------------------------------------------

/// `RlsPolicyEditorView` (the `rls-policy-edit` tab).
pub struct RlsPolicyEditorView {
    session: Arc<Session>,
    spec: TabSpec,
    policy: Option<RlsPolicy>,
    prefill_schema: String,
    table: String,
    tables: Vec<String>,
    form: PolicyForm,
    columns: Vec<ColumnDetail>,
    def_sql: bool,
    saving: bool,
}

impl RlsPolicyEditorView {
    pub fn new(spec: TabSpec, params: &serde_json::Value, session: Arc<Session>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let policy = params.get("policy").and_then(policy_from_json);
        let prefill_schema = params.get("prefillSchema").and_then(|v| v.as_str()).map(str::to_string).or(policy.as_ref().map(|p| p.schema.clone())).unwrap_or_default();
        let table = policy.as_ref().map(|p| p.table_name.clone()).or(params.get("prefillTable").and_then(|v| v.as_str()).map(str::to_string)).unwrap_or_default();
        let form = PolicyForm::new(policy.as_ref(), window, cx);
        let mut this = RlsPolicyEditorView { session, spec, policy, prefill_schema, table, tables: Vec::new(), form, columns: Vec::new(), def_sql: false, saving: false };
        this.load_columns(cx);
        if this.policy.is_none() {
            let d = this.session.driver.clone();
            let s = this.prefill_schema.clone();
            let fut = rexa_core::runtime::spawn(async move { d.tables(&s).await });
            cx.spawn(async move |this, cx| {
                if let Ok(t) = fut.await {
                    this.update(cx, |v, cx| {
                        v.tables = t.into_iter().filter(|t| !t.is_view).map(|t| t.name).collect();
                        cx.notify();
                    })
                    .ok();
                }
            })
            .detach();
        }
        this
    }

    fn load_columns(&mut self, cx: &mut Context<Self>) {
        self.columns.clear();
        if self.prefill_schema.is_empty() || self.table.is_empty() {
            return;
        }
        load_columns(&self.session, &self.prefill_schema.clone(), &self.table.clone(), cx, |v: &mut Self, c| v.columns = c);
    }

    fn close(&self, cx: &mut App) {
        rexa_core::emit_studio(rexa_core::StudioEvent::CloseTab(self.spec.clone()), cx);
    }

    fn save(&mut self, cx: &mut Context<Self>) {
        let payload = self.form.payload(cx);
        if payload.name.is_empty() || (self.policy.is_none() && self.table.is_empty()) {
            return;
        }
        let (sql, msg) = match &self.policy {
            Some(p) => (build_update_sql(p, &payload).join("\n"), "RLS policy updated"),
            None => (build_create_sql(&self.prefill_schema, &self.table, &payload), "RLS policy created"),
        };
        self.saving = true;
        cx.notify();
        let this = cx.entity().downgrade();
        actions::run(&self.session, sql, msg.into(), "Failed to save policy", cx, move |ok, cx| {
            this.update(cx, |v, cx| {
                v.saving = false;
                if ok {
                    v.close(cx);
                }
                cx.notify();
            })
            .ok();
        });
    }
}

impl Render for RlsPolicyEditorView {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        let is_edit = self.policy.is_some();
        let this = cx.entity();
        let disabled_input = |v: &str| div().h_9().px(px(10.)).flex().items_center().tw_rounded_lg().border_1().border_color(t.input).bg(with_alpha(t.input, if t.dark { 0.8 } else { 0.5 })).tw_text_xs().opacity(0.5).child(v.to_string());
        let (title, sub) = match &self.policy {
            Some(p) => (format!("Edit Policy: {}", p.name), format!("Update {}.{}", p.schema, p.table_name)),
            None => ("New RLS Policy".to_string(), format!("Create a policy for {}.{}", self.prefill_schema, if self.table.is_empty() { "..." } else { &self.table })),
        };
        let table_field = if is_edit {
            disabled_input(&self.table).into_any_element()
        } else {
            let tt = this.clone();
            Select::with_search("rls-ed-table")
                .w_full()
                .search_threshold(10)
                .placeholder("Select a table...")
                .search_placeholder("Search table...")
                .empty_text("No tables found.")
                .options(self.tables.iter().map(|x| SelectOption::simple(x.clone())))
                .value(Some(self.table.clone()).filter(|s| !s.is_empty()))
                .on_change(move |v, _, cx| {
                    tt.update(cx, |s, cx| {
                        s.table = v.to_string();
                        s.load_columns(cx);
                        cx.notify();
                    })
                })
                .into_any_element()
        };
        let key = format!("{}.{}", self.prefill_schema, self.table);
        let tm = this.clone();
        let def = (!self.columns.is_empty()).then(|| table_definition("rls-ed", &key, &self.columns, self.def_sql, move |sql, cx| tm.update(cx, |v, cx| {
            v.def_sql = sql;
            cx.notify();
        }), cx));
        let name_empty = self.form.name.read(cx).value().trim().is_empty();
        div()
            .size_full()
            .flex()
            .flex_col()
            .bg(t.studio_bg)
            .text_color(t.foreground)
            .overflow_hidden()
            .child(
                div().p_6().pb_0().flex_shrink_0().child(
                    div()
                        .flex()
                        .items_center()
                        .gap_3()
                        .child(div().p(px(6.)).tw_rounded_lg().bg(with_alpha(t.primary, 0.1)).child(Icon::new(IconName::Shield).size_4().text_color(t.primary)))
                        .child(div().child(div().tw_text_sm().font_weight(FontWeight::SEMIBOLD).child(rexa_ui::tight(title))).child(div().tw_text_xs().text_color(t.muted_foreground).child(sub))),
                ),
            )
            .child(
                div()
                    .id("rls-ed-body")
                    .flex_1()
                    .min_h_0()
                    .p_6()
                    .flex()
                    .flex_col()
                    .gap_4()
                    .overflow_y_scroll()
                    .child(
                        div()
                            .flex()
                            .gap_3()
                            .child(div().flex_1().flex().flex_col().gap_2().child(label("Schema", cx)).child(disabled_input(&self.prefill_schema)))
                            .child(div().flex_1().flex().flex_col().gap_2().child(label("Table", cx)).child(table_field)),
                    )
                    .child(self.form.render("rls-ed-form", this.clone(), |v: &mut Self| Some(&mut v.form), cx))
                    .children(def),
            )
            .child(
                div()
                    .p_6()
                    .border_t_1()
                    .border_color(t.border)
                    .bg(with_alpha(t.muted, 0.05))
                    .flex_shrink_0()
                    .flex()
                    .items_center()
                    .justify_end()
                    .gap_3()
                    .child(Button::new("rls-ed-cancel").secondary().label("Cancel").disabled(self.saving).on_click(cx.listener(|v, _, _, cx| v.close(cx))))
                    .child(
                        Button::new("rls-ed-save")
                            .label(if self.saving { "Saving..." } else if is_edit { "Save policy" } else { "Create policy" })
                            .disabled(self.saving || name_empty || (!is_edit && self.table.is_empty()))
                            .on_click(cx.listener(|v, _, _, cx| v.save(cx))),
                    ),
            )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rls_sql() {
        let p = PolicyPayload { name: "p".into(), command: "select".into(), permissive: "PERMISSIVE".into(), roles: vec![], using: Some("true".into()), with_check: Some("x".into()) };
        assert_eq!(build_create_sql("public", "t", &p), "CREATE POLICY \"p\" ON \"public\".\"t\" AS PERMISSIVE FOR SELECT TO PUBLIC USING (true);");
        let orig = RlsPolicy { schema: "public".into(), table_name: "t".into(), name: "p".into(), permissive: "PERMISSIVE".into(), command: "SELECT".into(), ..Default::default() };
        let u = PolicyPayload { name: "q".into(), roles: vec!["anon".into()], using: None, ..p.clone() };
        assert_eq!(build_update_sql(&orig, &u), vec!["ALTER POLICY \"p\" ON \"public\".\"t\" RENAME TO \"q\";".to_string(), "ALTER POLICY \"q\" ON \"public\".\"t\" TO \"anon\" USING (true);".to_string()]);
        assert_eq!(to_roles_array("{anon,\"auth\"}"), vec!["anon", "auth"]);
    }
}
