//! Port of components/connections/connection-manager.tsx — the connection
//! manager embedded the way connections-page.tsx's standalone layout does
//! (36px drag bar, inset rounded `--shell-content-bg` panel). This file owns
//! the state, the `connectionScreen === "list"` branch (card + list views,
//! ⋮ menus, ⌘K search, Providers filter, Sort, Manage menu, reordering) and
//! the list-level dialogs. Other screens live in select.rs (new-select),
//! form.rs (new-form / edit-form), jdbc.rs (jdbc-picker) and accounts.rs.

use crate::accounts::{self, AccountKind, AccountsScreen};
use crate::form::{ConnectionForm, FormEvent, FormMode};
use crate::providers;
use crate::widgets::{self, provider_logo};
use gpui::{
    div, img, prelude::*, px, svg, App, ClipboardItem, Context, Entity, FocusHandle, Focusable, FontWeight, Hsla,
    Image, KeyDownEvent, MouseButton, ObjectFit, SharedString, Subscription, Window,
};
use gpui_component::input::InputState;
use gpui_component::Icon;
use rexa_store::{ConnectionDraft, ConnectionRow, SavedConnection, Store, TagDef, WebStore};
use rexa_ui::theme::{with_alpha, ActiveTokens, Tokens, MONO};
use rexa_ui::{
    confirm, images, toast, tracked_text, Align, Button, ButtonSize, ConfirmOptions, Dialog, DropdownMenu, IconName,
    Kbd, MenuItem, Tw,
};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

#[derive(Clone, Copy, PartialEq)]
pub enum SortBy {
    Name,
    Recent,
}

#[derive(Clone, Copy, PartialEq)]
pub enum ViewMode {
    Card,
    List,
}

/// `ConnectionScreen` (only the screens this crate renders; settings /
/// compare / transfer / cloud-sync are other crates' routes).
#[derive(Clone, Debug, PartialEq)]
pub enum Screen {
    List,
    NewSelect,
    Form,
    JdbcPicker,
    Accounts(AccountKind),
}

const VIEW_KEY: &str = "rexa-db-connections-view";

/// Payload for drag reordering (`draggingConnectionId`).
#[derive(Clone)]
pub struct DraggedConnection {
    pub id: i64,
    pub name: SharedString,
}

impl Render for DraggedConnection {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens();
        div()
            .px_3()
            .py_2()
            .tw_rounded_lg()
            .border_1()
            .border_color(t.studio_border)
            .bg(t.card)
            .opacity(0.8)
            .tw_text_sm()
            .font_weight(FontWeight::MEDIUM)
            .child(self.name.clone())
    }
}

/// `ConnectionsUpdatePill` input (useAppUpdateContext). Lives in rexa-core so
/// the update checker in rexa-settings can set it.
pub use rexa_core::update::UpdateState;

pub struct ConnectionsScreen {
    pub(crate) focus: FocusHandle,
    pub(crate) rows: Vec<ConnectionRow>,
    pub(crate) folders: Vec<String>,
    pub(crate) tag_library: Vec<TagDef>,
    tags: HashMap<String, Hsla>,
    icons: HashMap<i64, Arc<Image>>,
    avatar: Option<Arc<Image>>,
    user_name: String,
    user_email: String,
    pub(crate) accounts: accounts::AccountSummary,
    sort_by: SortBy,
    view_mode: ViewMode,
    provider_filter: Vec<String>,
    show_only_favorites: bool,
    folder_filter: Option<String>,
    reorder_mode: bool,
    selected_index: usize,
    opening: HashSet<i64>,
    dragging: Option<i64>,
    drag_over: Option<i64>,
    manage_menu: Option<usize>,
    error: Option<SharedString>,
    pub(crate) screen: Screen,
    pub(crate) select_input: Entity<InputState>,
    pub(crate) jdbc_search: Entity<InputState>,
    pub(crate) provider_focus: usize,
    form: Option<(Entity<ConnectionForm>, Subscription)>,
    account_view: Option<Entity<AccountsScreen>>,
    _subs: Vec<Subscription>,
}

