//! Port of the new-form / edit-form branch of
//! components/connections/connection-manager.tsx (`handleAdd`,
//! `handleTestConnection`, `populateFormFromConnection`,
//! `renderGenericFieldForm`, the Postgres + SSH, Turso, Federated, JDBC,
//! SQLite/DuckDB file and generic URI forms), plus
//! components/connections/connection-tags.tsx (`ConnectionTagPicker`),
//! components/connections/connection-icon.tsx (`ConnectionIconPicker`) and
//! components/studio/jdbc-driver-{install-prompt,manager}.tsx.

use crate::fields::{self, FederatedSource, FieldValues, JdbcForm, PgForm};
use crate::home::tag_badge;
use crate::providers;
use crate::widgets::{self, field, hint, label, provider_logo, FieldInput};
use gpui::{
    div, img, prelude::*, px, AnyElement, App, Context, Entity, EventEmitter, FocusHandle, Focusable, FontWeight, Image,
    KeyDownEvent, ObjectFit, SharedString, Subscription, Window,
};
use gpui_component::input::{InputEvent, InputState, TextareaState};
use gpui_component::Icon;
use rexa_store::{ConnectionDraft, ConnectionRow, SavedConnection, Store, TagDef};
use rexa_store::Vault;
use rexa_ui::theme::{with_alpha, Tokens};
use rexa_ui::{
    toast, ActiveTokens, Align, Button, ButtonSize, Checkbox, IconName, Kbd, PasswordInput, Popover, Select, SelectOption,
    Switch, TextArea, Tw, MONO,
};
use std::sync::Arc;

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum FormMode {
    New,
    Duplicate,
    Edit(i64),
}

pub enum FormEvent {
    Back { to_select: bool },
    Saved,
    LibraryChanged,
}

/// `CONNECTION_TAG_COLORS`.
pub const TAG_COLORS: &[&str] =
    &["#ef4444", "#f97316", "#f59e0b", "#22c55e", "#14b8a6", "#0ea5e9", "#6366f1", "#a855f7", "#ec4899", "#71717a"];

const EMOJI_CHOICES: &[&str] = &[
    "🚀", "🔥", "⚡", "🌱", "🧪", "🛠️", "🐞", "🔒", "💾", "📦", "📊", "📈", "🧠", "🤖", "🌍", "☁️", "🏠", "🏢", "🛒", "💳", "🎮", "🎯",
    "⭐", "💎", "🟥", "🟧", "🟨", "🟩", "🟦", "🟪", "⬛", "⬜",
];

struct PgInputs {
    host: Entity<InputState>,
    port: Entity<InputState>,
    database: Entity<InputState>,
    username: Entity<InputState>,
    password: Entity<InputState>,
    ssh_host: Entity<InputState>,
    ssh_port: Entity<InputState>,
    ssh_username: Entity<InputState>,
    ssh_password: Entity<InputState>,
    ssh_key: Entity<TextareaState>,
}

struct GenericInputs {
    host: Entity<InputState>,
    port: Entity<InputState>,
    database: Entity<InputState>,
    username: Entity<InputState>,
    password: Entity<InputState>,
}

struct FederatedRow {
    connection_id: i64,
    alias: Entity<InputState>,
    namespace: Entity<InputState>,
}

pub struct ConnectionForm {
    focus: FocusHandle,
    mode: FormMode,
    provider: String,
    credential_ref: Option<String>,
    vault: Option<Arc<Vault>>,
    last_active: Option<i64>,
    // details
    name: Entity<InputState>,
    tags: Vec<String>,
    icon: Option<String>,
    icon_image: Option<Arc<Image>>,
    groups: Vec<String>,
    favorite: bool,
    // database
    uri: Entity<InputState>,
    pg: PgInputs,
    pg_ssl: String,
    pg_keychain: bool,
    pg_ssh: bool,
    pg_ssh_key_auth: bool,
    pg_ssh_keychain: bool,
    generic: GenericInputs,
    generic_ssl: String,
    protocol: String,
    oracle_sid: bool,
    turso_endpoint: Entity<InputState>,
    turso_token: Entity<InputState>,
    jdbc_url: Entity<InputState>,
    jdbc_driver: Entity<InputState>,
    jdbc_user: Entity<InputState>,
    jdbc_password: Entity<InputState>,
    jdbc_jars: Vec<String>,
    federated: Vec<FederatedRow>,
    // tag picker
    new_tag: Entity<InputState>,
    new_tag_color: Option<String>,
    edit_tag: Entity<InputState>,
    editing_tag: Option<String>,
    edit_tag_color: String,
    custom_emoji: Entity<InputState>,
    // context
    connections: Vec<SavedConnection>,
    folders: Vec<String>,
    tag_library: Vec<TagDef>,
    loading: bool,
    testing: bool,
    installing: Option<String>,
    _subs: Vec<Subscription>,
}

impl EventEmitter<FormEvent> for ConnectionForm {}

impl Focusable for ConnectionForm {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus.clone()
    }
}

impl ConnectionForm {
    fn blank(provider: &str, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let pg = PgForm::default();
        let f = if fields::is_field_based(provider) { fields::empty_field_values(provider) } else { FieldValues::default() };
        let i = |w: &mut Window, cx: &mut Context<Self>, v: &str, p: &str| widgets::input_state(w, cx, v, p);
        let pw = |w: &mut Window, cx: &mut Context<Self>| widgets::password_state(w, cx, "");
        let placeholder = providers::card(provider).map_or("protocol://user:password@host:port/database", |c| c.placeholder);
        let ssh_key = cx.new(|cx| TextareaState::new(window, cx));
        let mut this = Self {
            focus: cx.focus_handle(),
            mode: FormMode::New,
            provider: provider.to_string(),
            credential_ref: None,
            vault: None,
            last_active: None,
            name: i(window, cx, "", &crate::fields::connection_name_from_details("", Some(provider)).split(" • ").next().unwrap_or("PostgreSQL").to_string()),
            tags: Vec::new(),
            icon: None,
            icon_image: None,
            groups: Vec::new(),
            favorite: false,
            uri: i(window, cx, "", if provider == "postgresql" { "postgresql://user:password@host:5432/database" } else if matches!(provider, "sqlite" | "duckdb") { "Enter file path..." } else { placeholder }),
            pg: PgInputs {
                host: i(window, cx, &pg.host, ""),
                port: i(window, cx, &pg.port, ""),
                database: i(window, cx, "", ""),
                username: i(window, cx, &pg.username, ""),
                password: pw(window, cx),
                ssh_host: i(window, cx, &pg.ssh_host, "192.168.1.1"),
                ssh_port: i(window, cx, &pg.ssh_port, "22"),
                ssh_username: i(window, cx, &pg.ssh_username, "ubuntu"),
                ssh_password: pw(window, cx),
                ssh_key,
            },
            pg_ssl: pg.ssl_mode,
            pg_keychain: true,
            pg_ssh: false,
            pg_ssh_key_auth: false,
            pg_ssh_keychain: true,
            generic: GenericInputs {
                host: i(window, cx, &f.host, ""),
                port: i(window, cx, &f.port, ""),
                database: i(window, cx, "", if provider == "oracle" { "FREEPDB1" } else { "" }),
                username: i(window, cx, &f.username, ""),
                password: pw(window, cx),
            },
            generic_ssl: f.ssl_mode.clone(),
            protocol: if f.protocol.is_empty() { "postgresql".into() } else { f.protocol.clone() },
            oracle_sid: false,
            turso_endpoint: i(window, cx, "", "your-db-your-org.turso.io"),
            turso_token: i(window, cx, "", "turso-auth-token"),
            jdbc_url: i(window, cx, "", "postgresql://user:pass@host:5432/database"),
            jdbc_driver: i(window, cx, "", "org.postgresql.Driver"),
            jdbc_user: i(window, cx, "", "user"),
            jdbc_password: pw(window, cx),
            jdbc_jars: Vec::new(),
            federated: Vec::new(),
            new_tag: i(window, cx, "", "New tag name"),
            new_tag_color: None,
            edit_tag: i(window, cx, "", "New tag name"),
            editing_tag: None,
            edit_tag_color: TAG_COLORS[0].into(),
            custom_emoji: i(window, cx, "", "Any emoji or character"),
            connections: Vec::new(),
            folders: Vec::new(),
            tag_library: Vec::new(),
            loading: false,
            testing: false,
            installing: None,
            _subs: Vec::new(),
        };
        this.wire(window, cx);
        window.focus(&this.focus, cx);
        this
    }

    fn wire(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        // Re-render on any edit so derived state (disabled buttons, placeholders) follows.
        let all = [
            &self.name, &self.pg.host, &self.pg.port, &self.pg.database, &self.pg.username, &self.pg.password, &self.pg.ssh_host,
            &self.pg.ssh_port, &self.pg.ssh_username, &self.pg.ssh_password, &self.generic.host, &self.generic.port,
            &self.generic.database, &self.generic.username, &self.generic.password, &self.turso_endpoint, &self.turso_token,
            &self.jdbc_driver, &self.jdbc_user, &self.jdbc_password, &self.new_tag, &self.edit_tag,
        ];
        for s in all {
            self._subs.push(cx.observe(s, |_, _, cx| cx.notify()));
        }
        self._subs.push(cx.subscribe_in(&self.uri.clone(), window, Self::on_uri));
        self._subs.push(cx.subscribe_in(&self.jdbc_url.clone(), window, |this, s, ev: &InputEvent, window, cx| {
            if matches!(ev, InputEvent::Change) {
                let v = s.read(cx).value().to_string();
                if !v.is_empty() && widgets::value(&this.jdbc_driver, cx).is_empty() {
                    let dc = fields::detect_driver_class(&v);
                    if !dc.is_empty() {
                        widgets::set_value(&this.jdbc_driver, &dc, window, cx);
                    }
                }
                cx.notify();
            }
        }));
        for s in [self.turso_endpoint.clone(), self.turso_token.clone()] {
            self._subs.push(cx.subscribe_in(&s, window, |this, _, ev: &InputEvent, window, cx| {
                if matches!(ev, InputEvent::Change) {
                    widgets::set_value(&this.uri, "", window, cx);
                }
            }));
        }
        // Port fields accept digits only (`replace(/[^\d]/g, "")`).
        for s in [self.pg.port.clone(), self.pg.ssh_port.clone(), self.generic.port.clone()] {
            self._subs.push(cx.subscribe_in(&s, window, |_, s, ev: &InputEvent, window, cx| {
                if matches!(ev, InputEvent::Change) {
                    let v = s.read(cx).value().to_string();
                    let digits: String = v.chars().filter(|c| c.is_ascii_digit()).collect();
                    if digits != v {
                        widgets::set_value(s, &digits, window, cx);
                    }
                }
            }));
        }
        for s in [self.new_tag.clone(), self.edit_tag.clone(), self.custom_emoji.clone()] {
            self._subs.push(cx.subscribe_in(&s, window, |this, s, ev: &InputEvent, window, cx| {
                if let InputEvent::PressEnter { .. } = ev {
                    if *s == this.new_tag {
                        this.create_tag(window, cx);
                    } else if *s == this.edit_tag {
                        this.save_edited_tag(window, cx);
                    } else {
                        this.use_custom_emoji(window, cx);
                    }
                }
            }));
        }
    }

