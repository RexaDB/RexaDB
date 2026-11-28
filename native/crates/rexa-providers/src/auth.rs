//! Port of components/studio/auth/{auth-users-view,auth-data-grid,auth-selection-cell,
//! auth-providers-cell,auth-sort-dropdown,auth-add-user-dropdown,create-user-modal,
//! invite-user-modal,auth-user-sql,users-constants,auth-sessions-view,auth-section-header,
//! auth-providers-view,auth-providers-actions,auth-custom-providers-{list,table},
//! auth-provider-sheet,auth-custom-provider-*}.tsx and hooks/use-auth-{users,sessions,
//! query,provider-configs}.ts + lib/studio/auth/*.
//!
//! The users/sessions grids are `DataGridAg` in the original; here a read-only
//! grid with the same columns, widths, selection column and empty states.
//! Approximation: Neon Managed Auth (`neon_auth`) reuses the Supabase layout
//! with the original's neon_auth queries (the Neon-specific header/table skin
//! is not ported).

use crate::common::Grid;
use crate::data_table::{Column, DataTable, Row, TableState};
use crate::ui;
use gpui::{div, img, prelude::*, px, AnyElement, AnyView, App, AppContext, Context, Entity, FontWeight, SharedString, Window};
use rexa_core::{Session, StudioEvent, TabSpec};
use rexa_ui::widgets::{Icon, InputEvent, InputState};
use rexa_ui::{tw, with_alpha, ActiveTokens, Align, Badge, BadgeVariant, Button, ButtonSize, Checkbox, ConfirmOptions, Dialog, DropdownMenu, IconName, InputGroup, AddonAlign, MenuItem, OverlayId, Select, SelectOption, Switch, TextInput, Toast, Tw};
use serde_json::Value;
use std::collections::BTreeSet;
use std::sync::Arc;

pub fn build_tab(view: &str, _params: &Value, session: Arc<Session>, window: &mut Window, cx: &mut App) -> Option<AnyView> {
    Some(match view {
        "auth-users" => cx.new(|cx| AuthUsersView::new(session, window, cx)).into(),
        "auth-sessions" => cx.new(|cx| AuthSessionsView::new(session, window, cx)).into(),
        "auth-providers" => cx.new(|cx| AuthProvidersView::new(session, window, cx)).into(),
        _ => return None,
    })
}

fn is_neon(session: &Session) -> bool {
    session.connection.kind == "neon"
}

// ---- users-constants / use-auth-users ------------------------------------------------------

pub const AUTH_USERS_LIMIT: usize = 200;

const SOCIAL: [&str; 21] = ["apple", "auth0", "azure", "bitbucket", "discord", "facebook", "figma", "github", "gitlab", "google", "kakao", "keycloak", "linkedin", "notion", "slack", "spotify", "twitch", "twitter", "x", "workos", "zoom"];

pub fn users_query(neon: bool) -> String {
    if neon {
        return format!("SELECT id, email, NULL::text AS phone, \"createdAt\" AS created_at, NULL::timestamptz AS last_sign_in_at, CASE WHEN \"emailVerified\" THEN \"createdAt\" ELSE NULL END AS confirmed_at, NULL::timestamptz AS email_confirmed_at, NULL::timestamptz AS phone_confirmed_at, false AS is_anonymous, jsonb_build_object('name', name) AS raw_user_meta_data, 'email' AS providers, 'email' AS provider_type, '[]'::jsonb AS all_identity_data FROM neon_auth.\"user\" ORDER BY \"createdAt\" DESC LIMIT {AUTH_USERS_LIMIT};");
    }
    format!(
        "
  SELECT
    u.id,
    u.email,
    u.phone,
    u.created_at,
    u.last_sign_in_at,
    u.confirmed_at,
    u.email_confirmed_at,
    u.phone_confirmed_at,
    u.is_anonymous,
    u.raw_user_meta_data,
    COALESCE(string_agg(DISTINCT i.provider, ', '), CASE WHEN u.email IS NOT NULL THEN 'email' WHEN u.phone IS NOT NULL THEN 'phone' ELSE 'unknown' END) AS providers,
    COALESCE(string_agg(DISTINCT COALESCE(i.identity_data->>'provider_type', i.provider), ', '), CASE WHEN u.email IS NOT NULL THEN 'email' WHEN u.phone IS NOT NULL THEN 'phone' ELSE 'unknown' END) AS provider_type,
    COALESCE(jsonb_agg(DISTINCT i.identity_data) FILTER (WHERE i.identity_data IS NOT NULL), '[]'::jsonb) AS all_identity_data
  FROM auth.users u
  LEFT JOIN auth.identities i ON i.user_id = u.id
  GROUP BY u.id, u.email, u.phone, u.created_at, u.last_sign_in_at, u.confirmed_at, u.email_confirmed_at, u.phone_confirmed_at, u.is_anonymous, u.raw_user_meta_data
  ORDER BY u.created_at DESC
  LIMIT {AUTH_USERS_LIMIT};
"
    )
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct AuthUser {
    pub uid: String,
    pub display_name: String,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub providers: Vec<String>,
    pub provider_type: String,
    pub created_at: Option<String>,
    pub last_sign_in_at: Option<String>,
    pub avatar_url: Option<String>,
    pub confirmed: bool,
    pub created_raw: Option<String>,
    pub last_sign_in_raw: Option<String>,
}

/// `formatSupabaseDate`: "Fri 27 Nov 2026 16:18:00 GMT+0100".
pub fn format_supabase_date(v: &str) -> Option<String> {
    ui::parse_ts(v).map(|d| d.format("%a %d %b %Y %H:%M:%S GMT%z").to_string())
}

/// `mapProviderType`.
pub fn map_provider_type(provider_type: &str, anonymous: bool) -> &'static str {
    if anonymous {
        return "Anonymous";
    }
    let tokens: Vec<String> = provider_type.split(',').map(|t| t.trim().to_lowercase()).filter(|t| !t.is_empty()).collect();
    if tokens.is_empty() {
        "-"
    } else if tokens.iter().any(|t| t.contains("sso")) {
        "SAML"
    } else if tokens.iter().any(|t| SOCIAL.contains(&t.as_str())) {
        "Social"
    } else if tokens.iter().any(|t| t.contains("phone")) {
        "Phone"
    } else {
        "-"
    }
}

fn avatar_from(meta: &Value) -> Option<String> {
    let url = ["avatar_url", "avatarURL", "profileUrl", "profileURL", "profile_url", "profileImage", "profile_image", "profileImageUrl", "profileImageURL", "profile_image_url"].iter().find_map(|k| meta.get(*k).and_then(Value::as_str).filter(|s| !s.trim().is_empty()))?;
    if url.starts_with("https://avatars.githubusercontent.com") {
        let mut u = url::Url::parse(url).ok()?;
        let pairs: Vec<(String, String)> = u.query_pairs().filter(|(k, _)| k != "s").map(|(k, v)| (k.into_owned(), v.into_owned())).collect();
        u.query_pairs_mut().clear().extend_pairs(pairs).append_pair("s", "24");
        Some(u.to_string())
    } else if url.starts_with("https://lh3.googleusercontent.com") {
        Some(url.to_string())
    } else {
        None
    }
}

pub fn provider_name(p: &str) -> String {
    let n = match p {
        "apple" => "Apple",
        "auth0" => "Auth0",
        "azure" => "Azure",
        "bitbucket" => "Bitbucket",
        "discord" => "Discord",
        "email" => "Email",
        "facebook" => "Facebook",
        "figma" => "Figma",
        "github" => "GitHub",
        "gitlab" => "GitLab",
        "google" => "Google",
        "kakao" => "Kakao",
        "keycloak" => "Keycloak",
        "linkedin" => "LinkedIn",
        "messagebird" => "MessageBird",
        "notion" => "Notion",
        "saml" => "SAML",
        "slack" => "Slack",
        "spotify" => "Spotify",
        "textlocal" => "Textlocal",
        "twilio" => "Twilio",
        "twilioverify" => "Twilio Verify",
        "twitch" => "Twitch",
        "twitter" => "Twitter",
        "vonage" => "Vonage",
        "workos" => "WorkOS",
        "x" => "X",
        "zoom" => "Zoom",
        other => return other.to_string(),
    };
    n.to_string()
}

/// AUTH_PROVIDER_ICONS → embedded `providers/auth-*.svg`.
pub fn provider_icon(p: &str) -> Option<&'static str> {
    Some(match p.to_lowercase().as_str() {
        "apple" => "providers/auth-apple-icon.svg",
        "auth0" => "providers/auth-auth0-icon.svg",
        "azure" => "providers/auth-microsoft-icon.svg",
        "bitbucket" => "providers/auth-bitbucket-icon.svg",
        "discord" => "providers/auth-discord-icon.svg",
        "email" => "providers/auth-email-icon.svg",
        "facebook" => "providers/auth-facebook-icon.svg",
        "figma" => "providers/auth-figma-icon.svg",
        "github" => "providers/auth-github-icon.svg",
        "gitlab" => "providers/auth-gitlab-icon.svg",
        "google" => "providers/auth-google-icon.svg",
        "kakao" => "providers/auth-kakao-icon.svg",
        "keycloak" => "providers/auth-keycloak-icon.svg",
        "linkedin" | "linkedin_oidc" => "providers/auth-linkedin-icon.svg",
        "messagebird" | "textlocal" | "vonage" => "providers/auth-messagebird-icon.svg",
        "notion" => "providers/auth-notion-icon.svg",
        "saml" => "providers/auth-saml-icon.svg",
        "slack" | "slack_oidc" => "providers/auth-slack-icon.svg",
        "spotify" => "providers/auth-spotify-icon.svg",
        "twilio" | "twilioverify" => "providers/auth-twilio-icon.svg",
        "twitch" => "providers/auth-twitch-icon.svg",
        "twitter" => "providers/auth-twitter-icon.svg",
        "workos" => "providers/auth-workos-icon.svg",
        "x" => "providers/auth-x-icon-light.svg",
        "zoom" => "providers/auth-zoom-icon.svg",
        _ => return None,
    })
}