impl ConnectionsScreen {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let select_input = cx.new(|cx| InputState::new(window, cx).placeholder("postgresql://user:password@host:5432/database"));
        let sub = cx.subscribe_in(&select_input, window, Self::on_select_input);
        let jdbc_search = cx.new(|cx| InputState::new(window, cx).placeholder("Search databases..."));
        let jdbc_sub = cx.observe(&jdbc_search, |_, _, cx| cx.notify());
        let view_mode = Store::open()
            .ok()
            .and_then(|s| s.setting(VIEW_KEY).ok().flatten())
            .or_else(|| WebStore::open()?.get(VIEW_KEY).ok().flatten())
            .map(|v| if v.trim_matches('"') == "list" { ViewMode::List } else { ViewMode::Card })
            .unwrap_or(ViewMode::Card);
        let mut this = Self {
            focus: cx.focus_handle(),
            rows: Vec::new(),
            folders: Vec::new(),
            tag_library: Vec::new(),
            tags: HashMap::new(),
            icons: HashMap::new(),
            avatar: None,
            user_name: "User".into(),
            user_email: String::new(),
            accounts: accounts::AccountSummary::default(),
            sort_by: SortBy::Name,
            view_mode,
            provider_filter: Vec::new(),
            show_only_favorites: false,
            folder_filter: None,
            reorder_mode: false,
            selected_index: 0,
            opening: HashSet::new(),
            dragging: None,
            drag_over: None,
            manage_menu: None,
            error: None,
            screen: Screen::List,
            select_input,
            jdbc_search,
            provider_focus: 0,
            form: None,
            account_view: None,
            _subs: vec![sub, jdbc_sub],
        };
        this.reload();
        window.focus(&this.focus, cx);
        this
    }

    /// Open on a specific screen (`initialScreen`, `?edit=<id>`).
    pub fn with_route(mut self, route: &rexa_core::Route, window: &mut Window, cx: &mut Context<Self>) -> Self {
        match route {
            rexa_core::Route::EditConnection(id) => self.edit_connection(*id, false, window, cx),
            rexa_core::Route::ConnectionScreen(s) => match s.as_str() {
                "new-select" => self.screen = Screen::NewSelect,
                "jdbc-picker" => self.screen = Screen::JdbcPicker,
                other => {
                    if let Some(kind) = AccountKind::from_screen(other) {
                        self.open_accounts(kind, window, cx);
                    } else if let Some(p) = other.strip_prefix("new-form:") {
                        self.open_new_form(p, window, cx);
                    }
                }
            },
            _ => {}
        }
        self
    }

    /// `loadConnections` (+ tag library, folders, accounts, profile).
    pub fn reload(&mut self) {
        let loaded = Store::open().and_then(|s| {
            Ok((s.connection_rows()?, s.connection_groups()?, s.connection_tag_library()?, s.stored_user_profile().ok().flatten()))
        });
        match loaded {
            Ok((rows, folders, tags, profile)) => {
                self.icons = rows
                    .iter()
                    .filter_map(|r| {
                        let url = r.conn.icon.as_deref()?.strip_prefix("image:")?;
                        Some((r.conn.id, images::from_data_url(url)?))
                    })
                    .collect();
                self.rows = rows;
                self.folders = folders;
                self.tags = tags.iter().filter_map(|t| Some((t.name.clone(), rexa_ui::parse_color(&t.color)?))).collect();
                self.tag_library = tags;
                if let Some((name, email)) = profile {
                    self.user_name = name.filter(|n| !n.trim().is_empty()).unwrap_or_else(|| "User".into());
                    self.user_email = email.unwrap_or_default();
                }
                self.error = None;
            }
            Err(err) => self.error = Some(format!("{err:#}").into()),
        }
        if let Some(web) = WebStore::open() {
            self.avatar = web
                .get("rexa-db-user-avatar")
                .ok()
                .flatten()
                .and_then(|v| images::from_data_url(v.trim_matches('"')));
        }
        self.accounts = accounts::AccountSummary::load();
    }

    pub(crate) fn connections(&self) -> Vec<SavedConnection> {
        self.rows.iter().map(|r| r.conn.clone()).collect()
    }

    fn row(&self, id: i64) -> Option<&ConnectionRow> {
        self.rows.iter().find(|r| r.conn.id == id)
    }

    /// `filteredConnections`.
    fn visible(&self) -> Vec<ConnectionRow> {
        let mut list: Vec<ConnectionRow> = self
            .rows
            .iter()
            .filter(|r| !self.show_only_favorites || r.conn.is_favorite)
            .filter(|r| self.provider_filter.is_empty() || self.provider_filter.iter().any(|p| *p == r.conn.kind))
            .filter(|r| self.folder_filter.as_ref().map_or(true, |f| r.groups.contains(f)))
            .cloned()
            .collect();
        match self.sort_by {
            SortBy::Name => list.sort_by(|a, b| a.conn.name.to_lowercase().cmp(&b.conn.name.to_lowercase())),
            SortBy::Recent => list.sort_by_key(|r| std::cmp::Reverse(r.conn.last_active.unwrap_or(0))),
        }
        list
    }

    fn drag_reorder_enabled(&self) -> bool {
        self.screen == Screen::List && self.reorder_mode && self.visible().len() > 1
    }

    pub(crate) fn go_list(&mut self, cx: &mut Context<Self>) {
        self.screen = Screen::List;
        self.form = None;
        cx.notify();
    }

    // ---- actions -------------------------------------------------------------------

    /// `openConnection`: unlock + connect off-thread, then route to the studio.
    pub fn open_connection(&mut self, id: i64, cx: &mut Context<Self>) {
        let Some(row) = self.row(id).cloned() else { return };
        if !self.opening.insert(id) {
            return;
        }
        cx.notify();
        let name = row.conn.name.clone();
        let kind = providers::provider_of(&row.conn);
        if kind == "federated" {
            self.finish_open(id, cx);
            return;
        }
        let task = rexa_core::connect(row.conn.clone(), cx);
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |this, cx| match result {
                Ok(_) => this.finish_open(id, cx),
                Err(err) => {
                    this.opening.remove(&id);
                    cx.notify();
                    let msg = format!("{err:#}");
                    let creds = msg.contains("keychain")
                        || msg.contains("vault")
                        || msg.contains("credentials");
                    if row.conn.credential_ref.as_deref().is_some_and(|r| r.starts_with("vault:")) && msg.contains("vault") {
                        open_vault_unlock_dialog(id, false, this.weak(cx), cx);
                    } else { open_failure_dialog(
                        if creds { "Credentials locked" } else { "Connection failed" },
                        &name,
                        if creds { format!("Unable to unlock credentials for \"{name}\".") } else { format!("Unable to connect to \"{name}\".") },
                        msg,
                        creds,
                        creds.then_some(id),
                        this.weak(cx),
                        cx,
                    ); }
                }
            })
            .ok();
        })
        .detach();
    }

    fn finish_open(&mut self, id: i64, cx: &mut Context<Self>) {
        if let Ok(store) = Store::open() {
            store.update_connection(id, ConnectionDraft { last_active: Some(rexa_store::now_secs()), ..Default::default() }).ok();
        }
        self.opening.remove(&id);
        rexa_core::navigate(rexa_core::Route::Studio(id), cx);
    }

    fn weak(&self, cx: &Context<Self>) -> gpui::WeakEntity<Self> {
        cx.entity().downgrade()
    }

    /// `handleEdit` / `handleDuplicate`.
    pub fn edit_connection(&mut self, id: i64, duplicate: bool, window: &mut Window, cx: &mut Context<Self>) {
        let Some(row) = self.row(id).cloned() else { return };
        let mode = if duplicate { FormMode::Duplicate } else { FormMode::Edit(id) };
        // Unlock secrets (keychain bundle) so the form shows the real password.
        let mut conn = row.conn.clone();
        if conn.credential_ref.as_deref().is_some_and(|r| !r.is_empty()) {
            let vault = rexa_core::credential_vault(cx);
            if conn.credential_ref.as_deref().is_some_and(|r| r.starts_with("vault:")) && vault.is_none() {
                open_vault_unlock_dialog(id, true, self.weak(cx), cx);
                return;
            }
            match rexa_store::resolve_credentials(&conn, vault.as_deref()) {
                Ok(c) => conn.connection_string = c.connection_string,
                Err(_) => {
                    toast::error(
                        if duplicate {
                            "Could not unlock saved credentials to duplicate. Re-enter the password on the copy."
                        } else {
                            "Could not unlock saved credentials for editing. Re-enter the password to restore this connection."
                        },
                        cx,
                    );
                }
            }
        }
        let row = ConnectionRow { conn, ..row };
        let provider = providers::provider_of(&row.conn);
        let form = cx.new(|cx| ConnectionForm::from_row(mode, &provider, &row, window, cx));
        self.attach_form(form, window, cx);
    }

    pub(crate) fn open_new_form(&mut self, provider: &str, window: &mut Window, cx: &mut Context<Self>) {
        let cs = widgets::value(&self.select_input, cx);
        let form = cx.new(|cx| ConnectionForm::new_for(provider, &cs, window, cx));
        self.attach_form(form, window, cx);
    }

    pub(crate) fn open_jdbc_form(&mut self, t: &crate::fields::JdbcTemplate, window: &mut Window, cx: &mut Context<Self>) {
        let form = cx.new(|cx| ConnectionForm::new_jdbc(t, window, cx));
        self.attach_form(form, window, cx);
    }

    fn attach_form(&mut self, form: Entity<ConnectionForm>, window: &mut Window, cx: &mut Context<Self>) {
        let sub = cx.subscribe_in(&form, window, |this, _, ev: &FormEvent, window, cx| match ev {
            FormEvent::Back { to_select } => {
                this.form = None;
                this.screen = if *to_select { Screen::NewSelect } else { Screen::List };
                widgets::set_value(&this.select_input, "", window, cx);
                window.focus(&this.focus, cx);
                cx.notify();
            }
            FormEvent::Saved => {
                this.form = None;
                this.screen = Screen::List;
                widgets::set_value(&this.select_input, "", window, cx);
                this.reload();
                window.focus(&this.focus, cx);
                cx.notify();
            }
            FormEvent::LibraryChanged => {
                this.reload();
                cx.notify();
            }
        });
        let libs = (self.connections(), self.folders.clone(), self.tag_library.clone());
        form.update(cx, |f, cx| f.set_context(libs.0, libs.1, libs.2, self.accounts.neon_label(), cx));
        self.form = Some((form, sub));
        self.screen = Screen::Form;
        cx.notify();
    }

    pub(crate) fn open_accounts(&mut self, kind: AccountKind, window: &mut Window, cx: &mut Context<Self>) {
        let existing: Vec<String> = self.rows.iter().map(|r| r.conn.connection_string.clone()).collect();
        let view = cx.new(|cx| AccountsScreen::new(kind, existing, window, cx));
        cx.subscribe_in(&view, window, |this, _, ev: &accounts::AccountsEvent, window, cx| match ev {
            accounts::AccountsEvent::Back => {
                this.account_view = None;
                this.go_list(cx);
                window.focus(&this.focus, cx);
            }
            accounts::AccountsEvent::Changed => {
                this.reload();
                cx.notify();
            }
        })
        .detach();
        self.account_view = Some(view);
        self.screen = Screen::Accounts(kind);
        cx.notify();
    }

    fn toggle_favorite(&mut self, id: i64, cx: &mut Context<Self>) {
        let Some(row) = self.row(id) else { return };
        let next = !row.conn.is_favorite;
        let groups = row.groups.clone();
        match Store::open().and_then(|s| s.update_connection(id, ConnectionDraft { is_favorite: Some(next), groups: Some(groups), ..Default::default() })) {
            Ok(()) => {
                self.reload();
                toast::success(if next { "Added to favorites" } else { "Removed from favorites" }, cx);
            }
            Err(_) => {
                toast::error("Failed to update favorite status", cx);
            }
        }
        cx.notify();
    }

    fn toggle_folder(&mut self, id: i64, folder: &str, cx: &mut Context<Self>) {
        let Some(row) = self.row(id) else { return };
        let mut groups = row.groups.clone();
        if let Some(i) = groups.iter().position(|g| g == folder) {
            groups.remove(i);
        } else {
            groups.push(folder.to_string());
        }
        if let Err(e) = Store::open().and_then(|s| s.update_connection(id, ConnectionDraft { groups: Some(groups), ..Default::default() })) {
            toast::error(format!("{e:#}"), cx);
        }
        self.reload();
        cx.notify();
    }

    fn copy_uri(&self, id: i64, cx: &mut Context<Self>) {
        if let Some(r) = self.row(id) {
            cx.write_to_clipboard(ClipboardItem::new_string(r.conn.connection_string.clone()));
        }
    }

    fn request_delete(&mut self, id: i64, cx: &mut Context<Self>) {
        let name = self.row(id).map(|r| r.conn.name.clone()).unwrap_or_else(|| "this connection".into());
        let fut = confirm(
            ConfirmOptions::destructive("Delete Connection")
                .description(format!("Are you sure you want to delete \"{name}\"? This action cannot be undone."))
                .confirm_text("Delete"),
            cx,
        );
        cx.spawn(async move |this, cx| {
            if fut.await {
                this.update(cx, |this, cx| {
                    match Store::open().and_then(|s| s.delete_connection(id)) {
                        Ok(()) => {}
                        Err(e) => {
                            toast::error(format!("{e:#}"), cx);
                        }
                    }
                    rexa_core_sessions_forget(id, cx);
                    this.reload();
                    cx.notify();
                })
                .ok();
            }
        })
        .detach();
    }

    fn set_view_mode(&mut self, mode: ViewMode, cx: &mut Context<Self>) {
        self.view_mode = mode;
        if let Ok(s) = Store::open() {
            s.set_setting(VIEW_KEY, &format!("\"{}\"", if mode == ViewMode::List { "list" } else { "card" })).ok();
        }
        cx.notify();
    }

    /// `handleExport`: JSON of every row, like `JSON.stringify(connections)`.
    fn export_connections(&mut self, cx: &mut Context<Self>) {
        let data: Vec<serde_json::Value> = self.rows.iter().map(row_json).collect();
        let json = serde_json::to_string_pretty(&data).unwrap_or_default();
        let date = chrono_date();
        let dir = dirs::download_dir().unwrap_or_else(std::env::temp_dir);
        let rx = cx.prompt_for_new_path(&dir, Some(&format!("rexadb-connections-{date}.json")));
        cx.spawn(async move |_, cx| {
            if let Ok(Ok(Some(path))) = rx.await {
                let ok = std::fs::write(&path, json).is_ok();
                cx.update(|cx| {
                    if ok {
                        toast::success("Connections exported.", cx);
                    } else {
                        toast::error("Export failed.", cx);
                    }
                });
            }
        })
        .detach();
    }

    /// `handleImport`.
    fn import_connections(&mut self, cx: &mut Context<Self>) {
        let rx = cx.prompt_for_paths(gpui::PathPromptOptions { files: true, directories: false, multiple: false, prompt: None });
        cx.spawn(async move |this, cx| {
            let Ok(Ok(Some(paths))) = rx.await else { return };
            let Some(path) = paths.first() else { return };
            let result = (|| -> anyhow::Result<usize> {
                let text = std::fs::read_to_string(path)?;
                let items: Vec<serde_json::Value> = match serde_json::from_str(&text)? {
                    serde_json::Value::Array(a) => a,
                    _ => anyhow::bail!("Invalid format."),
                };
                let store = Store::open()?;
                let mut count = 0;
                for c in items {
                    let s = |k: &str| c.get(k).and_then(|v| v.as_str()).map(str::to_string);
                    let Some(cs) = s("connectionString") else { continue };
                    let tags = match c.get("tags") {
                        Some(serde_json::Value::Array(a)) => Some(a.iter().filter_map(|t| t.as_str().map(str::to_string)).collect()),
                        _ => s("environment").map(|e| vec![e]),
                    };
                    let groups = match c.get("groups") {
                        Some(serde_json::Value::Array(a)) => Some(a.iter().filter_map(|t| t.as_str().map(str::to_string)).collect()),
                        _ => s("group").map(|g| vec![g]),
                    };
                    let draft = ConnectionDraft {
                        name: Some(s("name").unwrap_or_else(|| "Imported Connection".into())),
                        connection_string: Some(cs),
                        connection_type: s("connectionType").or_else(|| s("connection_type")),
                        tags,
                        icon: Some(s("icon")),
                        color: Some(s("color")),
                        groups,
                        is_favorite: Some(c.get("isFavorite").and_then(|v| v.as_bool()).unwrap_or(false)),
                        ..Default::default()
                    };
                    if store.create_connection(draft).is_ok() {
                        count += 1;
                    }
                }
                Ok(count)
            })();
            this.update(cx, |this, cx| {
                match result {
                    Ok(n) => {
                        toast::success(format!("Imported {n} connections."), cx);
                    }
                    Err(_) => {
                        toast::error("Import failed.", cx);
                    }
                }
                this.reload();
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    fn open_folder_prompt(&mut self, rename: Option<String>, window: &mut Window, cx: &mut Context<Self>) {
        let input = cx.new(|cx| InputState::new(window, cx).placeholder("e.g. Work, Personal").default_value(rename.clone().unwrap_or_default()));
        widgets::focus(&input, window, cx);
        let weak = self.weak(cx);
        let submit = {
            let (input, weak, rename) = (input.clone(), weak.clone(), rename.clone());
            std::rc::Rc::new(move |_: &mut Window, cx: &mut App| {
                let v = input.read(cx).value().trim().to_string();
                if v.is_empty() {
                    return;
                }
                let res = Store::open().and_then(|s| match &rename {
                    Some(old) if *old != v => s.rename_connection_group(old, &v),
                    Some(_) => Ok(()),
                    None => s.add_connection_group(&v),
                });
                match (&res, &rename) {
                    (Ok(()), None) => toast::success(format!("Folder \"{v}\" created."), cx),
                    (Ok(()), Some(_)) => toast::success(format!("Renamed folder to \"{v}\"."), cx),
                    (Err(_), None) => toast::error("Failed to create folder.", cx),
                    (Err(_), Some(_)) => toast::error("Failed to rename folder.", cx),
                };
                rexa_ui::close_top(cx);
                weak.update(cx, |this, cx| {
                    this.reload();
                    cx.notify();
                })
                .ok();
            })
        };
        let sub_enter = submit.clone();
        cx.subscribe_in(&input, window, move |_, _, ev: &gpui_component::input::InputEvent, window, cx| {
            if let gpui_component::input::InputEvent::PressEnter { .. } = ev {
                sub_enter(window, cx);
            }
        })
        .detach();
        let adding = rename.is_none();
        let old = rename.unwrap_or_default();
        rexa_ui::open_dialog(cx, move |_, cx| {
            let t = cx.tokens().clone();
            let empty = input.read(cx).value().trim().is_empty();
            let s1 = submit.clone();
            Dialog::new()
                .max_w(400.)
                .title(if adding { "Create Folder" } else { "Rename Folder" })
                .description(if adding { "Enter a name for the new folder.".to_string() } else { format!("Enter a new name for \"{old}\".") })
                .child(
                    div().py_4().child(
                        div()
                            .flex()
                            .flex_col()
                            .gap_2()
                            .child(div().tw_text_xs().font_weight(FontWeight::MEDIUM).text_color(t.muted_foreground).child("Folder Name"))
                            .child(widgets::FieldInput::new(&input).h(32.).muted()),
                    ),
                )
                .footer(Button::new("folder-cancel").ghost().label("Cancel").on_click(|_, _, cx| rexa_ui::close_top(cx)))
                .footer(
                    Button::new("folder-ok")
                        .label(if adding { "Create" } else { "Rename" })
                        .disabled(empty)
                        .on_click(move |_, w, cx| s1(w, cx)),
                )
        });
    }

    /// The folder delete dialog ("Delete folder and connections" / "Delete folder only").
    fn open_folder_delete(&mut self, folder: String, cx: &mut Context<Self>) {
        let option = std::rc::Rc::new(std::cell::Cell::new(false)); // true = with connections
        let weak = self.weak(cx);
        rexa_ui::open_alert_dialog(cx, move |_, cx| {
            let t = cx.tokens().clone();
            let with = option.get();
            let choice = |id: &'static str, active: bool, destructive: bool, title: &'static str, desc: &'static str, set: bool, option: std::rc::Rc<std::cell::Cell<bool>>| {
                let tone = if destructive { t.destructive } else { t.primary };
                div()
                    .id(id)
                    .flex()
                    .items_start()
                    .gap_3()
                    .p_3()
                    .tw_rounded_lg()
                    .border_1()
                    .cursor_pointer()
                    .when(active, |d| d.bg(with_alpha(tone, 0.05)).border_color(with_alpha(tone, 0.3)))
                    .when(!active, |d| d.bg(with_alpha(t.muted, 0.3)).border_color(with_alpha(t.border, 0.4)).hover(|s| s.bg(with_alpha(t.muted, 0.5))))
                    .on_click(move |_, window, _| {
                        option.set(set);
                        window.refresh();
                    })
                    .child(
                        div()
                            .mt_1()
                            .size_4()
                            .tw_rounded_lg()
                            .border_1()
                            .flex()
                            .items_center()
                            .justify_center()
                            .border_color(if active { tone } else { t.muted_foreground })
                            .when(active, |d| d.bg(tone).child(div().size(px(6.)).tw_rounded_lg().bg(gpui::white()))),
                    )
                    .child(
                        div()
                            .child(div().tw_text_sm().font_weight(FontWeight::MEDIUM).child(title))
                            .child(div().tw_text_xs().text_color(t.muted_foreground).child(desc)),
                    )
            };
            let (folder2, weak2, option2) = (folder.clone(), weak.clone(), option.clone());
            rexa_ui::AlertDialog::new()
                .media(Icon::new(IconName::CircleAlert).size_5().text_color(rexa_ui::tw("red-500")))
                .title(format!("Delete Folder: {folder}"))
                .description("How would you like to handle the connections inside this folder?")
                .child(
                    div()
                        .py_4()
                        .flex()
                        .flex_col()
                        .gap_3()
                        .child(choice("fd-with", with, true, "Delete folder and connections", "Permanently removes the folder and all its connections.", true, option.clone()))
                        .child(choice("fd-keep", !with, false, "Delete folder only", "Connections will be moved to the unassigned list.", false, option.clone())),
                )
                .footer(Button::new("fd-cancel").ghost().label("Cancel").on_click(|_, _, cx| rexa_ui::close_top(cx)))
                .footer(Button::new("fd-ok").destructive().label("Delete").on_click(move |_, _, cx| {
                    let with = option2.get();
                    let folder = folder2.clone();
                    weak2
                        .update(cx, |this, cx| {
                            let res = Store::open().and_then(|s| {
                                for r in this.rows.iter().filter(|r| r.groups.contains(&folder)) {
                                    if with {
                                        s.delete_connection(r.conn.id)?;
                                    } else {
                                        let g: Vec<String> = r.groups.iter().filter(|g| **g != folder).cloned().collect();
                                        s.update_connection(r.conn.id, ConnectionDraft { groups: Some(g), ..Default::default() })?;
                                    }
                                }
                                s.delete_connection_group(&folder)
                            });
                            match res {
                                Ok(()) => toast::success(format!("Deleted folder \"{folder}\"."), cx),
                                Err(_) => toast::error("Failed to delete folder.", cx),
                            };
                            if this.folder_filter.as_deref() == Some(folder.as_str()) {
                                this.folder_filter = None;
                            }
                            this.reload();
                            cx.notify();
                        })
                        .ok();
                    rexa_ui::close_top(cx);
                }))
        });
    }

    fn open_command_menu(&mut self, cx: &mut Context<Self>) {
        let rows = self.rows.clone();
        let weak = self.weak(cx);
        // Leading `h-7 w-7 rounded-lg border border-studio-border bg-studio-bg/60` tile.
        fn tile(child: gpui::AnyElement, cx: &App) -> gpui::AnyElement {
            let t = cx.tokens();
            div()
                .flex()
                .size_7()
                .flex_shrink_0()
                .items_center()
                .justify_center()
                .tw_rounded_lg()
                .border_1()
                .border_color(t.studio_border)
                .bg(with_alpha(t.studio_bg, 0.6))
                .child(child)
                .into_any_element()
        }
        rexa_ui::open_command_dialog_with_footer(
            cx,
            "connections-search",
            "Search connections...",
            move |_, _| {
                let items = rows.iter().map(|r| {
                    let (id, weak) = (r.conn.id, weak.clone());
                    let provider = crate::providers::provider_of(&r.conn);
                    rexa_ui::CommandItem::new(r.conn.name.clone())
                        .value(format!("{} {}", r.conn.name, r.conn.id))
                        .keywords([r.conn.name.clone(), r.conn.connection_string.clone()])
                        .leading(move |cx| tile(provider_logo(&provider, 16., cx), cx))
                        .on_select(move |_, cx| {
                            weak.update(cx, |this, cx| this.open_connection(id, cx)).ok();
                        })
                });
                vec![
                    rexa_ui::CommandGroup::new("Connections").items(items),
                    rexa_ui::CommandGroup::new("Actions").item(
                        rexa_ui::CommandItem::new("Open Browser")
                            .value("open-browser")
                            .keywords(["browser", "web", "internet", "url"])
                            .leading(|cx| tile(Icon::new(IconName::Globe).size_4().into_any_element(), cx)),
                    ),
                ]
            },
            |_, cx| {
                let t = cx.tokens().clone();
                // `h-10 border-t border-studio-border bg-studio-bg px-4 text-xs`: <Kbd>Enter</Kbd> Select.
                Some(
                    div()
                        .flex()
                        .h_10()
                        .items_center()
                        .gap_2()
                        .border_t_1()
                        .border_color(t.studio_border)
                        .bg(t.studio_bg)
                        .px_4()
                        .tw_text_xs()
                        .font_weight(FontWeight::MEDIUM)
                        .text_color(t.muted_foreground)
                        .child(rexa_ui::Kbd::new("Enter"))
                        .child("Select")
                        .into_any_element(),
                )
            },
        );
    }

    // ---- keyboard -------------------------------------------------------------------

    fn on_key_down(&mut self, ev: &KeyDownEvent, window: &mut Window, cx: &mut Context<Self>) {
        let k = &ev.keystroke;
        let key = k.key.as_str();
        let cmd = k.modifiers.platform || k.modifiers.control;
        let root_focused = self.focus.is_focused(window);
        match &self.screen {
            Screen::List => {
                if !root_focused {
                    return;
                }
                let n = self.visible().len();
                if n == 0 {
                    return;
                }
                match key {
                    "/" => self.open_command_menu(cx),
                    "k" if cmd => self.open_command_menu(cx),
                    "n" if !cmd => {
                        self.screen = Screen::NewSelect;
                        self.provider_focus = 0;
                        cx.notify();
                    }
                    "m" if !cmd => {
                        self.manage_menu = Some(self.manage_menu.map_or(1, |g| g + 1));
                        cx.notify();
                    }
                    "down" | "j" if !cmd => self.selected_index = (self.selected_index + 1) % n,
                    "up" | "k" => self.selected_index = (self.selected_index + n - 1) % n,
                    "enter" if k.modifiers.platform && k.modifiers.shift => {
                        if let Some(r) = self.visible().get(self.selected_index) {
                            self.open_connection(r.conn.id, cx);
                        }
                    }
                    _ => return,
                }
                cx.stop_propagation();
            }
            Screen::NewSelect => {
                if key == "escape" {
                    self.go_list(cx);
                    widgets::set_value(&self.select_input, "", window, cx);
                    window.focus(&self.focus, cx);
                    return;
                }
                if !root_focused {
                    return;
                }
                let n = providers::PROVIDER_CARDS.len();
                match key {
                    "/" => widgets::focus(&self.select_input, window, cx),
                    "right" | "down" => self.provider_focus = (self.provider_focus + 1) % n,
                    "left" | "up" => self.provider_focus = (self.provider_focus + n - 1) % n,
                    "enter" => {
                        let id = providers::PROVIDER_CARDS[self.provider_focus].id;
                        self.select_provider(id, window, cx);
                    }
                    d if d.len() == 1 && ("1"..="9").contains(&d) => {
                        let i = d.parse::<usize>().unwrap() - 1;
                        let id = providers::PROVIDER_CARDS[i].id;
                        self.select_provider(id, window, cx);
                    }
                    _ => return,
                }
                cx.notify();
            }
            Screen::JdbcPicker => {
                if key == "escape" {
                    self.screen = Screen::NewSelect;
                    cx.notify();
                }
            }
            Screen::Accounts(_) => {
                if key == "escape" {
                    self.account_view = None;
                    self.go_list(cx);
                }
            }
            Screen::Form => {}
        }
    }

    pub(crate) fn select_provider(&mut self, id: &str, window: &mut Window, cx: &mut Context<Self>) {
        if id == "jdbc" {
            self.screen = Screen::JdbcPicker;
            cx.notify();
        } else {
            widgets::set_value(&self.select_input, "", window, cx);
            self.open_new_form(id, window, cx);
        }
    }

    fn on_select_input(&mut self, state: &Entity<InputState>, ev: &gpui_component::input::InputEvent, window: &mut Window, cx: &mut Context<Self>) {
        if !matches!(ev, gpui_component::input::InputEvent::Change) || self.screen != Screen::NewSelect {
            return;
        }
        let next = state.read(cx).value().to_string();
        if let Some(detected) = providers::detect(&next, None) {
            if next.contains("://") && next.len() > 16 {
                let form = cx.new(|cx| ConnectionForm::new_for(&detected, &next, window, cx));
                self.attach_form(form, window, cx);
            }
        }
    }

    // ---- list rendering (pixel-verified; see native/reference/connections-home.png) ----

    fn render_header_button(id: &'static str, _title: SharedString, t: &Tokens, child: impl IntoElement) -> gpui::Stateful<gpui::Div> {
        // h-7 w-7 rounded-full border border-studio-border bg-background/15 hover:bg-background/25
        div()
            .id(id)
            .flex()
            .items_center()
            .justify_center()
            .size(px(28.))
            .rounded_full()
            .border_1()
            .border_color(t.studio_border)
            .bg(with_alpha(t.background, 0.15))
            .hover(|s| s.bg(with_alpha(t.background, 0.25)))
            .cursor_pointer()
            .child(child)
    }

    fn render_update_pill(&self, t: &Tokens, cx: &App) -> Option<gpui::AnyElement> {
        let u = cx.try_global::<UpdateState>()?.clone();
        if !u.enabled || u.checking || u.dismissed || (!u.update_available && !u.downloading && !u.update_downloaded) {
            return None;
        }
        let version = u.latest_version.map(|v| format!(" · v{v}")).unwrap_or_default();
        let (tone, icon, text) = if u.updates_expired && u.update_available {
            ("amber", IconName::ExternalLink, format!("Renew{version}"))
        } else if u.update_downloaded {
            ("emerald", IconName::CircleCheck, format!("Restart{version}"))
        } else if u.downloading {
            ("blue", IconName::LoaderCircle, u.progress_percent.map_or("Updating…".into(), |p| format!("{p}%")))
        } else if u.nix {
            ("blue", IconName::Terminal, format!("Update via nix{version}"))
        } else {
            ("blue", IconName::Download, format!("Update{version}"))
        };
        let c = rexa_ui::tw(&format!("{tone}-500"));
        let _ = t;
        Some(
            div()
                .id("update-pill")
                .flex()
                .h_7()
                .items_center()
                .gap(px(6.))
                .rounded_full()
                .border_1()
                .px(px(10.))
                .tw_text_xs()
                .border_color(with_alpha(c, 0.3))
                .bg(with_alpha(c, 0.1))
                .text_color(rexa_ui::tw(&format!("{tone}-400")))
                .hover(|s| s.bg(with_alpha(c, 0.15)).border_color(with_alpha(c, 0.4)))
                .child(Icon::new(icon).size(px(14.)))
                .child(text)
                .into_any_element(),
        )
    }

    fn render_nav_user(&self, t: &Tokens) -> impl IntoElement {
        // NavUser: Avatar size-7 → DropdownMenu w-60 (avatar size-10 + name/email, Profile, Sign in).
        let avatar = self.avatar.clone();
        let (name, email) = (self.user_name.clone(), self.user_email.clone());
        let avatar_el = |size: f32, avatar: &Option<Arc<Image>>, name: &str| match avatar {
            Some(image) => img(image.clone()).size(px(size)).rounded_full().object_fit(ObjectFit::Cover).into_any_element(),
            None => rexa_ui::FallbackAvatar::new(name.to_string(), size).into_any_element(),
        };
        let trigger = div().cursor_pointer().child(avatar_el(28., &avatar, &name));
        let fg = t.foreground;
        let muted = t.muted_foreground;
        DropdownMenu::new("nav-user")
            .align(Align::End)
            .trigger(trigger)
            .menu(move |menu, _, _| {
                menu.w(240.)
                    .custom(
                        div()
                            .flex()
                            .items_center()
                            .gap_3()
                            .px(px(6.))
                            .py_1()
                            .child(avatar_el(40., &avatar, &name))
                            .child(
                                div()
                                    .min_w_0()
                                    .child(div().tw_text_sm().font_weight(FontWeight::MEDIUM).text_color(fg).child(name.clone()))
                                    .child(div().tw_text_xs().text_color(muted).overflow_hidden().text_ellipsis().whitespace_nowrap().child(email.clone())),
                            ),
                    )
                    .separator()
                    .item(MenuItem::new("Profile").icon(IconName::User).on_select(|_, cx| {
                        rexa_core::navigate(rexa_core::Route::ConnectionScreen("profile".into()), cx);
                    }))
                    .separator()
                    .item(MenuItem::new("Sign in").icon(IconName::LogIn).on_select(|_, cx| rexa_core::navigate(rexa_core::Route::Auth, cx)))
            })
    }

    fn render_title_row(&self, t: &Tokens, cx: &mut Context<Self>) -> impl IntoElement {
        let mut right = div().flex().items_center().gap_2().children(self.render_update_pill(t, cx));
        let a = &self.accounts;
        if !a.supabase.is_empty() {
            right = right.child(
                Self::render_header_button("supabase-accounts", a.title(AccountKind::Supabase).into(), t, img("brand/supabase.svg").size(px(16. * 0.78)))
                    .on_click(cx.listener(|this, _, w, cx| this.open_accounts(AccountKind::Supabase, w, cx))),
            );
        }
        if !a.spacetimedb.is_empty() {
            right = right.child(
                Self::render_header_button(
                    "spacetimedb-accounts",
                    a.title(AccountKind::SpacetimeDb).into(),
                    t,
                    svg().path("brand/spacetimedb.svg").size_4().text_color(with_alpha(t.foreground, 0.8)),
                )
                .on_click(cx.listener(|this, _, w, cx| this.open_accounts(AccountKind::SpacetimeDb, w, cx))),
            );
        }
        if !a.neon.is_empty() {
            right = right.child(
                Self::render_header_button("neon-accounts", a.title(AccountKind::Neon).into(), t, img("brand/neon.svg").size(px(16. * 0.72)))
                    .on_click(cx.listener(|this, _, w, cx| this.open_accounts(AccountKind::Neon, w, cx))),
            );
        }
        if accounts::PLANETSCALE_LOGIN_ENABLED && !a.planetscale.is_empty() {
            right = right.child(
                Self::render_header_button("planetscale-accounts", a.title(AccountKind::Planetscale).into(), t, img("providers/planetscale.png").size_4())
                    .on_click(cx.listener(|this, _, w, cx| this.open_accounts(AccountKind::Planetscale, w, cx))),
            );
        }
        right = right.child(
            Self::render_header_button(
                "settings",
                "Settings".into(),
                t,
                Icon::new(IconName::Settings).size(px(14.)).text_color(with_alpha(t.muted_foreground, 0.6)),
            )
            .on_click(|_, _, cx| rexa_core::navigate(rexa_core::Route::ConnectionScreen("settings".into()), cx)),
        );
        right = right.child(self.render_nav_user(t));

        div()
            .flex()
            .items_center()
            .justify_between()
            .mb_6()
            .child(
                // text-[28px] font-semibold tracking-tight
                div()
                    .text_size(px(28.))
                    .line_height(px(42.))
                    .font_weight(FontWeight::SEMIBOLD)
                    .text_color(t.foreground)
                    .child(tracked_text::tight("Connections")),
            )
            .child(right)
    }

    fn toolbar_button(id: &'static str, t: &Tokens, dashed: bool) -> gpui::Stateful<gpui::Div> {
        // h-9 px-3 rounded-lg border border-border bg-background text-sm flex items-center gap-2
        let el = div()
            .id(id)
            .flex()
            .items_center()
            .gap_2()
            .h_9()
            .px_3()
            .rounded(px(t.radius))
            .border_1()
            .border_color(t.border)
            .bg(t.background)
            .text_size(px(14.))
            .line_height(px(20.))
            .cursor_pointer();
        if dashed { el.border_dashed() } else { el }
    }

    fn provider_filter_menu(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        let mut trigger = Self::toolbar_button("providers", &t, true).child(div().text_color(t.foreground).child("Providers"));
        if !self.provider_filter.is_empty() {
            // flex -space-x-1.5 of h-5 w-5 rounded-full logo chips, then +N
            let mut chips = div().flex();
            for (i, id) in self.provider_filter.iter().take(3).enumerate() {
                chips = chips.child(
                    div()
                        .when(i > 0, |d| d.ml(px(-6.)))
                        .size_5()
                        .rounded_full()
                        .border_1()
                        .border_color(t.background)
                        .bg(t.background)
                        .flex()
                        .items_center()
                        .justify_center()
                        .overflow_hidden()
                        .child(provider_logo(id, if matches!(id.as_str(), "spacetimedb" | "supabase" | "neon") { 12. } else { 14. }, cx)),
                );
            }
            if self.provider_filter.len() > 3 {
                chips = chips.child(
                    div()
                        .ml(px(-6.))
                        .size_5()
                        .rounded_full()
                        .border_1()
                        .border_color(t.background)
                        .bg(t.muted)
                        .flex()
                        .items_center()
                        .justify_center()
                        .tw_text_10()
                        .font_weight(FontWeight::MEDIUM)
                        .child(format!("+{}", self.provider_filter.len() - 3)),
                );
            }
            trigger = trigger.child(chips);
        }
        trigger = trigger.child(Icon::new(IconName::ChevronDown).size_4().text_color(with_alpha(t.muted_foreground, 0.6)));
        let filter = self.provider_filter.clone();
        let weak = self.weak(cx);
        DropdownMenu::new("providers-menu").trigger(trigger).menu(move |menu, _, cx| {
            let w = weak.clone();
            let mut menu = menu
                .min_w(180.)
                .item(
                    MenuItem::new("All providers")
                        .text_xs()
                        .keep_open()
                        .leading(div())
                        .shortcut(if filter.is_empty() { "✓" } else { "" })
                        .on_select(move |_, cx| {
                            w.update(cx, |this, cx| {
                                this.provider_filter.clear();
                                cx.notify();
                            })
                            .ok();
                        }),
                )
                .separator();
            for card in providers::PROVIDER_CARDS {
                let w = weak.clone();
                let checked = filter.iter().any(|f| f == card.id);
                menu = menu.item(
                    MenuItem::new(card.label)
                        .text_xs()
                        .keep_open()
                        .leading(div().size_4().rounded_full().overflow_hidden().child(provider_logo(card.id, 16., cx)))
                        .shortcut(if checked { "✓" } else { "" })
                        .on_select(move |_, cx| {
                            w.update(cx, |this, cx| {
                                if let Some(i) = this.provider_filter.iter().position(|p| p == card.id) {
                                    this.provider_filter.remove(i);
                                } else {
                                    this.provider_filter.push(card.id.to_string());
                                }
                                cx.notify();
                            })
                            .ok();
                        }),
                );
            }
            menu
        })
    }

    fn render_toolbar(&self, t: &Tokens, cx: &mut Context<Self>) -> impl IntoElement {
        let search = Self::toolbar_button("search", t, false)
            .flex_1()
            .max_w(px(384.))
            .justify_between()
            .on_click(cx.listener(|this, _, _, cx| this.open_command_menu(cx)))
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap_2()
                    .text_color(t.muted_foreground)
                    .child(Icon::new(IconName::Search).size_4().text_color(with_alpha(t.muted_foreground, 0.6)))
                    .child("Search connections..."),
            )
            .child(div().ml_2().child(Kbd::shortcut("K").px(6.)));

        let sort_label = match self.sort_by {
            SortBy::Name => "Sorted by name",
            SortBy::Recent => "Sorted by recent",
        };
        let weak = self.weak(cx);
        let sort = DropdownMenu::new("sort-menu")
            .trigger(
                Self::toolbar_button("sort", t, false)
                    .child(Icon::new(IconName::SlidersHorizontal).size_4().text_color(with_alpha(t.muted_foreground, 0.7)))
                    .child(sort_label),
            )
            .menu(move |menu, _, _| {
                let (w1, w2) = (weak.clone(), weak.clone());
                menu.item(MenuItem::new("Sorted by name").text_xs().icon(IconName::ArrowUpDown).icon_size(14.).on_select(move |_, cx| {
                    w1.update(cx, |this, cx| {
                        this.sort_by = SortBy::Name;
                        cx.notify();
                    })
                    .ok();
                }))
                .item(MenuItem::new("Sorted by recent").text_xs().icon(IconName::ArrowUpDown).icon_size(14.).on_select(move |_, cx| {
                    w2.update(cx, |this, cx| {
                        this.sort_by = SortBy::Recent;
                        cx.notify();
                    })
                    .ok();
                }))
            });

        let toggle_button = |id: &'static str, icon: IconName, mode: ViewMode, active: bool, _label: &'static str, cx: &mut Context<Self>| {
            // Button size icon-sm (size-7) rounded-md; active = secondary (+ rexa-raised), else ghost.
            let el = div()
                .id(id)
                .flex()
                .items_center()
                .justify_center()
                .size_7()
                .rounded(px(t.radius - 2.))
                .border_1()
                .cursor_pointer()
                .child(Icon::new(icon).size_4());
            let el = if active {
                el.border_color(rexa_ui::white(0.2)).bg(rexa_ui::white(0.07)).text_color(rexa_ui::tw("neutral-100"))
            } else {
                el.border_color(gpui::transparent_black())
                    .text_color(t.muted_foreground)
                    .hover(|s| s.bg(rexa_ui::white(0.06)).text_color(t.foreground))
            };
            el.on_click(cx.listener(move |this, _, _, cx| this.set_view_mode(mode, cx)))
        };

        let view_toggle = div()
            .flex()
            .flex_shrink_0()
            .items_center()
            .gap(px(2.))
            .h_9()
            .p(px(2.))
            .rounded(px(t.radius))
            .border_1()
            .border_color(t.border)
            .bg(t.background)
            .child(toggle_button("view-card", IconName::LayoutGrid, ViewMode::Card, self.view_mode == ViewMode::Card, "Grid view", cx))
            .child(toggle_button("view-list", IconName::List, ViewMode::List, self.view_mode == ViewMode::List, "List view", cx));

        let new_connection = Self::toolbar_button("new-connection", t, false)
            .child(Icon::new(IconName::Plus).size_4().text_color(with_alpha(t.muted_foreground, 0.7)))
            .child("New Connection")
            .on_click(cx.listener(|this, _, window, cx| {
                widgets::set_value(&this.select_input, "", window, cx);
                this.screen = Screen::NewSelect;
                this.provider_focus = 0;
                cx.notify();
            }));

        div()
            .flex()
            .flex_wrap()
            .items_center()
            .gap_2()
            .mb_6()
            .child(search)
            .child(self.provider_filter_menu(cx))
            .child(sort)
            .child(
                div()
                    .ml_auto()
                    .flex()
                    .items_center()
                    .gap_2()
                    .child(view_toggle)
                    .child(div().relative().child(new_connection).children(self.render_manage_menu(cx))),
            )
    }

    /// `renderManageDropdown` — in the original it is only reachable through the
    /// `M` shortcut; here `M` opens it under the New Connection button.
    fn render_manage_menu(&self, cx: &mut Context<Self>) -> Option<gpui::AnyElement> {
        let generation = self.manage_menu?;
        let weak = self.weak(cx);
        let (reorder, favs, view) = (self.reorder_mode, self.show_only_favorites, self.view_mode);
        Some(
            div()
                .absolute()
                .right_0()
                .bottom_0()
                .child(
                    DropdownMenu::new(("manage-menu", generation))
                        .align(Align::End)
                        .open_on_mount()
                        .trigger(div().w(px(1.)).h(px(1.)))
                        .menu(move |menu, _, _| {
                            let w = weak.clone();
                            let act = move |f: fn(&mut ConnectionsScreen, &mut Window, &mut Context<ConnectionsScreen>)| {
                                let w = w.clone();
                                move |window: &mut Window, cx: &mut App| {
                                    w.update(cx, |this, cx| f(this, window, cx)).ok();
                                }
                            };
                            menu.item(MenuItem::new(if reorder { "Done Reordering" } else { "Reorder Connections" }).on_select(act(|this, _, cx| {
                                this.reorder_mode = !this.reorder_mode;
                                cx.notify();
                            })))
                            .item(
                                MenuItem::new(if favs { "Show All Connections" } else { "Show Only Favorites" })
                                    .icon(IconName::Star)
                                    .on_select(act(|this, _, cx| {
                                        this.show_only_favorites = !this.show_only_favorites;
                                        cx.notify();
                                    })),
                            )
                            .item(
                                MenuItem::new(if view == ViewMode::List { "Grid View" } else { "List View" })
                                    .icon(if view == ViewMode::List { IconName::Square } else { IconName::List })
                                    .on_select(act(|this, _, cx| {
                                        let next = if this.view_mode == ViewMode::List { ViewMode::Card } else { ViewMode::List };
                                        this.set_view_mode(next, cx);
                                    })),
                            )
                            .item(MenuItem::new("Add Folder").icon(IconName::Plus).on_select(act(|this, w, cx| this.open_folder_prompt(None, w, cx))))
                            .item(MenuItem::new("Compare Schemas").icon(IconName::ArrowRightLeft).on_select(|_, cx| {
                                rexa_core::navigate(rexa_core::Route::ConnectionScreen("compare".into()), cx)
                            }))
                            .item(MenuItem::new("Transfer Project").icon(IconName::ArrowRightLeft).on_select(|_, cx| {
                                rexa_core::navigate(rexa_core::Route::ConnectionScreen("transfer".into()), cx)
                            }))
                            .separator()
                            .item(MenuItem::new("Cloud Sync").icon(IconName::ShieldCheck).on_select(|_, cx| {
                                rexa_core::navigate(rexa_core::Route::ConnectionScreen("cloud-sync".into()), cx)
                            }))
                            .separator()
                            .item(MenuItem::new("Export Connections").icon(IconName::ArrowUpDown).on_select(act(|this, _, cx| this.export_connections(cx))))
                            .item(MenuItem::new("Import Connections").icon(IconName::Plus).on_select(act(|this, _, cx| this.import_connections(cx))))
                        }),
                )
                .into_any_element(),
        )
    }

    fn render_logo(&self, conn: &SavedConnection, provider: &str, size: f32, t: &Tokens) -> gpui::AnyElement {
        if let Some(image) = self.icons.get(&conn.id) {
            return img(image.clone()).size(px(size)).rounded(px(t.radius - 2.)).object_fit(ObjectFit::Cover).into_any_element();
        }
        if let Some(emoji) = conn.icon.as_deref().and_then(|i| i.strip_prefix("emoji:")) {
            return div()
                .size(px(size))
                .flex()
                .items_center()
                .justify_center()
                .text_size(px(size * 0.85))
                .child(emoji.to_string())
                .into_any_element();
        }
        if provider == "spacetimedb" {
            return svg().path("brand/spacetimedb.svg").size(px(size)).text_color(t.foreground).into_any_element();
        }
        let logo = providers::card(provider).map_or_else(|| providers::logo_for(provider), |c| c.logo);
        img(logo).size(px(size)).rounded(px(t.radius)).object_fit(ObjectFit::Contain).into_any_element()
    }

    fn render_tag(&self, name: &str) -> impl IntoElement {
        // ConnectionTagBadge: h-4.5 rounded-full px-2 text-[10px] font-medium,
        // color tone, bg tone/0x1a, inset 1px ring tone/0x33.
        tag_badge(name, self.tags.get(name).copied())
    }

    /// The card/list ⋮ menu (`renderConnectionListActions` / the card dropdown).
    fn connection_menu(&self, id: i64, list: bool, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        let favorite = self.row(id).is_some_and(|r| r.conn.is_favorite);
        let groups = self.row(id).map(|r| r.groups.clone()).unwrap_or_default();
        let folders = self.folders.clone();
        let weak = self.weak(cx);
        let trigger = div()
            .id(SharedString::from(format!("more-{id}")))
            .flex()
            .items_center()
            .justify_center()
            .when(list, |d| d.size_7().tw_rounded_lg())
            .when(!list, |d| d.size_8().rounded(px(t.radius)))
            .cursor_pointer()
            .text_color(t.muted_foreground)
            .hover(|s| s.text_color(t.foreground).bg(with_alpha(t.muted, 0.6)))
            .child(Icon::new(IconName::EllipsisVertical).size(px(if list { 14. } else { 16. })))
            .on_click(|_, _, cx| cx.stop_propagation());
        DropdownMenu::new(SharedString::from(format!("conn-menu-{id}")))
            .align(Align::End)
            .trigger(trigger)
            .menu(move |menu, _, _| {
                let w = weak.clone();
                let act = move |f: Box<dyn Fn(&mut ConnectionsScreen, &mut Window, &mut Context<ConnectionsScreen>)>| {
                    let w = w.clone();
                    move |window: &mut Window, cx: &mut App| {
                        w.update(cx, |this, cx| f(this, window, cx)).ok();
                    }
                };
                let item = |label: &str| {
                    let m = MenuItem::new(label.to_string());
                    if list { m.text_xs() } else { m }
                };
                let folders_c = folders.clone();
                let groups_c = groups.clone();
                let wf = weak.clone();
                menu.item(item("Open").on_select(act(Box::new(move |this, _, cx| this.open_connection(id, cx)))))
                    .item(item("Edit").on_select(act(Box::new(move |this, w, cx| this.edit_connection(id, false, w, cx)))))
                    .item(item("Duplicate").on_select(act(Box::new(move |this, w, cx| this.edit_connection(id, true, w, cx)))))
                    .item(
                        item(match (list, favorite) {
                            (true, true) => "Unfavorite",
                            (true, false) => "Favorite",
                            (false, true) => "Remove from Favorites",
                            (false, false) => "Add to Favorites",
                        })
                        .on_select(act(Box::new(move |this, _, cx| this.toggle_favorite(id, cx)))),
                    )
                    .item(item("Copy URI").on_select(act(Box::new(move |this, _, cx| this.copy_uri(id, cx)))))
                    .item(item("Transfer Project").icon(IconName::ArrowRightLeft).icon_size(if list { 14. } else { 16. }).on_select(move |_, cx| {
                        rexa_core::navigate(rexa_core::Route::ConnectionScreen(format!("transfer:{id}")), cx)
                    }))
                    .sub_item(item("Folders").icon(IconName::Folder).icon_size(if list { 12. } else { 14. }), move |sub, _, _| {
                        let mut sub = sub.min_w(160.);
                        if folders_c.is_empty() {
                            sub = sub.item(MenuItem::new("No folders yet").text_xs().disabled(true));
                        }
                        for f in folders_c.iter() {
                            let (w, name) = (wf.clone(), f.clone());
                            sub = sub.item(MenuItem::checkbox(f.clone(), groups_c.contains(f)).text_xs().on_select(move |_, cx| {
                                let name = name.clone();
                                w.update(cx, |this, cx| this.toggle_folder(id, &name, cx)).ok();
                            }));
                        }
                        sub
                    })
                    .separator()
                    .item(item("Delete").destructive().on_select(act(Box::new(move |this, _, cx| this.request_delete(id, cx)))))
            })
    }

    fn render_card(&self, row: &ConnectionRow, index: usize, t: &Tokens, cx: &mut Context<Self>) -> impl IntoElement {
        let conn = &row.conn;
        let provider = providers::provider_of(conn);
        let label = providers::card(&provider).map(|c| c.label);
        let id = conn.id;
        let opening = self.opening.contains(&id);
        let reorder = self.drag_reorder_enabled();

        let mut name_row = div().flex().items_center().gap_2().child(
            // h3 text-sm font-medium truncate max-w-[120px]
            div()
                .max_w(px(120.))
                .overflow_hidden()
                .text_ellipsis()
                .whitespace_nowrap()
                .text_size(px(14.))
                .line_height(px(20.))
                .font_weight(FontWeight::MEDIUM)
                .text_color(t.foreground)
                .child(conn.name.clone()),
        );
        if !conn.tags.is_empty() {
            let mut tags = div().flex().min_w_0().items_center().gap_1();
            for tag in conn.tags.iter().take(2) {
                tags = tags.child(self.render_tag(tag));
            }
            if conn.tags.len() > 2 {
                tags = tags.child(div().text_size(px(10.)).text_color(t.muted_foreground).child(format!("+{}", conn.tags.len() - 2)));
            }
            name_row = name_row.child(tags);
        }

        let mut text = div().child(name_row);
        if let Some(label) = label {
            text = text.child(
                // p.text-xs.text-muted-foreground.tracking-tight
                div().text_size(px(12.)).line_height(px(16.)).text_color(t.muted_foreground).child(tracked_text::tight(label)),
            );
        }

        let star = conn.is_favorite.then(|| {
            div()
                .absolute()
                .top(px(-8.))
                .right(px(-8.))
                .p(px(2.))
                .rounded(px(t.radius))
                .bg(t.studio_bg)
                .border_1()
                .border_color(with_alpha(t.border, 0.4))
                .shadow_sm()
                .child(Icon::new(IconName::Star).size(px(10.)).text_color(rexa_ui::tw("amber-500")))
        });

        let grip = reorder.then(|| {
            let name: SharedString = conn.name.clone().into();
            div()
                .id(SharedString::from(format!("grip-{id}")))
                .size_8()
                .tw_rounded_lg()
                .flex()
                .items_center()
                .justify_center()
                .text_color(t.muted_foreground)
                .opacity(0.7)
                .hover(|s| s.opacity(1.).text_color(t.foreground).bg(with_alpha(t.muted, 0.5)))
                .cursor_grab()
                .on_click(|_, _, cx| cx.stop_propagation())
                .on_drag(DraggedConnection { id, name }, |d, _, _, cx| cx.new(|_| d.clone()))
                .child(Icon::new(IconName::GripVertical).size(px(14.)))
        });

        // group relative rounded-lg border border-studio-border/60 bg-card p-4
        // hover:bg-studio-row-hover hover:border-studio-border
        let mut card = div()
            .id(SharedString::from(format!("conn-{id}")))
            .relative()
            .rounded(px(t.radius))
            .border_1()
            .border_color(with_alpha(t.studio_border, 0.6))
            .bg(t.card)
            .hover(|s| s.bg(t.studio_row_hover).border_color(t.studio_border))
            .p_4()
            .cursor_pointer()
            .when(opening, |d| d.opacity(0.5))
            .when(self.dragging == Some(id), |d| d.opacity(0.6))
            .when(self.drag_over == Some(id), |d| d.border_color(with_alpha(t.primary, 0.4)))
            .when(!opening && !self.reorder_mode, |d| {
                d.on_click(cx.listener(move |this, _, _, cx| {
                    this.selected_index = index;
                    this.open_connection(id, cx)
                }))
            });
        if reorder {
            card = card
                .drag_over::<DraggedConnection>(move |s, _, _, cx| s.border_color(with_alpha(cx.tokens().primary, 0.4)))
                .on_drop(cx.listener(move |this, d: &DraggedConnection, _, cx| this.reorder(d.id, Some(id), cx)));
        }
        card.child(
            div()
                .flex()
                .items_start()
                .justify_between()
                .mb_3()
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap_3()
                        .child(div().relative().child(self.render_logo(conn, &provider, 27., t)).children(star))
                        .child(text),
                )
                .child(div().flex().items_center().gap(px(2.)).children(grip).child(self.connection_menu(id, false, cx))),
        )
        .child(
            // The target sits in an inline-block <button> inside the card's
            // 16px/24px line box, so the row is 24px tall with the 12px/16px
            // text baseline-aligned ~5.4px down.
            div()
                .h(px(24.))
                .pt(px(5.4))
                .flex()
                .items_start()
                .gap_2()
                .text_size(px(12.))
                .line_height(px(16.))
                .text_color(t.muted_foreground)
                .hover(|s| s.text_color(with_alpha(t.foreground, 0.7)))
                .child(div().font_family(MONO).overflow_hidden().text_ellipsis().whitespace_nowrap().child(providers::target(conn))),
        )
        .children(opening.then(|| {
            // absolute inset-0 bg-background/80 rounded-lg backdrop-blur-sm "Connecting..."
            div()
                .absolute()
                .inset_0()
                .flex()
                .items_center()
                .justify_center()
                .rounded(px(t.radius))
                .bg(with_alpha(t.background, 0.8))
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap_2()
                        .tw_text_xs()
                        .text_color(t.muted_foreground)
                        .child(div().size_3().border_2().border_color(with_alpha(t.muted_foreground, 0.3)).tw_rounded_lg())
                        .child("Connecting..."),
                )
        }))
    }

    fn reorder(&mut self, source: i64, target: Option<i64>, cx: &mut Context<Self>) {
        self.dragging = None;
        self.drag_over = None;
        if Some(source) == target {
            return;
        }
        let mut ids: Vec<i64> = self.rows.iter().map(|r| r.conn.id).collect();
        let Some(from) = ids.iter().position(|i| *i == source) else { return };
        let moved = ids.remove(from);
        match target.and_then(|t| ids.iter().position(|i| *i == t).map(|p| (p, from))) {
            Some((to, from)) => ids.insert(if from <= to { to + 1 } else { to }, moved),
            None => ids.push(moved),
        }
        if let Err(e) = Store::open().and_then(|s| s.reorder_connections(&ids)) {
            toast::error(format!("{e:#}"), cx);
        }
        self.reload();
        cx.notify();
    }

    fn render_list_row(&self, row: &ConnectionRow, is_last: bool, t: &Tokens, cx: &mut Context<Self>) -> impl IntoElement {
        // li.group flex items-center gap-3 px-4 py-3 hover:bg-muted/40 [border-b]
        let conn = &row.conn;
        let provider = providers::provider_of(conn);
        let label = providers::card(&provider).map_or("PostgreSQL", |c| c.label);
        let id = conn.id;
        let opening = self.opening.contains(&id);
        let target = providers::target(conn);
        let mut tags = div().flex().min_w_0().items_center().gap_1();
        for tag in conn.tags.iter().take(3) {
            tags = tags.child(self.render_tag(tag));
        }
        if conn.tags.len() > 3 {
            tags = tags.child(div().text_size(px(10.)).text_color(t.muted_foreground).child(format!("+{}", conn.tags.len() - 3)));
        }
        div()
            .id(SharedString::from(format!("row-{id}")))
            .flex()
            .items_center()
            .gap_3()
            .px_4()
            .py_3()
            .when(!is_last, |d| d.border_b_1().border_color(t.border))
            .hover(|s| s.bg(with_alpha(t.muted, 0.4)))
            .child(
                div()
                    .id(SharedString::from(format!("row-open-{id}")))
                    .flex()
                    .min_w_0()
                    .flex_1()
                    .items_center()
                    .gap_3()
                    .tw_rounded_md()
                    .cursor_pointer()
                    .when(opening, |d| d.opacity(0.5))
                    .when(!opening, |d| d.on_click(cx.listener(move |this, _, _, cx| this.open_connection(id, cx))))
                    .child(div().flex_shrink_0().child(self.render_logo(conn, &provider, 20., t)))
                    .child(
                        div()
                            .min_w_0()
                            .flex_1()
                            .child(
                                div()
                                    .flex()
                                    .min_w_0()
                                    .items_center()
                                    .gap_2()
                                    .child(
                                        div()
                                            .overflow_hidden()
                                            .text_ellipsis()
                                            .whitespace_nowrap()
                                            .tw_text_sm()
                                            .font_weight(FontWeight::MEDIUM)
                                            .text_color(t.foreground)
                                            .child(conn.name.clone()),
                                    )
                                    .children(conn.is_favorite.then(|| {
                                        Icon::new(IconName::Star).size_3().flex_shrink_0().text_color(rexa_ui::tw("amber-500"))
                                    })),
                            )
                            .child(
                                div()
                                    .mt(px(2.))
                                    .flex()
                                    .min_w_0()
                                    .items_center()
                                    .gap(px(6.))
                                    .tw_text_xs()
                                    .text_color(t.muted_foreground)
                                    .child(div().flex_shrink_0().child(label))
                                    .child(div().text_color(with_alpha(t.muted_foreground, 0.5)).child("·"))
                                    .child(div().overflow_hidden().text_ellipsis().whitespace_nowrap().child(target)),
                            ),
                    ),
            )
            .child(
                div()
                    .flex()
                    .flex_shrink_0()
                    .items_center()
                    .gap_2()
                    .children(opening.then(|| div().tw_text_xs().text_color(t.muted_foreground).child("Connecting…")))
                    .child(tags)
                    .child(div().flex().items_center().justify_end().child(self.connection_menu(id, true, cx))),
            )
    }

    fn render_empty(&self, t: &Tokens, cx: &mut Context<Self>) -> impl IntoElement {
        let failed = self.error.is_some();
        div()
            .flex()
            .flex_col()
            .items_center()
            .justify_center()
            .h_full()
            .py(px(80.))
            .child(
                div()
                    .size_12()
                    .tw_rounded_lg()
                    .bg(t.studio_bg)
                    .border_1()
                    .border_color(with_alpha(t.studio_border, 0.6))
                    .flex()
                    .items_center()
                    .justify_center()
                    .mb_4()
                    .child(Icon::new(IconName::Database).size_6().text_color(t.muted_foreground)),
            )
            .child(
                div()
                    .tw_text_sm()
                    .font_weight(FontWeight::MEDIUM)
                    .text_color(t.foreground)
                    .mb_1()
                    .child(if failed { "Could not load connections" } else { "No connections found" }),
            )
            .child(
                div().tw_text_xs().text_color(t.muted_foreground).max_w(px(320.)).mb_6().text_center().child(match &self.error {
                    Some(e) => format!("{e} The local sidecar may still be starting — retry in a moment."),
                    None => "Add a database connection to get started.".into(),
                }),
            )
            .children(failed.then(|| {
                div().mb_3().child(Button::new("retry").outline().size(ButtonSize::Sm).label("Retry").on_click(cx.listener(|this, _, _, cx| {
                    this.reload();
                    cx.notify();
                })))
            }))
            .child(
                Button::new("add-connection")
                    .outline()
                    .size(ButtonSize::Sm)
                    .icon(IconName::Plus)
                    .label("Add Connection")
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.screen = Screen::NewSelect;
                        cx.notify();
                    })),
            )
    }

    fn render_list_screen(&mut self, t: &Tokens, cx: &mut Context<Self>) -> gpui::AnyElement {
        let visible = self.visible();
        let list = if visible.is_empty() {
            self.render_empty(t, cx).into_any_element()
        } else {
            match self.view_mode {
                ViewMode::Card => {
                    let mut grid = div()
                        .id("conn-grid")
                        .grid()
                        .grid_cols(3)
                        .gap_4()
                        .children(visible.iter().enumerate().map(|(i, r)| self.render_card(r, i, t, cx).into_any_element()));
                    if self.drag_reorder_enabled() {
                        grid = grid.on_drop(cx.listener(|this, d: &DraggedConnection, _, cx| this.reorder(d.id, None, cx)));
                    }
                    grid.into_any_element()
                }
                ViewMode::List => {
                    let n = visible.len();
                    div()
                        .overflow_hidden()
                        .rounded(px(t.radius))
                        .border_1()
                        .border_color(t.border)
                        .bg(t.card)
                        .children(visible.iter().enumerate().map(|(i, r)| self.render_list_row(r, i + 1 == n, t, cx).into_any_element()))
                        .into_any_element()
                }
            }
        };
        let reorder_hint = (self.view_mode == ViewMode::Card && self.reorder_mode).then(|| {
            div()
                .mb_3()
                .flex()
                .items_center()
                .gap_2()
                .tw_text_xs()
                .text_color(t.muted_foreground)
                .child(div().size_2().tw_rounded_lg().bg(with_alpha(rexa_ui::tw("emerald-500"), 0.8)))
                .child("Drag cards to reorder.")
        });
        div()
            .flex()
            .flex_col()
            .h_full()
            .flex_1()
            .max_w(px(1024.))
            .mx_auto()
            .px_6()
            .py_8()
            .child(self.render_title_row(t, cx))
            .child(self.render_toolbar(t, cx))
            .child(
                div()
                    .id("connections-scroll")
                    .flex_1()
                    .overflow_y_scroll()
                    .mx(px(-24.))
                    .px_6()
                    .pb(px(80.))
                    .children(reorder_hint)
                    .child(list),
            )
            .into_any_element()
    }
}