    pub fn new_for(provider: &str, connection_string: &str, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let mut this = Self::blank(provider, window, cx);
        if !connection_string.trim().is_empty() {
            widgets::set_value(&this.uri, connection_string, window, cx);
            this.apply_uri(connection_string, window, cx);
        }
        this
    }

    pub fn new_jdbc(t: &fields::JdbcTemplate, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let mut this = Self::blank("jdbc", window, cx);
        widgets::set_value(&this.jdbc_url, &fields::sample_jdbc_url(t), window, cx);
        widgets::set_value(&this.jdbc_driver, &t.driver_class, window, cx);
        match fields::load_installed_drivers().into_iter().find(|d| d.name == t.name) {
            Some(d) => this.jdbc_jars = d.jar_paths,
            None => this.prompt_install(t.clone(), cx),
        }
        this
    }

    /// `populateFormFromConnection`.
    pub fn from_row(mode: FormMode, provider: &str, row: &ConnectionRow, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let mut this = Self::blank(provider, window, cx);
        let c = &row.conn;
        this.mode = mode;
        if mode == FormMode::Duplicate {
            widgets::set_value(&this.name, &format!("{} (Copy)", c.name), window, cx);
        } else {
            widgets::set_value(&this.name, &c.name, window, cx);
            this.credential_ref = c.credential_ref.clone();
            if c.credential_ref.as_deref().is_some_and(|r| r.starts_with("vault:")) {
                this.vault = rexa_core::credential_vault(cx);
            }
            this.last_active = c.last_active;
        }
        this.tags = c.tags.clone();
        this.set_icon(c.icon.clone());
        this.groups = if row.groups.is_empty() { c.group.clone().into_iter().collect() } else { row.groups.clone() };
        this.favorite = c.is_favorite;
        let cs = c.connection_string.clone();
        widgets::set_value(&this.uri, &cs, window, cx);
        match provider {
            "jdbc" => {
                let j = fields::parse_jdbc(&cs);
                widgets::set_value(&this.jdbc_url, &j.url, window, cx);
                widgets::set_value(&this.jdbc_driver, &j.driver_class, window, cx);
                widgets::set_value(&this.jdbc_user, &j.username, window, cx);
                widgets::set_value(&this.jdbc_password, &j.password, window, cx);
                let relative = j.jar_paths.iter().any(|p| !p.starts_with('/'));
                this.jdbc_jars = match fields::load_installed_drivers().into_iter().find(|d| relative && d.driver_class == j.driver_class && !d.jar_paths.is_empty()) {
                    Some(d) => d.jar_paths,
                    None => j.jar_paths,
                };
            }
            "federated" => {
                if let Ok(sources) = fields::parse_federated(&cs) {
                    for s in sources {
                        this.add_federated_row(s, window, cx);
                    }
                }
            }
            _ => this.apply_uri(&cs, window, cx),
        }
        this
    }

    pub fn set_context(&mut self, connections: Vec<SavedConnection>, folders: Vec<String>, tags: Vec<TagDef>, _neon: Option<String>, cx: &mut Context<Self>) {
        self.connections = connections;
        self.folders = folders;
        self.tag_library = tags;
        cx.notify();
    }

    fn set_icon(&mut self, icon: Option<String>) {
        self.icon_image = icon.as_deref().and_then(|i| i.strip_prefix("image:")).and_then(rexa_ui::images::from_data_url);
        self.icon = icon;
    }

    /// Fast-fill: parse a pasted URI into the field inputs.
    fn apply_uri(&mut self, cs: &str, window: &mut Window, cx: &mut Context<Self>) {
        let p = self.provider.clone();
        if fields::is_neon_cli(cs) {
            return;
        }
        if p == "postgresql" {
            if let Some(f) = fields::parse_postgres(cs) {
                self.fill_pg(&f, window, cx);
            }
        } else if p == "turso" {
            if let Some((e, tok)) = fields::parse_turso(cs) {
                widgets::set_value(&self.turso_endpoint, &e, window, cx);
                widgets::set_value(&self.turso_token, &tok, window, cx);
            }
        } else if fields::is_field_based(&p) {
            let f = fields::parse_fields(&p, cs);
            self.fill_generic(&f, window, cx);
        }
    }

    fn fill_pg(&mut self, f: &PgForm, window: &mut Window, cx: &mut Context<Self>) {
        let pg = &self.pg;
        for (s, v) in [
            (&pg.host, &f.host),
            (&pg.port, &f.port),
            (&pg.database, &f.database),
            (&pg.username, &f.username),
            (&pg.password, &f.password),
            (&pg.ssh_host, &f.ssh_host),
            (&pg.ssh_port, &f.ssh_port),
            (&pg.ssh_username, &f.ssh_username),
            (&pg.ssh_password, &f.ssh_password),
        ] {
            widgets::set_value(s, v, window, cx);
        }
        let key = f.ssh_private_key.clone();
        self.pg.ssh_key.update(cx, |s, cx| s.set_value(key, window, cx));
        self.pg_ssl = f.ssl_mode.clone();
        self.pg_ssh = f.ssh;
        self.pg_ssh_key_auth = f.ssh_private_key_auth;
    }

    fn fill_generic(&mut self, f: &FieldValues, window: &mut Window, cx: &mut Context<Self>) {
        let g = &self.generic;
        for (s, v) in [(&g.host, &f.host), (&g.port, &f.port), (&g.database, &f.database), (&g.username, &f.username), (&g.password, &f.password)] {
            widgets::set_value(s, v, window, cx);
        }
        self.generic_ssl = f.ssl_mode.clone();
        self.protocol = f.protocol.clone();
        self.oracle_sid = f.connect_mode.as_deref() == Some("sid");
    }

    fn on_uri(&mut self, s: &Entity<InputState>, ev: &InputEvent, window: &mut Window, cx: &mut Context<Self>) {
        if !matches!(ev, InputEvent::Change) {
            return;
        }
        let next = s.read(cx).value().to_string();
        let looks_like_uri = {
            let t = next.trim();
            t.find("://").is_some_and(|i| i > 0 && t[..i].chars().all(|c| c.is_ascii_alphanumeric() || "+.-".contains(c)) && t.chars().next().unwrap().is_ascii_alphabetic())
        };
        if self.provider == "postgresql" || (fields::is_field_based(&self.provider) && looks_like_uri) {
            self.apply_uri(&next, window, cx);
        }
        cx.notify();
    }

    fn pg_form(&self, cx: &App) -> PgForm {
        let v = |s: &Entity<InputState>| widgets::value(s, cx);
        PgForm {
            host: v(&self.pg.host),
            port: v(&self.pg.port),
            database: v(&self.pg.database),
            username: v(&self.pg.username),
            password: v(&self.pg.password),
            ssl_mode: self.pg_ssl.clone(),
            keychain: self.pg_keychain,
            ssh: self.pg_ssh,
            ssh_host: v(&self.pg.ssh_host),
            ssh_port: v(&self.pg.ssh_port),
            ssh_username: v(&self.pg.ssh_username),
            ssh_private_key_auth: self.pg_ssh_key_auth,
            ssh_password: v(&self.pg.ssh_password),
            ssh_private_key: self.pg.ssh_key.read(cx).value().to_string(),
            ssh_keychain: self.pg_ssh_keychain,
        }
    }

    fn generic_values(&self, cx: &App) -> FieldValues {
        let v = |s: &Entity<InputState>| widgets::value(s, cx);
        FieldValues {
            host: v(&self.generic.host),
            port: v(&self.generic.port),
            database: v(&self.generic.database),
            username: v(&self.generic.username),
            password: v(&self.generic.password),
            ssl_mode: self.generic_ssl.clone(),
            auth_token: String::new(),
            protocol: self.protocol.clone(),
            connect_mode: (self.provider == "oracle").then(|| if self.oracle_sid { "sid" } else { "service" }.into()),
        }
    }

    fn jdbc_form(&self, cx: &App) -> JdbcForm {
        JdbcForm {
            url: widgets::value(&self.jdbc_url, cx),
            driver_class: widgets::value(&self.jdbc_driver, cx),
            username: widgets::value(&self.jdbc_user, cx),
            password: widgets::value(&self.jdbc_password, cx),
            jar_paths: self.jdbc_jars.clone(),
        }
    }

    fn federated_sources(&self, cx: &App) -> Vec<FederatedSource> {
        self.federated
            .iter()
            .map(|r| FederatedSource { alias: widgets::value(&r.alias, cx), connection_id: r.connection_id, namespace: widgets::value(&r.namespace, cx) })
            .collect()
    }

    /// `getCandidateConnectionString`.
    fn candidate(&self, cx: &App) -> String {
        let uri = widgets::value(&self.uri, cx);
        if fields::is_neon_cli(&uri) {
            return uri.trim().into();
        }
        match self.provider.as_str() {
            "postgresql" => fields::build_postgres(&self.pg_form(cx)),
            "turso" => {
                let b = fields::build_turso(&widgets::value(&self.turso_endpoint, cx), &widgets::value(&self.turso_token, cx));
                if b.is_empty() { uri.trim().into() } else { b }
            }
            "federated" => fields::build_federated(&self.federated_sources(cx)).unwrap_or_default(),
            "jdbc" => fields::build_jdbc(&self.jdbc_form(cx)),
            p if fields::is_field_based(p) => {
                let b = fields::build_from_fields(p, &self.generic_values(cx));
                if b.trim().is_empty() { uri.trim().into() } else { b }
            }
            _ => uri.trim().into(),
        }
    }

