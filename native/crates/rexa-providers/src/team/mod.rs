//! Port of `components/team/*` and `app/team/*`: the workspace Team screen
//! (dashboard, roles, users, connections, pending queries, invites, audit and
//! query logs), the accept-invite flow and the `connect-studio` /
//! `manage-workspaces` tabs. Backed by [`api`], which talks to the workspace
//! (`studio-backend`) API the same way `lib/studio-backend/api-client.ts` does.

pub mod api;

use crate::common::{self, Col};
use gpui::{
    div, prelude::*, px, AnyElement, AnyView, App, AppContext, Context, Entity, FontWeight,
    SharedString, Subscription, Window,
};
use gpui_component::scroll::ScrollableElement;
use rexa_core::{navigate, Route, StudioEvent};
use rexa_ui::widgets::{InputEvent, InputState};
use rexa_ui::{
    with_alpha, ActiveTokens, Badge, BadgeVariant, Button, ButtonSize, IconName, Select,
    SelectOption, Tw,
};
use serde_json::{json, Value};

#[derive(Clone, Copy, PartialEq, Eq)]
enum Tab {
    Dashboard,
    Roles,
    Users,
    Connections,
    Pending,
    Invites,
    Audit,
    QueryLog,
}

impl Tab {
    const ALL: [Tab; 8] = [
        Tab::Dashboard,
        Tab::Roles,
        Tab::Users,
        Tab::Connections,
        Tab::Pending,
        Tab::Invites,
        Tab::Audit,
        Tab::QueryLog,
    ];

    fn label(self) -> &'static str {
        match self {
            Tab::Dashboard => "Dashboard",
            Tab::Roles => "Roles",
            Tab::Users => "Users",
            Tab::Connections => "Connections",
            Tab::Pending => "Pending",
            Tab::Invites => "Invites",
            Tab::Audit => "Audit Logs",
            Tab::QueryLog => "Query Logs",
        }
    }

    fn icon(self) -> IconName {
        match self {
            Tab::Dashboard => IconName::LayoutDashboard,
            Tab::Roles => IconName::Shield,
            Tab::Users => IconName::Users,
            Tab::Connections => IconName::Database,
            Tab::Pending => IconName::ClipboardCheck,
            Tab::Invites => IconName::Mail,
            Tab::Audit => IconName::ScrollText,
            Tab::QueryLog => IconName::FileText,
        }
    }
}

#[derive(Default)]
struct Loaded {
    roles: Vec<Value>,
    users: Vec<Value>,
    connections: Vec<Value>,
    pending: Vec<Value>,
    invites: Vec<Value>,
    audit: Vec<Value>,
    query_logs: Vec<Value>,
}

async fn fetch(auth: &api::Auth, tab: Tab) -> anyhow::Result<Loaded> {
    let mut out = Loaded::default();
    match tab {
        Tab::Dashboard => {
            out.roles = api::list(&api::get(auth, "/roles").await?);
            out.connections = api::list(&api::get(auth, "/connections").await?);
        }
        Tab::Roles => out.roles = api::list(&api::get(auth, "/roles").await?),
        Tab::Users => {
            out.roles = api::list(&api::get(auth, "/roles").await?);
            out.users = api::list(&api::get(auth, "/users").await?);
        }
        Tab::Connections => out.connections = api::list(&api::get(auth, "/connections").await?),
        Tab::Pending => {
            out.connections = api::list(&api::get(auth, "/connections").await?);
            for connection in out.connections.clone() {
                let id = api::text(&connection, "id");
                if id.is_empty() {
                    continue;
                }
                if let Ok(rows) =
                    api::get(auth, &format!("/connections/{id}/pending-queries")).await
                {
                    for mut row in api::list(&rows) {
                        if let Some(object) = row.as_object_mut() {
                            object.insert(
                                "connectionName".into(),
                                json!(api::text(&connection, "name")),
                            );
                        }
                        out.pending.push(row);
                    }
                }
            }
        }
        Tab::Invites => out.invites = api::list(&api::get(auth, "/invites").await?),
        Tab::Audit => out.audit = api::list(&api::get(auth, "/audit-logs").await?),
        Tab::QueryLog => out.query_logs = api::list(&api::get(auth, "/query-logs").await?),
    }
    Ok(out)
}

/// An action that needs an inline confirmation before it runs.
#[derive(Clone)]
enum Confirm {
    DeleteRole {
        id: String,
        name: String,
    },
    DeleteConnection {
        id: String,
        name: String,
    },
    RejectQuery {
        connection: String,
        id: String,
        label: String,
    },
}

pub struct TeamScreen {
    tab: Tab,
    auth: Option<api::Auth>,
    loading: bool,
    error: Option<String>,
    loaded: Loaded,
    invite_email: Entity<InputState>,
    invite_role: Option<String>,
    role_name: Entity<InputState>,
    role_desc: Entity<InputState>,
    busy: bool,
    confirm: Option<Confirm>,
    generation: u64,
    _subs: Vec<Subscription>,
}