/// `mapUserRow`.
pub fn map_user(g: &Grid, r: &[String]) -> AuthUser {
    let meta: Value = serde_json::from_str(g.get(r, "raw_user_meta_data")).unwrap_or(Value::Null);
    let str_meta = |k: &str| meta.get(k).and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty()).map(str::to_string);
    let email = Some(g.get(r, "email").to_string()).filter(|s| !s.is_empty());
    let display = str_meta("full_name").or_else(|| str_meta("name")).or_else(|| str_meta("display_name")).or_else(|| email.as_ref().map(|e| e.split('@').next().unwrap_or("").to_string())).unwrap_or_else(|| "—".into());
    let avatar = avatar_from(&meta).or_else(|| serde_json::from_str::<Value>(g.get(r, "all_identity_data")).ok().and_then(|v| v.as_array().and_then(|a| a.iter().find_map(avatar_from))));
    let anonymous = ui::truthy(g.get(r, "is_anonymous"));
    let raw: Vec<String> = g.get(r, "providers").split(',').map(|p| p.trim().to_string()).filter(|p| !p.is_empty()).collect();
    let providers = if anonymous || raw.is_empty() { vec!["-".to_string()] } else { raw.into_iter().map(|p| if p.starts_with("sso") { "SAML".into() } else { p }).collect() };
    let confirmed = ["confirmed_at", "email_confirmed_at", "phone_confirmed_at"].iter().any(|k| !g.get(r, k).is_empty());
    let created = Some(g.get(r, "created_at").to_string()).filter(|s| !s.is_empty());
    let last = Some(g.get(r, "last_sign_in_at").to_string()).filter(|s| !s.is_empty());
    AuthUser {
        uid: g.get(r, "id").to_string(),
        display_name: display,
        email,
        phone: Some(g.get(r, "phone").to_string()).filter(|s| !s.is_empty()),
        provider_type: map_provider_type(g.get(r, "provider_type"), anonymous).to_string(),
        created_at: created.as_deref().and_then(format_supabase_date),
        last_sign_in_at: last.as_deref().and_then(format_supabase_date),
        avatar_url: avatar,
        confirmed,
        created_raw: created,
        last_sign_in_raw: last,
        providers: if anonymous { vec![] } else { providers },
    }
}

fn email_ok(s: &str) -> bool {
    let Some((local, domain)) = s.split_once('@') else { return false };
    !local.is_empty() && !s.chars().any(char::is_whitespace) && !domain.contains('@') && domain.split_once('.').is_some_and(|(a, b)| !a.is_empty() && !b.is_empty())
}