    fn federated_error(&self, cx: &App) -> Option<String> {
        let s = self.federated_sources(cx);
        s.iter().find_map(fields::federated_draft_error).or_else(|| fields::build_federated(&s).err())
    }

    fn validate_turso(&self, candidate: &str, cx: &mut App) -> bool {
        if self.provider != "turso" {
            return true;
        }
        match fields::parse_turso(candidate) {
            Some((e, _)) if e.is_empty() => {
                toast::error("Turso endpoint is required.", cx);
                false
            }
            None => {
                toast::error("Turso endpoint is required.", cx);
                false
            }
            Some((_, tok)) if tok.trim().is_empty() => {
                toast::error("Turso auth token is required.", cx);
                false
            }
            _ => true,
        }
    }

    fn back(&mut self, cx: &mut Context<Self>) {
        cx.emit(FormEvent::Back { to_select: !matches!(self.mode, FormMode::Edit(_)) });
    }

    /// `handleTestConnection`.
    fn test_connection(&mut self, cx: &mut Context<Self>) {
        let candidate = self.candidate(cx).trim().to_string();
        if candidate.is_empty() {
            toast::error("Connection URI is required.", cx);
            return;
        }
        if !self.validate_turso(&candidate, cx) {
            return;
        }
        if self.provider == "federated" {
            toast::message("Federated connections are validated when you open them and run a query.", cx);
            return;
        }
        self.testing = true;
        cx.notify();
        let kind = self.provider.clone();
        let name = {
            let n = widgets::value(&self.name, cx);
            if n.trim().is_empty() { fields::connection_name_from_details(&candidate, Some(&kind)) } else { n.trim().to_string() }
        };
        let task = rexa_core::runtime::spawn(async move {
            let driver = rexa_drivers::connect_detect(&kind, &candidate).await?;
            driver.execute("SELECT 1", 1).await.map(|_| ())
        });
        cx.spawn(async move |this, cx| {
            let res = task.await;
            this.update(cx, |this, cx| {
                this.testing = false;
                cx.notify();
                match res {
                    Ok(()) => {
                        toast::success("Connection successful.", cx);
                    }
                    Err(e) => crate::home::open_failure_dialog(
                        "Connection failed",
                        &name,
                        format!("Unable to connect to \"{name}\"."),
                        format!("{e:#}"),
                        false,
                        None,
                        gpui::WeakEntity::new_invalid(),
                        cx,
                    ),
                }
            })
            .ok();
        })
        .detach();
    }

    /// `handleAdd`.
    fn save(&mut self, cx: &mut Context<Self>) {
        if Store::open().ok().is_some_and(|s| rexa_store::CredentialStorageMode::current(&s) == rexa_store::CredentialStorageMode::Vault) && self.vault.is_none() {
            self.prompt_vault(cx);
            return;
        }
        let candidate = self.candidate(cx);
        if !self.validate_turso(&candidate, cx) {
            return;
        }
        if self.provider == "federated" {
            if let Err(e) = fields::build_federated(&self.federated_sources(cx)) {
                toast::error(e, cx);
                return;
            }
        }
        if candidate.trim().is_empty() {
            return;
        }
        self.loading = true;
        cx.notify();
        let p = self.provider.clone();
        let name = {
            let n = widgets::value(&self.name, cx);
            if n.trim().is_empty() { fields::connection_name_from_details(&candidate, Some(&p)) } else { n.trim().to_string() }
        };
        let mut d = ConnectionDraft {
            name: Some(name),
            connection_string: Some(candidate.clone()),
            connection_type: Some(p.clone()),
            tags: Some(self.tags.clone()),
            icon: Some(self.icon.clone()),
            color: None,
            groups: Some(self.groups.clone()),
            is_favorite: Some(self.favorite),
            last_active: self.last_active,
            ..Default::default()
        };
        if fields::is_field_based(&p) && !fields::is_neon_cli(&candidate) {
            let f = self.generic_values(cx);
            d.host = Some(f.host);
            d.port = Some(f.port);
            d.database = Some(f.database);
            d.username = Some(f.username);
            d.password = Some(Some(f.password));
            d.ssl_mode = Some(f.ssl_mode);
            d.auth_token = Some(Some(f.auth_token));
        } else if p == "postgresql" {
            let f = self.pg_form(cx);
            d.host = Some(f.host);
            d.port = Some(f.port);
            d.database = Some(f.database);
            d.username = Some(f.username);
            d.password = Some(Some(f.password));
            d.ssl_mode = Some(f.ssl_mode);
        } else if p == "turso" {
            d.host = Some(fields::turso_endpoint(&widgets::value(&self.turso_endpoint, cx)));
            d.database = Some(String::new());
            d.username = Some(String::new());
            d.password = Some(Some(String::new()));
            d.ssl_mode = Some("require".into());
            d.auth_token = Some(Some(widgets::value(&self.turso_token, cx)));
        }
        let vault = self.vault.clone();
        let res = Store::open().and_then(|s| match self.mode {
            FormMode::Edit(id) => {
                d.credential_ref = Some(self.credential_ref.clone());
                s.update_connection_with_vault(id, d, vault.as_deref()).map(|_| id)
            }
            _ => s.create_connection_with_vault(d, vault.as_deref()),
        });
        self.loading = false;
        match res {
            Ok(id) => {
                cx.default_global::<rexa_core::Sessions>().open.remove(&id);
                cx.emit(FormEvent::Saved);
            }
            Err(e) => {
                let msg = format!("{e:#}");
                toast::error(if msg.is_empty() { "Failed to save connection.".into() } else { msg }, cx);
                cx.notify();
            }
        }
    }

    fn prompt_vault(&mut self, cx: &mut Context<Self>) {
        let weak = cx.entity().downgrade();
        let existing = Store::open().ok().and_then(|s| s.vault_config().ok().flatten());
        rexa_ui::open_dialog(cx, move |window, cx| {
            let passphrase = cx.new(|cx| InputState::new(window, cx).masked(true).placeholder("At least 12 characters"));
            let pass = passphrase.clone();
            let existing = existing.clone();
            let w = weak.clone();
            rexa_ui::Dialog::new()
                .title(if existing.is_some() { "Unlock credential vault" } else { "Set up credential vault" })
                .description(if existing.is_some() { "Enter your vault passphrase to save this connection." } else { "Choose a passphrase of at least 12 characters. It cannot be recovered." })
                .child(FieldInput::new(&passphrase))
                .footer(Button::new("vault-cancel").outline().label("Cancel").on_click(|_, _, cx| rexa_ui::close_top(cx)))
                .footer(Button::new("vault-unlock").label(if existing.is_some() { "Unlock and save" } else { "Create vault and save" }).on_click(move |_, _, cx| {
                    let input = pass.read(cx).value().to_string();
                    if input.len() < 12 {
                        toast::error("Use at least 12 characters for the vault passphrase.", cx);
                        return;
                    }
                    let result = if let Some((salt, verifier)) = &existing {
                        Vault::unlock(&input, salt, verifier).map(|v| (v, None))
                    } else {
                        Vault::create(&input).and_then(|(v, salt, verifier)| {
                            Store::open()?.create_vault_config(&salt, &verifier)?;
                            Ok((v, Some(())))
                        })
                    };
                    match result {
                        Ok((vault, _)) => {
                            rexa_ui::close_top(cx);
                            w.update(cx, |form, cx| { form.vault = Some(Arc::new(vault)); form.save(cx); }).ok();
                        }
                        Err(e) => { toast::error(format!("{e:#}"), cx); }
                    }
                }))
        });
    }

    fn on_key_down(&mut self, ev: &KeyDownEvent, _window: &mut Window, cx: &mut Context<Self>) {
        let k = &ev.keystroke;
        let cmd = k.modifiers.platform || k.modifiers.control;
        match k.key.as_str() {
            "escape" => self.back(cx),
            "enter" if cmd && !k.modifiers.shift => self.save(cx),
            "t" if cmd && k.modifiers.shift => self.test_connection(cx),
            _ => return,
        }
        cx.stop_propagation();
    }

    // ---- tags ---------------------------------------------------------------------

    fn create_tag(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let name = widgets::value(&self.new_tag, cx).trim().to_string();
        if name.is_empty() {
            return;
        }
        let color = self.new_tag_color.clone().unwrap_or_else(|| TAG_COLORS[self.tag_library.len() % TAG_COLORS.len()].into());
        match Store::open().and_then(|s| s.save_connection_tag(&name, &color, None)) {
            Ok(()) => {
                widgets::set_value(&self.new_tag, "", window, cx);
                self.new_tag_color = None;
                if !self.tags.contains(&name) {
                    self.tags.push(name);
                }
                self.refresh_library(cx);
            }
            Err(e) => {
                toast::error(format!("{e:#}"), cx);
            }
        }
    }

    fn save_edited_tag(&mut self, _window: &mut Window, cx: &mut Context<Self>) {
        let Some(prev) = self.editing_tag.clone() else { return };
        let name = widgets::value(&self.edit_tag, cx).trim().to_string();
        if name.is_empty() {
            return;
        }
        match Store::open().and_then(|s| s.save_connection_tag(&name, &self.edit_tag_color, Some(&prev))) {
            Ok(()) => {
                self.editing_tag = None;
                for t in self.tags.iter_mut() {
                    if *t == prev {
                        *t = name.clone();
                    }
                }
                self.refresh_library(cx);
            }
            Err(e) => {
                toast::error(format!("{e:#}"), cx);
            }
        }
    }

    fn delete_tag(&mut self, name: String, cx: &mut Context<Self>) {
        match Store::open().and_then(|s| s.delete_connection_tag(&name)) {
            Ok(()) => {
                self.editing_tag = None;
                self.tags.retain(|t| *t != name);
                self.refresh_library(cx);
            }
            Err(_) => {
                toast::error("Failed to delete tag.", cx);
            }
        }
    }

