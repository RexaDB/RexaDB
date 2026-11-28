//! Port of the provider account screens and their stores/clients:
//! components/{supabase,spacetimedb,neon,planetscale}/*-account-screen.tsx,
//! components/shared/provider-accounts/* (header, empty state, account chips,
//! list toolbar, resource rows), the *-login-dialog.tsx dialogs, and
//! lib/{supabase-mgmt,spacetimedb-mgmt,neon-cli,neon-oauth,planetscale}
//! (token stores, list APIs, `register*` importers, connection-string builders).
//!
//! Accounts live where the old app kept them (localStorage keys below); they
//! are read from `app_settings` first, then migrated from WebKit localStorage.

use crate::fields::encode_component;
use crate::widgets::{self, FieldInput};
use gpui::{div, img, prelude::*, px, svg, AnyElement, App, Context, Entity, EventEmitter, FontWeight, SharedString, Window};
use gpui_component::input::InputState;
use gpui_component::Icon;
use aes_gcm::{aead::{Aead, KeyInit}, Aes256Gcm};
use ring::{agreement, digest, rand::{SecureRandom, SystemRandom}};
use rexa_store::{ConnectionDraft, Store, WebStore};
use rexa_ui::theme::{with_alpha, Tokens};
use rexa_ui::{toast, ActiveTokens, Button, ButtonSize, IconName, Tw, MONO};
use serde_json::Value;

/// lib/planetscale/auth.ts
pub const PLANETSCALE_LOGIN_ENABLED: bool = true;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AccountKind {
    Supabase,
    SpacetimeDb,
    Neon,
    Planetscale,
}

impl AccountKind {
    pub fn from_screen(s: &str) -> Option<Self> {
        Some(match s {
            "supabase" => Self::Supabase,
            "spacetimedb-account" | "spacetimedb" => Self::SpacetimeDb,
            "neon-cli" | "neon" => Self::Neon,
            "planetscale-account" | "planetscale" => Self::Planetscale,
            _ => return None,
        })
    }
    fn key(self) -> &'static str {
        match self {
            Self::Supabase => "rexadb-supabase-mgmt-accounts",
            Self::SpacetimeDb => "rexadb-spacetimedb-mgmt-accounts",
            Self::Neon => "rexadb-neon-cli-profiles",
            Self::Planetscale => "rexadb-planetscale-accounts",
        }
    }
    fn title(self) -> &'static str {
        match self {
            Self::Supabase => "Supabase",
            Self::SpacetimeDb => "SpacetimeDB",
            Self::Neon => "Neon",
            Self::Planetscale => "PlanetScale",
        }
    }
    fn description(self) -> &'static str {
        match self {
            Self::Supabase => "Browse, connect, and import your Supabase projects.",
            Self::SpacetimeDb => "Browse, connect, and import your SpacetimeDB databases.",
            Self::Neon => "Browse and connect your Neon projects, branches and databases.",
            Self::Planetscale => "Browse and connect your PlanetScale databases and branches.",
        }
    }
    fn noun(self) -> &'static str {
        match self {
            Self::Supabase | Self::Neon => "projects",
            _ => "databases",
        }
    }
}

pub fn logo(kind: AccountKind, size: f32, cx: &App) -> AnyElement {
    match kind {
        AccountKind::Supabase => img("brand/supabase.svg").size(px(size * 0.78)).into_any_element(),
        AccountKind::Neon => img("brand/neon.svg").size(px(size * 0.72)).into_any_element(),
        AccountKind::SpacetimeDb => svg().path("brand/spacetimedb.svg").size(px(size)).text_color(cx.tokens().foreground).into_any_element(),
        AccountKind::Planetscale => img("providers/planetscale.png").size(px(size)).into_any_element(),
    }
}

/// Raw account objects for `kind` (app_settings first, then localStorage).
pub fn load_accounts(kind: AccountKind) -> Vec<Value> {
    let from_settings = Store::open().ok().and_then(|s| s.setting(kind.key()).ok().flatten());
    let raw = from_settings.or_else(|| WebStore::open()?.get(kind.key()).ok().flatten());
    let mut list: Vec<Value> = raw.and_then(|r| serde_json::from_str::<Value>(&r).ok()).and_then(|v| v.as_array().cloned()).unwrap_or_default();
    // Migrate old plaintext account tokens to the OS keychain on first read.
    let mut migrated = false;
    for account in &mut list {
        let token_key = if kind == AccountKind::Neon || kind == AccountKind::Planetscale { "accessToken" } else { "token" };
        if let Some(token) = account.get(token_key).and_then(Value::as_str).filter(|s| !s.is_empty()).map(str::to_string) {
            match rexa_store::store_account_token(&token) {
                Ok(reference) => {
                    if let Some(object) = account.as_object_mut() {
                        object.remove(token_key);
                        object.insert("credentialRef".into(), Value::String(reference));
                    }
                    migrated = true;
                }
                Err(error) => eprintln!("Could not migrate provider token into the system keychain: {error:#}"),
            }
        }
        if let Some(reference) = account.get("credentialRef").and_then(Value::as_str) {
            match rexa_store::read_account_token(reference) {
                Ok(token) => { if let Some(object) = account.as_object_mut() { object.insert(token_key.into(), Value::String(token)); } }
                Err(error) => eprintln!("Could not read provider token from the system keychain: {error:#}"),
            }
        }
    }
    if migrated { if let Err(error) = save_accounts(kind, &list) { eprintln!("Could not persist migrated provider accounts: {error:#}"); } }
    // Drop entries whose token could not be resolved.
    let mut list: Vec<Value> = list.into_iter().filter(|a| {
        let token_key = if kind == AccountKind::Neon || kind == AccountKind::Planetscale { "accessToken" } else { "token" };
        a.get(token_key).and_then(Value::as_str).is_some_and(|s| !s.is_empty())
    }).collect();
    list.sort_by_key(|a| a.get("createdAt").and_then(Value::as_i64).unwrap_or(0));
    list
}

fn save_accounts(kind: AccountKind, list: &[Value]) -> anyhow::Result<()> {
    let mut stored = Vec::with_capacity(list.len());
    let mut keep = std::collections::HashSet::new();
    for account in list {
        let mut row = account.clone();
        let token_key = if kind == AccountKind::Neon || kind == AccountKind::Planetscale { "accessToken" } else { "token" };
        if let Some(token) = account.get(token_key).and_then(Value::as_str).filter(|s| !s.is_empty()) {
            let reference = match account.get("credentialRef").and_then(Value::as_str) {
                Some(reference) if rexa_store::read_account_token(reference).is_ok_and(|saved| saved == token) => reference.to_string(),
                _ => rexa_store::store_account_token(token)?,
            };
            keep.insert(reference.clone());
            let object = row.as_object_mut().ok_or_else(|| anyhow::anyhow!("Invalid account entry."))?;
            object.remove(token_key);
            object.insert("credentialRef".into(), Value::String(reference));
        }
        stored.push(row);
    }
    let previous = Store::open().ok().and_then(|s| s.setting(kind.key()).ok().flatten()).and_then(|r| serde_json::from_str::<Vec<Value>>(&r).ok()).unwrap_or_default();
    for reference in previous.iter().filter_map(|a| a.get("credentialRef").and_then(Value::as_str)) {
        if !keep.contains(reference) { let _ = rexa_store::delete_credential(reference); }
    }
    let store = Store::open()?;
    store.set_setting(kind.key(), &Value::Array(stored).to_string())?;
    Ok(())
}

fn s<'a>(v: &'a Value, k: &str) -> Option<&'a str> {
    v.get(k).and_then(Value::as_str).filter(|s| !s.is_empty())
}

fn account_label(kind: AccountKind, a: &Value) -> String {
    match kind {
        AccountKind::Supabase => s(a, "email").or(s(a, "name")).unwrap_or("Supabase account").into(),
        AccountKind::Planetscale => s(a, "email").or(s(a, "name")).unwrap_or("PlanetScale account").into(),
        AccountKind::Neon => s(a, "label").or(s(a, "profileName")).unwrap_or("Neon account").into(),
        AccountKind::SpacetimeDb => s(a, "identity").map(|i| format!("{}…", &i[..i.len().min(8)])).unwrap_or("SpacetimeDB account".into()),
    }
}

/// Header-button titles and new-select subtitles.
#[derive(Clone, Default)]
pub struct AccountSummary {
    pub supabase: Vec<String>,
    pub spacetimedb: Vec<String>,
    pub neon: Vec<String>,
    pub planetscale: Vec<String>,
}

impl AccountSummary {
    pub fn load() -> Self {
        let labels = |k| load_accounts(k).iter().map(|a| account_label(k, a)).collect();
        Self {
            supabase: labels(AccountKind::Supabase),
            spacetimedb: labels(AccountKind::SpacetimeDb),
            neon: labels(AccountKind::Neon),
            planetscale: labels(AccountKind::Planetscale),
        }
    }
    pub fn title(&self, kind: AccountKind) -> String {
        let list = match kind {
            AccountKind::Supabase => &self.supabase,
            AccountKind::SpacetimeDb => &self.spacetimedb,
            AccountKind::Neon => &self.neon,
            AccountKind::Planetscale => &self.planetscale,
        };
        match list.len() {
            1 if kind == AccountKind::SpacetimeDb => "SpacetimeDB — 1 account".into(),
            1 => format!("{} — {}", kind.title(), list[0]),
            n => format!("{} — {n} accounts", kind.title()),
        }
    }
    pub fn neon_label(&self) -> Option<String> {
        self.neon.first().cloned()
    }
}

pub enum AccountsEvent {
    Back,
    Changed,
}

#[derive(Clone)]
enum Connect {
    Ready { name: String, cs: String, kind: &'static str, key: String },
    Neon { profile: String, project_id: String, project: String },
    Planetscale { org: String, database: String, kind: String },
}

#[derive(Clone)]
struct Resource {
    group: String,
    title: String,
    subtitle: String,
    status: Option<(String, bool)>,
    connect: Connect,
    external: Option<String>,
}

pub struct AccountsScreen {
    kind: AccountKind,
    accounts: Vec<Value>,
    active: Option<usize>,
    existing: Vec<String>,
    search: Entity<InputState>,
    resources: Vec<Resource>,
    loading: bool,
    error: Option<String>,
    importing: bool,
    connecting: Option<String>,
    /// Neon project id / PlanetScale database name whose branches are shown.
    expanded: Option<String>,
    branches: std::collections::HashMap<String, Vec<Value>>,
    branches_loading: Option<String>,
    /// `connectingBranchId` / `connectingBranch`.
    connecting_branch: Option<String>,
    _sub: gpui::Subscription,
}

/// Neon "Connect to database" dialog state (`connectDialog`).
struct NeonPick {
    profile: String,
    project_id: String,
    project: String,
    branch: Value,
    databases: Vec<String>,
    roles: Vec<String>,
}

impl EventEmitter<AccountsEvent> for AccountsScreen {}

impl AccountsScreen {
    pub fn new(kind: AccountKind, existing: Vec<String>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let placeholder = format!("Search {}...", kind.noun());
        let search = cx.new(|cx| InputState::new(window, cx).placeholder(placeholder));
        let sub = cx.observe(&search, |_, _, cx| cx.notify());
        let accounts = load_accounts(kind);
        let mut this = Self {
            kind,
            active: (!accounts.is_empty()).then_some(0),
            accounts,
            existing,
            search,
            resources: Vec::new(),
            loading: false,
            error: None,
            importing: false,
            connecting: None,
            expanded: None,
            branches: Default::default(),
            branches_loading: None,
            connecting_branch: None,
            _sub: sub,
        };
        this.load(cx);
        this
    }