fn open_vault_unlock_dialog(id: i64, for_edit: bool, weak: gpui::WeakEntity<ConnectionsScreen>, cx: &mut App) {
    // The row stops spinning while the prompt is up; Unlock reopens it.
    weak.update(cx, |this, cx| {
        this.opening.remove(&id);
        cx.notify();
    })
    .ok();
    let config = Store::open().ok().and_then(|s| s.vault_config().ok().flatten());
    let Some((salt, verifier)) = config else {
        toast::error("Credential vault settings were not found.", cx);
        return;
    };
    crate::vault_prompt::open(false, cx, move |pass, window, cx| match rexa_store::Vault::unlock(&pass, &salt, &verifier) {
        Ok(vault) => {
            rexa_core::unlock_credential_vault(vault, cx);
            weak.update(cx, |this, cx| {
                if for_edit {
                    this.edit_connection(id, false, window, cx);
                } else {
                    this.open_connection(id, cx);
                }
            })
            .ok();
            Ok(())
        }
        Err(e) => Err(format!("{e:#}")),
    });
}

/// `ConnectionTagBadge`.
pub fn tag_badge(name: &str, tone: Option<Hsla>) -> impl IntoElement {
    let tone = tone.unwrap_or_else(|| rexa_ui::parse_color("#71717a").unwrap());
    div()
        .flex()
        .flex_shrink_0()
        .items_center()
        .h(px(18.))
        .max_w(px(120.))
        .px_2()
        .rounded_full()
        .text_size(px(10.))
        .line_height(px(10.))
        .font_weight(FontWeight::MEDIUM)
        .text_color(tone)
        .bg(with_alpha(tone, 0x1a as f32 / 255.))
        .border_1()
        .border_color(with_alpha(tone, 0x33 as f32 / 255.))
        .child(div().overflow_hidden().text_ellipsis().whitespace_nowrap().child(name.to_string()))
}