impl TeamScreen {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let invite_email =
            cx.new(|cx| InputState::new(window, cx).placeholder("person@company.com"));
        let role_name = cx.new(|cx| InputState::new(window, cx).placeholder("e.g. Analyst"));
        let role_desc =
            cx.new(|cx| InputState::new(window, cx).placeholder("What can this role do?"));
        let subs = vec![
            cx.subscribe(&invite_email, |_, _, event: &InputEvent, cx| {
                if matches!(event, InputEvent::Change) {
                    cx.notify();
                }
            }),
            cx.subscribe(&role_name, |_, _, event: &InputEvent, cx| {
                if matches!(event, InputEvent::Change) {
                    cx.notify();
                }
            }),
        ];
        let mut this = Self {
            tab: Tab::Dashboard,
            auth: api::active(),
            loading: false,
            error: None,
            loaded: Loaded::default(),
            invite_email,
            invite_role: None,
            role_name,
            role_desc,
            busy: false,
            confirm: None,
            generation: 0,
            _subs: subs,
        };
        this.load(cx);
        this
    }

    fn reload_auth(&mut self) {
        self.auth = api::active();
    }

    fn load(&mut self, cx: &mut Context<Self>) {
        let Some(auth) = self.auth.clone().filter(|a| a.is_configured()) else {
            self.loading = false;
            cx.notify();
            return;
        };
        self.generation = self.generation.wrapping_add(1);
        let generation = self.generation;
        let tab = self.tab;
        self.loading = true;
        self.error = None;
        cx.notify();
        let task = rexa_core::runtime::spawn(async move { fetch(&auth, tab).await });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |this, cx| {
                if this.generation != generation {
                    return;
                }
                this.loading = false;
                match result {
                    Ok(data) => {
                        this.loaded = data;
                        this.error = None;
                    }
                    Err(error) => this.error = Some(format!("{error:#}")),
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    fn run_mutation(
        &mut self,
        label: &'static str,
        cx: &mut Context<Self>,
        fut: impl std::future::Future<Output = anyhow::Result<Value>> + Send + 'static,
    ) {
        self.busy = true;
        self.error = None;
        cx.notify();
        let task = rexa_core::runtime::spawn(fut);
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |this, cx| {
                this.busy = false;
                match result {
                    Ok(_) => {
                        rexa_ui::Toast::success(label).show(cx);
                    }
                    Err(error) => {
                        let message = format!("{error:#}");
                        this.error = Some(message.clone());
                        rexa_ui::Toast::error(message).show(cx);
                    }
                }
                this.load(cx);
            })
            .ok();
        })
        .detach();
    }

    fn switch(&mut self, tab: Tab, cx: &mut Context<Self>) {
        if self.tab == tab {
            return;
        }
        self.tab = tab;
        self.confirm = None;
        self.load(cx);
    }

    fn create_invite(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let email = self.invite_email.read(cx).value().trim().to_lowercase();
        if email.is_empty() {
            rexa_ui::Toast::error("Email is required").show(cx);
            return;
        }
        let role_id: Option<i64> = self
            .invite_role
            .clone()
            .or_else(|| self.loaded.roles.first().map(|r| api::text(r, "id")))
            .and_then(|id| id.parse().ok());
        let Some(auth) = self.auth.clone() else {
            return;
        };
        let body = json!({ "email": email, "roleId": role_id });
        self.invite_email.update(cx, |state, cx| {
            state.set_value("", window, cx);
        });
        self.run_mutation("Invite created", cx, async move {
            api::post(&auth, "/invites", body).await
        });
    }

    fn create_role(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let name = self.role_name.read(cx).value().trim().to_string();
        let description = self.role_desc.read(cx).value().trim().to_string();
        if name.is_empty() {
            rexa_ui::Toast::error("Role name is required").show(cx);
            return;
        }
        let Some(auth) = self.auth.clone() else {
            return;
        };
        self.role_name.update(cx, |state, cx| {
            state.set_value("", window, cx);
        });
        self.role_desc.update(cx, |state, cx| {
            state.set_value("", window, cx);
        });
        self.run_mutation("Role created", cx, async move {
            api::post(
                &auth,
                "/roles",
                json!({ "name": name, "description": description }),
            )
            .await
        });
    }

    fn approve(&mut self, connection: String, id: String, cx: &mut Context<Self>) {
        let Some(auth) = self.auth.clone() else {
            return;
        };
        let path = format!("/connections/{connection}/pending-queries/{id}/approve");
        self.run_mutation("Query approved", cx, async move {
            api::post(&auth, &path, json!({})).await
        });
    }

    fn confirmed(&mut self, action: Confirm, cx: &mut Context<Self>) {
        let Some(auth) = self.auth.clone() else {
            return;
        };
        self.confirm = None;
        match action {
            Confirm::DeleteRole { id, .. } => {
                self.run_mutation("Role deleted", cx, async move {
                    api::delete(&auth, &format!("/roles/{id}")).await
                });
            }
            Confirm::DeleteConnection { id, .. } => {
                self.run_mutation("Connection removed", cx, async move {
                    api::delete(&auth, &format!("/connections/{id}")).await
                });
            }
            Confirm::RejectQuery { connection, id, .. } => {
                let path = format!("/connections/{connection}/pending-queries/{id}/reject");
                self.run_mutation("Query rejected", cx, async move {
                    api::post(&auth, &path, json!({})).await
                });
            }
        }
    }

    // ── render ───────────────────────────────────────────────────────────

    fn render_header(&mut self, cx: &mut Context<Self>) -> AnyElement {
        let t = cx.tokens().clone();
        let url = self
            .auth
            .as_ref()
            .map(|a| a.url.clone())
            .unwrap_or_default();
        div()
            .flex()
            .items_center()
            .gap_3()
            .px_6()
            .py_4()
            .border_b_1()
            .border_color(t.border)
            .child(
                Button::new("team-back")
                    .ghost()
                    .size(ButtonSize::IconSm)
                    .icon(IconName::ArrowLeft)
                    .on_click(|_, _, cx| navigate(Route::Connections, cx)),
            )
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(2.))
                    .child(
                        div()
                            .tw_text_sm()
                            .font_weight(FontWeight::SEMIBOLD)
                            .child("Team"),
                    )
                    .child(div().tw_text_xs().text_color(t.muted_foreground).child(
                        if url.is_empty() {
                            "No workspace connected".to_string()
                        } else {
                            url
                        },
                    )),
            )
            .child(div().flex_1())
            .child(
                Button::new("team-settings")
                    .outline()
                    .size(ButtonSize::Sm)
                    .icon(IconName::Settings)
                    .label("Workspace settings")
                    .on_click(|_, _, cx| {
                        rexa_core::emit_studio(
                            StudioEvent::OpenSettings {
                                section: Some("workspace".into()),
                            },
                            cx,
                        );
                    }),
            )
            .child(
                Button::new("team-refresh")
                    .outline()
                    .size(ButtonSize::Sm)
                    .icon(IconName::RefreshCw)
                    .label(if self.loading {
                        "Loading…"
                    } else {
                        "Refresh"
                    })
                    .disabled(self.loading)
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.reload_auth();
                        this.load(cx);
                    })),
            )
            .into_any_element()
    }

    fn render_tabs(&self, cx: &mut Context<Self>) -> AnyElement {
        let t = cx.tokens().clone();
        let pending_count = self
            .loaded
            .pending
            .iter()
            .filter(|q| api::text(q, "status") == "PENDING")
            .count();
        let mut bar = div()
            .flex()
            .items_center()
            .gap_1()
            .px_4()
            .border_b_1()
            .border_color(t.border);
        for tab in Tab::ALL {
            let active = self.tab == tab;
            bar = bar.child(
                div()
                    .id(SharedString::from(format!("team-tab-{}", tab.label())))
                    .flex()
                    .items_center()
                    .gap_2()
                    .h_10()
                    .px_3()
                    .tw_text_sm()
                    .cursor_pointer()
                    .when(active, |d| {
                        d.text_color(t.foreground)
                            .border_b_2()
                            .border_color(t.primary)
                    })
                    .when(!active, |d| {
                        d.text_color(t.muted_foreground)
                            .hover(|d| d.text_color(t.foreground))
                    })
                    .child(rexa_ui::widgets::Icon::new(tab.icon()).size(px(14.)))
                    .child(tab.label())
                    .when(tab == Tab::Pending && pending_count > 0, |d| {
                        d.child(
                            Badge::new(pending_count.to_string()).variant(BadgeVariant::Warning),
                        )
                    })
                    .on_click(cx.listener(move |this, _, _, cx| this.switch(tab, cx))),
            );
        }
        bar.into_any_element()
    }

    fn render_dashboard(&self, cx: &mut Context<Self>) -> AnyElement {
        let t = cx.tokens().clone();
        let user_count: u64 = self
            .loaded
            .roles
            .iter()
            .map(|r| api::num(r, "userCount"))
            .sum();
        let role_count = self.loaded.roles.len();
        let connection_count = self.loaded.connections.len();
        let stat = |label: &'static str, value: u64, icon: IconName| {
            div()
                .flex_1()
                .min_w(px(160.))
                .flex()
                .items_center()
                .gap_3()
                .p_4()
                .tw_rounded_lg()
                .border_1()
                .border_color(t.border)
                .bg(t.muted)
                .child(
                    rexa_ui::widgets::Icon::new(icon)
                        .size(px(24.))
                        .text_color(t.primary),
                )
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .child(
                            div()
                                .tw_text_sm()
                                .font_weight(FontWeight::BOLD)
                                .child(value.to_string()),
                        )
                        .child(
                            div()
                                .tw_text_xs()
                                .text_color(t.muted_foreground)
                                .child(label),
                        ),
                )
        };
        let recent: Vec<AnyElement> = self
            .loaded
            .connections
            .iter()
            .take(5)
            .map(|c| {
                div()
                    .flex()
                    .items_center()
                    .gap_3()
                    .h_10()
                    .px_3()
                    .border_b_1()
                    .border_color(with_alpha(t.border, 0.6))
                    .child(
                        rexa_ui::widgets::Icon::new(IconName::Database)
                            .size(px(14.))
                            .text_color(t.muted_foreground),
                    )
                    .child(
                        div()
                            .flex_1()
                            .truncate()
                            .tw_text_sm()
                            .child(api::text(c, "name")),
                    )
                    .child(
                        div()
                            .tw_text_xs()
                            .text_color(t.muted_foreground)
                            .child(api::text(c, "type")),
                    )
                    .into_any_element()
            })
            .collect();
        div()
            .id("team-dashboard")
            .flex_1()
            .min_h_0()
            .overflow_y_scrollbar()
            .p_6()
            .flex()
            .flex_col()
            .gap_5()
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap_1()
                    .child(
                        div()
                            .tw_text_sm()
                            .font_weight(FontWeight::SEMIBOLD)
                            .child("Overview"),
                    )
                    .child(
                        div()
                            .tw_text_xs()
                            .text_color(t.muted_foreground)
                            .child("Users, roles and connections in this workspace."),
                    ),
            )
            .child(
                div()
                    .flex()
                    .gap_4()
                    .child(stat("Users", user_count, IconName::Users))
                    .child(stat("Roles", role_count as u64, IconName::Shield))
                    .child(stat(
                        "Connections",
                        connection_count as u64,
                        IconName::Database,
                    )),
            )
            .child(
                div()
                    .tw_rounded_lg()
                    .border_1()
                    .border_color(t.border)
                    .overflow_hidden()
                    .child(
                        div()
                            .px_3()
                            .py_2()
                            .bg(t.muted)
                            .tw_text_xs()
                            .text_color(t.muted_foreground)
                            .child("Recent connections"),
                    )
                    .when(recent.is_empty(), |d| {
                        d.child(
                            div()
                                .p_6()
                                .text_center()
                                .tw_text_xs()
                                .text_color(t.muted_foreground)
                                .child("No connections in this workspace yet."),
                        )
                    })
                    .children(recent),
            )
            .into_any_element()
    }

    fn render_roles(&mut self, cx: &mut Context<Self>) -> AnyElement {
        let t = cx.tokens().clone();
        let roles = self.loaded.roles.clone();
        let mut rows = Vec::new();
        for role in roles {
            let id = api::text(&role, "id");
            let name = api::text(&role, "name");
            let description = api::text(&role, "description");
            let users = api::num(&role, "userCount");
            let system = role
                .get("isSystem")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let perms = role
                .get("permissions")
                .and_then(Value::as_array)
                .map(|list| {
                    list.iter()
                        .filter_map(|p| p.get("name").and_then(Value::as_str))
                        .collect::<Vec<_>>()
                        .join(", ")
                })
                .unwrap_or_default();
            let delete_id = id.clone();
            let delete_name = name.clone();
            rows.push(vec![
                div()
                    .flex()
                    .items_center()
                    .gap_2()
                    .truncate()
                    .font_weight(FontWeight::MEDIUM)
                    .child(name.clone())
                    .when(system, |d| {
                        d.child(Badge::new("System").variant(BadgeVariant::Outline))
                    })
                    .into_any_element(),
                common::muted(description, cx),
                div()
                    .truncate()
                    .tw_text_xs()
                    .text_color(t.muted_foreground)
                    .child(if perms.is_empty() {
                        "—".to_string()
                    } else {
                        perms
                    })
                    .into_any_element(),
                div()
                    .tw_text_xs()
                    .text_color(t.muted_foreground)
                    .child(users.to_string())
                    .into_any_element(),
                div()
                    .flex()
                    .justify_end()
                    .child(
                        Button::new(SharedString::from(format!("team-role-del-{id}")))
                            .ghost()
                            .size(ButtonSize::IconSm)
                            .icon(IconName::Trash)
                            .disabled(system || self.busy)
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.confirm = Some(Confirm::DeleteRole {
                                    id: delete_id.clone(),
                                    name: delete_name.clone(),
                                });
                                cx.notify();
                            })),
                    )
                    .into_any_element(),
            ]);
        }
        div()
            .flex_1()
            .min_h_0()
            .overflow_y_scrollbar()
            .flex()
            .flex_col()
            .child(
                common::toolbar()
                    .child(
                        div()
                            .w(px(200.))
                            .child(rexa_ui::TextInput::new(&self.role_name)),
                    )
                    .child(
                        div()
                            .flex_1()
                            .child(rexa_ui::TextInput::new(&self.role_desc)),
                    )
                    .child(
                        Button::new("team-role-create")
                            .size(ButtonSize::Sm)
                            .icon(IconName::Plus)
                            .label("Create role")
                            .disabled(self.busy)
                            .on_click(
                                cx.listener(|this, _, window, cx| this.create_role(window, cx)),
                            ),
                    ),
            )
            .child(common::list_table(
                &[
                    Col::new("Role"),
                    Col::new("Description"),
                    Col::new("Permissions"),
                    Col::w("Users", 90.),
                    Col::right("", 56.),
                ],
                rows,
                common::empty(
                    IconName::Shield,
                    "No roles yet",
                    "Create a role to control what team members can do.",
                    cx,
                ),
                cx,
            ))
            .into_any_element()
    }

    fn render_users(&mut self, cx: &mut Context<Self>) -> AnyElement {
        let t = cx.tokens().clone();
        let roles = self.loaded.roles.clone();
        let options: Vec<SelectOption> = roles
            .iter()
            .map(|r| SelectOption::new(api::text(r, "id"), api::text(r, "name")))
            .collect();
        let selected = self
            .invite_role
            .clone()
            .or_else(|| options.first().map(|o| o.value.to_string()));
        let mut rows = Vec::new();
        for user in self.loaded.users.clone() {
            let id = api::text(&user, "id");
            let name = api::text(&user, "name");
            let email = api::text(&user, "email");
            let role = user
                .get("role")
                .map(|r| api::text(r, "name"))
                .filter(|r| !r.is_empty())
                .unwrap_or_else(|| format!("#{}", api::text(&user, "roleId")));
            let active = user
                .get("isActive")
                .and_then(Value::as_bool)
                .unwrap_or(true);
            let created = common::time_ago(&api::text(&user, "createdAt"));
            rows.push(vec![
                div()
                    .flex()
                    .items_center()
                    .gap_2()
                    .min_w_0()
                    .child(
                        div()
                            .size(px(24.))
                            .tw_rounded_lg()
                            .bg(t.muted)
                            .flex()
                            .items_center()
                            .justify_center()
                            .tw_text_xs()
                            .child(
                                name.chars()
                                    .next()
                                    .map(|c| c.to_uppercase().to_string())
                                    .unwrap_or_else(|| "?".into()),
                            ),
                    )
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .min_w_0()
                            .child(div().truncate().tw_text_sm().child(if name.is_empty() {
                                email.clone()
                            } else {
                                name
                            }))
                            .child(
                                div()
                                    .truncate()
                                    .tw_text_xs()
                                    .text_color(t.muted_foreground)
                                    .child(email.clone()),
                            ),
                    )
                    .into_any_element(),
                div().tw_text_xs().child(role).into_any_element(),
                div()
                    .child(
                        Badge::new(if active { "Active" } else { "Inactive" }).variant(if active {
                            BadgeVariant::Success
                        } else {
                            BadgeVariant::Outline
                        }),
                    )
                    .into_any_element(),
                common::muted(created, cx),
                div()
                    .tw_text_xs()
                    .text_color(with_alpha(t.muted_foreground, 0.6))
                    .child(id.chars().take(8).collect::<String>())
                    .into_any_element(),
            ]);
        }
        let invite_row = div()
            .flex()
            .items_center()
            .gap_2()
            .px_6()
            .py_3()
            .child(
                div()
                    .w(px(240.))
                    .child(rexa_ui::TextInput::new(&self.invite_email)),
            )
            .child(
                Select::new("team-invite-role")
                    .options(options)
                    .value(selected)
                    .placeholder("Role")
                    .small()
                    .w(px(180.))
                    .on_change({
                        let entity = cx.entity();
                        move |value: SharedString, _, cx| {
                            entity.update(cx, |this, cx| {
                                this.invite_role = Some(value.to_string());
                                cx.notify();
                            });
                        }
                    }),
            )
            .child(
                Button::new("team-invite")
                    .size(ButtonSize::Sm)
                    .icon(IconName::Mail)
                    .label("Invite user")
                    .disabled(self.busy)
                    .on_click(cx.listener(|this, _, window, cx| this.create_invite(window, cx))),
            );
        div()
            .flex_1()
            .min_h_0()
            .overflow_y_scrollbar()
            .flex()
            .flex_col()
            .child(invite_row)
            .child(common::list_table(
                &[
                    Col::new("User"),
                    Col::w("Role", 160.),
                    Col::w("Status", 100.),
                    Col::w("Created", 110.),
                    Col::w("ID", 90.),
                ],
                rows,
                common::empty(
                    IconName::Users,
                    "No users yet",
                    "Invite a teammate to join this workspace.",
                    cx,
                ),
                cx,
            ))
            .into_any_element()
    }

    fn render_connections(&self, cx: &mut Context<Self>) -> AnyElement {
        let t = cx.tokens().clone();
        let mut rows = Vec::new();
        for connection in self.loaded.connections.clone() {
            let id = api::text(&connection, "id");
            let name = api::text(&connection, "name");
            let host = format!(
                "{}:{}",
                api::text(&connection, "host"),
                api::text(&connection, "port")
            );
            let delete_id = id.clone();
            let delete_name = name.clone();
            rows.push(vec![
                div()
                    .flex()
                    .items_center()
                    .gap_2()
                    .truncate()
                    .font_weight(FontWeight::MEDIUM)
                    .child(name)
                    .into_any_element(),
                div()
                    .tw_text_xs()
                    .text_color(t.muted_foreground)
                    .child(api::text(&connection, "type"))
                    .into_any_element(),
                common::muted(host, cx),
                common::muted(api::text(&connection, "database"), cx),
                common::muted(api::text(&connection, "createdBy"), cx),
                div()
                    .flex()
                    .justify_end()
                    .child(
                        Button::new(SharedString::from(format!("team-conn-del-{id}")))
                            .ghost()
                            .size(ButtonSize::IconSm)
                            .icon(IconName::Trash)
                            .disabled(self.busy)
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.confirm = Some(Confirm::DeleteConnection {
                                    id: delete_id.clone(),
                                    name: delete_name.clone(),
                                });
                                cx.notify();
                            })),
                    )
                    .into_any_element(),
            ]);
        }
        div()
            .flex_1()
            .min_h_0()
            .overflow_y_scrollbar()
            .flex()
            .flex_col()
            .child(common::section_title(
                "Connections shared with this workspace",
                cx,
            ))
            .child(common::list_table(
                &[
                    Col::new("Name"),
                    Col::w("Type", 100.),
                    Col::w("Host", 200.),
                    Col::w("Database", 140.),
                    Col::w("Created by", 130.),
                    Col::right("", 56.),
                ],
                rows,
                common::empty(
                    IconName::Database,
                    "No shared connections",
                    "Connections added to the workspace appear here.",
                    cx,
                ),
                cx,
            ))
            .into_any_element()
    }

    fn render_pending(&self, cx: &mut Context<Self>) -> AnyElement {
        let t = cx.tokens().clone();
        let mut rows = Vec::new();
        for query in self.loaded.pending.clone() {
            let id = api::text(&query, "id");
            let connection_id = api::text(&query, "connectionId");
            let connection_name = api::text(&query, "connectionName");
            let sql = api::text(&query, "sql");
            let status = api::text(&query, "status");
            let requested = query
                .get("requestedByUser")
                .map(|u| api::text(u, "name"))
                .filter(|n| !n.is_empty())
                .unwrap_or_else(|| api::text(&query, "requestedBy"));
            let created = common::time_ago(&api::text(&query, "createdAt"));
            let pending = status == "PENDING";
            rows.push(vec![
                div()
                    .truncate()
                    .font_family(rexa_ui::MONO)
                    .tw_text_xs()
                    .child(sql.clone())
                    .into_any_element(),
                div()
                    .truncate()
                    .tw_text_xs()
                    .child(connection_name)
                    .into_any_element(),
                div()
                    .truncate()
                    .tw_text_xs()
                    .child(requested)
                    .into_any_element(),
                div()
                    .child(
                        Badge::new(if status.is_empty() {
                            "PENDING".to_string()
                        } else {
                            status.clone()
                        })
                        .variant(if pending {
                            BadgeVariant::Warning
                        } else if status == "APPROVED" {
                            BadgeVariant::Success
                        } else {
                            BadgeVariant::Outline
                        }),
                    )
                    .into_any_element(),
                common::muted(created, cx),
                div()
                    .flex()
                    .justify_end()
                    .gap_1()
                    .when(pending, |d| {
                        let (approve_conn, approve_id) = (connection_id.clone(), id.clone());
                        let (reject_conn, reject_id, reject_label) =
                            (connection_id.clone(), id.clone(), sql.clone());
                        d.child(
                            Button::new(SharedString::from(format!("team-approve-{id}")))
                                .outline()
                                .size(ButtonSize::Sm)
                                .icon(IconName::Check)
                                .label("Approve")
                                .disabled(self.busy)
                                .on_click(cx.listener(move |this, _, _, cx| {
                                    this.approve(approve_conn.clone(), approve_id.clone(), cx)
                                })),
                        )
                        .child(
                            Button::new(SharedString::from(format!("team-reject-{id}")))
                                .ghost()
                                .size(ButtonSize::Sm)
                                .icon(IconName::X)
                                .disabled(self.busy)
                                .on_click(cx.listener(move |this, _, _, cx| {
                                    this.confirm = Some(Confirm::RejectQuery {
                                        connection: reject_conn.clone(),
                                        id: reject_id.clone(),
                                        label: reject_label.clone(),
                                    });
                                    cx.notify();
                                })),
                        )
                    })
                    .into_any_element(),
            ]);
        }
        let _ = t;
        div()
            .flex_1()
            .min_h_0()
            .overflow_y_scrollbar()
            .flex()
            .flex_col()
            .child(common::list_table(
                &[
                    Col::new("Query"),
                    Col::w("Connection", 160.),
                    Col::w("Requested by", 150.),
                    Col::w("Status", 110.),
                    Col::w("Created", 110.),
                    Col::right("", 180.),
                ],
                rows,
                common::empty(
                    IconName::ClipboardCheck,
                    "No pending queries",
                    "Queries waiting for approval will appear here.",
                    cx,
                ),
                cx,
            ))
            .into_any_element()
    }

    fn render_invites(&self, cx: &mut Context<Self>) -> AnyElement {
        let t = cx.tokens().clone();
        let mut rows = Vec::new();
        for invite in self.loaded.invites.clone() {
            let email = api::text(&invite, "email");
            let status = api::text(&invite, "status");
            let created_by = invite
                .get("createdBy")
                .map(|u| api::text(u, "name"))
                .filter(|n| !n.is_empty())
                .unwrap_or_else(|| "—".into());
            let expires = common::time_ago(&api::text(&invite, "expiresAt"));
            let id = api::text(&invite, "id");
            rows.push(vec![
                div()
                    .truncate()
                    .tw_text_sm()
                    .child(email)
                    .into_any_element(),
                div()
                    .child(
                        Badge::new(if status.is_empty() {
                            "PENDING".to_string()
                        } else {
                            status.clone()
                        })
                        .variant(match status.as_str() {
                            "ACCEPTED" => BadgeVariant::Success,
                            "EXPIRED" => BadgeVariant::Destructive,
                            _ => BadgeVariant::Warning,
                        }),
                    )
                    .into_any_element(),
                common::muted(created_by, cx),
                common::muted(expires, cx),
                common::muted(format!("#{id}"), cx),
            ]);
        }
        let _ = t;
        div()
            .flex_1()
            .min_h_0()
            .overflow_y_scrollbar()
            .flex()
            .flex_col()
            .child(common::list_table(
                &[
                    Col::new("Email"),
                    Col::w("Status", 120.),
                    Col::new("Invited by"),
                    Col::w("Expires", 120.),
                    Col::w("ID", 90.),
                ],
                rows,
                common::empty(
                    IconName::Mail,
                    "No invites yet",
                    "Invite teammates from the Users tab.",
                    cx,
                ),
                cx,
            ))
            .into_any_element()
    }

    fn render_audit(&self, cx: &mut Context<Self>) -> AnyElement {
        let t = cx.tokens().clone();
        let mut rows = Vec::new();
        for log in self.loaded.audit.clone() {
            let ts = log.get("ts").and_then(Value::as_i64).unwrap_or_default();
            let when = chrono::DateTime::from_timestamp_millis(ts)
                .map(|d| d.format("%Y-%m-%d %H:%M:%S").to_string())
                .unwrap_or_default();
            let method = api::text(&log, "method");
            let url = api::text(&log, "url");
            let status = log
                .get("status")
                .and_then(Value::as_i64)
                .unwrap_or_default();
            let user = log
                .get("user")
                .map(|u| api::text(u, "name"))
                .unwrap_or_default();
            rows.push(vec![
                common::muted(when, cx),
                div()
                    .font_family(rexa_ui::MONO)
                    .tw_text_xs()
                    .child(method)
                    .into_any_element(),
                div()
                    .truncate()
                    .font_family(rexa_ui::MONO)
                    .tw_text_xs()
                    .child(url)
                    .into_any_element(),
                div()
                    .child(Badge::new(status.to_string()).variant(if status < 300 {
                        BadgeVariant::Success
                    } else if status < 500 {
                        BadgeVariant::Warning
                    } else {
                        BadgeVariant::Destructive
                    }))
                    .into_any_element(),
                common::muted(user, cx),
            ]);
        }
        let _ = t;
        div()
            .flex_1()
            .min_h_0()
            .overflow_y_scrollbar()
            .flex()
            .flex_col()
            .child(common::list_table(
                &[
                    Col::w("Timestamp", 180.),
                    Col::w("Method", 90.),
                    Col::new("URL"),
                    Col::w("Status", 90.),
                    Col::new("User"),
                ],
                rows,
                common::empty(
                    IconName::ScrollText,
                    "No audit logs yet",
                    "Administrative actions in this workspace are recorded here.",
                    cx,
                ),
                cx,
            ))
            .into_any_element()
    }

    fn render_query_logs(&self, cx: &mut Context<Self>) -> AnyElement {
        let t = cx.tokens().clone();
        let mut rows = Vec::new();
        for log in self.loaded.query_logs.clone() {
            let sql = api::text(&log, "query");
            let connection = log
                .get("connection")
                .map(|c| api::text(c, "name"))
                .unwrap_or_default();
            let duration = log
                .get("duration")
                .and_then(Value::as_i64)
                .unwrap_or_default();
            let user = log
                .get("user")
                .map(|u| api::text(u, "name"))
                .unwrap_or_default();
            let at = common::time_ago(&api::text(&log, "executedAt"));
            rows.push(vec![
                div()
                    .truncate()
                    .font_family(rexa_ui::MONO)
                    .tw_text_xs()
                    .child(sql)
                    .into_any_element(),
                common::muted(connection, cx),
                div()
                    .tw_text_xs()
                    .child(format!("{duration}ms"))
                    .into_any_element(),
                common::muted(user, cx),
                common::muted(at, cx),
            ]);
        }
        let _ = t;
        div()
            .flex_1()
            .min_h_0()
            .overflow_y_scrollbar()
            .flex()
            .flex_col()
            .child(common::list_table(
                &[
                    Col::new("Query"),
                    Col::w("Connection", 160.),
                    Col::w("Duration", 100.),
                    Col::new("User"),
                    Col::w("Date", 110.),
                ],
                rows,
                common::empty(
                    IconName::FileText,
                    "No query logs yet",
                    "Queries run through this workspace are recorded here.",
                    cx,
                ),
                cx,
            ))
            .into_any_element()
    }

    fn render_confirm(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
        let action = self.confirm.clone()?;
        let t = cx.tokens().clone();
        let (title, confirm_label, destructive) = match &action {
            Confirm::DeleteRole { name, .. } => {
                (format!("Delete role “{name}”?"), "Delete role", true)
            }
            Confirm::DeleteConnection { name, .. } => (
                format!("Remove “{name}” from the workspace?"),
                "Remove",
                true,
            ),
            Confirm::RejectQuery { label, .. } => {
                let short: String = label.chars().take(60).collect();
                (format!("Reject “{short}”?"), "Reject", true)
            }
        };
        Some(
            div()
                .mx_6()
                .mt_3()
                .flex()
                .items_center()
                .gap_3()
                .p_3()
                .tw_rounded_lg()
                .border_1()
                .border_color(with_alpha(t.destructive, 0.35))
                .bg(with_alpha(t.destructive, 0.08))
                .child(
                    div()
                        .flex_1()
                        .tw_text_xs()
                        .text_color(t.foreground)
                        .child(title),
                )
                .child(
                    Button::new("team-confirm-cancel")
                        .ghost()
                        .size(ButtonSize::Sm)
                        .label("Cancel")
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.confirm = None;
                            cx.notify();
                        })),
                )
                .child(
                    Button::new("team-confirm-ok")
                        .size(ButtonSize::Sm)
                        .label(confirm_label)
                        .when(destructive, |b| b.destructive())
                        .disabled(self.busy)
                        .on_click(
                            cx.listener(move |this, _, _, cx| this.confirmed(action.clone(), cx)),
                        ),
                )
                .into_any_element(),
        )
    }

    fn render_body(&mut self, cx: &mut Context<Self>) -> AnyElement {
        if self.auth.as_ref().is_none_or(|a| !a.is_configured()) {
            return div()
                .flex_1()
                .flex()
                .flex_col()
                .items_center()
                .justify_center()
                .gap_3()
                .child(common::empty(
                    IconName::Server,
                    "No workspace connected",
                    "Connect a RexaDB workspace in Settings → Workspace, or accept an invite to create one.",
                    cx,
                ))
                .child(
                    Button::new("team-open-workspace")
                        .outline()
                        .size(ButtonSize::Sm)
                        .icon(IconName::Settings)
                        .label("Open workspace settings")
                        .on_click(|_, _, cx| {
                            rexa_core::emit_studio(StudioEvent::OpenSettings { section: Some("workspace".into()) }, cx);
                        }),
                )
                .into_any_element();
        }
        if let Some(error) = self.error.clone() {
            return div()
                .flex_1()
                .flex()
                .flex_col()
                .child(common::error_box(error, cx))
                .child(
                    Button::new("team-retry")
                        .outline()
                        .size(ButtonSize::Sm)
                        .label("Retry")
                        .on_click(cx.listener(|this, _, _, cx| this.load(cx))),
                )
                .into_any_element();
        }
        if self.loading && self.loaded_is_empty() {
            return common::loading("Loading workspace…", cx);
        }
        match self.tab {
            Tab::Dashboard => self.render_dashboard(cx),
            Tab::Roles => self.render_roles(cx),
            Tab::Users => self.render_users(cx),
            Tab::Connections => self.render_connections(cx),
            Tab::Pending => self.render_pending(cx),
            Tab::Invites => self.render_invites(cx),
            Tab::Audit => self.render_audit(cx),
            Tab::QueryLog => self.render_query_logs(cx),
        }
    }

    fn loaded_is_empty(&self) -> bool {
        self.loaded.roles.is_empty()
            && self.loaded.users.is_empty()
            && self.loaded.connections.is_empty()
            && self.loaded.pending.is_empty()
            && self.loaded.invites.is_empty()
            && self.loaded.audit.is_empty()
            && self.loaded.query_logs.is_empty()
    }
}