fn identity_insert(email: &str) -> String {
    format!(
        "
  INSERT INTO auth.identities
    (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  VALUES
    (gen_random_uuid(), v_id, v_id::text, jsonb_build_object('sub', v_id::text, 'email', '{}'), 'email', now(), now(), now());",
        ui::lit(email)
    )
}

/// `buildCreateUserSql`.
pub fn build_create_user_sql(email: &str, password: &str, confirm: bool) -> String {
    format!(
        "
DO $$
DECLARE
  v_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users
    (instance_id, id, aud, \"role\", email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  VALUES
    ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', '{}', extensions.crypt('{}', extensions.gen_salt('bf')), {}, '{{\"provider\":\"email\",\"providers\":[\"email\"]}}'::jsonb, '{{}}'::jsonb, now(), now());
{}
END $$;",
        ui::lit(email),
        ui::lit(password),
        if confirm { "now()" } else { "NULL" },
        identity_insert(email)
    )
}

/// `buildInviteUserSql`.
pub fn build_invite_user_sql(email: &str) -> String {
    format!(
        "
DO $$
DECLARE
  v_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users
    (instance_id, id, aud, \"role\", email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  VALUES
    ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', '{}', NULL, NULL, '{{\"provider\":\"email\",\"providers\":[\"email\"]}}'::jsonb, '{{}}'::jsonb, now(), now());
{}
END $$;",
        ui::lit(email),
        identity_insert(email)
    )
}

const SEARCH_COLUMNS: [(&str, &str); 4] = [("id", "User ID"), ("email", "Email address"), ("phone", "Phone number"), ("freeform", "Unified search")];
const SORT_OPTIONS: [(&str, &str); 5] = [("id", "Sort by user ID"), ("created_at", "Sort by created at"), ("last_sign_in_at", "Sort by last sign in at"), ("email", "Sort by email"), ("phone", "Sort by phone")];
const TOGGLEABLE: [&str; 7] = ["Display name", "Email", "Phone", "Providers", "Provider type", "Created at", "Last sign in at"];

fn placeholder_for(col: &str) -> &'static str {
    match col {
        "id" => "Search by user ID",
        "email" => "Search by email",
        "phone" => "Search by phone",
        "name" => "Search by name",
        _ => "Search by user ID, email, phone or name",
    }
}

/// UUIDV4_LEFT_PREFIX_REGEX: a prefix of a v4 UUID.
pub fn is_uuid_v4_prefix(s: &str) -> bool {
    let tmpl = "xxxxxxxx-xxxx-4xxx-Nxxx-xxxxxxxxxxxx";
    s.len() <= tmpl.len()
        && s.chars().zip(tmpl.chars()).all(|(c, t)| match t {
            '-' => c == '-',
            '4' => c == '4',
            'N' => matches!(c.to_ascii_lowercase(), '8' | '9' | 'a' | 'b'),
            _ => c.is_ascii_hexdigit(),
        })
}

fn is_phone_prefix(s: &str) -> bool {
    let digits = s.strip_prefix('+').unwrap_or(s);
    digits.len() <= 15 && digits.chars().all(|c| c.is_ascii_digit())
}

fn search_invalid(search: &str, col: &str) -> bool {
    if search.is_empty() || matches!(col, "freeform" | "email" | "name") {
        return false;
    }
    if col == "id" {
        return !is_uuid_v4_prefix(search);
    }
    !is_phone_prefix(search)
}

fn sort_value(u: &AuthUser, col: &str) -> Option<String> {
    match col {
        "created_at" => u.created_raw.clone(),
        "last_sign_in_at" => u.last_sign_in_raw.clone(),
        "id" => Some(u.uid.clone()),
        "email" => u.email.clone(),
        "phone" => u.phone.clone(),
        _ => None,
    }
}

/// `localeCompare(…, { numeric: true, sensitivity: "base" })` approximation.
fn natural_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    let (a, b) = (a.to_lowercase(), b.to_lowercase());
    match (a.parse::<f64>(), b.parse::<f64>()) {
        (Ok(x), Ok(y)) => x.partial_cmp(&y).unwrap_or(std::cmp::Ordering::Equal),
        _ => a.cmp(&b),
    }
}

// ---- shared grid (DataGridAg stand-in) -------------------------------------------------------

struct GridCol {
    name: String,
    width: f32,
}

/// Header + rows in fixed-width columns with an optional 95px selection column.
fn render_grid(id: &'static str, cols: &[GridCol], rows: Vec<(bool, Option<AnyElement>, Vec<AnyElement>)>, header_select: Option<AnyElement>, cx: &App) -> AnyElement {
    let t = cx.tokens();
    let has_sel = header_select.is_some();
    let total: f32 = cols.iter().map(|c| c.width).sum::<f32>() + if has_sel { 95. } else { 0. };
    let border = t.studio_border;
    let head = div()
        .flex()
        .h(px(36.))
        .w(px(total))
        .flex_shrink_0()
        .bg(t.studio_header_bg)
        .border_b_1()
        .border_color(border)
        .tw_text_xs()
        .font_weight(FontWeight::MEDIUM)
        .text_color(t.foreground)
        .children(header_select.map(|h| div().w(px(95.)).flex_shrink_0().flex().items_center().px_3().border_r_1().border_color(border).child(h)))
        .children(cols.iter().map(|c| div().w(px(c.width)).flex_shrink_0().flex().items_center().px_2().border_r_1().border_color(border).child(div().truncate().child(c.name.clone()))));
    let body = rows.into_iter().enumerate().map(|(i, (selected, sel, cells))| {
        div()
            .id((id, i))
            .flex()
            .h(px(40.))
            .w(px(total))
            .flex_shrink_0()
            .border_b_1()
            .border_color(border)
            .tw_text_xs()
            .when(selected, |d| d.bg(t.studio_selection))
            .hover(|d| d.bg(t.studio_row_hover))
            .children(sel.map(|s| div().w(px(95.)).flex_shrink_0().flex().items_center().gap_3().px_3().border_r_1().border_color(border).child(s)))
            .children(cells.into_iter().zip(cols.iter()).map(|(c, col)| div().w(px(col.width)).flex_shrink_0().flex().items_center().px_2().overflow_hidden().border_r_1().border_color(border).child(c)))
    });
    div()
        .id(id)
        .size_full()
        .overflow_scroll()
        .child(div().flex().flex_col().min_w(px(total)).child(head).children(body))
        .into_any_element()
}

fn dash(cx: &App) -> AnyElement {
    div().text_color(cx.tokens().muted_foreground).child(" - ").into_any_element()
}

fn text_cell(v: Option<String>, cx: &App) -> AnyElement {
    match v.filter(|s| !s.is_empty()) {
        Some(s) => div().truncate().child(s).into_any_element(),
        None => dash(cx),
    }
}

fn on_refresh<V: 'static>(view: &'static str, cx: &mut Context<V>, f: fn(&mut V, &mut Context<V>)) {
    cx.subscribe(&rexa_core::studio_bus(cx), move |this, _, e: &StudioEvent, cx| {
        if let StudioEvent::TabCommand { tab: TabSpec::View { view: v, .. }, command } = e {
            if v == view && command == "REFRESH_CURRENT_TAB" {
                f(this, cx);
            }
        }
    })
    .detach();
}

// ---- auth-users-view -----------------------------------------------------------------------

pub struct AuthUsersView {
    session: Arc<Session>,
    neon: bool,
    users: Vec<AuthUser>,
    loading: bool,
    error: Option<String>,
    filter_column: String,
    search: Entity<InputState>,
    sort: (String, bool),
    visible_cols: BTreeSet<&'static str>,
    selected: BTreeSet<String>,
    deleting: bool,
    // create / invite
    email: Entity<InputState>,
    password: Entity<InputState>,
    auto_confirm: bool,
    form_errors: (Option<String>, Option<String>),
    busy: bool,
    dialog: Option<OverlayId>,
}

impl AuthUsersView {
    fn new(session: Arc<Session>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let search = cx.new(|cx| InputState::new(window, cx).placeholder(placeholder_for("email")));
        cx.subscribe(&search, |this: &mut Self, _, e: &InputEvent, cx| {
            if matches!(e, InputEvent::Change) {
                this.selected.clear();
                cx.notify();
            }
        })
        .detach();
        let email = cx.new(|cx| InputState::new(window, cx).placeholder("user@example.com"));
        let password = cx.new(|cx| InputState::new(window, cx).placeholder("••••••••").masked(true));
        on_refresh("auth-users", cx, Self::refresh);
        let neon = is_neon(&session);
        let mut this = Self {
            session,
            neon,
            users: vec![],
            loading: false,
            error: None,
            filter_column: "email".into(),
            search,
            sort: ("created_at".into(), false),
            visible_cols: TOGGLEABLE.into_iter().collect(),
            selected: BTreeSet::new(),
            deleting: false,
            email,
            password,
            auto_confirm: true,
            form_errors: (None, None),
            busy: false,
            dialog: None,
        };
        this.refresh(cx);
        this
    }

    fn refresh(&mut self, cx: &mut Context<Self>) {
        self.loading = true;
        self.error = None;
        cx.notify();
        let driver = self.session.driver.clone();
        let sql = users_query(self.neon);
        ui::run(cx, async move { Ok(Grid::from_result(driver.execute(&sql, AUTH_USERS_LIMIT).await?)) }, |this, r, _| {
            this.loading = false;
            match r {
                Ok(g) => this.users = g.rows.iter().map(|row| map_user(&g, row)).collect(),
                Err(e) => this.error = Some(ui::err_text(&e)),
            }
        });
    }

    fn filtered(&self, cx: &App) -> Vec<AuthUser> {
        let (col, asc) = self.sort.clone();
        let mut sorted = self.users.clone();
        sorted.sort_by(|a, b| match (sort_value(a, &col), sort_value(b, &col)) {
            (None, None) => std::cmp::Ordering::Equal,
            (None, _) => std::cmp::Ordering::Greater,
            (_, None) => std::cmp::Ordering::Less,
            (Some(x), Some(y)) => {
                let o = natural_cmp(&x, &y);
                if asc { o } else { o.reverse() }
            }
        });
        let term = self.search.read(cx).value().trim().to_lowercase();
        let m = |v: Option<&str>| term.is_empty() || v.is_some_and(|v| v.to_lowercase().contains(&term));
        sorted
            .into_iter()
            .filter(|u| {
                if self.neon {
                    return m(u.email.as_deref()) || m(Some(&u.display_name)) || m(Some(&u.uid));
                }
                match self.filter_column.as_str() {
                    "email" => m(u.email.as_deref()),
                    "phone" => m(u.phone.as_deref()),
                    "id" => m(Some(&u.uid)),
                    "name" => m(Some(&u.display_name)),
                    _ => m(u.email.as_deref()) || m(u.phone.as_deref()) || m(Some(&u.uid)) || m(Some(&u.display_name)),
                }
            })
            .collect()
    }

    fn delete_selected(&mut self, cx: &mut Context<Self>) {
        let ids: Vec<String> = self.selected.iter().cloned().collect();
        let n = ids.len();
        let opts = ConfirmOptions::destructive(format!("Delete {n} user{}?", if n == 1 { "" } else { "s" })).description("This action cannot be undone. The users will be permanently removed from auth.users and their sessions will be invalidated.").confirm_text("Delete");
        ui::confirm_then(cx, opts, move |this, cx| {
            if ids.is_empty() {
                return;
            }
            this.deleting = true;
            cx.notify();
            let driver = this.session.driver.clone();
            let list = ids.iter().map(|id| format!("'{}'", ui::lit(id))).collect::<Vec<_>>().join(", ");
            let sql = format!("delete from auth.users where id in ({list});");
            ui::run(cx, async move { driver.execute(&sql, 1).await.map(|_| ()) }, move |this, r, cx| {
                this.deleting = false;
                match r {
                    Ok(()) => {
                        Toast::success(format!("Deleted {n} user{}", if n == 1 { "" } else { "s" })).show(cx);
                        this.selected.clear();
                        this.refresh(cx);
                    }
                    Err(e) => {
                        Toast::error(format!("Failed to delete users: {}", ui::err_text(&e))).show(cx);
                    }
                }
            });
        });
    }

    fn open_user_dialog(&mut self, invite: bool, window: &mut Window, cx: &mut Context<Self>) {
        self.email.update(cx, |s, cx| {
            s.set_value("", window, cx);
            s.focus(window, cx);
        });
        self.password.update(cx, |s, cx| s.set_value("", window, cx));
        self.auto_confirm = true;
        self.form_errors = (None, None);
        let weak = cx.entity().downgrade();
        let (email, password) = (self.email.clone(), self.password.clone());
        self.dialog = Some(rexa_ui::open_dialog(cx, move |_, cx| {
            let Some(view) = weak.upgrade() else { return Dialog::new() };
            let (busy, auto, (e_err, p_err)) = { let v = view.read(cx); (v.busy, v.auto_confirm, v.form_errors.clone()) };
            let t = cx.tokens().clone();
            let (v1, v2) = (view.clone(), view.clone());
            let err = |e: Option<String>| e.map(|e| div().tw_text_sm().text_color(t.destructive).child(e));
            let icon_input = |state: &Entity<InputState>, icon: IconName| TextInput::new(state).prefix(Icon::new(icon).size(px(18.)).text_color(t.muted_foreground));
            let d = Dialog::new().max_w(440.);
            if invite {
                d.title("Invite a new user")
                    .description("Create an unconfirmed user for an email address. Sending invitation emails requires the Supabase Auth admin API (service role key), which is not available over a database connection.")
                    .child(div().py_4().flex().flex_col().gap_2().child(rexa_ui::Label::new("User email")).child(TextInput::new(&email)).children(err(e_err)))
                    .footer(
                        div()
                            .flex()
                            .justify_end()
                            .gap_2()
                            .child(Button::new("inv-cancel").outline().label("Cancel").on_click(|_, _, cx| rexa_ui::close_top(cx)))
                            .child(Button::new("inv-ok").label(if busy { "Inviting..." } else { "Invite user" }).disabled(busy).on_click(move |_, _, cx| v2.update(cx, |s, cx| s.submit_user(true, cx)))),
                    )
            } else {
                d.title("Create a new user")
                    .description("Create a user directly in the auth.users table. A confirmation email will not be sent when creating a user via this form.")
                    .child(
                        div()
                            .py_4()
                            .flex()
                            .flex_col()
                            .gap_4()
                            .child(div().flex().flex_col().gap_2().child(rexa_ui::Label::new("Email address")).child(icon_input(&email, IconName::Mail)).children(err(e_err)))
                            .child(div().flex().flex_col().gap_2().child(rexa_ui::Label::new("User Password")).child(icon_input(&password, IconName::Lock)).children(err(p_err)))
                            .child(div().flex().items_center().gap_2().child(Checkbox::new("cu-auto").checked(auto).on_change(move |v, _, cx| v1.update(cx, |s, cx| { s.auto_confirm = v; cx.notify(); }))).child(rexa_ui::Label::new("Auto confirm user?"))),
                    )
                    .footer(
                        div()
                            .flex()
                            .justify_end()
                            .gap_2()
                            .child(Button::new("cu-cancel").outline().label("Cancel").on_click(|_, _, cx| rexa_ui::close_top(cx)))
                            .child(Button::new("cu-ok").label(if busy { "Creating..." } else { "Create user" }).disabled(busy).on_click(move |_, _, cx| v2.update(cx, |s, cx| s.submit_user(false, cx)))),
                    )
            }
        }));
        let _ = invite;
    }

    fn submit_user(&mut self, invite: bool, cx: &mut Context<Self>) {
        let email = self.email.read(cx).value().trim().to_string();
        let password = self.password.read(cx).value().to_string();
        let mut errs = (None, None);
        if invite {
            if email.is_empty() || !email_ok(&email) {
                errs.0 = Some("Please enter a valid email".to_string());
            }
        } else {
            if email.is_empty() {
                errs.0 = Some("Email is required".into());
            } else if !email_ok(&email) {
                errs.0 = Some("Must be a valid email address".into());
            }
            if password.is_empty() {
                errs.1 = Some("Password is required".into());
            }
        }
        self.form_errors = errs.clone();
        cx.notify();
        if errs.0.is_some() || errs.1.is_some() {
            return;
        }
        self.busy = true;
        let sql = if invite { build_invite_user_sql(&email) } else { build_create_user_sql(&email, &password, self.auto_confirm) };
        let driver = self.session.driver.clone();
        ui::run(cx, async move { driver.execute(&sql, 1).await.map(|_| ()) }, move |this, r, cx| {
            this.busy = false;
            match r {
                Ok(()) => {
                    Toast::success(if invite { format!("Created unconfirmed user for {email}") } else { format!("Successfully created user: {email}") }).show(cx);
                    if let Some(id) = this.dialog.take() {
                        rexa_ui::close_overlay(id, cx);
                    }
                    this.refresh(cx);
                }
                Err(e) => {
                    let m = ui::err_text(&e);
                    if invite {
                        this.form_errors.0 = Some(m.clone());
                        Toast::error(format!("Failed to invite user: {m}")).show(cx);
                    } else {
                        Toast::error(format!("Failed to create user: {m}")).show(cx);
                    }
                }
            }
        });
    }

    fn render_toolbar(&mut self, filtered: &[AuthUser], cx: &mut Context<Self>) -> AnyElement {
        let t = cx.tokens().clone();
        let w = cx.entity().downgrade();
        let left: AnyElement = if !self.selected.is_empty() {
            div()
                .flex()
                .items_center()
                .gap_2()
                .child(Button::new("au-del").outline().size(ButtonSize::Sm).icon(IconName::Trash).label(format!("Delete {} users", self.selected.len())).disabled(self.deleting).on_click(cx.listener(|this, _, _, cx| this.delete_selected(cx))))
                .child(Button::new("au-clear").ghost().size(ButtonSize::IconSm).icon(IconName::X).on_click(cx.listener(|this, _, _, cx| { this.selected.clear(); cx.notify(); })))
                .into_any_element()
        } else {
            let search = self.search.read(cx).value().to_string();
            let invalid = search_invalid(&search, &self.filter_column);
            let freeform = self.filter_column == "freeform";
            let select = Select::new("au-filter")
                .small()
                .w(px(130.))
                .options(SEARCH_COLUMNS.iter().map(|(v, l)| SelectOption::new(*v, *l)))
                .value(Some(self.filter_column.clone()))
                .on_change({
                    let w = w.clone();
                    move |v, win, cx| {
                        w.update(cx, |s, cx| {
                            s.filter_column = v.to_string();
                            s.search.update(cx, |st, cx| st.set_placeholder(placeholder_for(&v), win, cx));
                            cx.notify();
                        })
                        .ok();
                    }
                });
            let group = div()
                .flex()
                .h(px(26.))
                .items_stretch()
                .overflow_hidden()
                .tw_rounded_md()
                .border_1()
                .border_color(if invalid { t.destructive } else { t.border })
                .bg(t.studio_header_bg)
                .child(div().flex().items_center().px(px(6.)).child(Icon::new(IconName::Search).size(px(14.)).text_color(t.muted_foreground)))
                .child(div().w(px(1.)).bg(t.border))
                .child(div().w(px(130.)).tw_text_xs().when(freeform, |d| d.text_color(tw("amber-400"))).child(select))
                .child(div().w(px(1.)).bg(t.border))
                .child(
                    div()
                        .relative()
                        .w(px(245.))
                        .tw_text_xs()
                        .when(invalid, |d| d.text_color(tw("red-900")))
                        .child(TextInput::new(&self.search).h(24.))
                        .when(!search.is_empty(), |d| d.child(div().absolute().right(px(6.)).top(px(4.)).child(Button::new("au-search-x").ghost().size(ButtonSize::IconXs).icon(IconName::X).on_click(cx.listener(|this, _, win, cx| this.search.update(cx, |s, cx| s.set_value("", win, cx))))))),
                );
            let specific = !search.trim().is_empty() && !freeform;
            let sort: AnyElement = if specific {
                rexa_ui::Tooltip::new("Sorting cannot be changed when searching on a specific column. If you'd like to sort on other columns, change the search to unified search from the search dropdown.")
                    .child(Button::new("au-sort-off").outline().size(ButtonSize::Sm).icon(IconName::ArrowDownNarrowWide).label("Sorted by user ID").disabled(true))
                    .into_any_element()
            } else {
                let (col, asc) = self.sort.clone();
                let label = if col == "id" { "user ID".to_string() } else { col.replace('_', " ") };
                let w = w.clone();
                DropdownMenu::new("au-sort")
                    .trigger(Button::new("au-sort-btn").outline().size(ButtonSize::Sm).icon(if asc { IconName::ArrowDownNarrowWide } else { IconName::ArrowDownWideNarrow }).label(format!("Sorted by {label}")))
                    .menu(move |mut m, _, _| {
                        m = m.w(176.);
                        for (c, l) in SORT_OPTIONS {
                            let (w, col) = (w.clone(), col.clone());
                            m = m.sub(l, move |sm, _, _| {
                                let (wa, wd) = (w.clone(), w.clone());
                                sm.item(MenuItem::radio("Ascending", col == c && asc).on_select(move |_, cx| { wa.update(cx, |s, cx| { s.sort = (c.into(), true); cx.notify(); }).ok(); }))
                                    .item(MenuItem::radio("Descending", col == c && !asc).on_select(move |_, cx| { wd.update(cx, |s, cx| { s.sort = (c.into(), false); cx.notify(); }).ok(); }))
                            });
                        }
                        m
                    })
                    .into_any_element()
            };
            let visible = self.visible_cols.clone();
            let columns = DropdownMenu::new("au-cols").trigger(Button::new("au-cols-btn").outline().size(ButtonSize::Sm).icon(IconName::Columns2).label("Columns")).menu({
                let w = w.clone();
                move |mut m, _, _| {
                    m = m.label("Columns");
                    for c in TOGGLEABLE {
                        let w = w.clone();
                        m = m.item(MenuItem::checkbox(c, visible.contains(c)).keep_open().on_select(move |_, cx| {
                            w.update(cx, |s, cx| {
                                if !s.visible_cols.remove(c) {
                                    s.visible_cols.insert(c);
                                }
                                cx.notify();
                            })
                            .ok();
                        }));
                    }
                    m
                }
            });
            div().flex().flex_wrap().items_center().gap_2().child(group).child(sort).when(!self.neon, |d| d.child(columns)).into_any_element()
        };
        let _ = filtered;
        let add = DropdownMenu::new("au-add").align(Align::End).trigger(Button::new("au-add-btn").size(ButtonSize::Sm).label("Add user").icon_end(IconName::ChevronDown)).menu({
            let w = w.clone();
            move |m, _, _| {
                let (w1, w2) = (w.clone(), w.clone());
                m.w(176.)
                    .item(MenuItem::new("Send invitation").icon(IconName::Mail).on_select(move |win, cx| { w1.update(cx, |s, cx| s.open_user_dialog(true, win, cx)).ok(); }))
                    .item(MenuItem::new("Create new user").icon(IconName::UserPlus).on_select(move |win, cx| { w2.update(cx, |s, cx| s.open_user_dialog(false, win, cx)).ok(); }))
            }
        });
        div()
            .flex()
            .flex_shrink_0()
            .items_center()
            .justify_between()
            .gap_2()
            .border_b_1()
            .border_color(t.border)
            .bg(t.studio_header_bg)
            .py_3()
            .px_6()
            .child(left)
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap_2()
                    .child(rexa_ui::Tooltip::new("Refresh").child(Button::new("au-refresh").outline().size(ButtonSize::IconSm).icon(IconName::RefreshCw).disabled(self.loading).on_click(cx.listener(|this, _, _, cx| this.refresh(cx)))))
                    .when(!self.neon, |d| d.child(add)),
            )
            .into_any_element()
    }
}

impl Render for AuthUsersView {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        let filtered = self.filtered(cx);
        let toolbar = self.render_toolbar(&filtered, cx);
        let searching = !self.search.read(cx).value().trim().is_empty();
        let body: AnyElement = if self.loading && self.users.is_empty() {
            div().size_full().flex().items_center().justify_center().child(rexa_ui::Spinner::new(32.)).into_any_element()
        } else if let (Some(err), true) = (self.error.clone(), self.users.is_empty()) {
            div().size_full().flex().flex_col().items_center().justify_center().gap_y_2().child(div().tw_text_sm().font_weight(FontWeight::SEMIBOLD).child("Failed to retrieve users")).child(div().tw_text_xs().text_color(t.muted_foreground).child(err)).into_any_element()
        } else if filtered.is_empty() {
            div()
                .flex()
                .flex_col()
                .items_center()
                .justify_center()
                .gap_y_2()
                .py_16()
                .child(Icon::new(IconName::Users).size(px(40.)).text_color(t.muted_foreground))
                .child(div().tw_text_sm().font_weight(FontWeight::SEMIBOLD).child(if searching { "No users found" } else { "No users in your project" }))
                .child(div().tw_text_xs().text_color(t.muted_foreground).child(if searching { "There are currently no users based on the filters applied" } else { "There are currently no users who signed up to your project" }))
                .into_any_element()
        } else {
            let widths = [("Display name", 150.), ("Email", 300.), ("Phone", 150.), ("Providers", 150.), ("Provider type", 150.), ("Created at", 260.), ("Last sign in at", 260.)];
            let mut cols = vec![GridCol { name: "UID".into(), width: 280. }];
            cols.extend(widths.iter().filter(|(n, _)| self.visible_cols.contains(n)).map(|(n, w)| GridCol { name: n.to_string(), width: *w }));
            let all_selected = !filtered.is_empty() && filtered.iter().all(|u| self.selected.contains(&u.uid));
            let all_ids: Vec<String> = filtered.iter().map(|u| u.uid.clone()).collect();
            let w = cx.entity().downgrade();
            let header_sel = Checkbox::new("au-all").checked(all_selected).on_change({
                let w = w.clone();
                move |_, _, cx| {
                    let ids = all_ids.clone();
                    w.update(cx, |s, cx| {
                        if s.selected.len() == ids.len() {
                            s.selected.clear();
                        } else {
                            s.selected = ids.into_iter().collect();
                        }
                        cx.notify();
                    })
                    .ok();
                }
            });
            let rows = filtered
                .iter()
                .map(|u| {
                    let sel = self.selected.contains(&u.uid);
                    let uid = u.uid.clone();
                    let w = w.clone();
                    let avatar = div()
                        .size_6()
                        .rounded_full()
                        .border_1()
                        .border_color(t.studio_border)
                        .bg(with_alpha(t.muted, 0.2))
                        .flex()
                        .items_center()
                        .justify_center()
                        .overflow_hidden()
                        .child(match u.avatar_url.clone() {
                            Some(url) => {
                                let fg = t.muted_foreground;
                                img(SharedString::from(url)).size_full().with_fallback(move || Icon::new(IconName::User).size(px(12.)).text_color(fg).into_any_element()).into_any_element()
                            }
                            None => Icon::new(IconName::User).size(px(12.)).text_color(t.muted_foreground).into_any_element(),
                        });
                    let sel_cell = div()
                        .flex()
                        .items_center()
                        .gap_3()
                        .child(Checkbox::new(SharedString::from(format!("au-sel-{uid}"))).checked(sel).on_change(move |_, _, cx| {
                            let id = uid.clone();
                            w.update(cx, |s, cx| {
                                if !s.selected.remove(&id) {
                                    s.selected.insert(id);
                                }
                                cx.notify();
                            })
                            .ok();
                        }))
                        .child(avatar)
                        .into_any_element();
                    let mut cells = vec![text_cell(Some(u.uid.clone()), cx)];
                    for (n, _) in widths.iter().filter(|(n, _)| self.visible_cols.contains(n)) {
                        cells.push(match *n {
                            "Display name" => text_cell(Some(u.display_name.clone()), cx),
                            "Email" => text_cell(u.email.clone(), cx),
                            "Phone" => text_cell(u.phone.clone(), cx),
                            "Providers" => providers_cell(&u.providers, cx),
                            "Provider type" => text_cell(Some(u.provider_type.clone()), cx),
                            "Created at" => text_cell(u.created_at.clone(), cx),
                            _ if !u.confirmed && u.last_sign_in_at.is_some() => div().text_color(t.muted_foreground).child("Waiting for verification").into_any_element(),
                            _ => text_cell(u.last_sign_in_at.clone(), cx),
                        });
                    }
                    (sel, Some(sel_cell), cells)
                })
                .collect();
            render_grid("auth-users-grid", &cols, rows, Some(header_sel.into_any_element()), cx)
        };
        let status = if self.error.is_some() {
            div().text_color(t.destructive).child("Unable to refresh users")
        } else if self.loading {
            div().child("Refreshing users…")
        } else {
            div().child(format!("Showing {} of {} users", filtered.len(), self.users.len()))
        };
        div()
            .size_full()
            .flex()
            .flex_col()
            .bg(t.studio_bg)
            .text_color(t.foreground)
            .child(toolbar)
            .child(div().flex_1().min_h_0().child(body))
            .child(div().flex().flex_shrink_0().h_9().items_center().justify_between().border_t_1().border_color(t.border).bg(t.studio_bg).px_6().tw_text_xs().text_color(t.muted_foreground).child(status))
    }
}

/// `AuthProvidersCell`.
fn providers_cell(providers: &[String], cx: &App) -> AnyElement {
    let t = cx.tokens();
    if providers.is_empty() {
        return div().text_color(t.muted_foreground).child("-").into_any_element();
    }
    let display = providers.iter().map(|p| if let Some(c) = p.strip_prefix("custom:") { c.to_string() } else { provider_name(p) }).collect::<Vec<_>>().join(", ");
    let n = providers.len();
    div()
        .w_full()
        .flex()
        .items_center()
        .tw_text_xs()
        .children(providers.iter().filter(|p| *p != "-").enumerate().map(|(i, p)| {
            let inner: AnyElement = if let Some(c) = p.strip_prefix("custom:") {
                div().tw_text_xs().child(c.chars().next().unwrap_or('?').to_uppercase().to_string()).into_any_element()
            } else if let Some(icon) = provider_icon(if p == "SAML" { "saml" } else { p }) {
                // `dark:invert` for github / x → the light variants.
                let icon = match (t.dark, icon) {
                    (true, "providers/auth-github-icon.svg") => "providers/auth-github-icon-light.svg",
                    (false, "providers/auth-x-icon-light.svg") => "providers/auth-x-icon-light.svg",
                    (_, i) => i,
                };
                img(icon).size(px(16.)).into_any_element()
            } else {
                Icon::new(IconName::Mail).size(px(12.)).text_color(t.muted_foreground).into_any_element()
            };
            let _ = n;
            div().min_w_6().min_h_6().rounded_full().border_1().border_color(t.studio_border).flex().items_center().justify_center().bg(t.studio_header_bg).overflow_hidden().when(i > 0, |d| d.ml(px(-8.))).child(inner)
        }))
        .child(div().ml_1().truncate().child(capitalize(&display)))
        .into_any_element()
}

fn capitalize(s: &str) -> String {
    s.split(' ')
        .map(|w| {
            let mut c = w.chars();
            c.next().map(|f| f.to_uppercase().collect::<String>() + c.as_str()).unwrap_or_default()
        })
        .collect::<Vec<_>>()
        .join(" ")
}

// ---- auth-section-header ------------------------------------------------------------------

fn section_header(title: &str, description: &str, count: String, loading: bool, on_refresh: impl Fn(&mut Window, &mut App) + 'static, actions: Option<AnyElement>, search: Option<&Entity<InputState>>, cx: &App) -> AnyElement {
    let t = cx.tokens();
    div()
        .flex_shrink_0()
        .border_b_1()
        .border_color(t.studio_border)
        .bg(t.studio_bg)
        .px_6()
        .py_5()
        .child(
            div()
                .flex()
                .items_center()
                .justify_between()
                .gap_4()
                .child(
                    div()
                        .child(div().flex().items_center().gap_3().child(div().tw_text_sm().font_weight(FontWeight::SEMIBOLD).child(rexa_ui::tight(title.to_string()))).child(div().tw_text_xs().text_color(t.muted_foreground).child(count)))
                        .child(div().mt_1().tw_text_sm().text_color(t.muted_foreground).child(description.to_string())),
                )
                .child(div().flex().items_center().gap_2().child(Button::new("as-refresh").secondary().size(ButtonSize::Sm).icon(IconName::RefreshCw).label("Refresh").disabled(loading).on_click(move |_, w, cx| on_refresh(w, cx))).children(actions)),
        )
        .children(search.map(|s| div().mt_4().max_w(px(448.)).tw_text_sm().child(TextInput::new(s).h(36.))))
        .into_any_element()
}

// ---- auth-sessions-view ------------------------------------------------------------------

pub struct AuthSessionsView {
    session: Arc<Session>,
    neon: bool,
    grid: Grid,
    loading: bool,
    error: Option<String>,
    search: Entity<InputState>,
}

const SESSION_COLUMNS: [&str; 8] = ["id", "user_id", "created_at", "refreshed_at", "not_after", "ip", "user_agent", "aal"];

impl AuthSessionsView {
    fn new(session: Arc<Session>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let search = cx.new(|cx| InputState::new(window, cx).placeholder("Search by session id, user id, or IP"));
        cx.subscribe(&search, |_, _, e: &InputEvent, cx| {
            if matches!(e, InputEvent::Change) {
                cx.notify();
            }
        })
        .detach();
        on_refresh("auth-sessions", cx, Self::refresh);
        let neon = is_neon(&session);
        let mut this = Self { session, neon, grid: Grid::default(), loading: false, error: None, search };
        this.refresh(cx);
        this
    }

    fn refresh(&mut self, cx: &mut Context<Self>) {
        self.loading = true;
        self.error = None;
        cx.notify();
        let sql = if self.neon {
            "SELECT id, \"userId\" AS user_id, \"createdAt\" AS created_at, \"updatedAt\" AS refreshed_at, \"expiresAt\" AS not_after, \"ipAddress\" AS ip, \"userAgent\" AS user_agent, NULL::text AS aal FROM neon_auth.session ORDER BY \"createdAt\" DESC LIMIT 200;".to_string()
        } else {
            "\n  SELECT id, user_id, created_at, refreshed_at, not_after, ip, user_agent, aal\n  FROM auth.sessions\n  ORDER BY created_at DESC\n  LIMIT 200;\n".to_string()
        };
        let driver = self.session.driver.clone();
        ui::run(cx, async move { Ok(Grid::from_result(driver.execute(&sql, 200).await?)) }, |this, r, _| {
            this.loading = false;
            match r {
                Ok(g) => this.grid = g,
                Err(e) => this.error = Some(ui::err_text(&e)),
            }
        });
    }
}

impl Render for AuthSessionsView {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        let w = cx.entity().downgrade();
        let header = section_header(
            "Sessions",
            if self.neon { "View Managed Auth sessions on this branch." } else { "Track active Supabase auth sessions and metadata." },
            format!("{} total", self.grid.rows.len()),
            self.loading,
            move |_, cx| {
                w.update(cx, |s, cx| s.refresh(cx)).ok();
            },
            None,
            Some(&self.search),
            cx,
        );
        let q = self.search.read(cx).value().trim().to_lowercase();
        let body: AnyElement = if self.loading && self.grid.rows.is_empty() {
            div().size_full().flex().items_center().justify_center().child(rexa_ui::Spinner::new(24.)).into_any_element()
        } else if let Some(err) = self.error.clone() {
            div().p_6().tw_text_sm().text_color(t.destructive).child(err).into_any_element()
        } else {
            let cols: Vec<GridCol> = SESSION_COLUMNS.iter().map(|c| GridCol { name: c.to_string(), width: if matches!(*c, "id" | "user_id") { 280. } else if *c == "user_agent" { 320. } else { 200. } }).collect();
            let rows = self
                .grid
                .rows
                .iter()
                .filter(|r| q.is_empty() || r.iter().any(|v| v.to_lowercase().contains(&q)))
                .map(|r| (false, None, SESSION_COLUMNS.iter().map(|c| text_cell(Some(self.grid.get(r, c).to_string()), cx)).collect()))
                .collect::<Vec<_>>();
            if rows.is_empty() {
                div().p_6().tw_text_sm().text_color(t.muted_foreground).child("No rows").into_any_element()
            } else {
                render_grid("auth-sessions-grid", &cols, rows, None, cx)
            }
        };
        div().size_full().flex().flex_col().bg(t.studio_bg).text_color(t.foreground).child(header).child(div().flex_1().min_h_0().child(body))
    }
}

// ---- auth-providers-view -----------------------------------------------------------------

#[derive(Clone, Debug, Default, PartialEq)]
pub struct ProviderConfig {
    pub id: String,
    pub identifier: String,
    pub name: String,
    pub provider_type: String,
    pub enabled: bool,
    pub client_id: String,
    pub client_secret: String,
    pub scopes: Vec<String>,
    pub discovery_url: String,
    pub issuer: String,
    pub authorization_url: String,
    pub token_url: String,
    pub userinfo_url: String,
    pub jwks_uri: String,
    pub email_optional: bool,
}

fn config_from(g: &Grid, r: &[String]) -> ProviderConfig {
    ProviderConfig {
        id: g.get(r, "id").into(),
        identifier: g.get(r, "identifier").into(),
        name: g.get(r, "name").into(),
        provider_type: g.get(r, "provider_type").into(),
        enabled: ui::truthy(g.get(r, "enabled")),
        client_id: g.get(r, "client_id").into(),
        client_secret: g.get(r, "client_secret").into(),
        scopes: ui::text_array(g.get(r, "scopes")),
        discovery_url: g.get(r, "discovery_url").into(),
        issuer: g.get(r, "issuer").into(),
        authorization_url: g.get(r, "authorization_url").into(),
        token_url: g.get(r, "token_url").into(),
        userinfo_url: g.get(r, "userinfo_url").into(),
        jwks_uri: g.get(r, "jwks_uri").into(),
        email_optional: ui::truthy(g.get(r, "email_optional")),
    }
}

/// Form state (`CustomProviderFormState`) field order in `form_inputs`.
const FORM_FIELDS: [&str; 10] = ["identifier", "name", "issuer", "discovery_url", "authorization_url", "token_url", "userinfo_url", "jwks_uri", "client_id", "client_secret"];

/// `parseCustomProviderForm` → the SQL-ready config.
pub fn parse_provider_form(values: &std::collections::HashMap<&str, String>, id: &str, oauth2: bool, enabled: bool, scopes: &str, email_optional: bool) -> Result<ProviderConfig, &'static str> {
    let v = |k: &str| values.get(k).map(|s| s.trim().to_string()).unwrap_or_default();
    let raw_ident = v("identifier");
    let raw_ident = raw_ident.strip_prefix("custom:").or_else(|| raw_ident.strip_prefix("CUSTOM:")).unwrap_or(&raw_ident).to_string();
    let identifier = if raw_ident.is_empty() { String::new() } else { format!("custom:{raw_ident}") };
    let (name, issuer, client_id, client_secret) = (v("name"), v("issuer"), v("client_id"), v("client_secret"));
    if identifier.is_empty() {
        return Err("Project identifier is required.");
    }
    if name.is_empty() {
        return Err("Display name is required.");
    }
    if issuer.is_empty() {
        return Err("Issuer URL is required.");
    }
    if client_id.is_empty() {
        return Err("Client ID is required.");
    }
    if client_secret.is_empty() {
        return Err("Client secret is required.");
    }
    let base = issuer.trim_end_matches('/').to_string();
    let discovery = if !v("discovery_url").is_empty() { v("discovery_url") } else { format!("{base}/.well-known/openid-configuration") };
    let or = |k: &str, d: &str| if v(k).is_empty() { format!("{base}{d}") } else { v(k) };
    Ok(ProviderConfig {
        id: id.to_string(),
        identifier,
        name,
        provider_type: if oauth2 { "oauth2".into() } else { "oidc".into() },
        enabled,
        client_id,
        client_secret,
        scopes: scopes.split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect(),
        discovery_url: if oauth2 { String::new() } else { discovery },
        issuer,
        authorization_url: if oauth2 { or("authorization_url", "/oauth/authorize") } else { String::new() },
        token_url: if oauth2 { or("token_url", "/oauth/token") } else { String::new() },
        userinfo_url: if oauth2 { or("userinfo_url", "/oauth/userinfo") } else { String::new() },
        jwks_uri: if oauth2 { or("jwks_uri", "/.well-known/jwks.json") } else { String::new() },
        email_optional,
    })
}