    fn refresh_library(&mut self, cx: &mut Context<Self>) {
        if let Ok(lib) = Store::open().and_then(|s| s.connection_tag_library()) {
            self.tag_library = lib;
        }
        cx.emit(FormEvent::LibraryChanged);
        cx.notify();
    }

    fn use_custom_emoji(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let e = widgets::value(&self.custom_emoji, cx).trim().to_string();
        if e.is_empty() {
            return;
        }
        widgets::set_value(&self.custom_emoji, "", window, cx);
        // First grapheme: keep ZWJ sequences / variation selectors together.
        let mut first = String::new();
        for (i, c) in e.chars().enumerate() {
            if i > 0 && !matches!(c, '\u{200d}' | '\u{fe0f}' | '\u{1f3fb}'..='\u{1f3ff}') && !first.ends_with('\u{200d}') {
                break;
            }
            first.push(c);
        }
        self.set_icon(Some(format!("emoji:{first}")));
        cx.notify();
    }

    fn upload_icon(&mut self, cx: &mut Context<Self>) {
        let rx = cx.prompt_for_paths(gpui::PathPromptOptions { files: true, directories: false, multiple: false, prompt: None });
        cx.spawn(async move |this, cx| {
            let Ok(Ok(Some(paths))) = rx.await else { return };
            let Some(path) = paths.first().cloned() else { return };
            let res = image_to_icon_data_url(&path);
            this.update(cx, |this, cx| match res {
                Some(url) => {
                    this.set_icon(Some(format!("image:{url}")));
                    cx.notify();
                }
                None => {
                    toast::error("That file could not be read as an image.", cx);
                }
            })
            .ok();
        })
        .detach();
    }

    // ---- federated ---------------------------------------------------------------------

    fn add_federated_row(&mut self, s: FederatedSource, window: &mut Window, cx: &mut Context<Self>) {
        let alias = widgets::input_state(window, cx, &s.alias, "alias");
        let namespace = widgets::input_state(window, cx, &s.namespace, "default schema/db");
        self._subs.push(cx.observe(&alias, |_, _, cx| cx.notify()));
        self.federated.push(FederatedRow { connection_id: s.connection_id, alias, namespace });
    }

    fn toggle_federated(&mut self, conn: &SavedConnection, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(i) = self.federated.iter().position(|r| r.connection_id == conn.id) {
            self.federated.remove(i);
        } else {
            let used: Vec<String> = self.federated.iter().map(|r| widgets::value(&r.alias, cx)).collect();
            let base = sanitize_alias(&conn.name);
            let mut alias = base.clone();
            let mut n = 2;
            while used.contains(&alias) {
                alias = format!("{base}_{n}");
                n += 1;
            }
            let kind = federated_kind(&conn.connection_string);
            let ns = match kind {
                "sqlite" => "main".to_string(),
                "mysql" => url::Url::parse(&conn.connection_string).map(|u| u.path().trim_start_matches('/').to_string()).unwrap_or_default(),
                _ => "public".into(),
            };
            self.add_federated_row(FederatedSource { alias, connection_id: conn.id, namespace: ns }, window, cx);
        }
        cx.notify();
    }

    // ---- jdbc driver install (jdbc-driver-install-prompt.tsx) ----------------------------

