//! Port of the table toolbar's access controls:
//! - components/studio/toolbar/toolbar-global-actions.tsx (the "RLS off" popover with
//!   "Enable RLS", the "N RLS Policies" button)
//! - components/studio/toolbar/toolbar-permission-filter.tsx (the "Default access" /
//!   "As <role|user>" preview picker)
//! - lib/studio/table-permissions.ts (`TablePermissionContext`, `buildQueryExecutionContext`)
//! - lib/db/pg-client.ts `applyExecutionContext` (`SET LOCAL ROLE` + `request.jwt.*`
//!   settings inside a transaction around the read)
//! - hooks/use-studio.ts `enableRlsForCurrentTable`, `openCurrentTableRlsPolicies`,
//!   `loadSupabaseAuthUsers`, `fetchTableSecurityInfo` and `setTablePermissionContext`.
//!
//! As in the original, the execution context only applies to direct Postgres
//! connections; Supabase management connections run the plain read.

use crate::view::{ActionKind, TableEditor};
use gpui::{div, prelude::*, px, AnyElement, Context, Entity, FontWeight, SharedString, Window};
use rexa_core::runtime;
use rexa_drivers::{AuthUser, Driver, Kind, QueryResult, TableFilter, TablePage, TableQuery, TableRef};
use rexa_ui::widgets::{Icon, InputState};
use rexa_ui::{with_alpha, ActiveTokens, Align, Button, ButtonSize, IconName, Popover, Toast, Tw};
use serde_json::{json, Value};
use std::sync::Arc;

/// Supabase-style access roles shown in the table toolbar Access control.
const ACCESS_ROLES: [&str; 3] = ["postgres", "anon", "authenticated"];

/// `TablePermissionContext` (non-null).
#[derive(Debug, Clone, PartialEq)]
pub enum PermissionContext {
    Role { role: String },
    SupabaseUser { user_id: String, role: String, label: String, email: Option<String>, phone: Option<String>, app_meta: Value, user_meta: Value },
}

impl PermissionContext {
    pub fn label(&self) -> &str {
        match self {
            PermissionContext::Role { role } => role,
            PermissionContext::SupabaseUser { label, .. } => label,
        }
    }

    /// `getTablePermissionContextKey`
    pub fn key(&self) -> String {
        match self {
            PermissionContext::Role { role } => format!("role:{role}"),
            PermissionContext::SupabaseUser { user_id, .. } => format!("user:{user_id}"),
        }
    }

    /// `createSupabaseUserPermissionContext`
    pub fn from_user(user: &AuthUser) -> Self {
        let label = [user.email.as_deref(), user.phone.as_deref(), Some(user.display_name.as_str()), Some(user.id.as_str())]
            .into_iter()
            .flatten()
            .find(|s| !s.is_empty())
            .unwrap_or_default()
            .trim()
            .to_string();
        let role = if user.role.trim().is_empty() { "authenticated".to_string() } else { user.role.trim().to_string() };
        let record = |v: &Value| if v.is_object() { v.clone() } else { json!({}) };
        PermissionContext::SupabaseUser {
            user_id: user.id.trim().to_string(),
            role,
            label: if label.is_empty() { user.id.trim().to_string() } else { label },
            email: user.email.clone(),
            phone: user.phone.clone(),
            app_meta: record(&user.raw_app_meta_data),
            user_meta: record(&user.raw_user_meta_data),
        }
    }