fn sql_opt(s: &str) -> String {
    if s.is_empty() { "NULL".into() } else { format!("'{}'", ui::lit(s)) }
}

fn sql_arr(v: &[String]) -> String {
    format!("ARRAY[{}]::text[]", v.iter().map(|s| format!("'{}'", ui::lit(s))).collect::<Vec<_>>().join(","))
}

/// `insertAuthProviderConfig` / `updateAuthProviderConfig` with inlined literals.
pub fn build_save_provider_sql(c: &ProviderConfig, exists: bool, now: &str) -> String {
    let fields = [
        ("identifier", format!("'{}'", ui::lit(&c.identifier))),
        ("name", format!("'{}'", ui::lit(&c.name))),
        ("provider_type", format!("'{}'", ui::lit(&c.provider_type))),
        ("enabled", c.enabled.to_string()),
        ("client_id", format!("'{}'", ui::lit(&c.client_id))),
        ("client_secret", format!("'{}'", ui::lit(&c.client_secret))),
        ("scopes", sql_arr(&c.scopes)),
        ("acceptable_client_ids", sql_arr(std::slice::from_ref(&c.client_id))),
        ("attribute_mapping", "'{}'::jsonb".into()),
        ("authorization_params", "'{}'::jsonb".into()),
        ("authorization_url", sql_opt(&c.authorization_url)),
        ("discovery_url", sql_opt(&c.discovery_url)),
        ("email_optional", c.email_optional.to_string()),
        ("issuer", sql_opt(&c.issuer)),
        ("jwks_uri", sql_opt(&c.jwks_uri)),
        ("pkce_enabled", "true".into()),
        ("skip_nonce_check", "false".into()),
        ("token_url", sql_opt(&c.token_url)),
        ("userinfo_url", sql_opt(&c.userinfo_url)),
    ];
    if exists {
        let sets = fields.iter().map(|(k, v)| format!("{k} = {v}")).collect::<Vec<_>>().join(",\n        ");
        format!("UPDATE auth.custom_oauth_providers\n    SET {sets},\n        updated_at = '{now}'\n    WHERE id = '{}'\n    RETURNING *;", ui::lit(&c.id))
    } else {
        let names = fields.iter().map(|(k, _)| *k).collect::<Vec<_>>().join(", ");
        let vals = fields.iter().map(|(_, v)| v.clone()).collect::<Vec<_>>().join(", ");
        format!("INSERT INTO auth.custom_oauth_providers (\n      id, {names}, created_at, updated_at\n    ) VALUES (\n      '{}', {vals}, '{now}', '{now}'\n    ) RETURNING *;", ui::lit(&c.id))
    }
}