    fn prompt_install(&mut self, t: fields::JdbcTemplate, cx: &mut Context<Self>) {
        let weak = cx.entity().downgrade();
        rexa_ui::open_dialog(cx, move |_, cx| {
            let tk = cx.tokens().clone();
            let (w, tpl) = (weak.clone(), t.clone());
            rexa_ui::Dialog::new()
                .max_w(440.)
                .title(format!("Install {} driver", t.name))
                .description("This database needs a JDBC driver. RexaDB can download it from Maven Central.")
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .gap_2()
                        .child(div().flex().items_center().gap_3().child(crate::select::jdbc_logo(&t.name, 32.)).child(
                            div()
                                .min_w_0()
                                .child(div().tw_text_sm().font_weight(FontWeight::MEDIUM).child(t.name.clone()))
                                .child(div().tw_text_xs().font_family(MONO).text_color(tk.muted_foreground).child(t.driver_class.clone())),
                        ))
                        .child(div().tw_text_xs().text_color(tk.muted_foreground).overflow_hidden().text_ellipsis().whitespace_nowrap().child(t.jar_url.clone())),
                )
                .footer(Button::new("jdbc-skip").outline().label("Skip").on_click(|_, _, cx| rexa_ui::close_top(cx)))
                .footer(Button::new("jdbc-install").icon(IconName::Download).label("Install Driver").on_click(move |_, _, cx| {
                    rexa_ui::close_top(cx);
                    let tpl = tpl.clone();
                    w.update(cx, |this, cx| this.install_driver(tpl, cx)).ok();
                }))
        });
    }

    fn install_driver(&mut self, t: fields::JdbcTemplate, cx: &mut Context<Self>) {
        self.installing = Some(t.name.clone());
        cx.notify();
        let dest = fields::driver_jar_path(&t.name, &t.jar_url);
        let url = t.jar_url.clone();
        let task = rexa_core::runtime::spawn(async move { download(&url, &dest).await.map(|_| dest) });
        cx.spawn(async move |this, cx| {
            let res = task.await;
            this.update(cx, |this, cx| {
                this.installing = None;
                match res {
                    Ok(path) => {
                        let jars = vec![path.to_string_lossy().to_string()];
                        fields::save_installed_driver(&t.name, &t.driver_class, &jars).ok();
                        this.jdbc_jars = jars;
                        toast::success(format!("{} driver installed.", t.name), cx);
                    }
                    Err(e) => {
                        toast::error(format!("Failed to install driver: {e:#}"), cx);
                    }
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    /// jdbc-driver-manager.tsx ("Browse Drivers"): installed drivers to pick from.
    fn open_driver_manager(&mut self, cx: &mut Context<Self>) {
        let weak = cx.entity().downgrade();
        rexa_ui::open_dialog(cx, move |_, cx| {
            let tk = cx.tokens().clone();
            let installed = fields::load_installed_drivers();
            let mut list = div().flex().flex_col().gap_2();
            if installed.is_empty() {
                list = list.child(div().py_6().text_center().tw_text_sm().text_color(tk.muted_foreground).child("No drivers installed yet."));
            }
            for (i, d) in installed.into_iter().enumerate() {
                let (w, d2) = (weak.clone(), d.clone());
                let name = d.name.clone();
                list = list.child(
                    div()
                        .id(("drv", i))
                        .flex()
                        .items_center()
                        .gap_3()
                        .p_3()
                        .tw_rounded_lg()
                        .border_1()
                        .border_color(with_alpha(tk.border, 0.6))
                        .hover(|s| s.bg(with_alpha(tk.muted, 0.3)))
                        .cursor_pointer()
                        .on_click(move |_, window, cx| {
                            rexa_ui::close_top(cx);
                            let d = d2.clone();
                            w.update(cx, |this, cx| {
                                widgets::set_value(&this.jdbc_driver, &d.driver_class, window, cx);
                                this.jdbc_jars = d.jar_paths.clone();
                                if widgets::value(&this.jdbc_url, cx).is_empty() {
                                    if let Some(t) = fields::jdbc_templates().iter().find(|t| t.name == d.name) {
                                        widgets::set_value(&this.jdbc_url, &fields::sample_jdbc_url(t), window, cx);
                                    }
                                }
                                cx.notify();
                            })
                            .ok();
                        })
                        .child(crate::select::jdbc_logo(&d.name, 24.))
                        .child(
                            div()
                                .flex_1()
                                .min_w_0()
                                .child(div().tw_text_sm().font_weight(FontWeight::MEDIUM).child(d.name.clone()))
                                .child(div().tw_text_xs().font_family(MONO).text_color(tk.muted_foreground).child(d.driver_class.clone())),
                        )
                        .child(
                            Button::new(("drv-rm", i)).ghost().size(ButtonSize::IconSm).icon(IconName::Trash).on_click(move |_, window, cx| {
                                cx.stop_propagation();
                                fields::remove_installed_driver(&name).ok();
                                window.refresh();
                            }),
                        ),
                );
            }
            rexa_ui::Dialog::new().max_w(520.).title("JDBC Drivers").description("Installed drivers. Pick one to use it for this connection.").child(list)
        });
    }

    // ---- rendering ---------------------------------------------------------------------

    fn card(&self, title: &str, desc: &str, t: &Tokens, body: impl IntoElement) -> impl IntoElement {
        // Card + className="space-y-5 border-studio-border/60 bg-studio-bg/80 p-5"
        div()
            .flex()
            .flex_col()
            .gap_5()
            .tw_rounded_lg()
            .border_1()
            .border_color(with_alpha(t.studio_border, 0.6))
            .bg(with_alpha(t.studio_bg, 0.8))
            .shadow(vec![gpui::BoxShadow {
                color: with_alpha(t.foreground, 0.1),
                offset: gpui::point(px(0.), px(0.)),
                blur_radius: px(0.),
                spread_radius: px(1.),
                inset: false,
            }])
            .p_5()
            .tw_text_sm()
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap_1()
                    .child(div().tw_text_sm().font_weight(FontWeight::SEMIBOLD).child(title.to_string()))
                    .child(div().tw_text_xs().text_color(t.muted_foreground).child(desc.to_string())),
            )
            .child(body)
    }

    fn picker_button(id: &'static str, t: &Tokens, content: AnyElement) -> impl IntoElement {
        // Button outline h-10 w-full justify-between border-border/60 bg-background text-sm font-normal
        div()
            .id(id)
            .flex()
            .items_center()
            .justify_between()
            .w_full()
            .h_10()
            .px_3()
            .tw_rounded_lg()
            .border_1()
            .border_color(with_alpha(t.border, 0.6))
            .bg(t.background)
            .tw_text_sm()
            .cursor_pointer()
            .hover(|s| s.bg(with_alpha(t.muted, 0.6)))
            .child(div().min_w_0().flex_1().overflow_hidden().child(content))
            .child(Icon::new(IconName::ChevronsUpDown).size_4().ml_2().flex_shrink_0().opacity(0.5))
    }

    fn render_icon_picker(&self, t: &Tokens, cx: &mut Context<Self>) -> impl IntoElement {
        let weak = cx.entity().downgrade();
        let provider = self.provider.clone();
        let current = self.icon_view(&provider, 24., cx);
        let trigger = div()
            .id("icon-picker")
            .flex()
            .size_10()
            .flex_shrink_0()
            .items_center()
            .justify_center()
            .tw_rounded_lg()
            .border_1()
            .border_color(with_alpha(t.border, 0.6))
            .bg(t.background)
            .cursor_pointer()
            .hover(|s| s.bg(t.accent))
            .child(current);
        Popover::new("icon-popover").align(Align::Start).w(Some(288.)).p(12.).trigger(trigger).content(move |ctl, _, cx| {
            let tk = cx.tokens().clone();
            let Some(this) = weak.upgrade() else { return div() };
            let cur = this.read(cx).icon.clone();
            let mut grid = div().grid().grid_cols(8).gap_1();
            for (i, e) in EMOJI_CHOICES.iter().enumerate() {
                let selected = cur.as_deref() == Some(&format!("emoji:{e}"));
                let (w, ctl) = (weak.clone(), ctl.clone());
                grid = grid.child(
                    div()
                        .id(("emoji", i))
                        .flex()
                        .size_7()
                        .items_center()
                        .justify_center()
                        .tw_rounded_md()
                        .tw_text_base()
                        .cursor_pointer()
                        .hover(|s| s.bg(tk.accent))
                        .when(selected, |d| d.bg(tk.accent).border_1().border_color(with_alpha(tk.primary, 0.5)))
                        .on_click(move |_, window, cx| {
                            w.update(cx, |this, cx| {
                                this.set_icon(Some(format!("emoji:{e}")));
                                cx.notify();
                            })
                            .ok();
                            ctl.close(window, cx);
                        })
                        .child(*e),
                );
            }
            let emoji_input = this.read(cx).custom_emoji.clone();
            let (w1, w2, w3) = (weak.clone(), weak.clone(), weak.clone());
            let (c1, c2, c3) = (ctl.clone(), ctl.clone(), ctl.clone());
            div()
                .flex()
                .flex_col()
                .gap_3()
                .child(grid)
                .child(
                    div()
                        .flex()
                        .gap_2()
                        .child(div().flex_1().child(rexa_ui::TextInput::new(&emoji_input)))
                        .child(Button::new("emoji-use").outline().size(ButtonSize::Sm).label("Use").on_click(move |_, window, cx| {
                            w1.update(cx, |this, cx| this.use_custom_emoji(window, cx)).ok();
                            c1.close(window, cx);
                        })),
                )
                .child(
                    div()
                        .flex()
                        .gap_2()
                        .border_t_1()
                        .border_color(with_alpha(tk.border, 0.4))
                        .pt_3()
                        .child(div().flex_1().child(Button::new("icon-upload").outline().size(ButtonSize::Sm).w_full().icon(IconName::Upload).label("Upload image").on_click(
                            move |_, window, cx| {
                                c2.close(window, cx);
                                w2.update(cx, |this, cx| this.upload_icon(cx)).ok();
                            },
                        )))
                        .child(Button::new("icon-default").ghost().size(ButtonSize::Sm).icon(IconName::RotateCcw).label("Default").disabled(cur.is_none()).on_click(
                            move |_, window, cx| {
                                w3.update(cx, |this, cx| {
                                    this.set_icon(None);
                                    cx.notify();
                                })
                                .ok();
                                c3.close(window, cx);
                            },
                        )),
                )
        })
    }

    fn icon_view(&self, provider: &str, size: f32, cx: &App) -> AnyElement {
        if let Some(i) = &self.icon_image {
            return img(i.clone()).size(px(size)).tw_rounded_md().object_fit(ObjectFit::Cover).into_any_element();
        }
        if let Some(e) = self.icon.as_deref().and_then(|i| i.strip_prefix("emoji:")) {
            return div().size(px(size)).flex().items_center().justify_center().text_size(px(size * 0.85)).child(e.to_string()).into_any_element();
        }
        provider_logo(provider, size, cx)
    }

    fn tag_color(&self, name: &str) -> Option<gpui::Hsla> {
        self.tag_library.iter().find(|t| t.name == name).and_then(|t| rexa_ui::parse_color(&t.color))
    }

    fn render_tag_list(&self, names: &[String], max: usize, t: &Tokens) -> impl IntoElement {
        let mut row = div().flex().min_w_0().items_center().gap_1();
        for n in names.iter().take(max) {
            row = row.child(tag_badge(n, self.tag_color(n)));
        }
        if names.len() > max {
            row = row.child(div().tw_text_10().text_color(t.muted_foreground).child(format!("+{}", names.len() - max)));
        }
        row
    }

    fn swatches(id: &'static str, value: String, on: impl Fn(&str, &mut Window, &mut App) + 'static) -> impl IntoElement {
        let on = std::rc::Rc::new(on);
        let mut row = div().flex().flex_wrap().gap(px(6.));
        for (i, c) in TAG_COLORS.iter().enumerate() {
            let on = on.clone();
            let color = rexa_ui::parse_color(c).unwrap();
            let selected = value == *c;
            row = row.child(
                div()
                    .id((id, i))
                    .size_4()
                    .rounded_full()
                    .bg(color)
                    .cursor_pointer()
                    .when(selected, |d| d.border_2().border_color(gpui::hsla(0., 0., 1., 0.6)))
                    .on_click(move |_, w, cx| on(c, w, cx)),
            );
        }
        row
    }

    fn render_tag_picker(&self, t: &Tokens, cx: &mut Context<Self>) -> impl IntoElement {
        let content: AnyElement = if self.tags.is_empty() {
            div().text_color(t.muted_foreground).child("Select tags").into_any_element()
        } else {
            self.render_tag_list(&self.tags, 2, t).into_any_element()
        };
        let weak = cx.entity().downgrade();
        Popover::new("tag-popover").align(Align::Start).match_trigger_width().w(Some(256.)).p(6.).w_full().trigger(Self::picker_button("tag-picker", t, content)).content(
            move |_, _, cx| {
                let tk = cx.tokens().clone();
                let Some(this) = weak.upgrade() else { return div() };
                let f = this.read(cx);
                let mut body = div().flex().flex_col().gap_2();
                if f.tag_library.is_empty() {
                    body = body.child(div().px_2().py_3().text_center().tw_text_sm().text_color(tk.muted_foreground).child("No tags yet. Create one below."));
                } else {
                    let mut list = div().id("tag-list").flex().flex_col().gap(px(2.)).max_h(px(240.)).overflow_y_scroll();
                    for (i, tag) in f.tag_library.iter().enumerate() {
                        let name = tag.name.clone();
                        if f.editing_tag.as_deref() == Some(name.as_str()) {
                            let (w1, w2, w3, w4) = (weak.clone(), weak.clone(), weak.clone(), weak.clone());
                            let n2 = name.clone();
                            list = list.child(
                                div()
                                    .flex()
                                    .flex_col()
                                    .gap_2()
                                    .tw_rounded_md()
                                    .border_1()
                                    .border_color(with_alpha(tk.border, 0.6))
                                    .p_2()
                                    .child(rexa_ui::TextInput::new(&f.edit_tag))
                                    .child(Self::swatches("edit-sw", f.edit_tag_color.clone(), move |c, _, cx| {
                                        let c = c.to_string();
                                        w1.update(cx, |this, cx| {
                                            this.edit_tag_color = c;
                                            cx.notify();
                                        })
                                        .ok();
                                    }))
                                    .child(
                                        div()
                                            .flex()
                                            .items_center()
                                            .gap(px(6.))
                                            .child(Button::new("tag-del").ghost().size(ButtonSize::Sm).icon(IconName::Trash).label("Delete").colors(
                                                gpui::transparent_black(),
                                                with_alpha(tk.muted, 0.6),
                                                tk.destructive,
                                            ).on_click(move |_, _, cx| {
                                                let n = n2.clone();
                                                w2.update(cx, |this, cx| this.delete_tag(n, cx)).ok();
                                            }))
                                            .child(div().ml_auto().flex().gap(px(6.)).child(Button::new("tag-cancel").ghost().size(ButtonSize::Sm).label("Cancel").on_click(
                                                move |_, _, cx| {
                                                    w3.update(cx, |this, cx| {
                                                        this.editing_tag = None;
                                                        cx.notify();
                                                    })
                                                    .ok();
                                                },
                                            )).child(Button::new("tag-save").size(ButtonSize::Sm).label("Save").on_click(move |_, window, cx| {
                                                w4.update(cx, |this, cx| this.save_edited_tag(window, cx)).ok();
                                            }))),
                                    ),
                            );
                            continue;
                        }
                        let checked = f.tags.contains(&name);
                        let (w1, w2) = (weak.clone(), weak.clone());
                        let (n1, n2, color) = (name.clone(), name.clone(), tag.color.clone());
                        let gid = SharedString::from(format!("tag-row-{i}"));
                        list = list.child(
                            div()
                                .id(gid.clone())
                                .group(gid.clone())
                                .flex()
                                .items_center()
                                .gap_1()
                                .rounded(px(4.))
                                .hover(|s| s.bg(tk.accent))
                                .child(
                                    div()
                                        .id(("tag-toggle", i))
                                        .flex()
                                        .flex_1()
                                        .min_w_0()
                                        .items_center()
                                        .gap_2()
                                        .px_2()
                                        .py(px(6.))
                                        .cursor_pointer()
                                        .on_click(move |_, _, cx| {
                                            let n = n1.clone();
                                            w1.update(cx, |this, cx| {
                                                if let Some(i) = this.tags.iter().position(|t| *t == n) {
                                                    this.tags.remove(i);
                                                } else {
                                                    this.tags.push(n);
                                                }
                                                cx.notify();
                                            })
                                            .ok();
                                        })
                                        .child(rexa_ui::square_check(checked, cx))
                                        .child(tag_badge(&name, rexa_ui::parse_color(&tag.color))),
                                )
                                .child(
                                    div()
                                        .id(("tag-edit", i))
                                        .mr_1()
                                        .p_1()
                                        .rounded(px(4.))
                                        .text_color(tk.muted_foreground)
                                        .opacity(0.)
                                        .group_hover(gid, |s| s.opacity(1.))
                                        .hover(|s| s.text_color(tk.foreground))
                                        .cursor_pointer()
                                        .on_click(move |_, window, cx| {
                                            let (n, c) = (n2.clone(), color.clone());
                                            w2.update(cx, |this, cx| {
                                                widgets::set_value(&this.edit_tag, &n, window, cx);
                                                this.edit_tag_color = c;
                                                this.editing_tag = Some(n);
                                                cx.notify();
                                            })
                                            .ok();
                                        })
                                        .child(Icon::new(IconName::Pencil).size(px(14.))),
                                ),
                        );
                    }
                    body = body.child(list);
                }
                let next_color = f.new_tag_color.clone().unwrap_or_else(|| TAG_COLORS[f.tag_library.len() % TAG_COLORS.len()].into());
                let empty = widgets::value(&f.new_tag, cx).trim().is_empty();
                let (w1, w2) = (weak.clone(), weak.clone());
                body.child(
                    div()
                        .flex()
                        .flex_col()
                        .gap_2()
                        .tw_rounded_md()
                        .border_1()
                        .border_color(with_alpha(tk.border, 0.6))
                        .p_2()
                        .child(rexa_ui::TextInput::new(&f.new_tag))
                        .child(Self::swatches("new-sw", next_color, move |c, _, cx| {
                            let c = c.to_string();
                            w1.update(cx, |this, cx| {
                                this.new_tag_color = Some(c);
                                cx.notify();
                            })
                            .ok();
                        }))
                        .child(div().flex().justify_end().child(Button::new("tag-create").size(ButtonSize::Sm).icon(IconName::Plus).label("Create tag").disabled(empty).on_click(
                            move |_, window, cx| {
                                w2.update(cx, |this, cx| this.create_tag(window, cx)).ok();
                            },
                        ))),
                )
            },
        )
    }

    fn render_folder_picker(&self, t: &Tokens, cx: &mut Context<Self>) -> impl IntoElement {
        let content: AnyElement = if self.groups.is_empty() {
            div().text_color(t.muted_foreground).child("Select folders").into_any_element()
        } else {
            div().overflow_hidden().text_ellipsis().whitespace_nowrap().child(self.groups.join(", ")).into_any_element()
        };
        let weak = cx.entity().downgrade();
        Popover::new("folder-popover").align(Align::Start).match_trigger_width().p(4.).w_full().trigger(Self::picker_button("folder-picker", t, content)).content(move |_, _, cx| {
            let tk = cx.tokens().clone();
            let Some(this) = weak.upgrade() else { return div() };
            let f = this.read(cx);
            if f.folders.is_empty() {
                return div().px_2().py_4().text_center().tw_text_sm().text_color(tk.muted_foreground).child("No folders found.");
            }
            let mut list = div().id("folder-list").flex().flex_col().gap(px(2.)).max_h(px(240.)).overflow_y_scroll();
            for (i, g) in f.folders.iter().enumerate() {
                let selected = f.groups.contains(g);
                let (w, name) = (weak.clone(), g.clone());
                list = list.child(
                    div()
                        .id(("folder", i))
                        .flex()
                        .items_center()
                        .gap_2()
                        .px_2()
                        .py(px(6.))
                        .tw_text_sm()
                        .rounded(px(4.))
                        .cursor_pointer()
                        .hover(|s| s.bg(tk.accent))
                        .when(selected, |d| d.bg(tk.accent))
                        .on_click(move |_, _, cx| {
                            let n = name.clone();
                            w.update(cx, |this, cx| {
                                if let Some(i) = this.groups.iter().position(|g| *g == n) {
                                    this.groups.remove(i);
                                } else {
                                    this.groups.push(n);
                                }
                                cx.notify();
                            })
                            .ok();
                        })
                        .child(rexa_ui::square_check(selected, cx))
                        .child(div().overflow_hidden().text_ellipsis().whitespace_nowrap().child(g.clone())),
                );
            }
            div().child(list)
        })
    }

    fn render_details(&self, t: &Tokens, cx: &mut Context<Self>) -> impl IntoElement {
        let weak = cx.entity().downgrade();
        let body = div()
            .flex()
            .flex_col()
            .gap_4()
            .child(field(
                "Connection Name",
                div().flex().gap_2().child(self.render_icon_picker(t, cx)).child(FieldInput::new(&self.name).h(40.)),
            ))
            .child(
                div()
                    .grid()
                    .grid_cols(2)
                    .gap_4()
                    .child(field("Tags", self.render_tag_picker(t, cx)))
                    .child(field("Group / Folder", self.render_folder_picker(t, cx))),
            )
            .child(
                div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .py_2()
                    .border_t_1()
                    .border_color(with_alpha(t.border, 0.4))
                    .child(div().flex().flex_col().gap(px(2.)).child(label("Favorite")).child(hint("Pin to top of list", cx)))
                    .child(Switch::new("favorite").checked(self.favorite).on_change(move |v, _, cx| {
                        weak.update(cx, |this, cx| {
                            this.favorite = v;
                            cx.notify();
                        })
                        .ok();
                    })),
            );
        self.card("Details", "Name, icon, tags, folder and favorite.", t, body)
    }

    fn fast_fill(&self, placeholder_note: Option<String>, cx: &App) -> impl IntoElement {
        let t = cx.tokens();
        div()
            .flex()
            .flex_col()
            .gap_2()
            .tw_rounded_lg()
            .border_1()
            .border_color(with_alpha(t.border, 0.6))
            .bg(with_alpha(t.muted, 0.4))
            .p_3()
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap_2()
                    .child(label("Connection String"))
                    .child(div().tw_text_xs().text_color(t.muted_foreground).child("(Optional fast-fill)")),
            )
            .child(FieldInput::new(&self.uri).mono())
            .children(placeholder_note.map(|n| hint(n, cx)))
    }

    fn ssl_select(&self, id: &'static str, options: Vec<(&'static str, &'static str)>, value: String, generic: bool, cx: &mut Context<Self>) -> impl IntoElement {
        let weak = cx.entity().downgrade();
        Select::new(id)
            .options(options.into_iter().map(|(v, l)| SelectOption::new(v, l)))
            .value(Some(value))
            .placeholder("Select SSL mode")
            .small()
            .w_full()
            .on_change(move |v, _, cx| {
                weak.update(cx, |this, cx| {
                    if generic {
                        this.generic_ssl = v.to_string();
                    } else {
                        this.pg_ssl = v.to_string();
                    }
                    cx.notify();
                })
                .ok();
            })
    }

    fn render_postgres(&self, t: &Tokens, cx: &mut Context<Self>) -> AnyElement {
        let w = cx.entity().downgrade();
        let pick = |f: fn(&mut ConnectionForm, usize)| {
            let w = w.clone();
            move |i: usize, _: &mut Window, cx: &mut App| {
                w.update(cx, |this, cx| {
                    f(this, i);
                    cx.notify();
                })
                .ok();
            }
        };
        let keychain_toggle = |id: &'static str, on: bool, what: &'static str, ssh: bool, w: gpui::WeakEntity<Self>| {
            div()
                .id(id)
                .flex()
                .items_center()
                .gap(px(6.))
                .tw_text_xs()
                .text_color(t.muted_foreground)
                .hover(|s| s.text_color(t.foreground))
                .cursor_pointer()
                .on_click(move |_, _, cx| {
                    w.update(cx, |this, cx| {
                        if ssh {
                            this.pg_ssh_keychain = !this.pg_ssh_keychain;
                        } else {
                            this.pg_keychain = !this.pg_keychain;
                        }
                        cx.notify();
                    })
                    .ok();
                    toast::message("Changing keychain setting requires app restart to fully apply.", cx);
                })
                .child(Icon::new(IconName::ShieldCheck).size(px(14.)))
                .child(format!("{} {what} client keychain integration", if on { "Disable" } else { "Enable" }))
        };
        let pg = &self.pg;
        let mut ssh = div().flex().flex_col().border_t_1().border_color(with_alpha(t.border, 0.6)).pt_2().child(
            div()
                .mb_3()
                .mt_1()
                .flex()
                .items_center()
                .justify_between()
                .child(label("SSH Tunnel"))
                .child(widgets::segmented("ssh-mode", &[("Off", !self.pg_ssh), ("Enable SSH", self.pg_ssh)], false, false, pick(|f, i| f.pg_ssh = i == 1), cx)),
        );
        if self.pg_ssh {
            let small = |text: &'static str, input: AnyElement| div().flex().flex_col().gap_2().child(div().tw_text_xs().font_weight(FontWeight::MEDIUM).child(text)).child(input);
            let auth = if self.pg_ssh_key_auth {
                small(
                    "Private Key",
                    div()
                        .flex()
                        .flex_col()
                        .gap_2()
                        .child(div().font_family(MONO).tw_text_xs().child(TextArea::new(&pg.ssh_key).min_h(120.)))
                        .child(keychain_toggle("ssh-keychain", self.pg_ssh_keychain, "SSH", true, w.clone()))
                        .child(hint("This client setting does not control saved credential storage.", cx))
                        .into_any_element(),
                )
            } else {
                small("SSH Password", PasswordInput::new("ssh-password", &pg.ssh_password).into_any_element())
            };
            ssh = ssh.child(
                div()
                    .mt_3()
                    .flex()
                    .flex_col()
                    .gap_4()
                    .tw_rounded_lg()
                    .border_1()
                    .border_color(with_alpha(t.border, 0.6))
                    .bg(with_alpha(t.muted, 0.4))
                    .p_4()
                    .child(
                        div()
                            .grid()
                            .grid_cols(3)
                            .gap_3()
                            .child(div().col_span(2).child(small("SSH Server", FieldInput::new(&pg.ssh_host).into_any_element())))
                            .child(small("Port", FieldInput::new(&pg.ssh_port).into_any_element())),
                    )
                    .child(small("SSH Username", FieldInput::new(&pg.ssh_username).into_any_element()))
                    .child(
                        div().flex().flex_col().gap_3().pt_2().child(div().tw_text_xs().font_weight(FontWeight::MEDIUM).child("Authentication")).child(widgets::segmented(
                            "ssh-auth",
                            &[("Password", !self.pg_ssh_key_auth), ("Private Key", self.pg_ssh_key_auth)],
                            false,
                            true,
                            pick(|f, i| f.pg_ssh_key_auth = i == 1),
                            cx,
                        )),
                    )
                    .child(auth),
            );
        }
        div()
            .flex()
            .flex_col()
            .gap_4()
            .child(self.fast_fill(None, cx))
            .child(div().grid().grid_cols(2).gap_3().child(field("Host", FieldInput::new(&pg.host))).child(field("Port", FieldInput::new(&pg.port))))
            .child(field("Database", FieldInput::new(&pg.database)))
            .child(
                div().grid().grid_cols(2).gap_3().child(field("Username", FieldInput::new(&pg.username))).child(
                    div()
                        .flex()
                        .flex_col()
                        .gap_2()
                        .child(label("Password"))
                        .child(PasswordInput::new("pg-password", &pg.password))
                        .child(div().mt_1().child(keychain_toggle("pg-keychain", self.pg_keychain, "PostgreSQL", false, w.clone())))
                        .child(hint("This client setting does not control saved credential storage.", cx)),
                ),
            )
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap_4()
                    .border_t_1()
                    .border_color(with_alpha(t.border, 0.6))
                    .pt_4()
                    .child(field("SSL Mode", self.ssl_select("pg-ssl", fields::PG_SSL_OPTIONS.to_vec(), self.pg_ssl.clone(), false, cx)))
                    .child(ssh),
            )
            .into_any_element()
    }

    fn render_generic(&self, cx: &mut Context<Self>) -> AnyElement {
        let p = self.provider.clone();
        let (redis, mongo, ps, oracle) = (p == "redis", p == "mongodb", p == "planetscale", p == "oracle");
        let w = cx.entity().downgrade();
        let g = &self.generic;
        let mut col = div().flex().flex_col().gap_4();
        if ps {
            let w = w.clone();
            col = col.child(
                div()
                    .flex()
                    .flex_col()
                    .gap_2()
                    .child(label("Protocol"))
                    .child(widgets::segmented(
                        "ps-proto",
                        &[("Vitess (MySQL)", self.protocol == "mysql"), ("PostgreSQL", self.protocol != "mysql")],
                        true,
                        true,
                        move |i, window, cx| {
                            w.update(cx, |this, cx| {
                                this.protocol = if i == 0 { "mysql" } else { "postgresql" }.into();
                                widgets::set_value(&this.generic.port, if i == 0 { "3306" } else { "5432" }, window, cx);
                                this.generic_ssl = "require".into();
                                cx.notify();
                            })
                            .ok();
                        },
                        cx,
                    ))
                    .child(hint(
                        if self.protocol == "mysql" {
                            "Vitess (MySQL) is PlanetScale's original protocol."
                        } else {
                            "PlanetScale also supports the PostgreSQL wire protocol."
                        },
                        cx,
                    )),
            );
        }
        if oracle {
            let w = w.clone();
            col = col.child(
                div()
                    .flex()
                    .flex_col()
                    .gap_2()
                    .child(label("Connection Type"))
                    .child(widgets::segmented(
                        "ora-mode",
                        &[("Service Name", !self.oracle_sid), ("SID", self.oracle_sid)],
                        true,
                        true,
                        move |i, window, cx| {
                            w.update(cx, |this, cx| {
                                this.oracle_sid = i == 1;
                                let cs = fields::build_from_fields("oracle", &this.generic_values(cx));
                                widgets::set_value(&this.uri, &cs, window, cx);
                                cx.notify();
                            })
                            .ok();
                        },
                        cx,
                    ))
                    .child(hint("Service Name and SID are mutually exclusive. Prefer Service Name for modern Oracle (for example FREEPDB1 / XEPDB1).", cx)),
            );
        }
        let note = oracle.then(|| {
            if self.oracle_sid { "SID URLs use ?sid=ORCL and an empty path." } else { "Service Name URLs put the service in the path (/FREEPDB1)." }.to_string()
        });
        col = col
            .child(self.fast_fill(note, cx))
            .child(div().grid().grid_cols(2).gap_3().child(field("Host", FieldInput::new(&g.host))).child(field("Port", FieldInput::new(&g.port))));
        let db_label = if redis {
            "Database Index"
        } else if oracle {
            if self.oracle_sid { "SID" } else { "Service Name" }
        } else {
            "Database"
        };
        let mut db = field(db_label, FieldInput::new(&g.database));
        if redis {
            db = db.child(hint("Logical database number (e.g. 0, 1, 2).", cx));
        }
        if mongo {
            db = db.child(hint("Default database / auth source.", cx));
        }
        if oracle {
            db = db.child(hint(
                if self.oracle_sid { "Legacy System Identifier for the instance." } else { "Listener service name. Run lsnrctl services on the server to list them." },
                cx,
            ));
        }
        col.child(db)
            .child(div().grid().grid_cols(2).gap_3().child(field("Username", FieldInput::new(&g.username))).child(field("Password", PasswordInput::new("f-password", &g.password))))
            .child(field("SSL Mode", self.ssl_select("f-ssl", fields::ssl_options(&p, &self.protocol), self.generic_ssl.clone(), true, cx)))
            .into_any_element()
    }

    fn render_federated(&self, t: &Tokens, cx: &mut Context<Self>) -> AnyElement {
        let editing = match self.mode {
            FormMode::Edit(id) => Some(id),
            _ => None,
        };
        let eligible: Vec<SavedConnection> = self
            .connections
            .iter()
            .filter(|c| Some(c.id) != editing && matches!(federated_kind(&c.connection_string), "postgres" | "sqlite" | "mysql"))
            .cloned()
            .collect();
        let mut list = div().flex().flex_col().gap_3().child(hint("Choose the saved SQL connections to include in this federated connection.", cx));
        if eligible.is_empty() {
            list = list.child(
                div()
                    .tw_rounded_lg()
                    .border_1()
                    .border_dashed()
                    .border_color(with_alpha(t.border, 0.6))
                    .px_3()
                    .py_4()
                    .tw_text_sm()
                    .text_color(t.muted_foreground)
                    .child("No supported saved SQL connections found. Add a Postgres, MySQL, SQLite, or libSQL connection first."),
            );
        }
        let mut rows = div().flex().flex_col().gap_2().p_2();
        for c in &eligible {
            let checked = self.federated.iter().any(|r| r.connection_id == c.id);
            let (w, c2) = (cx.entity().downgrade(), c.clone());
            let lbl = federated_label(&c.connection_string);
            rows = rows.child(
                div()
                    .id(SharedString::from(format!("fed-{}", c.id)))
                    .flex()
                    .items_center()
                    .gap_3()
                    .tw_rounded_lg()
                    .border_1()
                    .border_color(with_alpha(t.border, 0.6))
                    .px_3()
                    .py_3()
                    .cursor_pointer()
                    .hover(|s| s.bg(with_alpha(t.muted, 0.3)))
                    .on_click(move |_, window, cx| {
                        let c = c2.clone();
                        w.update(cx, |this, cx| this.toggle_federated(&c, window, cx)).ok();
                    })
                    .child(Checkbox::new(SharedString::from(format!("fed-cb-{}", c.id))).checked(checked))
                    .child(
                        div()
                            .min_w_0()
                            .flex_1()
                            .flex()
                            .items_center()
                            .gap_2()
                            .child(div().overflow_hidden().text_ellipsis().whitespace_nowrap().tw_text_sm().font_weight(FontWeight::MEDIUM).child(c.name.clone()))
                            .child(rexa_ui::Badge::new(lbl.to_uppercase()).variant(rexa_ui::BadgeVariant::Outline)),
                    ),
            );
        }
        list = list.child(
            div()
                .id("fed-scroll")
                .h(px(224.))
                .overflow_y_scroll()
                .tw_rounded_lg()
                .border_1()
                .border_color(with_alpha(t.border, 0.6))
                .child(rows),
        );
        let mut selected = div().flex().flex_col().gap_3();
        for r in &self.federated {
            let name = self.connections.iter().find(|c| c.id == r.connection_id).map_or("Unknown connection".to_string(), |c| c.name.clone());
            let src = FederatedSource { alias: widgets::value(&r.alias, cx), connection_id: r.connection_id, namespace: String::new() };
            let err = fields::federated_draft_error(&src);
            let (w, id) = (cx.entity().downgrade(), r.connection_id);
            selected = selected.child(
                div()
                    .flex()
                    .flex_col()
                    .gap_2()
                    .tw_rounded_lg()
                    .border_1()
                    .border_color(with_alpha(t.border, 0.6))
                    .p_3()
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .justify_between()
                            .gap_3()
                            .child(div().min_w_0().overflow_hidden().text_ellipsis().whitespace_nowrap().tw_text_sm().font_weight(FontWeight::MEDIUM).child(name))
                            .child(Button::new(SharedString::from(format!("fed-rm-{id}"))).outline().size(ButtonSize::IconLg).icon(IconName::Trash).on_click(
                                move |_, _, cx| {
                                    w.update(cx, |this, cx| {
                                        this.federated.retain(|r| r.connection_id != id);
                                        cx.notify();
                                    })
                                    .ok();
                                },
                            )),
                    )
                    .child(div().grid().grid_cols(2).gap_2().child(FieldInput::new(&r.alias)).child(FieldInput::new(&r.namespace)))
                    .children(err.map(|e| div().tw_text_xs().text_color(rexa_ui::tw("red-400")).child(e))),
            );
        }
        let err = self.federated_error(cx);
        div()
            .flex()
            .flex_col()
            .gap_3()
            .child(div().flex().flex_col().gap_2().child(label("Mapped Sources")).child(div().flex().flex_col().gap_4().child(list).when(!self.federated.is_empty(), |d| d.child(selected))))
            .child(match err {
                Some(e) => div().tw_text_xs().text_color(t.destructive).child(e),
                None => hint("Use aliases like `sales.users` and `app.orders` in federated SQL queries.", cx),
            })
            .into_any_element()
    }

    fn render_jdbc(&self, t: &Tokens, cx: &mut Context<Self>) -> AnyElement {
        let w = cx.entity().downgrade();
        let installing = self.installing.clone();
        div()
            .flex()
            .flex_col()
            .gap_4()
            .child(field("Connection String", FieldInput::new(&self.jdbc_url).mono()))
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap_2()
                    .child(
                        div().flex().items_center().justify_between().child(label("Driver Class")).child(
                            div()
                                .id("browse-drivers")
                                .tw_text_xs()
                                .text_color(t.muted_foreground)
                                .underline()
                                .cursor_pointer()
                                .hover(|s| s.text_color(t.foreground))
                                .on_click(move |_, _, cx| {
                                    w.update(cx, |this, cx| this.open_driver_manager(cx)).ok();
                                })
                                .child("Browse Drivers"),
                        ),
                    )
                    .child(
                        div().relative().child(FieldInput::new(&self.jdbc_driver).mono().h(32.)).children((!self.jdbc_jars.is_empty()).then(|| {
                            div().absolute().right_3().top(px(8.)).child(Icon::new(IconName::Check).size_4().text_color(rexa_ui::tw("green-500")))
                        })),
                    ),
            )
            .child(div().grid().grid_cols(2).gap_3().child(field("Username", FieldInput::new(&self.jdbc_user))).child(field("Password", PasswordInput::new("jdbc-password", &self.jdbc_password))))
            .children(installing.map(|n| hint(format!("Installing {n} driver…"), cx)))
            .children((!self.jdbc_jars.is_empty()).then(|| {
                div()
                    .flex()
                    .flex_col()
                    .gap_1()
                    .child(div().tw_text_xs().text_color(t.muted_foreground).font_weight(FontWeight::MEDIUM).child(if self.jdbc_jars.len() > 1 { "Driver JARs" } else { "Driver JAR" }))
                    .child(div().tw_text_xs().text_color(t.muted_foreground).overflow_hidden().text_ellipsis().whitespace_nowrap().child(self.jdbc_jars.join(", ")))
            }))
            .into_any_element()
    }

    fn render_file(&self, duckdb: bool, t: &Tokens, cx: &mut Context<Self>) -> AnyElement {
        let code = |s: &'static str| div().tw_text_xs().bg(t.muted).px_1().rounded(px(4.)).child(s);
        let w = cx.entity().downgrade();
        let mut desc = div().flex().flex_wrap().items_center().gap(px(3.)).tw_text_xs().text_color(t.muted_foreground);
        desc = if duckdb {
            desc.child("Select a DuckDB database file (").child(code(".duckdb")).child("or").child(code(".ddb")).child("), or type a path manually. Use").child(code(":memory:")).child("for an in-memory database.")
        } else {
            desc.child("Select a SQLite database file, or type a path manually. Use").child(code(":memory:")).child("for an in-memory database.")
        };
        div()
            .flex()
            .flex_col()
            .gap_2()
            .child(label("Database File"))
            .child(
                div().flex().gap_2().child(div().flex_1().child(FieldInput::new(&self.uri).mono().h(32.))).child(
                    Button::new("browse-file").outline().icon(IconName::FolderOpen).label("Browse").on_click(move |_, _, cx| {
                        let rx = cx.prompt_for_paths(gpui::PathPromptOptions { files: true, directories: false, multiple: false, prompt: None });
                        let w = w.clone();
                        cx.spawn(async move |cx| {
                            if let Ok(Ok(Some(p))) = rx.await {
                                if let Some(p) = p.first() {
                                    let s = p.to_string_lossy().to_string();
                                    cx.update(|cx| {
                                        if let Some(win) = cx.active_window() {
                                            win.update(cx, |_, window, cx| {
                                                w.update(cx, |this, cx| widgets::set_value(&this.uri, &s, window, cx)).ok();
                                            })
                                            .ok();
                                        }
                                    });
                                }
                            }
                        })
                        .detach();
                    }),
                ),
            )
            .child(desc)
            .into_any_element()
    }

    fn render_database(&self, t: &Tokens, cx: &mut Context<Self>) -> impl IntoElement {
        let uri = widgets::value(&self.uri, cx);
        let body = match self.provider.as_str() {
            "postgresql" => self.render_postgres(t, cx),
            "turso" => div()
                .flex()
                .flex_col()
                .gap_3()
                .child(field("Database Endpoint", FieldInput::new(&self.turso_endpoint).h(32.)))
                .child(field("Auth Token", FieldInput::new(&self.turso_token).h(32.)))
                .into_any_element(),
            "federated" => self.render_federated(t, cx),
            "jdbc" => self.render_jdbc(t, cx),
            "sqlite" => self.render_file(false, t, cx),
            "duckdb" => self.render_file(true, t, cx),
            _ if fields::is_neon_cli(&uri) => div()
                .flex()
                .flex_col()
                .gap_2()
                .tw_rounded_lg()
                .border_1()
                .border_color(with_alpha(t.border, 0.6))
                .bg(with_alpha(t.muted, 0.4))
                .p_3()
                .child(label("Neon connection"))
                .child(hint(
                    "This connection is managed via your Neon account. Rename it here, or connect the database again from the Neon screen to change the project, branch, database or role.",
                    cx,
                ))
                .into_any_element(),
            p if fields::is_field_based(p) => self.render_generic(cx),
            _ => field("Connection URI", FieldInput::new(&self.uri).mono().h(32.)).into_any_element(),
        };
        self.card("Database Connection", "Connection string, host, port, credentials and SSL.", t, div().flex().flex_col().gap_5().child(body))
    }
}