    fn active_account(&self) -> Option<Value> {
        self.active.and_then(|i| self.accounts.get(i).cloned())
    }

    fn load(&mut self, cx: &mut Context<Self>) {
        let Some(account) = self.active_account() else {
            self.resources.clear();
            return;
        };
        self.loading = true;
        self.error = None;
        cx.notify();
        let kind = self.kind;
        let task = rexa_core::runtime::spawn(async move { list_resources(kind, &account).await });
        cx.spawn(async move |this, cx| {
            let res = task.await;
            this.update(cx, |this, cx| {
                this.loading = false;
                match res {
                    Ok(r) => this.resources = r,
                    Err(e) => {
                        this.resources.clear();
                        this.error = Some(format!("{e:#}"));
                    }
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    fn is_connected(&self, key: &str) -> bool {
        self.existing.iter().any(|cs| connection_key(self.kind, cs).as_deref() == Some(key))
    }

    fn create(&mut self, name: &str, cs: &str, kind: &str, cx: &App) -> bool {
        let vault = rexa_core::credential_vault(cx);
        let ok = Store::open()
            .and_then(|s| s.create_connection_with_vault(ConnectionDraft { name: Some(name.into()), connection_string: Some(cs.into()), connection_type: Some(kind.into()), ..Default::default() }, vault.as_deref()))
            .is_ok();
        if ok {
            self.existing.push(cs.into());
        }
        ok
    }

    fn connect(&mut self, r: Resource, cx: &mut Context<Self>) {
        match r.connect.clone() {
            Connect::Ready { name, cs, kind, key } => {
                if self.is_connected(&key) {
                    return;
                }
                if self.create(&name, &cs, kind, cx) {
                    toast::success(format!("Connected to {name}"), cx);
                    cx.emit(AccountsEvent::Changed);
                } else {
                    toast::error("Failed to create connection.", cx);
                }
                cx.notify();
            }
            other => {
                let Some(account) = self.active_account() else { return };
                self.connecting = Some(r.title.clone());
                cx.notify();
                let task = rexa_core::runtime::spawn(async move { resolve_connect(&other, &account).await });
                cx.spawn(async move |this, cx| {
                    let res = task.await;
                    this.update(cx, |this, cx| {
                        this.connecting = None;
                        match res {
                            Ok((name, cs, kind)) => {
                                if this.existing.iter().any(|e| *e == cs) {
                                    toast::info("This database and role are already connected.", cx);
                                } else if this.create(&name, &cs, kind, cx) {
                                    toast::success(format!("Connected to {name}"), cx);
                                    cx.emit(AccountsEvent::Changed);
                                } else {
                                    toast::error("Failed to create connection.", cx);
                                }
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
    }

    /// The expandable key of a Neon project / PlanetScale database row.
    fn branch_scope(r: &Resource) -> Option<String> {
        match &r.connect {
            Connect::Neon { project_id, .. } => Some(project_id.clone()),
            Connect::Planetscale { org, database, .. } => Some(format!("{org}/{database}")),
            Connect::Ready { .. } => None,
        }
    }

    /// `toggleProject` / `toggleDatabase`: expand and lazily `listBranches`.
    fn toggle_branches(&mut self, r: Resource, cx: &mut Context<Self>) {
        let Some(scope) = Self::branch_scope(&r) else { return };
        if self.expanded.as_deref() == Some(scope.as_str()) {
            self.expanded = None;
            cx.notify();
            return;
        }
        self.expanded = Some(scope.clone());
        cx.notify();
        if self.branches.contains_key(&scope) {
            return;
        }
        let Some(account) = self.active_account() else { return };
        self.branches_loading = Some(scope.clone());
        let connect = r.connect.clone();
        let task = rexa_core::runtime::spawn(async move { list_branches(&connect, &account).await });
        cx.spawn(async move |this, cx| {
            let res = task.await;
            this.update(cx, |this, cx| {
                this.branches_loading = None;
                match res {
                    Ok(list) => {
                        this.branches.insert(scope, list);
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

    fn add_connection(&mut self, name: String, cs: String, kind: &'static str, cx: &mut Context<Self>) {
        if self.existing.iter().any(|e| *e == cs) {
            toast::info("This database and role are already connected.", cx);
        } else if self.create(&name, &cs, kind, cx) {
            toast::success(format!("Connected to {name}"), cx);
            cx.emit(AccountsEvent::Changed);
        } else {
            toast::error("Failed to create connection.", cx);
        }
        cx.notify();
    }

    /// `handleConnectBranch` (Neon: databases × roles, picker when ambiguous;
    /// PlanetScale: mint a branch password).
    fn connect_branch(&mut self, r: Resource, branch: Value, window: &mut Window, cx: &mut Context<Self>) {
        let Some(account) = self.active_account() else { return };
        let st = |v: &Value, k: &str| v.get(k).and_then(Value::as_str).unwrap_or("").to_string();
        let branch_key = match &r.connect {
            Connect::Planetscale { database, .. } => format!("{database}/{}", st(&branch, "name")),
            _ => st(&branch, "id"),
        };
        self.connecting_branch = Some(branch_key);
        cx.notify();
        match r.connect.clone() {
            Connect::Neon { profile, project_id, project } => {
                let (acct, pid, bid) = (account.clone(), project_id.clone(), st(&branch, "id"));
                let task = rexa_core::runtime::spawn(async move { neon_databases_and_roles(&acct, &pid, &bid).await });
                cx.spawn_in(window, async move |this, cx| {
                    let res = task.await;
                    this.update_in(cx, |this, window, cx| {
                        this.connecting_branch = None;
                        cx.notify();
                        let (databases, roles) = match res {
                            Ok(v) => v,
                            Err(e) => {
                                toast::error(format!("{e:#}"), cx);
                                return;
                            }
                        };
                        if databases.is_empty() || roles.is_empty() {
                            toast::error("This branch has no database/role to connect to.", cx);
                            return;
                        }
                        let pick = NeonPick { profile, project_id, project, branch, databases, roles };
                        let available = pick.databases.iter().flat_map(|d| pick.roles.iter().map(move |r| (d.clone(), r.clone()))).find(|(d, r)| !this.existing.iter().any(|e| *e == pick.connection_string(d, r)));
                        let Some((db, role)) = available else {
                            toast::info("All database and role combinations are already connected.", cx);
                            return;
                        };
                        if pick.databases.len() == 1 && pick.roles.len() == 1 {
                            let (name, cs) = (pick.name(&db, &role), pick.connection_string(&db, &role));
                            this.add_connection(name, cs, "neon", cx);
                            return;
                        }
                        this.open_neon_picker(pick, db, role, window, cx);
                    })
                    .ok();
                })
                .detach();
            }
            Connect::Planetscale { org, database, kind } => {
                let task = rexa_core::runtime::spawn(async move { planetscale_branch_connection(&account, &org, &database, &kind, &branch).await });
                cx.spawn(async move |this, cx| {
                    let res = task.await;
                    this.update(cx, |this, cx| {
                        this.connecting_branch = None;
                        match res {
                            Ok((name, cs, kind)) => this.add_connection(name, cs, kind, cx),
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
            Connect::Ready { .. } => {
                self.connecting_branch = None;
            }
        }
    }

    /// The "Connect to database" dialog (Database / Role selects).
    fn open_neon_picker(&mut self, pick: NeonPick, db: String, role: String, _window: &mut Window, cx: &mut Context<Self>) {
        let weak = cx.entity().downgrade();
        let existing = self.existing.clone();
        let pick = std::rc::Rc::new(pick);
        let nonce = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or_default();
        rexa_ui::open_dialog(cx, move |window, cx| {
            let t = cx.tokens().clone();
            let sel = window.use_keyed_state(gpui::SharedString::from(format!("neon-pick-{nonce}")), cx, {
                let (db, role) = (db.clone(), role.clone());
                move |_, _| (db, role)
            });
            let (cur_db, cur_role) = sel.read(cx).clone();
            let exists = existing.iter().any(|e| *e == pick.connection_string(&cur_db, &cur_role));
            let field = |label: &'static str, id: &'static str, options: &[String], value: String, set_db: bool| {
                let sel = sel.clone();
                div()
                    .flex()
                    .flex_col()
                    .gap(px(6.))
                    .child(div().tw_text_xs().font_weight(FontWeight::MEDIUM).text_color(t.muted_foreground).child(label))
                    .child(
                        rexa_ui::Select::new(id)
                            .w_full()
                            .placeholder(if set_db { "Select a database" } else { "Select a role" })
                            .options(options.iter().map(|o| rexa_ui::SelectOption::simple(o.clone())))
                            .value(Some(value))
                            .on_change(move |v, _, cx| {
                                sel.update(cx, |s, cx| {
                                    if set_db {
                                        s.0 = v.to_string();
                                    } else {
                                        s.1 = v.to_string();
                                    }
                                    cx.notify();
                                });
                            }),
                    )
            };
            let (p2, w2) = (pick.clone(), weak.clone());
            let (d2, r2) = (cur_db.clone(), cur_role.clone());
            rexa_ui::Dialog::new()
                .max_w(448.)
                .title("Connect to database")
                .description(format!("{} · {}", pick.project, pick.branch.get("name").and_then(Value::as_str).unwrap_or("")))
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .gap_4()
                        .child(field("Database", "neon-pick-db", &pick.databases, cur_db.clone(), true))
                        .when(pick.roles.len() > 1, |d| d.child(field("Role", "neon-pick-role", &pick.roles, cur_role.clone(), false)))
                        .when(exists, |d| d.child(div().tw_text_xs().text_color(t.muted_foreground).child("This database and role are already connected."))),
                )
                .footer(Button::new("neon-pick-cancel").outline().size(ButtonSize::Sm).label("Cancel").on_click(|_, _, cx| rexa_ui::close_top(cx)))
                .footer(Button::new("neon-pick-connect").size(ButtonSize::Sm).label("Connect").disabled(cur_db.is_empty() || cur_role.is_empty() || exists).on_click(move |_, _, cx| {
                    rexa_ui::close_top(cx);
                    let (name, cs) = (p2.name(&d2, &r2), p2.connection_string(&d2, &r2));
                    w2.update(cx, |this, cx| this.add_connection(name, cs, "neon", cx)).ok();
                }))
        });
    }

    fn branch_rows(&self, r: &Resource, t: &Tokens, cx: &mut Context<Self>) -> Option<AnyElement> {
        let scope = Self::branch_scope(r)?;
        if self.expanded.as_deref() != Some(scope.as_str()) {
            return None;
        }
        let st = |v: &Value, k: &str| v.get(k).and_then(Value::as_str).unwrap_or("").to_string();
        let body: AnyElement = if self.branches_loading.as_deref() == Some(scope.as_str()) {
            div().flex().items_center().justify_center().py_5().child(rexa_ui::Spinner::new(16.)).into_any_element()
        } else {
            let list = self.branches.get(&scope).cloned().unwrap_or_default();
            if list.is_empty() {
                div().py_3().tw_text_xs().text_color(t.muted_foreground).child("No branches found.").into_any_element()
            } else {
                let neon = matches!(r.connect, Connect::Neon { .. });
                div()
                    .flex()
                    .flex_col()
                    .gap(px(2.))
                    .children(list.into_iter().enumerate().map(|(i, b)| {
                        let (badge, key) = if neon {
                            (b.get("default").and_then(Value::as_bool) == Some(true), st(&b, "id"))
                        } else {
                            let db = match &r.connect {
                                Connect::Planetscale { database, .. } => database.clone(),
                                _ => String::new(),
                            };
                            (b.get("production").and_then(Value::as_bool) == Some(true), format!("{db}/{}", st(&b, "name")))
                        };
                        let connected = if neon {
                            let bid = st(&b, "id");
                            self.existing.iter().filter(|e| neon_pointer_branch(e).as_deref() == Some(bid.as_str())).count()
                        } else {
                            0
                        };
                        let busy = self.connecting_branch.as_deref() == Some(key.as_str());
                        let disabled = if neon { self.connecting_branch.is_some() } else { busy };
                        let (res, branch) = (r.clone(), b.clone());
                        div()
                            .flex()
                            .items_center()
                            .gap(px(10.))
                            .rounded(px(6.))
                            .px_2()
                            .py(px(6.))
                            .hover(|s| s.bg(with_alpha(t.studio_row_hover, 0.5)))
                            .child(Icon::new(IconName::GitBranch).size(px(14.)).flex_shrink_0().text_color(t.muted_foreground))
                            .child(
                                div()
                                    .min_w_0()
                                    .flex_1()
                                    .flex()
                                    .items_baseline()
                                    .tw_text_xs()
                                    .child(div().font_weight(FontWeight::MEDIUM).child(st(&b, "name")))
                                    .when(badge, |d| d.child(div().ml(px(6.)).text_size(px(10.)).text_color(t.muted_foreground).child(if neon { "default" } else { "production" }))),
                            )
                            .when(connected > 0, |d| {
                                d.child(
                                    div()
                                        .flex_shrink_0()
                                        .rounded_full()
                                        .border_1()
                                        .border_color(with_alpha(t.primary, 0.2))
                                        .bg(with_alpha(t.primary, 0.1))
                                        .px_2()
                                        .py(px(2.))
                                        .text_size(px(10.))
                                        .font_weight(FontWeight::MEDIUM)
                                        .text_color(t.primary)
                                        .child(format!("{connected} connected")),
                                )
                            })
                            .child(
                                Button::new(("branch-connect", i))
                                    .size(ButtonSize::Xs)
                                    .when(busy, |b| b.icon(IconName::LoaderCircle))
                                    .label("Connect")
                                    .disabled(disabled)
                                    .on_click(cx.listener(move |this, _, window, cx| this.connect_branch(res.clone(), branch.clone(), window, cx))),
                            )
                    }))
                    .into_any_element()
            }
        };
        Some(div().ml(px(52.)).border_l_1().border_color(with_alpha(t.studio_border, 0.5)).py_1().pl_3().child(body).into_any_element())
    }

    /// `registerActiveSupabaseProjects` / `registerSpacetimeDbDatabases`.
    fn import_all(&mut self, cx: &mut Context<Self>) {
        self.importing = true;
        let (mut imported, mut already, mut failed) = (0, 0, 0);
        let mut nameless = 0;
        for r in self.resources.clone() {
            if let Connect::Ready { name, cs, kind, key } = &r.connect {
                if self.kind == AccountKind::Supabase && !r.status.as_ref().is_some_and(|(_, active)| *active || r.status.as_ref().unwrap().0 == "Starting") {
                    continue;
                }
                if name.is_empty() {
                    nameless += 1;
                    continue;
                }
                if self.is_connected(key) {
                    already += 1;
                } else if self.create(name, cs, kind, cx) {
                    imported += 1;
                } else {
                    failed += 1;
                }
            }
        }
        self.importing = false;
        let (noun, active) = if self.kind == AccountKind::Supabase { ("projects", "active ") } else { ("databases", "") };
        let total = imported + already + if self.kind == AccountKind::SpacetimeDb { nameless } else { 0 };
        if imported > 0 {
            toast::success(format!("Imported {imported} of {total} {active}{noun}"), cx);
            cx.emit(AccountsEvent::Changed);
        } else if already > 0 {
            toast::info(format!("All {active}{noun} are already connected."), cx);
        } else if failed > 0 {
            toast::error(format!("Failed to import {noun}."), cx);
        } else {
            toast::info(format!("No {active}{noun} to import."), cx);
        }
        cx.notify();
    }

    fn remove_account(&mut self, i: usize, cx: &mut Context<Self>) {
        if i >= self.accounts.len() {
            return;
        }
        let mut next = self.accounts.clone();
        next.remove(i);
        if let Err(error) = save_accounts(self.kind, &next) { toast::error(format!("Could not remove account: {error:#}"), cx); return; }
        self.accounts = next;
        self.active = (!self.accounts.is_empty()).then_some(0);
        cx.emit(AccountsEvent::Changed);
        self.load(cx);
        cx.notify();
    }

    fn open_login(&mut self, cx: &mut Context<Self>) {
        let kind = self.kind;
        let weak = cx.entity().downgrade();
        rexa_ui::open_dialog(cx, move |window, cx| {
            let title = format!("Connect {} account", kind.title());
            let token_hint = match kind {
                AccountKind::Supabase => "Create a management access token in Supabase account settings.",
                AccountKind::SpacetimeDb => "Sign in with your browser, or paste an identity token for a self-hosted server.",
                AccountKind::Neon => "Create an API key in the Neon console. It stays on this device.",
                AccountKind::Planetscale => "Create a service token with database and branch access in PlanetScale settings.",
            };
            let token = cx.new(|cx| InputState::new(window, cx).masked(true).placeholder("Access token"));
            let label = cx.new(|cx| InputState::new(window, cx).placeholder("Account name or email"));
            let host = cx.new(|cx| InputState::new(window, cx).placeholder("maincloud.spacetimedb.com"));
            let token2 = token.clone();
            let label2 = label.clone();
            let host2 = host.clone();
            let weak = weak.clone();
            rexa_ui::Dialog::new()
                .max_w(384.)
                .title(title)
                .description(token_hint)
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .gap_3()
                        .pt_2()
                        .when(kind == AccountKind::SpacetimeDb, {
                            let weak = weak.clone();
                            move |d| d.child(Button::new("stdb-browser-login").size(ButtonSize::Lg).w_full().label("Continue with browser").on_click(move |_, _, cx| {
                                weak.update(cx, |this, cx| this.start_spacetimedb_login(cx)).ok();
                                rexa_ui::close_top(cx);
                            }))
                        })
                        .when(kind == AccountKind::Supabase, {
                            let weak = weak.clone();
                            move |d| d.child(Button::new("supabase-browser-login").size(ButtonSize::Lg).w_full().label("Continue with browser").on_click(move |_, _, cx| {
                                match supabase_login_session() {
                                    Ok((session_id, login_url, private_key)) => {
                                        cx.open_url(&login_url);
                                        rexa_ui::close_top(cx);
                                        open_supabase_code_dialog(session_id, private_key, weak.clone(), cx);
                                    }
                                    Err(error) => { toast::error(format!("Could not start Supabase sign-in: {error:#}"), cx); }
                                }
                            }))
                        })
                        .when(kind == AccountKind::Supabase, |d| d.child(div().py_1().text_center().tw_text_xs().text_color(cx.tokens().muted_foreground).child("Or connect with a management token")))
                        .when(kind == AccountKind::Neon, {
                            let weak = weak.clone();
                            move |d| d.child(Button::new("neon-browser-login").size(ButtonSize::Lg).w_full().label("Continue with browser").on_click(move |_, _, cx| {
                                weak.update(cx, |this, cx| this.start_neon_login(cx)).ok();
                                rexa_ui::close_top(cx);
                            }))
                        })
                        .when(kind == AccountKind::Neon, |d| d.child(div().py_1().text_center().tw_text_xs().text_color(cx.tokens().muted_foreground).child("Or connect with an API key")))
                        .when(kind == AccountKind::SpacetimeDb, |d| d.child(div().py_1().text_center().tw_text_xs().text_color(cx.tokens().muted_foreground).child("Or connect with a token")))
                        .child(FieldInput::new(&token))
                        .child(FieldInput::new(&label))
                        .when(kind == AccountKind::SpacetimeDb, |d| d.child(FieldInput::new(&host)))
                        .child(Button::new("login-save").size(ButtonSize::Lg).w_full().label("Save and connect").on_click(move |_, _, cx| {
                            let secret = token2.read(cx).value().trim().to_string();
                            if secret.is_empty() { toast::error("Enter an access token.", cx); return; }
                            let account_name = label2.read(cx).value().trim().to_string();
                            let mut account = serde_json::Map::new();
                            account.insert("createdAt".into(), Value::from(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis() as i64)));
                            match kind {
                                AccountKind::Supabase => { account.insert("token".into(), Value::String(secret)); account.insert("name".into(), Value::String(account_name)); }
                                AccountKind::SpacetimeDb => { account.insert("token".into(), Value::String(secret)); account.insert("host".into(), Value::String(host2.read(cx).value().trim().to_string())); }
                                AccountKind::Neon => { account.insert("accessToken".into(), Value::String(secret)); account.insert("profileName".into(), Value::String(format!("native-{}", uuid::Uuid::new_v4().simple()))); account.insert("label".into(), Value::String(if account_name.is_empty() { "Neon account".into() } else { account_name })); }
                                AccountKind::Planetscale => { account.insert("accessToken".into(), Value::String(secret)); account.insert("name".into(), Value::String(account_name)); }
                            }
                            weak.update(cx, |this, cx| {
                                let mut next = this.accounts.clone();
                                next.push(Value::Object(account));
                                next.sort_by_key(|a| a.get("createdAt").and_then(Value::as_i64).unwrap_or(0));
                                if let Err(error) = save_accounts(kind, &next) { toast::error(format!("Could not save account token: {error:#}"), cx); return; }
                                this.accounts = next;
                                this.active = Some(this.accounts.len().saturating_sub(1));
                                cx.emit(AccountsEvent::Changed);
                                this.load(cx);
                                cx.notify();
                            }).ok();
                            rexa_ui::close_top(cx);
                        })),
                )
        });
    }

    fn start_spacetimedb_login(&mut self, cx: &mut Context<Self>) {
        let request = rexa_core::runtime::spawn(spacetimedb_login_request());
        toast::info("Opening SpacetimeDB sign-in in your browser…", cx);
        cx.spawn(async move |this, cx| {
            let result = match request.await {
                Ok((request_token, login_url)) => {
                    cx.update(|cx| cx.open_url(&login_url));
                    rexa_core::runtime::spawn(async move { spacetimedb_login_poll(&request_token).await }).await
                }
                Err(error) => Err(error),
            };
            this.update(cx, |this, cx| {
                match result {
                    Ok(token) => {
                        let mut account = serde_json::Map::new();
                        account.insert("createdAt".into(), Value::from(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis() as i64)));
                        account.insert("token".into(), Value::String(token.clone()));
                        account.insert("host".into(), Value::String("maincloud.spacetimedb.com".into()));
                        if let Some(identity) = stdb_identity(&token) { account.insert("identity".into(), Value::String(identity)); }
                        let mut next = this.accounts.clone();
                        next.push(Value::Object(account));
                        next.sort_by_key(|a| a.get("createdAt").and_then(Value::as_i64).unwrap_or(0));
                        if let Err(error) = save_accounts(AccountKind::SpacetimeDb, &next) {
                            toast::error(format!("Could not save account token: {error:#}"), cx);
                            return;
                        }
                        this.accounts = next;
                        this.active = Some(this.accounts.len().saturating_sub(1));
                        cx.emit(AccountsEvent::Changed);
                        this.load(cx);
                        toast::success("SpacetimeDB account connected", cx);
                    }
                    Err(error) => { toast::error(format!("SpacetimeDB sign-in failed: {error:#}"), cx); }
                }
                cx.notify();
            }).ok();
        }).detach();
    }

    fn finish_supabase_login(&mut self, session_id: String, private_key: agreement::EphemeralPrivateKey, code: String, cx: &mut Context<Self>) {
        let request = rexa_core::runtime::spawn(supabase_login_exchange(session_id, code, private_key));
        let weak = cx.entity().downgrade();
        cx.spawn(async move |_, cx| {
            let result = request.await;
            weak.update(cx, |this, cx| match result {
                Ok(token) => {
                    let mut account = serde_json::Map::new();
                    account.insert("createdAt".into(), Value::from(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis() as i64)));
                    account.insert("token".into(), Value::String(token));
                    account.insert("name".into(), Value::String("Supabase account".into()));
                    let mut next = this.accounts.clone();
                    next.push(Value::Object(account));
                    next.sort_by_key(|a| a.get("createdAt").and_then(Value::as_i64).unwrap_or(0));
                    if let Err(error) = save_accounts(AccountKind::Supabase, &next) {
                        toast::error(format!("Could not save Supabase account: {error:#}"), cx);
                        return;
                    }
                    this.accounts = next;
                    this.active = Some(this.accounts.len().saturating_sub(1));
                    cx.emit(AccountsEvent::Changed);
                    this.load(cx);
                    toast::success("Supabase account connected", cx);
                }
                Err(error) => { toast::error(format!("Supabase sign-in failed: {error:#}. Start browser sign-in again to retry."), cx); }
            }).ok();
        }).detach();
    }

    fn start_neon_login(&mut self, cx: &mut Context<Self>) {
        let weak = cx.entity().downgrade();
        toast::info("Starting Neon sign-in in your browser…", cx);
        let prepare = rexa_core::runtime::spawn(neon_auth_prepare());
        cx.spawn(async move |_, cx| {
            let result = match prepare.await {
                Ok(flow) => {
                    let auth_url = flow.auth_url.clone();
                    cx.update(|cx| cx.open_url(&auth_url));
                    rexa_core::runtime::spawn(neon_auth_finish(flow)).await
                }
                Err(error) => Err(error),
            };
            weak.update(cx, |this, cx| match result {
                Ok(credentials) => {
                    let profile = format!("rexadb-{}", uuid::Uuid::new_v4().simple());
                    let label = credentials.get("email").and_then(Value::as_str).unwrap_or("Neon account").to_string();
                    let mut account = serde_json::Map::new();
                    account.insert("createdAt".into(), Value::from(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis() as i64)));
                    account.insert("accessToken".into(), Value::String(credentials.to_string()));
                    account.insert("profileName".into(), Value::String(profile));
                    account.insert("label".into(), Value::String(label));
                    let mut next = this.accounts.clone();
                    next.push(Value::Object(account));
                    next.sort_by_key(|a| a.get("createdAt").and_then(Value::as_i64).unwrap_or(0));
                    if let Err(error) = save_accounts(AccountKind::Neon, &next) {
                        toast::error(format!("Could not save Neon credentials: {error:#}"), cx);
                        return;
                    }
                    this.accounts = next;
                    this.active = Some(this.accounts.len().saturating_sub(1));
                    cx.emit(AccountsEvent::Changed);
                    this.load(cx);
                    toast::success("Neon account connected", cx);
                }
                Err(error) => { toast::error(format!("Neon sign-in failed: {error:#}"), cx); }
            }).ok();
        }).detach();
    }

    // ---- rendering ---------------------------------------------------------------------

    fn header(&self, t: &Tokens, cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .mb_5()
            .flex()
            .items_center()
            .justify_between()
            .gap_4()
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap_3()
                    .child(
                        div()
                            .id("acct-back")
                            .flex()
                            .h_8()
                            .flex_shrink_0()
                            .items_center()
                            .gap(px(6.))
                            .tw_rounded_lg()
                            .px_2()
                            .tw_text_sm()
                            .text_color(t.muted_foreground)
                            .cursor_pointer()
                            .hover(|s| s.bg(with_alpha(t.muted, 0.6)).text_color(t.foreground))
                            .on_click(cx.listener(|_, _, _, cx| cx.emit(AccountsEvent::Back)))
                            .child(Icon::new(IconName::ArrowLeft).size_4())
                            .child("Back"),
                    )
                    .child(
                        div()
                            .flex()
                            .size(px(44.))
                            .flex_shrink_0()
                            .items_center()
                            .justify_center()
                            .tw_rounded_xl()
                            .border_1()
                            .border_color(t.studio_border)
                            .bg(with_alpha(t.studio_bg, 0.6))
                            .child(logo(self.kind, 22., cx)),
                    )
                    .child(
                        div()
                            .child(div().text_size(px(15.)).line_height(px(22.)).font_weight(FontWeight::SEMIBOLD).child(rexa_ui::tight(self.kind.title())))
                            .child(div().tw_text_xs().text_color(t.muted_foreground).child(self.kind.description())),
                    ),
            )
    }

    fn empty_state(&self, t: &Tokens, cx: &mut Context<Self>) -> impl IntoElement {
        let (title, desc, action) = match self.kind {
            AccountKind::Supabase => ("No Supabase account linked", "Log in with your Supabase (supabase.com) account to browse your projects and connect them here.", "Log in to Supabase"),
            AccountKind::SpacetimeDb => ("No SpacetimeDB account linked", "Log in with your SpacetimeDB account to browse your databases and connect them here.", "Log in to SpacetimeDB"),
            AccountKind::Neon => ("No Neon account linked", "Sign in with your Neon account to browse your projects and connect them here.", "Sign in to Neon"),
            AccountKind::Planetscale => ("No PlanetScale account linked", "Log in with your PlanetScale account to browse your databases and connect them here.", "Log in to PlanetScale"),
        };
        div()
            .flex()
            .flex_col()
            .items_center()
            .justify_center()
            .rounded(px(16.))
            .border_1()
            .border_dashed()
            .border_color(with_alpha(t.studio_border, 0.6))
            .bg(with_alpha(t.studio_bg, 0.4))
            .px_6()
            .py_16()
            .child(
                div()
                    .mb_4()
                    .flex()
                    .size_16()
                    .items_center()
                    .justify_center()
                    .rounded(px(16.))
                    .border_1()
                    .border_color(t.studio_border)
                    .bg(with_alpha(t.studio_bg, 0.6))
                    .child(logo(self.kind, 22., cx)),
            )
            .child(div().tw_text_sm().font_weight(FontWeight::SEMIBOLD).child(title))
            .child(div().mt(px(6.)).max_w(px(384.)).text_center().tw_text_xs().line_height(px(19.5)).text_color(t.muted_foreground).child(desc))
            .child(div().mt_5().child(Button::new("acct-empty-login").size(ButtonSize::Lg).icon(IconName::Plus).label(action).on_click(cx.listener(|this, _, _, cx| this.open_login(cx)))))
    }

    fn chips(&self, t: &Tokens, cx: &mut Context<Self>) -> impl IntoElement {
        let mut row = div().mb_5().flex().flex_wrap().items_center().gap_2();
        for (i, a) in self.accounts.iter().enumerate() {
            let active = self.active == Some(i);
            let label = account_label(self.kind, a);
            let initial = label.chars().next().map(|c| c.to_uppercase().to_string()).unwrap_or("?".into());
            let gid = SharedString::from(format!("chip-{i}"));
            row = row.child(
                div()
                    .id(gid.clone())
                    .group(gid.clone())
                    .flex()
                    .h_8()
                    .items_center()
                    .gap_2()
                    .rounded_full()
                    .border_1()
                    .pl(px(6.))
                    .pr_3()
                    .tw_text_xs()
                    .cursor_pointer()
                    .when(active, |d| d.border_color(with_alpha(t.primary, 0.5)).bg(with_alpha(t.primary, 0.1)).text_color(t.foreground))
                    .when(!active, |d| {
                        d.border_color(with_alpha(t.studio_border, 0.6))
                            .bg(with_alpha(t.studio_bg, 0.6))
                            .text_color(t.muted_foreground)
                            .hover(|s| s.border_color(t.studio_border).text_color(t.foreground))
                    })
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.active = Some(i);
                        this.load(cx);
                    }))
                    .child(
                        div()
                            .flex()
                            .size_5()
                            .flex_shrink_0()
                            .items_center()
                            .justify_center()
                            .rounded_full()
                            .tw_text_10()
                            .font_weight(FontWeight::SEMIBOLD)
                            .when(active, |d| d.bg(with_alpha(t.primary, 0.2)).text_color(t.primary))
                            .when(!active, |d| d.bg(with_alpha(t.muted, 0.7)).text_color(t.muted_foreground))
                            .child(initial),
                    )
                    .child(div().max_w(px(256.)).overflow_hidden().text_ellipsis().whitespace_nowrap().font_weight(FontWeight::MEDIUM).child(label))
                    .child(
                        div()
                            .id(("chip-rm", i))
                            .mr(px(-4.))
                            .flex()
                            .size_4()
                            .items_center()
                            .justify_center()
                            .rounded_full()
                            .text_color(with_alpha(t.muted_foreground, 0.7))
                            .opacity(0.)
                            .group_hover(gid, |s| s.opacity(1.))
                            .hover(|s| s.bg(with_alpha(t.destructive, 0.15)).text_color(t.destructive))
                            .on_click(cx.listener(move |this, _, _, cx| {
                                cx.stop_propagation();
                                this.remove_account(i, cx);
                            }))
                            .child(Icon::new(IconName::X).size(px(10.))),
                    ),
            );
        }
        row.child(
            div()
                .id("chip-add")
                .flex()
                .h_8()
                .items_center()
                .gap(px(6.))
                .rounded_full()
                .border_1()
                .border_dashed()
                .border_color(with_alpha(t.studio_border, 0.7))
                .px_3()
                .tw_text_xs()
                .text_color(t.muted_foreground)
                .cursor_pointer()
                .hover(|s| s.border_color(t.studio_border).text_color(t.foreground))
                .on_click(cx.listener(|this, _, _, cx| this.open_login(cx)))
                .child(Icon::new(IconName::Plus).size_3())
                .child(format!("Add {} account", self.kind.title())),
        )
    }

    fn resource_row(&self, i: usize, r: &Resource, t: &Tokens, cx: &mut Context<Self>) -> impl IntoElement {
        let key = match &r.connect {
            Connect::Ready { key, .. } => Some(key.clone()),
            _ => None,
        };
        let connected = key.as_deref().is_some_and(|k| self.is_connected(k));
        let pill = |text: String, primary: bool| {
            div()
                .flex_shrink_0()
                .rounded_full()
                .border_1()
                .px_2()
                .py(px(2.))
                .tw_text_10()
                .font_weight(FontWeight::MEDIUM)
                .when(primary, |d| d.border_color(with_alpha(t.primary, 0.2)).bg(with_alpha(t.primary, 0.1)).text_color(t.primary))
                .when(!primary, |d| d.border_color(with_alpha(t.studio_border, 0.6)).bg(with_alpha(t.muted, 0.4)).text_color(t.muted_foreground))
                .child(text)
        };
        let mut trailing = div().flex().items_center().gap_2();
        if let Some((label, active)) = &r.status {
            trailing = trailing.child(pill(label.clone(), *active));
        }
        let busy = self.connecting.as_deref() == Some(r.title.as_str());
        let scope = Self::branch_scope(r);
        let expandable = scope.is_some();
        let expanded = scope.is_some() && self.expanded == scope;
        trailing = if expandable {
            trailing
        } else if connected {
            trailing.child(pill("Connected".into(), true))
        } else {
            let res = r.clone();
            trailing.child(
                Button::new(("res-connect", i))
                    .size(ButtonSize::Xs)
                    .disabled(busy)
                    .label(if busy { "Connecting…" } else { "Connect" })
                    .on_click(cx.listener(move |this, _, _, cx| this.connect(res.clone(), cx))),
            )
        };
        if let Some(url) = r.external.clone() {
            trailing = trailing.child(Button::new(("res-ext", i)).ghost().size(ButtonSize::IconSm).icon(IconName::ExternalLink).on_click(move |_, _, cx| cx.open_url(&url)));
        }
        let row_res = r.clone();
        let row = div()
            .id(("res-row", i))
            .flex()
            .items_center()
            .gap_3()
            .tw_rounded_lg()
            .px(px(10.))
            .py(px(10.))
            .when(expandable, |d| {
                d.cursor_pointer()
                    .hover(|s| s.bg(with_alpha(t.studio_row_hover, 0.7)))
                    .when(expanded, |d| d.bg(with_alpha(t.studio_row_hover, 0.5)))
                    .on_click(cx.listener(move |this, _, _, cx| this.toggle_branches(row_res.clone(), cx)))
                    .child(Icon::new(if expanded { IconName::ChevronDown } else { IconName::ChevronRight }).size(px(14.)).flex_shrink_0().text_color(t.muted_foreground))
            })
            .child(
                div()
                    .flex()
                    .size_8()
                    .flex_shrink_0()
                    .items_center()
                    .justify_center()
                    .tw_rounded_lg()
                    .bg(with_alpha(t.muted, 0.6))
                    .child(Icon::new(IconName::Database).size_4().text_color(t.muted_foreground)),
            )
            .child(
                div()
                    .min_w_0()
                    .flex_1()
                    .child(div().overflow_hidden().text_ellipsis().whitespace_nowrap().tw_text_sm().font_weight(FontWeight::MEDIUM).child(r.title.clone()))
                    .child(div().overflow_hidden().text_ellipsis().whitespace_nowrap().tw_text_xs().text_color(t.muted_foreground).child(r.subtitle.clone())),
            )
            .child(trailing);
        let branches = self.branch_rows(r, t, cx);
        div().overflow_hidden().tw_rounded_lg().child(row).children(branches)
    }
}

impl Render for AccountsScreen {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        let mut page = div().mx_auto().w_full().max_w(px(1024.)).px_6().py_6().child(self.header(&t, cx));
        if self.accounts.is_empty() {
            page = page.child(self.empty_state(&t, cx));
        } else {
            let q = widgets::value(&self.search, cx).to_lowercase();
            let filtered: Vec<(usize, Resource)> = self
                .resources
                .iter()
                .cloned()
                .enumerate()
                .filter(|(_, r)| q.is_empty() || r.title.to_lowercase().contains(&q) || r.subtitle.to_lowercase().contains(&q) || r.group.to_lowercase().contains(&q))
                .collect();
            let can_import = matches!(self.kind, AccountKind::Supabase | AccountKind::SpacetimeDb);
            let toolbar = div().border_b_1().border_color(with_alpha(t.studio_border, 0.5)).px_4().py_3().child(
                div()
                    .flex()
                    .flex_wrap()
                    .items_center()
                    .gap(px(10.))
                    .child(
                        div()
                            .relative()
                            .min_w(px(160.))
                            .flex_1()
                            .child(FieldInput::new(&self.search).h(32.).pl(32.))
                            .child(div().absolute().left(px(10.)).top(px(9.)).child(Icon::new(IconName::Search).size(px(14.)).text_color(t.muted_foreground))),
                    )
                    .child(
                        div()
                            .flex()
                            .flex_shrink_0()
                            .items_center()
                            .gap(px(6.))
                            .child(Button::new("acct-refresh").ghost().size(ButtonSize::Sm).icon(IconName::RefreshCw).disabled(self.loading).on_click(cx.listener(|this, _, _, cx| this.load(cx))))
                            .when(can_import, |d| {
                                d.child(
                                    Button::new("acct-import")
                                        .size(ButtonSize::Sm)
                                        .icon(IconName::Download)
                                        .disabled(self.importing || self.active.is_none())
                                        .label(if self.importing {
                                            "Importing...".to_string()
                                        } else if self.kind == AccountKind::Supabase {
                                            "Import all active".into()
                                        } else {
                                            "Import all".into()
                                        })
                                        .on_click(cx.listener(|this, _, _, cx| this.import_all(cx))),
                                )
                            }),
                    ),
            );
            let body: AnyElement = if self.loading {
                div().flex().items_center().justify_center().py_12().child(rexa_ui::Spinner::new(20.)).into_any_element()
            } else if let Some(e) = &self.error {
                div()
                    .m_2()
                    .tw_rounded_lg()
                    .border_1()
                    .border_color(with_alpha(t.destructive, 0.3))
                    .bg(with_alpha(t.destructive, 0.05))
                    .p_4()
                    .text_center()
                    .child(div().tw_text_sm().font_weight(FontWeight::MEDIUM).text_color(t.destructive).child(format!("Failed to load {}", self.kind.noun())))
                    .child(div().mt_1().tw_text_xs().text_color(t.muted_foreground).font_family(MONO).child(e.clone()))
                    .child(div().mt_2().tw_text_xs().text_color(t.muted_foreground).child("This account's token may have expired. Switch accounts or remove this account and log in again."))
                    .into_any_element()
            } else {
                let mut groups: Vec<(String, Vec<(usize, Resource)>)> = Vec::new();
                for (i, r) in filtered.iter().cloned() {
                    match groups.iter_mut().find(|(g, _)| *g == r.group) {
                        Some((_, list)) => list.push((i, r)),
                        None => groups.push((r.group.clone(), vec![(i, r)])),
                    }
                }
                let mut col = div().flex().flex_col().gap_3();
                for (g, list) in groups {
                    let mut rows = div().flex().flex_col().gap(px(2.));
                    for (i, r) in list {
                        rows = rows.child(self.resource_row(i, &r, &t, cx));
                    }
                    col = col.child(
                        div()
                            .when(!g.is_empty(), |d| {
                                d.child(div().mb_1().px(px(10.)).pt_1().tw_text_10().font_weight(FontWeight::SEMIBOLD).text_color(t.muted_foreground).child(rexa_ui::tracked_text::tracked(g.to_uppercase(), 0.05)))
                            })
                            .child(rows),
                    );
                }
                if filtered.is_empty() {
                    col = col.child(div().py_8().text_center().tw_text_sm().text_color(t.muted_foreground).child(if self.resources.is_empty() {
                        format!("No {} found.", self.kind.noun())
                    } else {
                        format!("No {} match your search.", self.kind.noun())
                    }));
                }
                col.into_any_element()
            };
            page = page.child(self.chips(&t, cx)).child(
                div()
                    .overflow_hidden()
                    .tw_rounded_xl()
                    .border_1()
                    .border_color(with_alpha(t.studio_border, 0.6))
                    .bg(with_alpha(t.studio_bg, 0.4))
                    .child(toolbar)
                    .child(div().p_2().child(body)),
            );
        }
        div().id("accounts-scroll").size_full().overflow_y_scroll().child(page)
    }
}

// ---- API clients ---------------------------------------------------------------------

const SPACETIMEDB_AUTH_HOST: &str = "spacetimedb.com";

struct NeonAuthFlow {
    listener: tokio::net::TcpListener,
    auth_url: String,
    redirect_uri: String,
    state: String,
    verifier: String,
    token_endpoint: String,
}

async fn neon_auth_prepare() -> anyhow::Result<NeonAuthFlow> {
    let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(15)).build()?;
    let discovery: Value = client.get("https://oauth2.neon.tech/.well-known/openid-configuration").send().await?.error_for_status()?.json().await?;
    let authorization_endpoint = discovery.get("authorization_endpoint").and_then(Value::as_str).filter(|s| s.starts_with("https://")).ok_or_else(|| anyhow::anyhow!("Neon OAuth discovery did not provide a valid authorization endpoint"))?;
    let token_endpoint = discovery.get("token_endpoint").and_then(Value::as_str).filter(|s| s.starts_with("https://")).ok_or_else(|| anyhow::anyhow!("Neon OAuth discovery did not provide a valid token endpoint"))?.to_string();
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0)).await?;
    let port = listener.local_addr()?.port();
    let redirect_uri = format!("http://127.0.0.1:{port}/callback");
    let rng = SystemRandom::new();
    let mut verifier_bytes = [0u8; 32];
    let mut state_bytes = [0u8; 16];
    rng.fill(&mut verifier_bytes).map_err(|_| anyhow::anyhow!("could not create a secure PKCE verifier"))?;
    rng.fill(&mut state_bytes).map_err(|_| anyhow::anyhow!("could not create secure OAuth state"))?;
    use base64::Engine;
    let verifier = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(verifier_bytes);
    let state = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(state_bytes);
    let challenge = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(digest::digest(&digest::SHA256, verifier.as_bytes()).as_ref());
    let scopes = ["openid", "offline", "offline_access", "urn:neoncloud:projects:create", "urn:neoncloud:projects:read", "urn:neoncloud:projects:update", "urn:neoncloud:projects:delete", "urn:neoncloud:orgs:create", "urn:neoncloud:orgs:read", "urn:neoncloud:orgs:update", "urn:neoncloud:orgs:delete", "urn:neoncloud:orgs:permission"];
    let mut auth_url = url::Url::parse(authorization_endpoint)?;
    auth_url.query_pairs_mut()
        .append_pair("client_id", "neonctl")
        .append_pair("response_type", "code")
        .append_pair("scope", &scopes.join(" "))
        .append_pair("redirect_uri", &redirect_uri)
        .append_pair("state", &state)
        .append_pair("code_challenge", &challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("prompt", "login");
    Ok(NeonAuthFlow { listener, auth_url: auth_url.to_string(), redirect_uri, state, verifier, token_endpoint })
}

async fn neon_auth_finish(flow: NeonAuthFlow) -> anyhow::Result<Value> {
    use tokio::io::AsyncReadExt;
    let exchange = async {
        loop {
            let (mut stream, _) = flow.listener.accept().await?;
            let mut buffer = [0u8; 8192];
            let length = stream.read(&mut buffer).await?;
            let request = String::from_utf8_lossy(&buffer[..length]);
            let Some(path) = request.lines().next().and_then(|line| line.split_whitespace().nth(1)) else { continue };
            let callback = url::Url::parse(&format!("http://127.0.0.1{}", path))?;
            if callback.path() != "/callback" {
                write_oauth_reply(&mut stream, "404 Not Found", "Sign-in callback not found.").await?;
                continue;
            }
            if callback.query_pairs().find(|(key, _)| key == "state").map(|(_, value)| value.into_owned()).as_deref() != Some(flow.state.as_str()) {
                write_oauth_reply(&mut stream, "400 Bad Request", "Sign-in state did not match. Return to RexaDB and try again.").await?;
                continue;
            }
            if let Some((_, error)) = callback.query_pairs().find(|(key, _)| key == "error") {
                let message = callback.query_pairs().find(|(key, _)| key == "error_description").map(|(_, value)| value.into_owned()).unwrap_or(error.into_owned());
                write_oauth_reply(&mut stream, "400 Bad Request", "Neon sign-in was not completed. You can close this tab.").await?;
                anyhow::bail!("Neon rejected sign-in: {message}");
            }
            let code = callback.query_pairs().find(|(key, _)| key == "code").map(|(_, value)| value.into_owned()).filter(|value| !value.is_empty()).ok_or_else(|| anyhow::anyhow!("Neon callback did not include an authorization code"))?;
            let response = reqwest::Client::new().post(&flow.token_endpoint)
                .header("content-type", "application/x-www-form-urlencoded")
                .form(&[("grant_type", "authorization_code"), ("code", &code), ("redirect_uri", &flow.redirect_uri), ("client_id", "neonctl"), ("code_verifier", &flow.verifier)])
                .send().await?;
            let status = response.status();
            let body = response.text().await?;
            if !status.is_success() { write_oauth_reply(&mut stream, "400 Bad Request", "Neon token exchange failed. Return to RexaDB to retry.").await?; anyhow::bail!("Neon token exchange failed ({status}): {}", body.chars().take(300).collect::<String>()); }
            let mut credentials: Value = serde_json::from_str(&body)?;
            credentials.get("access_token").and_then(Value::as_str).filter(|s| !s.is_empty()).ok_or_else(|| anyhow::anyhow!("Neon did not return an access token"))?;
            let expires_in = credentials.get("expires_in").and_then(Value::as_u64).unwrap_or(3600);
            credentials["expires_at"] = Value::from(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)?.as_millis() as u64 + expires_in * 1000);
            credentials["type"] = Value::String("oauth".into());
            credentials["token_type"] = credentials.get("token_type").cloned().unwrap_or(Value::String("bearer".into()));
            credentials["scope"] = credentials.get("scope").cloned().unwrap_or(Value::String("openid offline offline_access".into()));
            if let Some(email) = credentials.get("id_token").and_then(Value::as_str).and_then(id_token_email) { credentials["email"] = Value::String(email); }
            write_oauth_reply(&mut stream, "200 OK", "Signed in to Neon. You can close this tab and return to RexaDB.").await?;
            return Ok::<Value, anyhow::Error>(credentials);
        }
    };
    tokio::time::timeout(std::time::Duration::from_secs(60), exchange).await.map_err(|_| anyhow::anyhow!("Neon sign-in timed out"))?
}

async fn write_oauth_reply(stream: &mut tokio::net::TcpStream, status: &str, message: &str) -> anyhow::Result<()> {
    use tokio::io::AsyncWriteExt;
    let body = format!("<!doctype html><html><meta charset=\"utf-8\"><title>Neon</title><body style=\"font:16px system-ui;text-align:center;padding:4rem\"><h2>{message}</h2></body></html>");
    stream.write_all(format!("HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).as_bytes()).await?;
    stream.shutdown().await?;
    Ok(())
}

fn id_token_email(token: &str) -> Option<String> {
    use base64::Engine;
    let payload = token.split('.').nth(1)?;
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(payload.trim_end_matches('=' )).ok()?;
    serde_json::from_slice::<Value>(&bytes).ok()?.get("email")?.as_str().map(str::to_string)
}

fn supabase_login_session() -> anyhow::Result<(String, String, agreement::EphemeralPrivateKey)> {
    let rng = SystemRandom::new();
    let private_key = agreement::EphemeralPrivateKey::generate(&agreement::ECDH_P256, &rng)
        .map_err(|_| anyhow::anyhow!("could not generate an ephemeral P-256 key"))?;
    let public_key = private_key.compute_public_key()
        .map_err(|_| anyhow::anyhow!("could not compute the public key"))?;
    let public_hex = encode_hex(public_key.as_ref());
    let session_id = uuid::Uuid::new_v4().to_string();
    let timestamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)?.as_millis();
    let mut login_url = url::Url::parse("https://supabase.com/dashboard/cli/login")?;
    login_url.query_pairs_mut()
        .append_pair("session_id", &session_id)
        .append_pair("token_name", &format!("rexadb_RexaDB_{timestamp}"))
        .append_pair("public_key", &public_hex);
    Ok((session_id, login_url.to_string(), private_key))
}

fn open_supabase_code_dialog(
    session_id: String,
    private_key: agreement::EphemeralPrivateKey,
    account: gpui::WeakEntity<AccountsScreen>,
    cx: &mut App,
) {
    use std::sync::{Arc, Mutex};
    let private_key = Arc::new(Mutex::new(Some(private_key)));
    rexa_ui::open_dialog(cx, move |window, cx| {
        let code = cx.new(|cx| InputState::new(window, cx).placeholder("8-character device code"));
        let code_value = code.clone();
        let private_key = private_key.clone();
        let account = account.clone();
        let session_id = session_id.clone();
        rexa_ui::Dialog::new()
            .max_w(384.)
            .title("Finish Supabase sign-in")
            .description("Approve the request in your browser, then enter the device code shown by Supabase.")
            .child(div().flex().flex_col().gap_3().pt_2()
                .child(FieldInput::new(&code))
                .child(Button::new("supabase-code-submit").size(ButtonSize::Lg).w_full().label("Verify and connect").on_click(move |_, _, cx| {
                    let code = code_value.read(cx).value().trim().to_string();
                    if code.chars().count() != 8 || !code.chars().all(|c| c.is_ascii_alphanumeric()) {
                        toast::error("Enter the 8-character code shown in the Supabase browser page.", cx);
                        return;
                    }
                    let key = private_key.lock().ok().and_then(|mut key| key.take());
                    let Some(private_key) = key else {
                        toast::error("This sign-in attempt has already been used. Start browser sign-in again.", cx);
                        return;
                    };
                    account.update(cx, |this, cx| this.finish_supabase_login(session_id.clone(), private_key, code, cx)).ok();
                    rexa_ui::close_top(cx);
                })))
    });
}

async fn supabase_login_exchange(session_id: String, device_code: String, private_key: agreement::EphemeralPrivateKey) -> anyhow::Result<String> {
    let mut endpoint = url::Url::parse(&format!("https://api.supabase.com/platform/cli/login/{}", session_id))?;
    endpoint.query_pairs_mut().append_pair("device_code", &device_code);
    let response = reqwest::Client::new().get(endpoint).send().await?;
    let status = response.status();
    let body = response.text().await?;
    if !status.is_success() { anyhow::bail!("Supabase returned {status}: {body}"); }
    let response: Value = serde_json::from_str(&body)?;
    let encrypted = decode_hex(response.get("access_token").and_then(Value::as_str).ok_or_else(|| anyhow::anyhow!("Supabase response is missing access_token"))?)?;
    let server_public = decode_hex(response.get("public_key").and_then(Value::as_str).ok_or_else(|| anyhow::anyhow!("Supabase response is missing public_key"))?)?;
    let nonce = decode_hex(response.get("nonce").and_then(Value::as_str).ok_or_else(|| anyhow::anyhow!("Supabase response is missing nonce"))?)?;
    if nonce.len() != 12 { anyhow::bail!("Supabase returned an invalid AES-GCM nonce"); }
    let peer = agreement::UnparsedPublicKey::new(&agreement::ECDH_P256, server_public);
    let decrypted = agreement::agree_ephemeral(private_key, &peer, |shared| {
        use aes_gcm::aead::generic_array::GenericArray;
        let cipher = Aes256Gcm::new_from_slice(shared).map_err(|_| anyhow::anyhow!("invalid ECDH key material"))?;
        cipher.decrypt(GenericArray::from_slice(&nonce), encrypted.as_ref())
            .map_err(|_| anyhow::anyhow!("could not decrypt Supabase access token"))
    }).map_err(|_| anyhow::anyhow!("Supabase key agreement failed"))??;
    Ok(String::from_utf8(decrypted)?.trim().to_string())
}

fn encode_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut result = String::with_capacity(bytes.len() * 2);
    for byte in bytes { result.push(HEX[(byte >> 4) as usize] as char); result.push(HEX[(byte & 0x0f) as usize] as char); }
    result
}

fn decode_hex(input: &str) -> anyhow::Result<Vec<u8>> {
    if input.len() % 2 != 0 { anyhow::bail!("Supabase returned malformed hexadecimal data"); }
    input.as_bytes().chunks_exact(2).map(|pair| {
        let digit = |b: u8| match b { b'0'..=b'9' => Some(b - b'0'), b'a'..=b'f' => Some(b - b'a' + 10), b'A'..=b'F' => Some(b - b'A' + 10), _ => None };
        let hi = digit(pair[0]).ok_or_else(|| anyhow::anyhow!("Supabase returned malformed hexadecimal data"))?;
        let lo = digit(pair[1]).ok_or_else(|| anyhow::anyhow!("Supabase returned malformed hexadecimal data"))?;
        Ok((hi << 4) | lo)
    }).collect()
}

async fn spacetimedb_login_request() -> anyhow::Result<(String, String)> {
    let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(20)).build()?;
    let mut url = url::Url::parse(&format!("https://{SPACETIMEDB_AUTH_HOST}/api/auth/cli/login/request-token"))?;
    url.query_pairs_mut().append_pair("host", SPACETIMEDB_AUTH_HOST);
    let response = client.post(url).send().await?;
    let status = response.status();
    let body = response.text().await?;
    if !status.is_success() { anyhow::bail!("SpacetimeDB request failed ({status}): {}", body.chars().take(400).collect::<String>()); }
    let payload: Value = serde_json::from_str(&body)?;
    if payload.get("success").and_then(Value::as_bool) != Some(true) {
        anyhow::bail!("{}", payload.get("error").map(format_provider_error).unwrap_or_else(|| "SpacetimeDB could not start sign-in".into()));
    }
    let request_token = payload.pointer("/data/token").and_then(Value::as_str).filter(|s| !s.is_empty()).ok_or_else(|| anyhow::anyhow!("SpacetimeDB returned no login token"))?.to_string();
    let mut login_url = url::Url::parse(&format!("https://{SPACETIMEDB_AUTH_HOST}/login/cli"))?;
    login_url.query_pairs_mut().append_pair("token", &request_token);
    Ok((request_token, login_url.to_string()))
}

async fn spacetimedb_login_poll(request_token: &str) -> anyhow::Result<String> {
    let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(20)).build()?;
    let started = tokio::time::Instant::now();
    while started.elapsed() < std::time::Duration::from_secs(180) {
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
        let mut url = url::Url::parse(&format!("https://{SPACETIMEDB_AUTH_HOST}/api/auth/cli/status"))?;
        url.query_pairs_mut().append_pair("host", SPACETIMEDB_AUTH_HOST).append_pair("token", request_token);
        let response = match client.get(url).send().await {
            Ok(response) => response,
            Err(_) => continue,
        };
        if !response.status().is_success() { continue; }
        let payload: Value = match response.json().await { Ok(payload) => payload, Err(_) => continue };
        if payload.get("success").and_then(Value::as_bool) != Some(true) {
            anyhow::bail!("{}", payload.get("error").map(format_provider_error).unwrap_or_else(|| "SpacetimeDB sign-in was rejected".into()));
        }
        if payload.pointer("/data/approved").and_then(Value::as_bool) == Some(true) {
            if let Some(session_token) = payload.pointer("/data/sessionToken").and_then(Value::as_str).filter(|s| !s.is_empty()) {
                return spacetimedb_login_exchange(&client, session_token).await;
            }
        }
    }
    anyhow::bail!("Sign-in timed out. Please try again.")
}

async fn spacetimedb_login_exchange(client: &reqwest::Client, session_token: &str) -> anyhow::Result<String> {
    let mut url = url::Url::parse(&format!("https://{SPACETIMEDB_AUTH_HOST}/api/spacetimedb-token"))?;
    url.query_pairs_mut().append_pair("host", SPACETIMEDB_AUTH_HOST);
    let response = client.post(url).bearer_auth(session_token).send().await?;
    let status = response.status();
    let body = response.text().await?;
    if !status.is_success() { anyhow::bail!("SpacetimeDB token exchange failed ({status}): {}", body.chars().take(400).collect::<String>()); }
    let payload: Value = serde_json::from_str(&body)?;
    if payload.get("success").and_then(Value::as_bool) != Some(true) {
        anyhow::bail!("{}", payload.get("error").map(format_provider_error).unwrap_or_else(|| "SpacetimeDB token exchange failed".into()));
    }
    payload.pointer("/data/token").and_then(Value::as_str).filter(|s| !s.is_empty()).map(str::to_string).ok_or_else(|| anyhow::anyhow!("SpacetimeDB returned no identity token"))
}

fn format_provider_error(error: &Value) -> String {
    match error {
        Value::String(message) => message.clone(),
        Value::Null => "Unknown error".into(),
        value => value.to_string(),
    }
}

fn connection_key(kind: AccountKind, cs: &str) -> Option<String> {
    let t = cs.trim();
    match kind {
        // parseProjectRef: supabase-mgmt://<ref>
        AccountKind::Supabase => t.strip_prefix("supabase-mgmt://").map(|r| r.split(['/', '?']).next().unwrap_or("").to_string()),
        // parseSpacetimeDbConnection: host/database (lowercased)
        AccountKind::SpacetimeDb => {
            let rest = t.strip_prefix("spacetimedbs://").or_else(|| t.strip_prefix("spacetimedb://"))?;
            let rest = rest.split('?').next()?;
            let (host, db) = rest.split_once('/')?;
            Some(format!("{host}/{}", crate::fields::decode_component(db)).to_lowercase())
        }
        _ => Some(t.to_string()),
    }
}

fn normalize_stdb_host(host: Option<&str>) -> String {
    let h = host.unwrap_or("").trim();
    let h = h.trim_start_matches("https://").trim_start_matches("http://").trim_start_matches("wss://").trim_start_matches("ws://").trim_end_matches('/');
    if h.is_empty() { "maincloud.spacetimedb.com".into() } else { h.into() }
}

/// `buildSpacetimeDbConnectionString`.
fn stdb_connection_string(host: &str, database: &str, token: &str) -> String {
    let raw = host.trim();
    let wants_https = raw.to_lowercase().starts_with("https://");
    let wants_http = raw.to_lowercase().starts_with("http://");
    let clean = normalize_stdb_host(Some(raw));
    let proto = if wants_https || (!wants_http && clean.to_lowercase().ends_with(".spacetimedb.com")) { "spacetimedbs" } else { "spacetimedb" };
    format!("{proto}://{clean}/{}?token={}", encode_component(database.trim().trim_start_matches('/')), encode_component(token))
}

/// `decodeSpacetimeDbIdentity`: the JWT `hex_identity` / `sub` claim.
fn stdb_identity(token: &str) -> Option<String> {
    use base64::Engine;
    let payload = token.split('.').nth(1)?;
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(payload.trim_end_matches('=')).ok()?;
    let v: Value = serde_json::from_slice(&bytes).ok()?;
    v.get("hex_identity").or_else(|| v.get("sub")).and_then(Value::as_str).map(str::to_string)
}

fn neon_token(profile: &str) -> anyhow::Result<String> {
    let file = if profile == "DEFAULT" { "credentials.json".to_string() } else { format!("credentials.{profile}.json") };
    let dir = std::env::var("NEON_CONFIG_DIR").map(std::path::PathBuf::from).unwrap_or_else(|_| dirs::home_dir().unwrap_or_default().join(".config").join("neon"));
    let raw = std::fs::read_to_string(dir.join(file)).map_err(|_| anyhow::anyhow!("Neon credentials for \"{profile}\" were not found. Reconnect the account."))?;
    let v: Value = serde_json::from_str(&raw)?;
    v.get("access_token").and_then(Value::as_str).map(str::to_string).ok_or_else(|| anyhow::anyhow!("Neon credentials are invalid. Reconnect the account."))
}

async fn neon_access_token(account: &Value) -> anyhow::Result<String> {
    let profile = s(account, "profileName").unwrap_or("DEFAULT");
    let saved = s(account, "accessToken").map(str::to_string).map(Ok).unwrap_or_else(|| neon_token(profile))?;
    let Ok(mut credentials) = serde_json::from_str::<Value>(&saved) else { return Ok(saved) };
    if credentials.get("type").and_then(Value::as_str) != Some("oauth") { return Ok(saved); }
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)?.as_millis() as u64;
    let expires_at = credentials.get("expires_at").and_then(Value::as_u64).unwrap_or(0);
    let mut changed = false;
    if expires_at <= now + 120_000 {
        let refresh = credentials.get("refresh_token").and_then(Value::as_str).filter(|s| !s.is_empty()).ok_or_else(|| anyhow::anyhow!("Neon session expired. Sign in again to reconnect this account."))?.to_string();
        let discovery: Value = reqwest::Client::new().get("https://oauth2.neon.tech/.well-known/openid-configuration").send().await?.error_for_status()?.json().await?;
        let token_endpoint = discovery.get("token_endpoint").and_then(Value::as_str).filter(|s| s.starts_with("https://")).ok_or_else(|| anyhow::anyhow!("Neon OAuth discovery did not provide a valid token endpoint"))?;
        let response = reqwest::Client::new().post(token_endpoint)
            .header("content-type", "application/x-www-form-urlencoded")
            .form(&[("grant_type", "refresh_token"), ("refresh_token", refresh.as_str()), ("client_id", "neonctl")])
            .send().await?;
        let status = response.status();
        let body = response.text().await?;
        if !status.is_success() { anyhow::bail!("Neon token refresh failed ({status}): {}. Sign in again to reconnect this account.", body.chars().take(300).collect::<String>()); }
        let updated: Value = serde_json::from_str(&body)?;
        let access = updated.get("access_token").and_then(Value::as_str).filter(|s| !s.is_empty()).ok_or_else(|| anyhow::anyhow!("Neon token refresh did not return an access token"))?.to_string();
        let expires_in = updated.get("expires_in").and_then(Value::as_u64).unwrap_or(3600);
        credentials["access_token"] = Value::String(access);
        credentials["refresh_token"] = updated.get("refresh_token").and_then(Value::as_str).map(|s| Value::String(s.into())).unwrap_or(Value::String(refresh));
        credentials["expires_at"] = Value::from(now + expires_in * 1000);
        for key in ["id_token", "token_type", "scope"] {
            if let Some(value) = updated.get(key) { credentials[key] = value.clone(); }
        }
        changed = true;
    }
    let access = credentials.get("access_token").and_then(Value::as_str).filter(|s| !s.is_empty()).ok_or_else(|| anyhow::anyhow!("Neon credentials do not include an access token"))?.to_string();
    if changed {
        let mut accounts = load_accounts(AccountKind::Neon);
        if let Some(saved_account) = accounts.iter_mut().find(|row| s(row, "profileName") == Some(profile)) {
            if let Some(object) = saved_account.as_object_mut() { object.insert("accessToken".into(), Value::String(credentials.to_string())); }
            save_accounts(AccountKind::Neon, &accounts)?;
        }
    }
    Ok(access)
}

const NEON_API: &str = "https://console.neon.tech/api/v2";

async fn list_resources(kind: AccountKind, account: &Value) -> anyhow::Result<Vec<Resource>> {
    let arr = |v: &Value, k: &str| v.get(k).and_then(Value::as_array).cloned().unwrap_or_default();
    let st = |v: &Value, k: &str| v.get(k).and_then(Value::as_str).unwrap_or("").to_string();
    match kind {
        AccountKind::Supabase => {
            let token = s(account, "token").unwrap_or("").to_string();
            let projects = crate::http::get_json("https://api.supabase.com/v1/projects", &token).await?;
            let orgs = crate::http::get_json("https://api.supabase.com/v1/organizations", &token).await.unwrap_or(Value::Null);
            let org_name = |id: &str| orgs.as_array().and_then(|o| o.iter().find(|x| x.get("id").and_then(Value::as_str) == Some(id))).map(|o| st(o, "name")).unwrap_or("Unknown".into());
            Ok(projects
                .as_array()
                .cloned()
                .unwrap_or_default()
                .iter()
                .map(|p| {
                    let (r, status) = (st(p, "ref"), st(p, "status"));
                    let label = match status.as_str() {
                        "ACTIVE_HEALTHY" | "ACTIVE" => ("Active".to_string(), true),
                        "PAUSED" => ("Paused".into(), false),
                        "COMING_UP" => ("Starting".into(), false),
                        s => (s.replace('_', " "), false),
                    };
                    Resource {
                        group: org_name(&st(p, "organization_id")),
                        title: st(p, "name"),
                        subtitle: format!("{r} · {}", st(p, "region")),
                        status: Some(label),
                        connect: Connect::Ready {
                            name: st(p, "name"),
                            cs: format!("supabase-mgmt://{r}?token={}", encode_component(&token)),
                            kind: "supabase-mgmt",
                            key: r.clone(),
                        },
                        external: Some(format!("https://supabase.com/dashboard/project/{r}/settings/database")),
                    }
                })
                .collect())
        }
        AccountKind::SpacetimeDb => {
            let token = s(account, "token").unwrap_or("").to_string();
            let host = normalize_stdb_host(s(account, "host"));
            let identity = stdb_identity(&token).ok_or_else(|| anyhow::anyhow!("Invalid SpacetimeDB token: no identity claim"))?;
            let ids = crate::http::get_json(&format!("https://{host}/v1/identity/{}/databases", encode_component(&identity)), &token).await?;
            let mut out = Vec::new();
            for id in arr(&ids, "identities") {
                let Some(id) = id.as_str().map(|s| s.trim_start_matches("0x").to_lowercase()) else { continue };
                let names = crate::http::get_json(&format!("https://{host}/v1/database/{id}/names"), &token).await.map(|v| arr(&v, "names")).unwrap_or_default();
                let name = names.first().and_then(Value::as_str).unwrap_or("").to_string();
                out.push(Resource {
                    group: String::new(),
                    title: if name.is_empty() { format!("{}…", &id[..id.len().min(12)]) } else { name.clone() },
                    subtitle: format!("{host} · {}…", &id[..id.len().min(16)]),
                    status: None,
                    connect: Connect::Ready { name: name.clone(), cs: stdb_connection_string(&host, &name, &token), kind: "spacetimedb", key: format!("{host}/{name}").to_lowercase() },
                    external: None,
                });
            }
            Ok(out)
        }
        AccountKind::Neon => {
            let profile = s(account, "profileName").unwrap_or("DEFAULT").to_string();
            let token = neon_access_token(account).await?;
            let orgs = crate::http::get_json(&format!("{NEON_API}/users/me/organizations"), &token).await.map(|v| arr(&v, "organizations")).unwrap_or_default();
            let mut out = Vec::new();
            let scopes: Vec<(String, String)> = if orgs.is_empty() { vec![(String::new(), String::new())] } else { orgs.iter().map(|o| (st(o, "id"), st(o, "name"))).collect() };
            for (org_id, org_name) in scopes {
                let url = if org_id.is_empty() { format!("{NEON_API}/projects") } else { format!("{NEON_API}/projects?org_id={}", encode_component(&org_id)) };
                let projects = crate::http::get_json(&url, &token).await?;
                for p in arr(&projects, "projects") {
                    out.push(Resource {
                        group: org_name.clone(),
                        title: st(&p, "name"),
                        subtitle: format!("{} · {}", st(&p, "id"), st(&p, "region_id")),
                        status: None,
                        connect: Connect::Neon { profile: profile.clone(), project_id: st(&p, "id"), project: st(&p, "name") },
                        external: Some(format!("https://console.neon.tech/app/projects/{}", st(&p, "id"))),
                    });
                }
            }
            Ok(out)
        }
        AccountKind::Planetscale => {
            let token = s(account, "accessToken").unwrap_or("").to_string();
            let orgs = crate::http::get_json("https://api.planetscale.com/v1/organizations", &token).await?;
            let mut out = Vec::new();
            for o in arr(&orgs, "data") {
                let org = st(&o, "name");
                let dbs = crate::http::get_json(&format!("https://api.planetscale.com/v1/organizations/{}/databases", encode_component(&org)), &token).await?;
                for d in arr(&dbs, "data") {
                    let region = d.get("region").and_then(|r| r.get("display_name")).and_then(Value::as_str).unwrap_or("").to_string();
                    out.push(Resource {
                        group: org.clone(),
                        title: st(&d, "name"),
                        subtitle: format!("{} · {region}", if st(&d, "kind").to_lowercase().contains("postgres") { "PostgreSQL" } else { "Vitess (MySQL)" }),
                        status: Some((st(&d, "state").replace('_', " "), st(&d, "state") == "ready")),
                        connect: Connect::Planetscale { org: org.clone(), database: st(&d, "name"), kind: st(&d, "kind") },
                        external: Some(format!("https://app.planetscale.com/{org}/{}", st(&d, "name"))),
                    });
                }
            }
            Ok(out)
        }
    }
}

impl NeonPick {
    /// `buildNeonCliConnectionString`
    fn connection_string(&self, database: &str, role: &str) -> String {
        format!(
            "neon-cli://{}/{}/{}/{}?role={}",
            encode_component(&self.profile),
            encode_component(&self.project_id),
            encode_component(self.branch.get("id").and_then(Value::as_str).unwrap_or("")),
            encode_component(database),
            encode_component(role)
        )
    }

    fn name(&self, database: &str, role: &str) -> String {
        if self.branch.get("default").and_then(Value::as_bool) == Some(true) {
            format!("{} / {database} ({role})", self.project)
        } else {
            format!("{} ({}) / {database} ({role})", self.project, self.branch.get("name").and_then(Value::as_str).unwrap_or(""))
        }
    }
}

/// The branch id of a `neon-cli://profile/project/branch/db` pointer.
fn neon_pointer_branch(cs: &str) -> Option<String> {
    let rest = cs.strip_prefix("neon-cli://")?;
    let path = rest.split('?').next()?;
    path.split('/').nth(2).map(|b| urlencoding_decode(b))
}

fn urlencoding_decode(s: &str) -> String {
    url::form_urlencoded::parse(format!("x={s}").as_bytes()).next().map(|(_, v)| v.into_owned()).unwrap_or_else(|| s.to_string())
}

/// `listBranches` (Neon project branches / PlanetScale database branches).
async fn list_branches(c: &Connect, account: &Value) -> anyhow::Result<Vec<Value>> {
    match c {
        Connect::Neon { project_id, .. } => {
            let token = neon_access_token(account).await?;
            let v = crate::http::get_json(&format!("{NEON_API}/projects/{project_id}/branches"), &token).await?;
            Ok(v.get("branches").and_then(Value::as_array).cloned().unwrap_or_default())
        }
        Connect::Planetscale { org, database, .. } => {
            let token = account.get("accessToken").and_then(Value::as_str).unwrap_or("").to_string();
            let v = crate::http::get_json(&format!("https://api.planetscale.com/v1/organizations/{}/databases/{}/branches", encode_component(org), encode_component(database)), &token).await?;
            Ok(v.get("data").and_then(Value::as_array).cloned().unwrap_or_default())
        }
        Connect::Ready { .. } => Ok(Vec::new()),
    }
}

/// `listDatabases` + `listRoles` for a Neon branch.
async fn neon_databases_and_roles(account: &Value, project_id: &str, branch_id: &str) -> anyhow::Result<(Vec<String>, Vec<String>)> {
    let token = neon_access_token(account).await?;
    let base = format!("{NEON_API}/projects/{project_id}/branches/{branch_id}");
    let (db_url, role_url) = (format!("{base}/databases"), format!("{base}/roles"));
    let (dbs, roles) = tokio::try_join!(crate::http::get_json(&db_url, &token), crate::http::get_json(&role_url, &token))?;
    let names = |v: &Value, k: &str| v.get(k).and_then(Value::as_array).map(|a| a.iter().filter_map(|x| x.get("name").and_then(Value::as_str).map(str::to_string)).collect()).unwrap_or_default();
    Ok((names(&dbs, "databases"), names(&roles, "roles")))
}

/// `createBranchPassword` + `buildPlanetscaleConnectionString` for one branch.
async fn planetscale_branch_connection(account: &Value, org: &str, database: &str, kind: &str, branch: &Value) -> anyhow::Result<(String, String, &'static str)> {
    let st = |v: &Value, k: &str| v.get(k).and_then(Value::as_str).unwrap_or("").to_string();
    let token = account.get("accessToken").and_then(Value::as_str).unwrap_or("").to_string();
    let base = format!("https://api.planetscale.com/v1/organizations/{}/databases/{}", encode_component(org), encode_component(database));
    let bname = st(branch, "name");
    let pw = crate::http::post_json(&format!("{base}/branches/{}/passwords", encode_component(&bname)), &token, serde_json::json!({ "name": "rexadb", "role": "admin" })).await?;
    let (host, user, pass) = (st(&pw, "access_host_url"), encode_component(&st(&pw, "username")), encode_component(&st(&pw, "plain_text")));
    let cs = if kind.to_lowercase().contains("postgres") {
        format!("postgresql://{user}:{pass}@{host}:5432/{database}?sslmode=require")
    } else {
        format!("mysql://{user}:{pass}@{host}:3306/{database}?ssl=true")
    };
    let production = branch.get("production").and_then(Value::as_bool) == Some(true);
    Ok((if production { database.to_string() } else { format!("{database} ({bname})") }, cs, "planetscale"))
}

/// Neon: default branch → first database + owner role → `neon-cli://` pointer.
/// PlanetScale: production branch → mint an admin password → mysql/postgres URL.
async fn resolve_connect(c: &Connect, account: &Value) -> anyhow::Result<(String, String, &'static str)> {
    let st = |v: &Value, k: &str| v.get(k).and_then(Value::as_str).unwrap_or("").to_string();
    match c {
        Connect::Neon { profile, project_id, project } => {
            let token = neon_access_token(account).await?;
            let branches = crate::http::get_json(&format!("{NEON_API}/projects/{project_id}/branches"), &token).await?;
            let list = branches.get("branches").and_then(Value::as_array).cloned().unwrap_or_default();
            let branch = list.iter().find(|b| b.get("default").and_then(Value::as_bool) == Some(true)).or(list.first()).cloned().ok_or_else(|| anyhow::anyhow!("This project has no branches."))?;
            let bid = st(&branch, "id");
            let dbs = crate::http::get_json(&format!("{NEON_API}/projects/{project_id}/branches/{bid}/databases"), &token).await?;
            let db = dbs.get("databases").and_then(Value::as_array).and_then(|d| d.first().cloned()).ok_or_else(|| anyhow::anyhow!("This branch has no databases."))?;
            let (dname, role) = (st(&db, "name"), st(&db, "owner_name"));
            let cs = format!(
                "neon-cli://{}/{}/{}/{}?role={}",
                encode_component(profile),
                encode_component(project_id),
                encode_component(&bid),
                encode_component(&dname),
                encode_component(&role)
            );
            let name = if branch.get("default").and_then(Value::as_bool) == Some(true) {
                format!("{project} / {dname} ({role})")
            } else {
                format!("{project} ({}) / {dname} ({role})", st(&branch, "name"))
            };
            Ok((name, cs, "neon"))
        }
        Connect::Planetscale { org, database, kind } => {
            let token = account.get("accessToken").and_then(Value::as_str).unwrap_or("").to_string();
            let base = format!("https://api.planetscale.com/v1/organizations/{}/databases/{}", encode_component(org), encode_component(database));
            let branches = crate::http::get_json(&format!("{base}/branches"), &token).await?;
            let list = branches.get("data").and_then(Value::as_array).cloned().unwrap_or_default();
            let branch = list.iter().find(|b| b.get("production").and_then(Value::as_bool) == Some(true)).or(list.first()).cloned().ok_or_else(|| anyhow::anyhow!("This database has no branches."))?;
            let bname = st(&branch, "name");
            let pw = crate::http::post_json(&format!("{base}/branches/{}/passwords", encode_component(&bname)), &token, serde_json::json!({ "name": "rexadb", "role": "admin" })).await?;
            let (host, user, pass) = (st(&pw, "access_host_url"), encode_component(&st(&pw, "username")), encode_component(&st(&pw, "plain_text")));
            let cs = if kind.to_lowercase().contains("postgres") {
                format!("postgresql://{user}:{pass}@{host}:5432/{database}?sslmode=require")
            } else {
                format!("mysql://{user}:{pass}@{host}:3306/{database}?ssl=true")
            };
            let production = branch.get("production").and_then(Value::as_bool) == Some(true);
            Ok((if production { database.clone() } else { format!("{database} ({bname})") }, cs, "planetscale"))
        }
        Connect::Ready { name, cs, kind, .. } => Ok((name.clone(), cs.clone(), kind)),
    }
}