pub struct AuthProvidersView {
    session: Arc<Session>,
    configs: Vec<ProviderConfig>,
    loading: bool,
    error: Option<String>,
    view_mode: &'static str,
    table: Entity<TableState>,
    sheet: Option<Option<ProviderConfig>>,
    form_inputs: Vec<(&'static str, Entity<InputState>)>,
    scopes: Entity<InputState>,
    form_id: String,
    oauth2: bool,
    form_enabled: bool,
    email_optional: bool,
    form_error: Option<String>,
    saving: bool,
    pending_form: Option<Vec<(&'static str, String)>>,
}

impl AuthProvidersView {
    fn new(session: Arc<Session>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let table = cx.new(|_| TableState::default());
        cx.observe(&table, |_, _, cx| cx.notify()).detach();
        let placeholder = |k: &str| match k {
            "identifier" => "my-company",
            "name" => "My Provider",
            "issuer" => "https://auth.company.com",
            "discovery_url" => "https://issuer/.well-known/openid-configuration",
            "authorization_url" => "https://auth.company.com/oauth/authorize",
            "token_url" => "https://auth.company.com/oauth/token",
            "userinfo_url" => "https://auth.company.com/oauth/userinfo",
            "jwks_uri" => "https://auth.company.com/.well-known/jwks.json",
            _ => "",
        };
        let form_inputs = FORM_FIELDS.iter().map(|k| (*k, cx.new(|cx| InputState::new(window, cx).placeholder(placeholder(k)).masked(*k == "client_secret")))).collect();
        let scopes = cx.new(|cx| InputState::new(window, cx).placeholder("openid, email, profile"));
        on_refresh("auth-providers", cx, Self::refresh);
        let mut this = Self { session, configs: vec![], loading: false, error: None, view_mode: "grid", table, sheet: None, form_inputs, scopes, form_id: String::new(), oauth2: false, form_enabled: true, email_optional: false, form_error: None, saving: false, pending_form: None };
        this.refresh(cx);
        this
    }

    fn refresh(&mut self, cx: &mut Context<Self>) {
        self.loading = true;
        self.error = None;
        cx.notify();
        let driver = self.session.driver.clone();
        ui::run(cx, async move { Ok(Grid::from_result(driver.execute("SELECT * FROM auth.custom_oauth_providers ORDER BY name;", 1000).await?)) }, |this, r, _| {
            this.loading = false;
            match r {
                Ok(g) => this.configs = g.rows.iter().map(|row| config_from(&g, row)).collect(),
                Err(e) => {
                    this.configs.clear();
                    this.error = Some(ui::err_text(&e));
                }
            }
        });
    }

    fn input(&self, k: &str) -> Entity<InputState> {
        self.form_inputs.iter().find(|(n, _)| *n == k).map(|(_, s)| s.clone()).expect("form field")
    }

    /// `buildCustomProviderForm`.
    fn open_sheet(&mut self, config: Option<ProviderConfig>, cx: &mut Context<Self>) {
        let c = config.clone().unwrap_or_default();
        self.form_id = if config.is_some() { c.id.clone() } else { uuid_v4() };
        self.oauth2 = c.provider_type == "oauth2";
        self.form_enabled = config.as_ref().map(|c| c.enabled).unwrap_or(true);
        self.email_optional = c.email_optional;
        self.form_error = None;
        let secret = if config.is_some() && !c.client_secret.is_empty() { "placeholder".to_string() } else { String::new() };
        self.pending_form = Some(vec![
            ("identifier", c.identifier.trim_start_matches("custom:").to_string()),
            ("name", c.name.clone()),
            ("issuer", c.issuer.clone()),
            ("discovery_url", c.discovery_url.clone()),
            ("authorization_url", c.authorization_url.clone()),
            ("token_url", c.token_url.clone()),
            ("userinfo_url", c.userinfo_url.clone()),
            ("jwks_uri", c.jwks_uri.clone()),
            ("client_id", c.client_id.clone()),
            ("client_secret", secret),
            ("scopes", c.scopes.join(", ")),
        ]);
        self.sheet = Some(config);
        cx.notify();
    }

    fn save(&mut self, cx: &mut Context<Self>) {
        let Some(existing) = self.sheet.clone() else { return };
        let values: std::collections::HashMap<&str, String> = self.form_inputs.iter().map(|(k, s)| (*k, s.read(cx).value().to_string())).collect();
        let scopes = self.scopes.read(cx).value().to_string();
        let mut parsed = match parse_provider_form(&values, &self.form_id, self.oauth2, self.form_enabled, &scopes, self.email_optional) {
            Ok(p) => p,
            Err(e) => {
                self.form_error = Some(e.into());
                cx.notify();
                return;
            }
        };
        let current = self.configs.iter().find(|c| c.id == parsed.id).cloned();
        if let Some(cur) = &current {
            if parsed.client_secret == "placeholder" {
                parsed.client_secret = cur.client_secret.clone();
            }
        }
        let _ = existing;
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let sql = build_save_provider_sql(&parsed, current.is_some(), &now);
        self.saving = true;
        self.form_error = None;
        cx.notify();
        let driver = self.session.driver.clone();
        ui::run(cx, async move { driver.execute(&sql, 1).await.map(|_| ()) }, |this, r, cx| {
            this.saving = false;
            match r {
                Ok(()) => {
                    this.sheet = None;
                    this.refresh(cx);
                }
                Err(e) => this.form_error = Some(ui::err_text(&e)),
            }
        });
    }

    fn render_sheet(&mut self, cx: &mut Context<Self>) -> Option<AnyElement> {
        let config = self.sheet.clone()?;
        let t = cx.tokens().clone();
        let label = |s: &str| div().tw_text_xs().text_color(t.muted_foreground).child(s.to_string());
        let field = |this: &Self, k: &str, l: &str| div().flex().flex_col().gap_2().child(label(l)).child(TextInput::new(&this.input(k)).h(36.));
        let w = cx.entity().downgrade();
        let protocol = Select::new("ap-protocol")
            .w_full()
            .placeholder("Select configuration method")
            .options([SelectOption::new("oidc", "Auto-discovery (Recommended)"), SelectOption::new("oauth2", "Manual configuration")])
            .value(Some(if self.oauth2 { "oauth2" } else { "oidc" }))
            .on_change({
                let w = w.clone();
                move |v, _, cx| {
                    w.update(cx, |s, cx| {
                        s.oauth2 = v.as_ref() == "oauth2";
                        cx.notify();
                    })
                    .ok();
                }
            });
        let editing = config.is_some();
        let body = div()
            .p_6()
            .flex()
            .flex_col()
            .gap_6()
            .tw_text_sm()
            .children(self.form_error.clone().map(|e| div().tw_rounded_lg().border_1().border_color(with_alpha(tw("red-500"), 0.4)).bg(with_alpha(tw("red-500"), 0.1)).p_3().tw_text_xs().text_color(tw("red-200")).child(e)))
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap_4()
                    .child(div().flex().flex_col().gap_2().child(label("Provider Identifier")).child(InputGroup::new(&self.input("identifier")).addon(AddonAlign::InlineStart, rexa_ui::input_group_text("custom:", cx)).disabled(editing)))
                    .child(field(self, "name", "Display Name")),
            )
            .child(div().flex().flex_col().gap_2().child(label("Configuration Method")).child(protocol))
            .child(field(self, "issuer", "Issuer URL"))
            .when(!self.oauth2, |d| d.child(field(self, "discovery_url", "Discovery URL").child(div().tw_text_xs().text_color(t.muted_foreground).child("Leave empty to use {issuer}/.well-known/openid-configuration."))))
            .when(self.oauth2, |d| {
                d.child(
                    div()
                        .flex()
                        .flex_col()
                        .gap_3()
                        .child(div().flex().gap_3().child(div().flex_1().child(field(self, "authorization_url", "Authorization URL"))).child(div().flex_1().child(field(self, "token_url", "Token URL"))))
                        .child(div().flex().gap_3().child(div().flex_1().child(field(self, "userinfo_url", "Userinfo URL"))).child(div().flex_1().child(field(self, "jwks_uri", "JWKS URI")))),
                )
            })
            .child(div().flex().gap_4().child(div().flex_1().child(field(self, "client_id", "Client ID"))).child(div().flex_1().child(field(self, "client_secret", "Client Secret"))))
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap_4()
                    .child(div().flex().flex_col().gap_2().child(label("Scopes")).child(TextInput::new(&self.scopes).h(36.)))
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .justify_between()
                            .gap_4()
                            .border_1()
                            .border_color(t.studio_border)
                            .tw_rounded_lg()
                            .px_4()
                            .py_2()
                            .child(div().child(div().tw_text_sm().font_weight(FontWeight::MEDIUM).child("Allow Users Without Email")).child(div().tw_text_xs().text_color(t.muted_foreground).child("Allow login even if the provider returns no email.")))
                            .child(Switch::new("ap-email-opt").checked(self.email_optional).on_change({
                                let w = w.clone();
                                move |v, _, cx| {
                                    w.update(cx, |s, cx| {
                                        s.email_optional = v;
                                        cx.notify();
                                    })
                                    .ok();
                                }
                            })),
                    ),
            )
            .into_any_element();
        let footer = Button::new("ap-save").label(if self.saving { "Saving..." } else { "Save Provider" }).disabled(self.saving).on_click(cx.listener(|this, _, _, cx| this.save(cx))).into_any_element();
        let title = config.as_ref().map(|c| c.name.clone()).filter(|n| !n.is_empty()).unwrap_or_else(|| "Custom Provider".into());
        let w2 = w.clone();
        // Header copy: "Manage custom providers stored in auth.custom_oauth_providers."
        Some(div().w(px(520.)).h_full().flex_shrink_0().child(ui::studio_sheet("auth-provider-sheet", title, div().child(div().px_6().pt_4().tw_text_xs().text_color(t.muted_foreground).child("Manage custom providers stored in auth.custom_oauth_providers.")).child(body).into_any_element(), Some(footer), move |_, cx| { w2.update(cx, |s, cx| { s.sheet = None; cx.notify(); }).ok(); }, cx)).into_any_element())
    }
}