impl Render for ConnectionForm {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        let empty = self.candidate(cx).trim().is_empty();
        let editing = matches!(self.mode, FormMode::Edit(_));
        let logo_known = providers::card(&self.provider).is_some() || self.provider == "supabase-mgmt";
        div()
            .id("connection-form")
            .track_focus(&self.focus)
            .on_key_down(cx.listener(Self::on_key_down))
            .size_full()
            .overflow_y_scroll()
            .py_6()
            .child(
                div()
                    .mx_auto()
                    .max_w(px(1152.))
                    .px_2()
                    .flex()
                    .flex_col()
                    .gap_4()
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .justify_between()
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .gap_2()
                                    .child(Button::new("form-back").ghost().size(ButtonSize::Icon).icon(IconName::ArrowLeft).on_click(cx.listener(|this, _, _, cx| this.back(cx))))
                                    .child(div().tw_text_sm().font_weight(FontWeight::SEMIBOLD).child(format!("Configure {}", self.provider))),
                            )
                            .children(logo_known.then(|| div().opacity(0.6).rounded_full().overflow_hidden().child(provider_logo(&self.provider, 22., cx)))),
                    )
                    .child(div().grid().grid_cols(2).gap_5().items_start().child(self.render_details(&t, cx)).child(self.render_database(&t, cx)))
                    .child(
                        div()
                            .grid()
                            .grid_cols(2)
                            .gap_4()
                            .child(
                                Button::new("test-connection")
                                    .outline()
                                    .size(ButtonSize::Lg)
                                    .w_full()
                                    .disabled(self.testing || empty)
                                    .label(if self.testing { "Testing..." } else { "Test Connection" })
                                    .child(Kbd::new("⌘⇧T").px(6.))
                                    .on_click(cx.listener(|this, _, _, cx| this.test_connection(cx))),
                            )
                            .child(
                                Button::new("save-connection")
                                    .size(ButtonSize::Lg)
                                    .w_full()
                                    .disabled(self.loading || empty)
                                    .label(if self.loading {
                                        "Saving..."
                                    } else if editing {
                                        "Save Changes"
                                    } else {
                                        "Save Connection"
                                    })
                                    .child(div().ml_1().child(Kbd::new("⌘↵").px(6.)))
                                    .on_click(cx.listener(|this, _, _, cx| this.save(cx))),
                            ),
                    ),
            )
    }
}