fn rexa_core_sessions_forget(id: i64, cx: &mut App) {
    cx.default_global::<rexa_core::Sessions>().open.remove(&id);
}

fn chrono_date() -> String {
    // YYYY-MM-DD (new Date().toISOString().split("T")[0]) without a date crate.
    let days = rexa_store::now_secs() / 86_400;
    let (mut y, mut d) = (1970i64, days);
    loop {
        let len = if (y % 4 == 0 && y % 100 != 0) || y % 400 == 0 { 366 } else { 365 };
        if d < len {
            break;
        }
        d -= len;
        y += 1;
    }
    let leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
    let months = [31, if leap { 29 } else { 28 }, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let mut m = 0;
    while d >= months[m] {
        d -= months[m];
        m += 1;
    }
    format!("{y:04}-{:02}-{:02}", m + 1, d + 1)
}

fn row_json(r: &ConnectionRow) -> serde_json::Value {
    let c = &r.conn;
    serde_json::json!({
        "id": c.id, "name": c.name, "connectionString": c.connection_string, "connectionType": c.kind,
        "createdAt": r.created_at, "sortOrder": r.sort_order, "environment": c.environment, "color": c.color,
        "tags": c.tags, "icon": c.icon, "group": c.group, "groups": r.groups, "isFavorite": c.is_favorite,
        "lastActive": c.last_active, "host": c.host, "port": c.port, "database": c.database, "username": c.username,
        "sslMode": r.ssl_mode, "credentialRef": c.credential_ref,
    })
}

/// The "Connection failed" / "Credentials locked" dialog.
#[allow(clippy::too_many_arguments)]
pub fn open_failure_dialog(
    title: &str,
    _name: &str,
    message: String,
    error: String,
    credentials: bool,
    recovery: Option<i64>,
    weak: gpui::WeakEntity<ConnectionsScreen>,
    cx: &mut App,
) {
    let title = title.to_string();
    let local_net = cfg!(target_os = "macos")
        && ["econnrefused", "ehostunreach", "no route to host", "connection refused", "network is unreachable"]
            .iter()
            .any(|p| error.to_lowercase().contains(p));
    rexa_ui::open_dialog(cx, move |_, cx| {
        let t = cx.tokens().clone();
        let li = |s: &str| {
            div().flex().gap_2().ml_4().child(div().child("•")).child(div().child(s.to_string()))
        };
        let mut body = div().flex().flex_col().gap_5();
        if !credentials {
            let mut list = div().flex().flex_col().gap_1().tw_text_sm().text_color(with_alpha(t.foreground, 0.85));
            list = list
                .child(li("The database server is running and reachable."))
                .child(li("The host, port, database, username, and password are correct."))
                .child(li("Your network, VPN, SSH tunnel, or firewall is not blocking the connection."));
            if local_net {
                list = list.child(li("RexaDB is allowed under System Settings › Privacy & Security › Local Network. macOS can block this connection even when the error says it was refused."));
            }
            body = body.child(
                div()
                    .flex()
                    .flex_col()
                    .gap_2()
                    .child(div().tw_text_sm().text_color(t.muted_foreground).child("Check the connection details and make sure:"))
                    .child(list),
            );
        }
        body = body.child(
            div()
                .tw_rounded_lg()
                .border_1()
                .border_color(with_alpha(t.destructive, 0.25))
                .bg(with_alpha(t.destructive, 0.08))
                .px_4()
                .py_3()
                .child(div().mb_1().tw_text_xs().font_weight(FontWeight::MEDIUM).text_color(with_alpha(t.destructive, 0.8)).child("Error details"))
                .child(if credentials {
                    div().tw_text_sm().line_height(px(24.)).text_color(t.foreground).child(error.clone())
                } else {
                    div().font_family(MONO).tw_text_xs().line_height(px(20.)).text_color(t.destructive).child(error.clone())
                }),
        );
        let mut d = Dialog::new().w(900.).max_w(900.).hide_close().title(title.clone()).description(message.clone()).child(body);
        d = d.footer(
            Button::new("fail-close")
                .variant(if recovery.is_some() { rexa_ui::ButtonVariant::Outline } else { rexa_ui::ButtonVariant::Default })
                .label(if recovery.is_some() { "Close" } else { "Got it" })
                .on_click(|_, _, cx| rexa_ui::close_top(cx)),
        );
        if let Some(id) = recovery {
            let w = weak.clone();
            d = d.footer(Button::new("fail-edit").label("Edit credentials").on_click(move |_, window, cx| {
                rexa_ui::close_top(cx);
                w.update(cx, |this, cx| this.edit_connection(id, false, window, cx)).ok();
            }));
        }
        d
    });
}

impl Focusable for ConnectionsScreen {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus.clone()
    }
}