fn uuid_v4() -> String {
    let mut b = [0u8; 16];
    for (i, x) in b.iter_mut().enumerate() {
        let n = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
        *x = ((n >> ((i % 8) * 8)) as u8) ^ (rand_byte() as u8);
    }
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    let h: String = b.iter().map(|x| format!("{x:02x}")).collect();
    format!("{}-{}-{}-{}-{}", &h[..8], &h[8..12], &h[12..16], &h[16..20], &h[20..])
}

fn rand_byte() -> u64 {
    use std::hash::{BuildHasher, Hasher};
    let mut h = std::collections::hash_map::RandomState::new().build_hasher();
    h.write_u64(std::time::Instant::now().elapsed().as_nanos() as u64);
    h.finish()
}

impl Render for AuthProvidersView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if let Some(vals) = self.pending_form.take() {
            for (k, v) in vals {
                let target = if k == "scopes" { self.scopes.clone() } else { self.input(k) };
                target.update(cx, |s, cx| s.set_value(v, window, cx));
            }
        }
        let t = cx.tokens().clone();
        let mode = self.view_mode;
        let actions = div()
            .flex()
            .items_center()
            .gap_2()
            .child({
                let b = Button::new("ap-grid").size(ButtonSize::Sm).label("Grid").on_click(cx.listener(|this, _, _, cx| { this.view_mode = "grid"; cx.notify(); }));
                if mode == "grid" { b.secondary() } else { b.ghost() }
            })
            .child({
                let b = Button::new("ap-table").size(ButtonSize::Sm).label("Table").on_click(cx.listener(|this, _, _, cx| { this.view_mode = "table"; cx.notify(); }));
                if mode == "table" { b.secondary() } else { b.ghost() }
            })
            .child(Button::new("ap-add").size(ButtonSize::Sm).label("Add Provider").on_click(cx.listener(|this, _, _, cx| this.open_sheet(None, cx))))
            .into_any_element();
        let w = cx.entity().downgrade();
        let header = section_header("Sign In / Providers", "", format!("{} providers", self.configs.len()), self.loading, move |_, cx| { w.update(cx, |s, cx| s.refresh(cx)).ok(); }, Some(actions), None, cx);
        let content: AnyElement = if self.configs.is_empty() {
            div().p_6().tw_text_sm().text_color(t.muted_foreground).child("No custom providers yet.").into_any_element()
        } else if mode == "table" {
            let w = cx.entity().downgrade();
            let rows = self.configs.iter().map(|c| {
                let (w, c2) = (w.clone(), c.clone());
                Row::new(c.id.clone())
                    .sort("name", c.name.clone())
                    .sort("identifier", c.identifier.clone())
                    .sort("provider_type", c.provider_type.clone())
                    .cell(div().truncate().font_weight(FontWeight::MEDIUM).child(c.name.clone()))
                    .cell(div().truncate().text_color(t.muted_foreground).child(c.identifier.clone()))
                    .cell(div().truncate().text_color(t.muted_foreground).child(c.provider_type.clone()))
                    .cell(Badge::new(if c.enabled { "Enabled" } else { "Disabled" }).variant(if c.enabled { BadgeVariant::Success } else { BadgeVariant::Outline }))
                    .on_click(move |_, cx| {
                        let c = c2.clone();
                        w.update(cx, |s, cx| s.open_sheet(Some(c), cx)).ok();
                    })
            });
            div()
                .p_6()
                .child(DataTable::new("auth-providers", &self.table).columns([Column::new("name", "Name").fr(1.2).sortable(), Column::new("identifier", "Identifier").fr(1.2).sortable(), Column::new("provider_type", "Type").fr(0.8).sortable(), Column::new("enabled", "Enabled").fr(0.7)]).rows(rows))
                .into_any_element()
        } else {
            div()
                .p_6()
                .flex()
                .flex_wrap()
                .gap_4()
                .children(self.configs.iter().map(|c| {
                    let c2 = c.clone();
                    div()
                        .id(SharedString::from(format!("ap-card-{}", c.id)))
                        .w(px(320.))
                        .tw_rounded_lg()
                        .border_1()
                        .border_color(t.studio_border)
                        .bg(with_alpha(t.studio_bg, 0.6))
                        .p_4()
                        .flex()
                        .items_center()
                        .justify_between()
                        .gap_4()
                        .cursor_pointer()
                        .hover(|d| d.bg(t.studio_row_hover))
                        .on_click(cx.listener(move |this, _, _, cx| this.open_sheet(Some(c2.clone()), cx)))
                        .child(div().child(div().tw_text_sm().font_weight(FontWeight::SEMIBOLD).child(c.name.clone())).child(div().tw_text_xs().text_color(t.muted_foreground).child(c.identifier.clone())))
                        .child(div().tw_text_xs().font_weight(FontWeight::MEDIUM).text_color(if c.enabled { tw("emerald-400") } else { t.muted_foreground }).child(if c.enabled { "Enabled" } else { "Disabled" }))
                }))
                .into_any_element()
        };
        let sheet = self.render_sheet(cx);
        div()
            .size_full()
            .flex()
            .bg(t.studio_bg)
            .text_color(t.foreground)
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .flex()
                    .flex_col()
                    .child(header)
                    .children(self.error.clone().map(|e| div().px_6().py_3().tw_text_xs().text_color(tw("red-200")).border_b_1().border_color(with_alpha(tw("red-500"), 0.3)).bg(with_alpha(tw("red-500"), 0.1)).child(e)))
                    .child(div().id("ap-body").flex_1().overflow_y_scroll().child(content)),
            )
            .children(sheet)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn provider_types() {
        assert_eq!(map_provider_type("github, email", false), "Social");
        assert_eq!(map_provider_type("sso:abc", false), "SAML");
        assert_eq!(map_provider_type("phone", false), "Phone");
        assert_eq!(map_provider_type("email", false), "-");
        assert_eq!(map_provider_type("email", true), "Anonymous");
    }

    #[test]
    fn search_validation() {
        assert!(!search_invalid("abc", "email"));
        assert!(!search_invalid("1234abcd-12", "id"));
        assert!(search_invalid("zz", "id"));
        assert!(!search_invalid("+4912", "phone"));
        assert!(search_invalid("abc", "phone"));
        assert!(email_ok("a@b.co"));
        assert!(!email_ok("a@b"));
    }

    #[test]
    fn user_sql_escapes() {
        let sql = build_create_user_sql("o'k@x.io", "p'w", true);
        assert!(sql.contains("'o''k@x.io'"));
        assert!(sql.contains("extensions.crypt('p''w'"));
        assert!(sql.contains("now(), '{\"provider\""));
        assert!(build_invite_user_sql("a@b.co").contains("NULL, NULL"));
    }

    #[test]
    fn maps_user_rows() {
        let g = Grid {
            columns: ["id", "email", "phone", "created_at", "last_sign_in_at", "confirmed_at", "email_confirmed_at", "phone_confirmed_at", "is_anonymous", "raw_user_meta_data", "providers", "provider_type", "all_identity_data"].iter().map(|s| s.to_string()).collect(),
            rows: vec![["u1", "ada@x.io", "", "2024-01-02 03:04:05+00", "", "", "2024-01-02 03:04:05+00", "", "f", r#"{"avatar_url":"https://avatars.githubusercontent.com/u/1?v=4"}"#, "github", "github", "[]"].iter().map(|s| s.to_string()).collect()],
        };
        let u = map_user(&g, &g.rows[0]);
        assert_eq!(u.display_name, "ada");
        assert_eq!(u.providers, vec!["github"]);
        assert_eq!(u.provider_type, "Social");
        assert!(u.confirmed);
        assert!(u.avatar_url.unwrap().ends_with("s=24"));
    }

    #[test]
    fn provider_form() {
        let mut v = std::collections::HashMap::new();
        v.insert("identifier", "custom:acme".to_string());
        v.insert("name", "Acme".to_string());
        v.insert("issuer", "https://id.acme.com/".to_string());
        v.insert("client_id", "cid".to_string());
        v.insert("client_secret", "sec".to_string());
        let c = parse_provider_form(&v, "id1", true, true, "openid, email", false).unwrap();
        assert_eq!(c.identifier, "custom:acme");
        assert_eq!(c.token_url, "https://id.acme.com/oauth/token");
        assert_eq!(c.scopes, vec!["openid", "email"]);
        let sql = build_save_provider_sql(&c, false, "now");
        assert!(sql.starts_with("INSERT INTO auth.custom_oauth_providers"));
        assert!(build_save_provider_sql(&c, true, "now").contains("WHERE id = 'id1'"));
        v.remove("issuer");
        assert_eq!(parse_provider_form(&v, "id1", false, true, "", false).unwrap_err(), "Issuer URL is required.");
        assert!(is_uuid_v4_prefix(&uuid_v4()));
    }
}