/// `sanitizeFederatedAlias`.
fn sanitize_alias(v: &str) -> String {
    let mut s: String = v.trim().chars().map(|c| if c.is_ascii_alphanumeric() || c == '_' { c } else { '_' }).collect();
    while s.contains("__") {
        s = s.replace("__", "_");
    }
    let s = s.trim_start_matches(|c: char| !(c.is_ascii_alphabetic() || c == '_')).to_string();
    if s.is_empty() { "source".into() } else { s }
}

/// `detectConnectionDbType` reduced to the federated-eligible families.
fn federated_kind(cs: &str) -> &'static str {
    match providers::detect(cs, None).as_deref() {
        Some("mysql" | "mariadb") => "mysql",
        Some("sqlite" | "turso") => "sqlite",
        Some("postgresql" | "timescale" | "supabase" | "neon" | "cockroachdb" | "yugabytedb" | "redshift") => "postgres",
        Some("planetscale") if cs.starts_with("mysql") => "mysql",
        Some("planetscale") => "postgres",
        _ => "other",
    }
}

fn federated_label(cs: &str) -> &'static str {
    match federated_kind(cs) {
        "sqlite" if cs.trim().to_lowercase().starts_with("libsql://") => "libsql",
        k => k,
    }
}

/// `imageFileToIconDataUrl`: cover-crop to a 64×64 PNG data URL.
fn image_to_icon_data_url(path: &std::path::Path) -> Option<String> {
    use base64::Engine;
    let img = image::open(path).ok()?;
    let side = img.width().min(img.height());
    let (x, y) = ((img.width() - side) / 2, (img.height() - side) / 2);
    let square = img.crop_imm(x, y, side, side).resize_exact(64, 64, image::imageops::FilterType::Lanczos3);
    let mut buf = std::io::Cursor::new(Vec::new());
    square.write_to(&mut buf, image::ImageFormat::Png).ok()?;
    Some(format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(buf.into_inner())))
}

async fn download(url: &str, dest: &std::path::Path) -> anyhow::Result<()> {
    let bytes = crate::http::get_bytes(url).await?;
    if let Some(dir) = dest.parent() {
        std::fs::create_dir_all(dir)?;
    }
    std::fs::write(dest, bytes)?;
    Ok(())
}