impl Render for TeamScreen {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        let header = self.render_header(cx);
        let tabs = self.render_tabs(cx);
        let confirm = self.render_confirm(cx);
        let body = self.render_body(cx);
        div()
            .size_full()
            .flex()
            .flex_col()
            .bg(t.background)
            .text_color(t.foreground)
            .child(header)
            .child(tabs)
            .children(confirm)
            .child(body)
    }
}

// ── accept invite ────────────────────────────────────────────────────────

pub struct AcceptInvite {
    step_url: bool,
    studio_url: Entity<InputState>,
    token: Entity<InputState>,
    name: Entity<InputState>,
    email: Entity<InputState>,
    busy: bool,
    error: Option<String>,
    done: bool,
    _subs: Vec<Subscription>,
}

impl AcceptInvite {
    fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let studio_url = cx.new(|cx| {
            InputState::new(window, cx)
                .default_value("http://localhost:3000")
                .placeholder("https://studio.example.com")
        });
        let token = cx.new(|cx| InputState::new(window, cx).placeholder("Paste the invite token"));
        let name = cx.new(|cx| InputState::new(window, cx).placeholder("Your name"));
        let email = cx.new(|cx| InputState::new(window, cx).placeholder("you@company.com"));
        Self {
            step_url: true,
            studio_url,
            token,
            name,
            email,
            busy: false,
            error: None,
            done: false,
            _subs: Vec::new(),
        }
    }

    fn accept(&mut self, cx: &mut Context<Self>) {
        let url = self.studio_url.read(cx).value().trim().to_string();
        let token = self.token.read(cx).value().trim().to_string();
        let name = self.name.read(cx).value().trim().to_string();
        let email = self.email.read(cx).value().trim().to_string();
        if token.is_empty() || name.is_empty() || email.is_empty() {
            self.error = Some("All fields are required.".into());
            cx.notify();
            return;
        }
        self.busy = true;
        self.error = None;
        cx.notify();
        let task = rexa_core::runtime::spawn(async move {
            api::accept_invite(&url, &token, &name, &email).await
        });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |this, cx| {
                this.busy = false;
                match result {
                    Ok(_) => {
                        this.done = true;
                        rexa_ui::Toast::success("Connected to the workspace").show(cx);
                    }
                    Err(error) => this.error = Some(format!("{error:#}")),
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    fn input_row(label: &'static str, input: &Entity<InputState>) -> AnyElement {
        div()
            .flex()
            .flex_col()
            .gap_1()
            .child(
                div()
                    .tw_text_xs()
                    .font_weight(FontWeight::MEDIUM)
                    .child(label),
            )
            .child(rexa_ui::TextInput::new(input))
            .into_any_element()
    }
}

impl Render for AcceptInvite {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        let body = if self.done {
            div()
                .flex()
                .flex_col()
                .items_center()
                .gap_4()
                .child(
                    rexa_ui::widgets::Icon::new(IconName::CircleCheck)
                        .size(px(36.))
                        .text_color(t.primary),
                )
                .child(
                    div()
                        .tw_text_sm()
                        .font_weight(FontWeight::SEMIBOLD)
                        .child("You're connected"),
                )
                .child(
                    div()
                        .tw_text_xs()
                        .text_color(t.muted_foreground)
                        .child("The workspace is now available on the Team screen."),
                )
                .child(
                    Button::new("accept-open-team")
                        .size(ButtonSize::Sm)
                        .label("Open Team")
                        .on_click(|_, _, cx| navigate(Route::Team, cx)),
                )
                .into_any_element()
        } else if self.step_url {
            div()
                .flex()
                .flex_col()
                .gap_4()
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .gap_1()
                        .child(
                            div()
                                .tw_text_sm()
                                .font_weight(FontWeight::SEMIBOLD)
                                .child("Connect to a workspace"),
                        )
                        .child(div().tw_text_xs().text_color(t.muted_foreground).child(
                            "Enter the URL of the RexaDB studio backend you were invited to.",
                        )),
                )
                .child(Self::input_row("Studio URL", &self.studio_url))
                .child(
                    Button::new("accept-next")
                        .size(ButtonSize::Sm)
                        .label("Continue")
                        .on_click(cx.listener(|this, _, _, cx| {
                            let url =
                                api::trim_url(&this.studio_url.read(cx).value().trim().to_string());
                            if url.is_empty() {
                                this.error = Some("Enter your studio backend URL.".into());
                            } else {
                                this.step_url = false;
                                this.error = None;
                            }
                            cx.notify();
                        })),
                )
                .into_any_element()
        } else {
            div()
                .flex()
                .flex_col()
                .gap_3()
                .child(
                    div()
                        .tw_text_sm()
                        .font_weight(FontWeight::SEMIBOLD)
                        .child("Accept invite"),
                )
                .child(Self::input_row("Invite token", &self.token))
                .child(Self::input_row("Name", &self.name))
                .child(Self::input_row("Email", &self.email))
                .child(
                    Button::new("accept-submit")
                        .size(ButtonSize::Sm)
                        .label(if self.busy {
                            "Connecting…"
                        } else {
                            "Accept invite"
                        })
                        .disabled(self.busy)
                        .on_click(cx.listener(|this, _, _, cx| this.accept(cx))),
                )
                .child(
                    div()
                        .id("accept-change-url")
                        .tw_text_xs()
                        .text_color(t.muted_foreground)
                        .cursor_pointer()
                        .hover(|d| d.text_color(t.foreground))
                        .child("Change studio URL")
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.step_url = true;
                            cx.notify();
                        })),
                )
                .into_any_element()
        };
        div()
            .size_full()
            .flex()
            .items_center()
            .justify_center()
            .bg(t.background)
            .text_color(t.foreground)
            .child(
                div()
                    .w(px(420.))
                    .flex()
                    .flex_col()
                    .gap_4()
                    .p_6()
                    .tw_rounded_xl()
                    .border_1()
                    .border_color(t.border)
                    .bg(t.studio_bg)
                    .children(self.error.clone().map(|error| common::error_box(error, cx)))
                    .child(body),
            )
    }
}