    /// `applyExecutionContext`: the statements run after `BEGIN`.
    pub fn statements(&self) -> Vec<String> {
        let d = Kind::Postgres.dialect();
        let set = |name: &str, value: &str| format!("SELECT pg_catalog.set_config('{name}', {}, true)", d.quote_str(value));
        match self {
            PermissionContext::Role { role } => vec![format!("SET LOCAL ROLE {}", d.quote_ident(role))],
            PermissionContext::SupabaseUser { user_id, role, email, phone, app_meta, user_meta, .. } => {
                let mut claims = serde_json::Map::new();
                claims.insert("sub".into(), json!(user_id));
                claims.insert("role".into(), json!(role));
                if let Some(e) = email {
                    claims.insert("email".into(), json!(e));
                }
                if let Some(p) = phone {
                    claims.insert("phone".into(), json!(p));
                }
                claims.insert("app_metadata".into(), app_meta.clone());
                claims.insert("user_metadata".into(), user_meta.clone());
                let mut out = vec![
                    format!("SET LOCAL ROLE {}", d.quote_ident(role)),
                    set("request.jwt.claim.sub", user_id),
                    set("request.jwt.claim.role", role),
                    set("request.jwt.claims", &Value::Object(claims).to_string()),
                ];
                if let Some(e) = email.as_deref().filter(|e| !e.is_empty()) {
                    out.push(set("request.jwt.claim.email", e));
                }
                if let Some(p) = phone.as_deref().filter(|p| !p.is_empty()) {
                    out.push(set("request.jwt.claim.phone", p));
                }
                out
            }
        }
    }
}

/// Toolbar access state of one table tab.
#[derive(Default)]
pub struct AccessState {
    /// (`rlsEnabled`, `policyCount`) from `fetchTableSecurityInfo`.
    pub security: Option<(bool, i64)>,
    pub context: Option<PermissionContext>,
    pub auth_users: Vec<AuthUser>,
    pub loading_users: bool,
    pub enabling_rls: bool,
    pub search: Option<Entity<InputState>>,
}

pub fn supports_access(kind: Kind) -> bool {
    matches!(kind, Kind::Postgres | Kind::SupabaseMgmt)
}

/// Runs `sql` inside the execution context (direct Postgres only).
async fn run_in_context(driver: &Arc<dyn Driver>, ctx: &PermissionContext, sql: String) -> anyhow::Result<QueryResult> {
    let mut statements = ctx.statements();
    statements.push(sql);
    let mut results = driver.transaction(&statements).await?;
    results.pop().ok_or_else(|| anyhow::anyhow!("The preview query returned no result."))
}

/// `read_table` under the preview context.
pub async fn read_table(driver: Arc<dyn Driver>, query: TableQuery, ctx: Option<PermissionContext>) -> anyhow::Result<TablePage> {
    match ctx {
        Some(ctx) if driver.kind() == Kind::Postgres => {
            let sql = rexa_drivers::grid::build_select_sql(driver.kind(), &query);
            let result = run_in_context(&driver, &ctx, sql.clone()).await?;
            Ok(TablePage { result, query: sql, total_count: None })
        }
        _ => driver.read_table(&query).await,
    }
}

/// `count_rows` under the preview context.
pub async fn count_rows(driver: Arc<dyn Driver>, table: TableRef, filter: TableFilter, ctx: Option<PermissionContext>) -> anyhow::Result<u64> {
    match ctx {
        Some(ctx) if driver.kind() == Kind::Postgres => {
            let sql = rexa_drivers::grid::build_count_sql(driver.kind(), &table, &filter);
            let r = run_in_context(&driver, &ctx, sql).await?;
            r.rows
                .first()
                .and_then(|row| row.first())
                .and_then(|c| c.as_str())
                .and_then(|s| s.trim().parse::<f64>().ok())
                .map(|n| n as u64)
                .ok_or_else(|| anyhow::anyhow!("count returned no rows"))
        }
        _ => driver.count_rows(&table, &filter).await,
    }
}

impl TableEditor {
    pub(crate) fn preview_only(&self) -> bool {
        self.access.context.is_some()
    }