impl Render for ConnectionsScreen {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        let content = match self.screen.clone() {
            Screen::List => div().flex().size_full().child(self.render_list_screen(&t, cx)).into_any_element(),
            Screen::NewSelect => self.render_new_select(&t, window, cx),
            Screen::JdbcPicker => self.render_jdbc_picker(&t, window, cx),
            Screen::Form => match &self.form {
                Some((f, _)) => f.clone().into_any_element(),
                None => div().into_any_element(),
            },
            Screen::Accounts(_) => match &self.account_view {
                Some(v) => v.clone().into_any_element(),
                None => div().into_any_element(),
            },
        };

        div()
            .id("connections-root")
            .track_focus(&self.focus)
            .on_key_down(cx.listener(Self::on_key_down))
            .size_full()
            .flex()
            .flex_col()
            .bg(t.studio_bg)
            .text_color(t.foreground)
            .child(
                // connections-page.tsx: app-drag-region h-9
                div()
                    .id("drag-region")
                    .h_9()
                    .flex_shrink_0()
                    .on_mouse_down(MouseButton::Left, |e, window, _| {
                        if e.click_count == 2 {
                            window.titlebar_double_click();
                        } else {
                            window.start_window_move();
                        }
                    }),
            )
            .child(
                // px-2 pb-2 › rounded-lg bg-[var(--shell-content-bg)]
                div().flex_1().min_h_0().px_2().pb_2().child(
                    div()
                        .size_full()
                        .flex()
                        .flex_col()
                        .overflow_hidden()
                        .rounded(px(t.radius))
                        .bg(t.var("--shell-content-bg").unwrap_or(t.studio_bg))
                        .child(content),
                ),
            )
    }
}