// ── workspace tabs (connect-studio / manage-workspaces) ──────────────────

pub struct Workspaces {
    configured: bool,
    list: Vec<Value>,
}

impl Workspaces {
    pub fn new(_window: &mut Window, _cx: &mut Context<Self>) -> Self {
        Self {
            configured: api::active().is_some_and(|a| a.is_configured()),
            list: api::workspaces(),
        }
    }

    fn reload(&mut self, cx: &mut Context<Self>) {
        self.configured = api::active().is_some_and(|a| a.is_configured());
        self.list = api::workspaces();
        cx.notify();
    }

    fn activate(&mut self, ws: &Value, cx: &mut Context<Self>) {
        let url = api::text(ws, "studioUrl");
        let token = api::text(ws, "studioToken");
        let user = api::text(ws, "userId");
        match api::save_config(&url, &token, &user) {
            Ok(()) => {
                rexa_ui::Toast::success("Workspace activated").show(cx);
            }
            Err(error) => {
                rexa_ui::Toast::error(format!("{error:#}")).show(cx);
            }
        }
        self.reload(cx);
    }

    fn remove(&mut self, url: &str, cx: &mut Context<Self>) {
        let mut list = api::workspaces();
        list.retain(|w| api::text(w, "studioUrl") != url);
        if let Err(error) = api::save_workspaces(&list) {
            rexa_ui::Toast::error(format!("{error:#}")).show(cx);
        }
        self.reload(cx);
    }
}