    /// `fetchTableSecurityInfo` for the table's schema, then pick this table.
    pub(crate) fn load_table_security(&mut self, cx: &mut Context<Self>) {
        if !supports_access(self.kind) {
            return;
        }
        let driver = self.driver.clone();
        let (schema, table) = (self.table.schema.clone(), self.table.name.clone());
        let task = runtime::spawn(async move { driver.table_security(&schema).await });
        cx.spawn(async move |this, cx| {
            if let Ok(rows) = task.await {
                this.update(cx, |this, cx| {
                    this.access.security = rows.iter().find(|r| r.table_name == table).map(|r| (r.rls_enabled, r.policy_count));
                    cx.notify();
                })
                .ok();
            }
        })
        .detach();
    }

    /// `loadSupabaseAuthUsers`
    pub(crate) fn load_auth_users(&mut self, cx: &mut Context<Self>) {
        if !supports_access(self.kind) {
            return;
        }
        let driver = self.driver.clone();
        self.access.loading_users = true;
        let task = runtime::spawn(async move { driver.supabase_auth_users().await });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |this, cx| {
                this.access.loading_users = false;
                match result {
                    Ok(users) => this.access.auth_users = users.into_iter().filter(|u| !u.id.is_empty()).collect(),
                    Err(e) => {
                        this.access.auth_users.clear();
                        let msg = format!("{e:#}");
                        let lower = msg.to_lowercase();
                        // Swallow only the "auth schema/table doesn't exist" case.
                        let missing = lower.contains("does not exist") && (lower.contains("auth.users") || lower.contains("\"auth\"") || lower.contains("schema auth")) || msg.contains("42P01");
                        if !msg.is_empty() && !missing {
                            this.error = Some(msg);
                        }
                    }
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    /// `setTablePermissionContext`
    pub(crate) fn set_permission_context(&mut self, next: Option<PermissionContext>, window: &mut Window, cx: &mut Context<Self>) {
        if self.access.context == next {
            return;
        }
        self.access.context = next;
        self.page = 0;
        self.grid.editor = None;
        self.selected_rows.clear();
        self.grid.clear_selection();
        self.focus.focus(window, cx);
        self.refresh(cx);
    }

    /// `enableRlsForCurrentTable`
    fn enable_rls(&mut self, close: rexa_ui::PopoverCtl, window: &mut Window, cx: &mut Context<Self>) {
        if self.access.enabling_rls {
            return;
        }
        let d = self.kind.dialect();
        let (schema, table) = (self.table.schema.clone(), self.table.name.clone());
        let sql = format!("ALTER TABLE {}.{} ENABLE ROW LEVEL SECURITY;", d.quote_ident(&schema), d.quote_ident(&table));
        if self.settings.review_mode {
            self.add_action(ActionKind::EnableRls, format!("Enable RLS on \"{schema}\".\"{table}\""), sql, Vec::new(), cx);
            close.close(window, cx);
            return;
        }
        self.access.enabling_rls = true;
        cx.notify();
        let driver = self.driver.clone();
        let task = runtime::spawn(async move { driver.execute(&sql, 0).await });
        cx.spawn_in(window, async move |this, cx| {
            let result = task.await;
            this.update_in(cx, |this, window, cx| {
                this.access.enabling_rls = false;
                match result {
                    Ok(_) => {
                        Toast::success("RLS enabled").show(cx);
                        close.close(window, cx);
                        this.load_table_security(cx);
                        rexa_core::emit_studio(rexa_core::StudioEvent::SchemaChanged, cx);
                    }
                    Err(e) => {
                        let msg = format!("{e:#}");
                        Toast::error(if msg.is_empty() { "Failed to enable RLS".into() } else { msg }).show(cx);
                    }
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    /// `ToolbarGlobalActions`' RLS button (Postgres / Supabase only).
    pub(crate) fn render_rls_button(&mut self, cx: &mut Context<Self>) -> Option<AnyElement> {
        if !supports_access(self.kind) {
            return None;
        }
        let t = cx.tokens().clone();
        match self.access.security {
            Some((false, _)) => {
                let this = cx.entity();
                let table = self.table.name.clone();
                let enabling = self.access.enabling_rls;
                let preview = self.preview_only();
                let destructive = t.destructive;
                let (bg, hover_bg) = if t.dark { (0.2, 0.3) } else { (0.15, 0.25) };
                Some(
                    Popover::new("rls-off")
                        .align(Align::End)
                        .side_offset(8.)
                        .w(Some(288.))
                        .p(12.)
                        .trigger(
                            Button::new("rls-off-btn")
                                .size(ButtonSize::Sm)
                                .icon(IconName::Lock)
                                .label("RLS off")
                                // border-destructive/25 is not expressible on Button; fill + text only.
                                .colors(with_alpha(destructive, bg), with_alpha(destructive, hover_bg), destructive),
                        )
                        .content(move |ctl, _, cx| {
                            let t = cx.tokens().clone();
                            let (this, ctl) = (this.clone(), ctl.clone());
                            div()
                                .flex()
                                .flex_col()
                                .child(
                                    div()
                                        .flex()
                                        .items_start()
                                        .gap(px(10.))
                                        .child(div().mt(px(2.)).flex_shrink_0().child(Icon::new(IconName::Lock).size_4().text_color(t.muted_foreground)))
                                        .child(
                                            div()
                                                .min_w_0()
                                                .child(div().tw_text_sm().font_weight(FontWeight::MEDIUM).child("Enable Row Level Security"))
                                                .child(
                                                    div()
                                                        .mt(px(6.))
                                                        .text_size(px(12.))
                                                        .line_height(px(19.5))
                                                        .text_color(t.muted_foreground)
                                                        .child(format!("Restricts read and write access to \"{table}\" to the policies you define.")),
                                                ),
                                        ),
                                )
                                .child(
                                    div().mt_3().child(
                                        Button::new("enable-rls")
                                            .outline()
                                            .size(ButtonSize::Sm)
                                            .w_full()
                                            .child(div().text_size(px(12.)).child(if enabling { "Enabling…" } else { "Enable RLS" }))
                                            .disabled(enabling || preview)
                                            .on_click(move |_, window, cx| {
                                                let ctl = ctl.clone();
                                                this.update(cx, |this, cx| this.enable_rls(ctl, window, cx));
                                            }),
                                    ),
                                )
                        })
                        .into_any_element(),
                )
            }
            security => {
                let count: SharedString = match security {
                    Some((_, n)) => n.to_string().into(),
                    None => "—".into(),
                };
                let (schema, table) = (self.table.schema.clone(), self.table.name.clone());
                Some(
                    Button::new("rls-policies-btn")
                        .outline()
                        .size(ButtonSize::Sm)
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .justify_center()
                                .h_4()
                                .min_w_4()
                                .px_1()
                                .rounded(px(10.))
                                .tw_text_xs()
                                .bg(t.muted)
                                .text_color(with_alpha(t.foreground, 0.8))
                                .border_1()
                                .border_color(t.studio_border)
                                .child(count),
                        )
                        .label("RLS Policies")
                        .on_click(move |_, _, cx| rexa_schema::open_rls_policies_for_table(&schema, &table, cx))
                        .into_any_element(),
                )
            }
        }
    }

    /// `ToolbarPermissionFilter`
    pub(crate) fn render_permission_filter(&mut self, window: &mut Window, cx: &mut Context<Self>) -> Option<AnyElement> {
        if !supports_access(self.kind) {
            return None;
        }
        let search = self
            .access
            .search
            .get_or_insert_with(|| cx.new(|cx| InputState::new(window, cx).placeholder("Search roles or users...")))
            .clone();
        let label: SharedString = match &self.access.context {
            Some(c) => format!("As {}", c.label()).into(),
            None => "Default access".into(),
        };
        let user_icon = matches!(self.access.context, Some(PermissionContext::SupabaseUser { .. }));
        let selected = self.access.context.as_ref().map(PermissionContext::key).unwrap_or_else(|| "__default__".into());
        let users = self.access.auth_users.clone();
        let loading = self.access.loading_users;
        let supabase_mgmt = self.kind == Kind::SupabaseMgmt;
        let this = cx.entity();
        let chevron = cx.tokens().muted_foreground;
        Some(
            Popover::new("permission-filter")
                .align(Align::End)
                .w(Some(320.))
                .p(4.)
                .trigger_with(move |open| {
                    Button::new("permission-filter-btn").outline().size(ButtonSize::Sm).child(
                        div()
                            .flex()
                            .items_center()
                            .gap_2()
                            .max_w(px(214.))
                            .child(div().flex().items_center().gap_2().min_w_0().child(Icon::new(if user_icon { IconName::User } else { IconName::Shield }).size(px(14.)).flex_shrink_0()).child(div().truncate().child(label.clone())))
                            .child(Icon::new(if open { IconName::ChevronUp } else { IconName::ChevronDown }).size(px(14.)).flex_shrink_0().text_color(chevron)),
                    )
                })
                .content(move |ctl, _, cx| {
                    let t = cx.tokens().clone();
                    let query = search.read(cx).value().to_lowercase();
                    let matches = |text: &str| query.is_empty() || text.to_lowercase().contains(&query);
                    let total = 1 + ACCESS_ROLES.len() + users.len();
                    let group_label = |text: &'static str| {
                        div().px_2().py(px(6.)).tw_text_xs().text_color(with_alpha(t.muted_foreground, 0.7)).child(text)
                    };
                    let separator = || div().mx(px(-4.)).my_1().h(px(1.)).bg(t.border);
                    let item = |key: String, body: AnyElement, pick: Option<PermissionContext>| {
                        let is_selected = key == selected;
                        let (this, ctl) = (this.clone(), ctl.clone());
                        div()
                            .id(SharedString::from(format!("perm-{key}")))
                            .relative()
                            .flex()
                            .items_center()
                            .w_full()
                            .rounded(px(6.))
                            .py_2()
                            .pl_2()
                            .pr_8()
                            .tw_text_xs()
                            .cursor_pointer()
                            .hover(|s| s.bg(t.accent).text_color(t.accent_foreground))
                            .child(body)
                            .when(is_selected, |d| d.child(div().absolute().right_2().child(Icon::new(IconName::Check).size(px(14.)))))
                            .on_click(move |_, window, cx| {
                                ctl.close(window, cx);
                                let pick = pick.clone();
                                this.update(cx, |this, cx| this.set_permission_context(pick, window, cx));
                            })
                            .into_any_element()
                    };
                    let mut list: Vec<AnyElement> = Vec::new();
                    if total >= 6 {
                        list.push(div().p_1().child(rexa_ui::TextInput::new(&search).h(32.)).into_any_element());
                    }
                    list.push(group_label("Access").into_any_element());
                    if matches("Default access") {
                        list.push(item(
                            "__default__".into(),
                            div().flex().flex_col().items_start().child("Default access").child(div().tw_text_xs().text_color(t.muted_foreground).child("Use the connection role with no impersonation.")).into_any_element(),
                            None,
                        ));
                    }
                    list.push(separator().into_any_element());
                    list.push(group_label("Role").into_any_element());
                    for role in ACCESS_ROLES.into_iter().filter(|r| matches(r)) {
                        let hint = match role {
                            "postgres" => "Bypass RLS as the database owner.",
                            "anon" => "Anonymous Data API role.",
                            _ => "Pick a signed-in auth user below.",
                        };
                        list.push(item(
                            format!("role:{role}"),
                            div()
                                .flex()
                                .flex_col()
                                .items_start()
                                .child(div().flex().items_center().gap_2().child(Icon::new(IconName::Shield).size(px(14.)).text_color(with_alpha(t.muted_foreground, 0.7))).child(role))
                                .child(div().pl_5().tw_text_xs().text_color(t.muted_foreground).child(hint))
                                .into_any_element(),
                            Some(PermissionContext::Role { role: role.into() }),
                        ));
                    }
                    list.push(separator().into_any_element());
                    list.push(group_label("Authenticated users").into_any_element());
                    if loading {
                        list.push(
                            div()
                                .px_3()
                                .py_2()
                                .tw_text_xs()
                                .text_color(t.muted_foreground)
                                .flex()
                                .items_center()
                                .gap_2()
                                .child(Icon::new(IconName::LoaderCircle).size(px(14.)))
                                .child("Loading auth users...")
                                .into_any_element(),
                        );
                    } else if !users.is_empty() {
                        for user in users.iter() {
                            let primary = [user.email.as_deref(), user.phone.as_deref(), Some(user.display_name.as_str()), Some(user.id.as_str())]
                                .into_iter()
                                .flatten()
                                .find(|s| !s.is_empty())
                                .unwrap_or_default()
                                .to_string();
                            if !matches(&primary) {
                                continue;
                            }
                            let role = if user.role.is_empty() { "authenticated".to_string() } else { user.role.clone() };
                            let secondary = if !user.display_name.is_empty() && user.display_name != primary { format!("{role} • {}", user.display_name) } else { role };
                            list.push(item(
                                format!("user:{}", user.id),
                                div()
                                    .flex()
                                    .min_w_0()
                                    .items_center()
                                    .gap_2()
                                    .child(Icon::new(IconName::Users).size(px(14.)).text_color(with_alpha(t.muted_foreground, 0.7)))
                                    .child(
                                        div()
                                            .flex()
                                            .min_w_0()
                                            .flex_col()
                                            .items_start()
                                            .child(div().max_w(px(220.)).truncate().child(primary))
                                            .child(div().max_w(px(220.)).truncate().tw_text_xs().text_color(t.muted_foreground).child(secondary)),
                                    )
                                    .into_any_element(),
                                Some(PermissionContext::from_user(user)),
                            ));
                        }
                    } else {
                        let hint = if supabase_mgmt {
                            "For Supabase Management connections, ensure the project has auth users and the access token was granted database scope. If this persists, connect with a direct `postgres://` string — it lists auth users reliably."
                        } else {
                            "Ensure the `auth` schema exists on this database."
                        };
                        list.push(
                            div()
                                .px_3()
                                .py_2()
                                .text_size(px(12.))
                                .line_height(px(19.5))
                                .text_color(t.muted_foreground)
                                .child("No auth.users found.")
                                .child(div().mt_1().child(hint))
                                .into_any_element(),
                        );
                    }
                    list.push(
                        div()
                            .border_t_1()
                            .border_color(t.studio_border)
                            .px_3()
                            .py_2()
                            .text_size(px(12.))
                            .line_height(px(19.5))
                            .text_color(t.muted_foreground)
                            .child("Choose postgres or anon for a role preview, or an authenticated user to apply their JWT claims to table reads.")
                            .into_any_element(),
                    );
                    div().id("permission-list").flex().flex_col().max_h(px(420.)).overflow_y_scroll().children(list)
                })
                .into_any_element(),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn role_context_sets_local_role() {
        let ctx = PermissionContext::Role { role: "anon".into() };
        assert_eq!(ctx.statements(), vec!["SET LOCAL ROLE \"anon\"".to_string()]);
        assert_eq!(ctx.key(), "role:anon");
    }

    #[test]
    fn user_context_sets_jwt_claims() {
        let user = AuthUser { id: "u1".into(), display_name: "ada".into(), email: Some("ada@example.com".into()), role: String::new(), ..Default::default() };
        let ctx = PermissionContext::from_user(&user);
        assert_eq!(ctx.label(), "ada@example.com");
        let s = ctx.statements();
        assert_eq!(s[0], "SET LOCAL ROLE \"authenticated\"");
        assert!(s[1].contains("request.jwt.claim.sub") && s[1].contains("'u1'"));
        assert!(s.iter().any(|x| x.contains("request.jwt.claim.email")));
        assert!(!s.iter().any(|x| x.contains("request.jwt.claim.phone")));
    }
}