impl Render for Workspaces {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        let rows: Vec<AnyElement> = self
            .list
            .iter()
            .map(|ws| {
                let url = api::text(ws, "studioUrl");
                let name = api::text(ws, "name");
                let active = self.configured
                    && api::active().is_some_and(|a| api::trim_url(&a.url) == api::trim_url(&url));
                let (activate_ws, remove_url) = (ws.clone(), url.clone());
                div()
                    .flex()
                    .items_center()
                    .gap_3()
                    .px_6()
                    .h(px(48.))
                    .border_b_1()
                    .border_color(with_alpha(t.border, 0.6))
                    .child(
                        rexa_ui::widgets::Icon::new(IconName::Server)
                            .size(px(16.))
                            .text_color(t.muted_foreground),
                    )
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .flex_1()
                            .min_w_0()
                            .child(div().truncate().tw_text_sm().child(if name.is_empty() {
                                url.clone()
                            } else {
                                name
                            }))
                            .child(
                                div()
                                    .truncate()
                                    .tw_text_xs()
                                    .text_color(t.muted_foreground)
                                    .child(url.clone()),
                            ),
                    )
                    .when(active, |d| {
                        d.child(Badge::new("Active").variant(BadgeVariant::Success))
                    })
                    .child(
                        Button::new(SharedString::from(format!("ws-activate-{url}")))
                            .outline()
                            .size(ButtonSize::Sm)
                            .label("Activate")
                            .disabled(active)
                            .on_click(
                                cx.listener(move |this, _, _, cx| this.activate(&activate_ws, cx)),
                            ),
                    )
                    .child(
                        Button::new(SharedString::from(format!("ws-remove-{url}")))
                            .ghost()
                            .size(ButtonSize::IconSm)
                            .icon(IconName::Trash)
                            .on_click(
                                cx.listener(move |this, _, _, cx| this.remove(&remove_url, cx)),
                            ),
                    )
                    .into_any_element()
            })
            .collect();
        div()
            .size_full()
            .flex()
            .flex_col()
            .bg(t.background)
            .text_color(t.foreground)
            .child(common::header("Workspaces", "Saved studio backends. Activate one to use its Team screen and shared connections.", cx))
            .child(common::toolbar().child(
                Button::new("ws-connect")
                    .size(ButtonSize::Sm)
                    .icon(IconName::Plus)
                    .label("Connect workspace")
                    .on_click(|_, _, cx| navigate(Route::ConnectionScreen("accept-invite".into()), cx)),
            ).child(
                Button::new("ws-team")
                    .outline()
                    .size(ButtonSize::Sm)
                    .label("Open Team")
                    .on_click(|_, _, cx| navigate(Route::Team, cx)),
            ))
            .child(if rows.is_empty() {
                common::empty(IconName::Server, "No workspaces saved", "Connect a workspace to collaborate with your team.", cx)
            } else {
                div().flex_1().min_h_0().overflow_y_scrollbar().children(rows).into_any_element()
            })
    }
}

/// Route + tab registration for this module.
pub fn build_screen(route: &Route, window: &mut Window, cx: &mut App) -> Option<AnyView> {
    match route {
        Route::Team => Some(cx.new(|cx| TeamScreen::new(window, cx)).into()),
        Route::ConnectionScreen(screen) if screen == "accept-invite" || screen == "team-invite" => {
            Some(cx.new(|cx| AcceptInvite::new(window, cx)).into())
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tab_labels_are_unique() {
        let mut labels: Vec<&str> = Tab::ALL.iter().map(|t| t.label()).collect();
        labels.sort();
        labels.dedup();
        assert_eq!(labels.len(), Tab::ALL.len());
    }
}
