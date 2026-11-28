//! Port of components/studio/storage/{storage-files-view,storage-buckets-shared,
//! storage-bucket-view,storage-policies-view,storage-settings-view}.tsx and
//! lib/studio/storage-utils.ts.
//!
//! Like the original, buckets/objects are read and edited through SQL on the
//! `storage` schema (works for supabase-mgmt and direct Postgres connections).
//! Native addition (the original only showed a toast): when the project's
//! Management API token is linked, the Storage REST API (with the project's
//! service-role key) is used to upload files from a native file dialog,
//! download private objects and mint signed URLs.

use crate::supabase::{self, ConnInfo};
use crate::ui::{self, lit, Prompt};
use gpui::{div, img, prelude::*, px, AnyElement, AnyView, App, AppContext, Context, Entity, EventEmitter, FontWeight, Global, MouseButton, SharedString, Window};
use rexa_core::{Session, TabSpec};
use rexa_drivers::Driver;
use rexa_ui::widgets::{Icon, InputEvent, InputState};
use rexa_ui::{tw, with_alpha, ActiveTokens, Align, Badge, BadgeVariant, Button, ButtonSize, ConfirmOptions, Dialog, DropdownMenu, IconName, Menu, MenuItem, OverlayId, Select, SelectOption, Switch, TextInput, Toast, Tw};
use serde_json::Value;
use std::sync::Arc;

pub fn build_tab(view: &str, params: &Value, session: Arc<Session>, window: &mut Window, cx: &mut App) -> Option<AnyView> {
    Some(match view {
        "storage-files" => cx.new(|cx| StorageFilesView::new(session, window, cx)).into(),
        "storage-bucket" | "supabase-storage" => {
            let bucket = params.get("bucketName").or_else(|| params.get("bucket")).or_else(|| params.get("name")).and_then(Value::as_str).unwrap_or_default().to_string();
            cx.new(|cx| StorageBucketView::new(session, bucket, window, cx)).into()
        }
        "storage-policies" => cx.new(|cx| StoragePoliciesView::new(session, window, cx)).into(),
        "storage-settings" => cx.new(|cx| StorageSettingsView::new(session, window, cx)).into(),
        _ => return None,
    })
}

// ---- storage-utils ----------------------------------------------------------------------

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Bucket {
    pub id: String,
    pub name: String,
    pub public: bool,
    pub file_size_limit: Option<f64>,
    pub allowed_mime_types: Option<Vec<String>>,
    pub created_at: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Object {
    pub id: String,
    pub name: String,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    pub metadata: Option<Value>,
}

/// Marker object written to materialize otherwise-empty folders. Never shown.
pub const EMPTY_FOLDER_PLACEHOLDER: &str = ".emptyFolderPlaceholder";

#[derive(Clone, Debug, PartialEq)]
pub enum Entry {
    Folder(String),
    File(String, Object),
}

impl Entry {
    pub fn name(&self) -> &str {
        match self {
            Entry::Folder(n) | Entry::File(n, _) => n,
        }
    }
}

/// `listFolderEntries`: immediate children of `prefix`, folders first.
pub fn list_folder_entries(objects: &[Object], prefix: &str) -> Vec<Entry> {
    let with_slash = if prefix.is_empty() { String::new() } else { format!("{prefix}/") };
    let mut folders = std::collections::BTreeSet::new();
    let mut files: Vec<&Object> = vec![];
    for obj in objects {
        if obj.name.is_empty() || (!with_slash.is_empty() && !obj.name.starts_with(&with_slash)) {
            continue;
        }
        let rest = &obj.name[with_slash.len()..];
        if rest.is_empty() {
            continue;
        }
        match rest.find('/') {
            None if rest == EMPTY_FOLDER_PLACEHOLDER => {}
            None => files.push(obj),
            Some(i) => {
                folders.insert(rest[..i].to_string());
            }
        }
    }
    files.sort_by(|a, b| a.name.cmp(&b.name));
    folders
        .into_iter()
        .map(Entry::Folder)
        .chain(files.into_iter().map(|o| Entry::File(o.name.rsplit('/').next().unwrap_or(&o.name).to_string(), o.clone())))
        .collect()
}

pub fn parent_path(path: &str) -> String {
    let trimmed = path.trim_end_matches('/');
    trimmed.rfind('/').map(|i| trimmed[..i].to_string()).unwrap_or_default()
}

pub fn path_segments(path: &str) -> Vec<String> {
    path.split('/').filter(|s| !s.is_empty()).map(str::to_string).collect()
}

pub fn join_path(parts: &[&str]) -> String {
    parts.iter().filter(|p| !p.is_empty()).copied().collect::<Vec<_>>().join("/")
}

fn encode_storage_path(path: &str) -> String {
    path.split('/').map(supabase::enc).collect::<Vec<_>>().join("/")
}

pub fn object_size(meta: Option<&Value>) -> Option<f64> {
    let m = meta?;
    let v = m.get("size").or_else(|| m.get("contentLength")).or_else(|| m.get("content_length"))?;
    v.as_f64().or_else(|| v.as_str().and_then(|s| s.parse().ok()))
}

pub fn object_mime(meta: Option<&Value>) -> String {
    meta.and_then(|m| ["mimetype", "contentType", "content_type", "type"].iter().find_map(|k| m.get(*k).and_then(Value::as_str).filter(|s| !s.is_empty())))
        .unwrap_or("—")
        .to_string()
}

/// `validateBucketName`.
pub fn validate_bucket_name(name: &str) -> Option<&'static str> {
    let n = name.trim();
    if n.is_empty() {
        return Some("Bucket name is required.");
    }
    let mut chars = n.chars();
    let first_ok = chars.next().is_some_and(|c| c.is_ascii_lowercase() || c.is_ascii_digit());
    let rest_ok = n.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '.' | '_' | '-'));
    (!(first_ok && rest_ok)).then_some("Use lowercase letters, numbers, dots, underscores, or hyphens.")
}

pub fn build_create_bucket_sql(name: &str, public: bool) -> String {
    let l = lit(name);
    format!("INSERT INTO storage.buckets (id, name, public)\n         VALUES ('{l}', '{l}', {public})")
}

async fn try_queries(driver: &Arc<dyn Driver>, queries: &[String]) -> anyhow::Result<crate::common::Grid> {
    let mut last = None;
    for sql in queries {
        match driver.execute(sql, 10_000).await {
            Ok(r) => return Ok(crate::common::Grid::from_result(r)),
            Err(e) => last = Some(e),
        }
    }
    Err(last.unwrap_or_else(|| anyhow::anyhow!("Query failed.")))
}

fn normalize_buckets(g: &crate::common::Grid) -> Vec<Bucket> {
    g.rows
        .iter()
        .map(|r| {
            let id = g.get(r, "id");
            let name = g.get(r, "name");
            let mimes = g.get(r, "allowed_mime_types");
            Bucket {
                id: if id.is_empty() { name } else { id }.to_string(),
                name: if name.is_empty() { id } else { name }.to_string(),
                public: ui::truthy(g.get(r, "public")),
                file_size_limit: g.get(r, "file_size_limit").parse().ok(),
                allowed_mime_types: (!mimes.is_empty()).then(|| ui::text_array(mimes)),
                created_at: Some(g.get(r, "created_at").to_string()).filter(|s| !s.is_empty()),
            }
        })
        .filter(|b| !b.name.is_empty())
        .collect()
}

const BUCKETS_COLUMNS: &str = "id, name, public, file_size_limit, allowed_mime_types, created_at, updated_at";

pub async fn fetch_buckets(driver: Arc<dyn Driver>) -> anyhow::Result<Vec<Bucket>> {
    let g = try_queries(&driver, &[format!("SELECT {BUCKETS_COLUMNS} FROM storage.buckets ORDER BY name"), "SELECT * FROM storage.buckets ORDER BY name".into()]).await?;
    Ok(normalize_buckets(&g))
}

async fn fetch_bucket(driver: Arc<dyn Driver>, name: &str) -> anyhow::Result<Option<Bucket>> {
    let s = lit(name);
    let w = format!("WHERE id = '{s}' OR name = '{s}' LIMIT 1");
    let g = try_queries(&driver, &[format!("SELECT {BUCKETS_COLUMNS} FROM storage.buckets {w}"), format!("SELECT * FROM storage.buckets {w}")]).await?;
    Ok(normalize_buckets(&g).into_iter().next())
}

async fn fetch_objects(driver: Arc<dyn Driver>, bucket: &str) -> anyhow::Result<Vec<Object>> {
    let w = format!("WHERE bucket_id = '{}' ORDER BY name", lit(bucket));
    let g = try_queries(&driver, &[format!("SELECT id, name, bucket_id, owner, owner_id, created_at, updated_at, last_accessed_at, metadata FROM storage.objects {w}"), format!("SELECT * FROM storage.objects {w}")]).await?;
    Ok(g.rows
        .iter()
        .map(|r| Object {
            id: g.get(r, "id").to_string(),
            name: g.get(r, "name").to_string(),
            created_at: Some(g.get(r, "created_at").to_string()).filter(|s| !s.is_empty()),
            updated_at: Some(g.get(r, "updated_at").to_string()).filter(|s| !s.is_empty()),
            metadata: serde_json::from_str::<Value>(g.get(r, "metadata")).ok().filter(Value::is_object),
        })
        .filter(|o| !o.name.is_empty())
        .collect())
}

async fn exec(driver: &Arc<dyn Driver>, sql: String) -> anyhow::Result<crate::common::Grid> {
    Ok(crate::common::Grid::from_result(driver.execute(&sql, 1000).await?))
}

// ---- Storage REST API (native addition) ----------------------------------------------

#[derive(Clone)]
pub struct StorageApi {
    pub base: String,
    pub key: String,
}

fn api_cache() -> &'static std::sync::Mutex<std::collections::HashMap<String, StorageApi>> {
    static C: std::sync::OnceLock<std::sync::Mutex<std::collections::HashMap<String, StorageApi>>> = std::sync::OnceLock::new();
    C.get_or_init(Default::default)
}

/// Service-role key via `GET /v1/projects/{ref}/api-keys` (read-only).
pub async fn storage_api(info: Option<ConnInfo>) -> anyhow::Result<StorageApi> {
    let info = info.ok_or_else(|| anyhow::anyhow!("Download requires a public bucket URL or the Storage API."))?;
    if let Some(api) = api_cache().lock().ok().and_then(|c| c.get(&info.project_ref).cloned()) {
        return Ok(api);
    }
    let access = supabase::resolve_access(Some(info)).await?.ok_or_else(|| anyhow::anyhow!("No Supabase access."))?;
    let keys = supabase::request(&access.token, reqwest::Method::GET, &format!("/projects/{}/api-keys?reveal=true", access.project_ref), None).await?;
    let key = keys
        .as_array()
        .and_then(|ks| {
            ks.iter()
                .find(|k| k.get("name").and_then(Value::as_str) == Some("service_role"))
                .or_else(|| ks.iter().find(|k| k.get("type").and_then(Value::as_str) == Some("secret")))
        })
        .and_then(|k| k.get("api_key").and_then(Value::as_str))
        .filter(|k| !k.is_empty())
        .ok_or_else(|| anyhow::anyhow!("The project's service-role key is not available to this account."))?
        .to_string();
    let api = StorageApi { base: format!("https://{}.supabase.co/storage/v1", access.project_ref), key };
    if let Ok(mut c) = api_cache().lock() {
        c.insert(access.project_ref, api.clone());
    }
    Ok(api)
}

impl StorageApi {
    fn req(&self, method: reqwest::Method, path: &str) -> reqwest::RequestBuilder {
        supabase::http().request(method, format!("{}{path}", self.base)).bearer_auth(&self.key).header("apikey", &self.key)
    }
    pub async fn upload(&self, bucket: &str, path: &str, bytes: Vec<u8>, mime: &str) -> anyhow::Result<()> {
        let res = self.req(reqwest::Method::POST, &format!("/object/{}/{}", supabase::enc(bucket), encode_storage_path(path))).header("content-type", mime).header("x-upsert", "false").body(bytes).send().await?;
        supabase::read_response(res).await.map(|_| ())
    }
    pub async fn download(&self, bucket: &str, path: &str) -> anyhow::Result<Vec<u8>> {
        let res = self.req(reqwest::Method::GET, &format!("/object/authenticated/{}/{}", supabase::enc(bucket), encode_storage_path(path))).send().await?;
        if !res.status().is_success() {
            let status = res.status().as_u16();
            let text = res.text().await.unwrap_or_default();
            anyhow::bail!("Supabase Storage {status}: {}", supabase::error_detail(&text, "download failed"));
        }
        Ok(res.bytes().await?.to_vec())
    }
    pub async fn signed_url(&self, bucket: &str, path: &str, expires_in: u64) -> anyhow::Result<String> {
        let res = self.req(reqwest::Method::POST, &format!("/object/sign/{}/{}", supabase::enc(bucket), encode_storage_path(path))).json(&serde_json::json!({ "expiresIn": expires_in })).send().await?;
        let v = supabase::read_response(res).await?;
        let rel = v.get("signedURL").or_else(|| v.get("signedUrl")).and_then(Value::as_str).ok_or_else(|| anyhow::anyhow!("No signed URL returned."))?;
        Ok(if rel.starts_with("http") { rel.to_string() } else { format!("{}{}", self.base, rel) })
    }
}

fn mime_for(path: &std::path::Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).as_deref() {
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("svg") => "image/svg+xml",
        Some("pdf") => "application/pdf",
        Some("json") => "application/json",
        Some("txt" | "md") => "text/plain",
        Some("csv") => "text/csv",
        Some("html") => "text/html",
        Some("js") => "text/javascript",
        Some("ts") => "application/typescript",
        Some("mp4") => "video/mp4",
        Some("mp3") => "audio/mpeg",
        Some("zip") => "application/zip",
        _ => "application/octet-stream",
    }
}

// ---- studio:storage-buckets-changed ------------------------------------------------------

pub struct BucketsBus;
pub struct BucketsChanged;
impl EventEmitter<BucketsChanged> for BucketsBus {}
struct BusGlobal(Entity<BucketsBus>);
impl Global for BusGlobal {}

fn bus(cx: &mut App) -> Entity<BucketsBus> {
    if let Some(g) = cx.try_global::<BusGlobal>() {
        return g.0.clone();
    }
    let e = cx.new(|_| BucketsBus);
    cx.set_global(BusGlobal(e.clone()));
    e
}

pub fn notify_buckets_changed(cx: &mut App) {
    bus(cx).update(cx, |_, cx| cx.emit(BucketsChanged));
}

fn open_bucket_tab(name: &str, cx: &mut App) {
    if name.is_empty() {
        return;
    }
    rexa_core::open_tab(TabSpec::View { view: "storage-bucket".into(), params: serde_json::json!({ "id": format!("storage-bucket-{name}"), "name": name, "bucketName": name }) }, cx);
}

fn open_simple(view: &str, cx: &mut App) {
    rexa_core::open_tab(TabSpec::View { view: view.into(), params: Value::Object(Default::default()) }, cx);
}

fn search_state<V: 'static>(placeholder: &str, window: &mut Window, cx: &mut Context<V>) -> Entity<InputState> {
    let state = cx.new(|cx| InputState::new(window, cx).placeholder(placeholder.to_string()));
    cx.subscribe(&state, |_, _, e: &InputEvent, cx| {
        if matches!(e, InputEvent::Change) {
            cx.notify();
        }
    })
    .detach();
    state
}

fn refresh_on_tab_command<V: 'static>(view: &str, cx: &mut Context<V>, f: fn(&mut V, &mut Context<V>)) {
    let view = view.to_string();
    cx.subscribe(&rexa_core::studio_bus(cx), move |this, _, e: &rexa_core::StudioEvent, cx| {
        if let rexa_core::StudioEvent::TabCommand { tab: TabSpec::View { view: v, .. }, command } = e {
            if *v == view && command == "REFRESH_CURRENT_TAB" {
                f(this, cx);
            }
        }
    })
    .detach();
}

// ---- storage-files-view --------------------------------------------------------------------

pub struct StorageFilesView {
    session: Arc<Session>,
    buckets: Vec<Bucket>,
    loading: bool,
    load_error: Option<String>,
    search: Entity<InputState>,
    new_name: Entity<InputState>,
    new_public: bool,
    creating: bool,
    dialog: Option<OverlayId>,
}

impl StorageFilesView {
    fn new(session: Arc<Session>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let search = search_state("Search buckets…", window, cx);
        let new_name = cx.new(|cx| InputState::new(window, cx).placeholder("avatars"));
        cx.subscribe(&new_name, |this: &mut Self, _, e: &InputEvent, cx| {
            if matches!(e, InputEvent::PressEnter { .. }) {
                this.create(cx);
            }
        })
        .detach();
        let b = bus(cx);
        cx.subscribe(&b, |this, _, _: &BucketsChanged, cx| this.load(cx)).detach();
        refresh_on_tab_command("storage-files", cx, Self::load);
        let mut this = Self { session, buckets: vec![], loading: false, load_error: None, search, new_name, new_public: false, creating: false, dialog: None };
        this.load(cx);
        this
    }

    fn load(&mut self, cx: &mut Context<Self>) {
        self.loading = true;
        cx.notify();
        let driver = self.session.driver.clone();
        ui::run(cx, fetch_buckets(driver), |this, r, cx| {
            this.loading = false;
            match r {
                Ok(b) => {
                    this.buckets = b;
                    this.load_error = None;
                }
                Err(e) => {
                    let msg = ui::err_text(&e);
                    Toast::error(msg.clone()).show(cx);
                    this.buckets.clear();
                    this.load_error = Some(msg);
                }
            }
        });
    }

    fn open_create(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let weak = cx.entity().downgrade();
        let input = self.new_name.clone();
        input.update(cx, |s, cx| s.focus(window, cx));
        self.dialog = Some(rexa_ui::open_dialog(cx, move |_, cx| {
            let Some(view) = weak.upgrade() else { return Dialog::new() };
            let (public, creating) = { let v = view.read(cx); (v.new_public, v.creating) };
            let t = cx.tokens().clone();
            let (v1, v2) = (view.clone(), view.clone());
            Dialog::new()
                .max_w(384.)
                .title("Create a new bucket")
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .gap_4()
                        .child(div().flex().flex_col().gap(px(6.)).child(rexa_ui::Label::new("Name")).child(TextInput::new(&input)))
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .justify_between()
                                .gap_3()
                                .tw_rounded_lg()
                                .border_1()
                                .border_color(t.border)
                                .px_3()
                                .py(px(10.))
                                .child(div().child(div().tw_text_sm().font_weight(FontWeight::MEDIUM).child("Public bucket")).child(div().tw_text_xs().text_color(t.muted_foreground).child("Anyone with the URL can access objects")))
                                .child(Switch::new("new-bucket-public").checked(public).on_change(move |v, _, cx| v1.update(cx, |s, cx| { s.new_public = v; cx.notify(); }))),
                        ),
                )
                .footer(
                    div()
                        .flex()
                        .justify_end()
                        .gap_2()
                        .child(Button::new("nb-cancel").ghost().size(ButtonSize::Sm).label("Cancel").disabled(creating).on_click(|_, _, cx| rexa_ui::close_top(cx)))
                        .child(Button::new("nb-create").size(ButtonSize::Sm).label(if creating { "Creating…" } else { "Create" }).disabled(creating).on_click(move |_, _, cx| v2.update(cx, |s, cx| s.create(cx)))),
                )
        }));
    }

    fn create(&mut self, cx: &mut Context<Self>) {
        if self.creating {
            return;
        }
        let name = self.new_name.read(cx).value().trim().to_string();
        if let Some(e) = validate_bucket_name(&name) {
            Toast::error(e).show(cx);
            return;
        }
        self.creating = true;
        cx.notify();
        let driver = self.session.driver.clone();
        let sql = build_create_bucket_sql(&name, self.new_public);
        ui::run(cx, async move { exec(&driver, sql).await }, move |this, r, cx| {
            this.creating = false;
            match r {
                Ok(_) => {
                    Toast::success(format!("Bucket \"{name}\" created.")).show(cx);
                    if let Some(id) = this.dialog.take() {
                        rexa_ui::close_overlay(id, cx);
                    }
                    this.new_public = false;
                    notify_buckets_changed(cx);
                    open_bucket_tab(&name, cx);
                }
                Err(e) => {
                    Toast::error(ui::err_text(&e)).show(cx);
                }
            }
        });
    }
}

impl Render for StorageFilesView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let _ = window;
        let t = cx.tokens().clone();
        let q = self.search.read(cx).value().trim().to_lowercase();
        let filtered: Vec<Bucket> = self.buckets.iter().filter(|b| b.name.to_lowercase().contains(&q)).cloned().collect();
        let header = ui::page_header(
            "Files",
            "Browse buckets and manage objects in Supabase Storage.",
            vec![
                ui::refresh_button("sf-refresh", self.loading, { let w = cx.entity().downgrade(); move |_, cx| { w.update(cx, |s, cx| s.load(cx)).ok(); } }).into_any_element(),
                Button::new("sf-new").size(ButtonSize::Sm).icon(IconName::Plus).label("New bucket").on_click(cx.listener(|this, _, w, cx| this.open_create(w, cx))).into_any_element(),
            ],
            cx,
        );
        let body: AnyElement = if self.loading && self.buckets.is_empty() {
            div().py_20().text_center().tw_text_sm().text_color(t.muted_foreground).child("Loading buckets…").into_any_element()
        } else if let (Some(err), true) = (self.load_error.clone(), self.buckets.is_empty()) {
            div()
                .mx_auto()
                .w_full()
                .max_w(px(512.))
                .tw_rounded_xl()
                .border_1()
                .border_color(with_alpha(t.destructive, 0.3))
                .bg(with_alpha(t.destructive, 0.1))
                .p_6()
                .flex()
                .flex_col()
                .items_center()
                .text_center()
                .child(div().tw_text_sm().font_weight(FontWeight::MEDIUM).child("Failed to load buckets"))
                .child(div().mt_1().tw_text_xs().text_color(t.muted_foreground).child(err))
                .child(div().mt_2().tw_text_xs().text_color(t.muted_foreground).child(ui::inline(vec![div().child("Try running").into_any_element(), ui::code("SELECT * FROM storage.buckets;", cx), div().child("in the SQL editor to check access.").into_any_element()])))
                .child(div().mt_3().child(Button::new("sf-retry").size(ButtonSize::Sm).icon(IconName::RefreshCw).label("Retry").on_click(cx.listener(|this, _, _, cx| this.load(cx)))))
                .into_any_element()
        } else if filtered.is_empty() {
            let searching = !q.is_empty();
            ui::empty_state(
                IconName::HardDrive,
                if searching { "No matching buckets" } else { "No buckets yet" },
                Some(if searching { "Try a different search term." } else { "Create a bucket to start uploading files to Storage." }.into()),
                (!searching).then(|| div().mt_2().child(Button::new("sf-new-empty").size(ButtonSize::Sm).icon(IconName::Plus).label("New bucket").on_click(cx.listener(|this, _, w, cx| this.open_create(w, cx)))).into_any_element()),
                cx,
            )
        } else {
            fn cols<E: Styled>(d: E) -> E {
                d.flex().items_center().gap_2()
            }
            let head = cols(div())
                .border_b_1()
                .border_color(t.border)
                .bg(with_alpha(t.muted, 0.3))
                .px_4()
                .py_2()
                .child(div().flex_1().child(ui::th("Name", cx)))
                .child(div().w(px(100.)).child(ui::th("Visibility", cx)))
                .child(div().w(px(120.)).child(ui::th("File size limit", cx)))
                .child(div().w(px(160.)).child(ui::th("Created", cx)));
            let rows = filtered.iter().enumerate().map(|(i, b)| {
                let name = b.name.clone();
                cols(div().id(SharedString::from(format!("bucket-{}", b.id))))
                    .when(i > 0, |d| d.border_t_1().border_color(with_alpha(t.border, 0.6)))
                    .px_4()
                    .py_3()
                    .tw_text_xs()
                    .cursor_pointer()
                    .hover(|d| d.bg(with_alpha(t.muted, 0.2)))
                    .on_click(move |_, _, cx| open_bucket_tab(&name, cx))
                    .child(div().flex_1().min_w_0().flex().items_center().gap_2().font_weight(FontWeight::MEDIUM).child(Icon::new(IconName::HardDrive).size(px(14.)).text_color(t.muted_foreground)).child(div().truncate().child(b.name.clone())))
                    .child(div().w(px(100.)).flex().child(Badge::new(if b.public { "Public" } else { "Private" }).variant(if b.public { BadgeVariant::Default } else { BadgeVariant::Secondary })))
                    .child(div().w(px(120.)).text_color(t.muted_foreground).child(b.file_size_limit.map(|l| ui::format_bytes(Some(l))).unwrap_or_else(|| "—".into())))
                    .child(div().w(px(160.)).text_color(t.muted_foreground).child(b.created_at.as_deref().map(ui::date_medium_short).unwrap_or_else(|| "—".into())))
            });
            div().tw_rounded_xl().border_1().border_color(t.border).overflow_hidden().child(head).children(rows).into_any_element()
        };
        div()
            .size_full()
            .flex()
            .flex_col()
            .overflow_hidden()
            .bg(t.studio_bg)
            .text_color(t.foreground)
            .child(header)
            .child(
                div()
                    .id("sf-body")
                    .flex_1()
                    .min_h_0()
                    .overflow_y_scroll()
                    .p_6()
                    .child(div().mb_4().max_w(px(384.)).child(ui::search_box(&self.search, 36., cx)))
                    .child(body),
            )
    }
}

// ---- storage-bucket-view ------------------------------------------------------------------

#[derive(Clone, Copy, PartialEq)]
enum DialogKind {
    Folder,
    RenameFolder,
    RenameFile,
    Move,
    Settings,
}

pub struct StorageBucketView {
    session: Arc<Session>,
    info: Option<ConnInfo>,
    bucket_name: String,
    bucket: Option<Bucket>,
    objects: Vec<Object>,
    loading: bool,
    path: String,
    selected: Option<(String, Object)>,
    preview_url: Option<String>,
    search: Entity<InputState>,
    policy_count: Option<i64>,
    prompt_input: Entity<InputState>,
    dialog: Option<(DialogKind, OverlayId)>,
    target: Option<String>,
    busy: bool,
    deleting: bool,
    uploading: bool,
    // bucket settings dialog
    is_public: bool,
    size_limit: Entity<InputState>,
    mime_types: Vec<String>,
    mime_draft: Entity<InputState>,
    pending_size_limit: Option<String>,
    clear_mime_draft: bool,
    last_placeholder: String,
}

impl StorageBucketView {
    fn new(session: Arc<Session>, bucket_name: String, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let search = search_state("Search…", window, cx);
        let prompt_input = cx.new(|cx| InputState::new(window, cx));
        let size_limit = cx.new(|cx| InputState::new(window, cx).placeholder("No limit"));
        let mime_draft = cx.new(|cx| InputState::new(window, cx).placeholder("e.g. image/png"));
        cx.subscribe(&mime_draft, |this: &mut Self, s, e: &InputEvent, cx| match e {
            InputEvent::PressEnter { .. } | InputEvent::Blur => this.add_mime(cx),
            InputEvent::Change => {
                if s.read(cx).value().ends_with(',') {
                    this.add_mime(cx);
                }
            }
            _ => {}
        })
        .detach();
        refresh_on_tab_command("storage-bucket", cx, Self::reload);
        let vault = rexa_core::credential_vault(cx);
        let info = supabase::connection_info(&session, vault.as_deref());
        let mut this = Self {
            session,
            info,
            bucket_name,
            bucket: None,
            objects: vec![],
            loading: false,
            path: String::new(),
            selected: None,
            preview_url: None,
            search,
            policy_count: None,
            prompt_input,
            dialog: None,
            target: None,
            busy: false,
            deleting: false,
            uploading: false,
            is_public: false,
            size_limit,
            mime_types: vec![],
            mime_draft,
            pending_size_limit: None,
            clear_mime_draft: false,
            last_placeholder: String::new(),
        };
        this.reload(cx);
        this
    }

    fn reload(&mut self, cx: &mut Context<Self>) {
        self.load(cx);
        self.load_policy_count(cx);
    }

    fn public_url_base(&self) -> Option<String> {
        let info = self.info.as_ref()?;
        Some(format!("https://{}.supabase.co/storage/v1/object/public/{}", info.project_ref, self.bucket_name))
    }

    fn file_public_url(&self, full: &str) -> Option<String> {
        if !self.bucket.as_ref().is_some_and(|b| b.public) {
            return None;
        }
        Some(format!("{}/{}", self.public_url_base()?, encode_storage_path(full)))
    }

    fn load(&mut self, cx: &mut Context<Self>) {
        if self.bucket_name.is_empty() {
            return;
        }
        self.loading = true;
        cx.notify();
        let (d1, d2, name) = (self.session.driver.clone(), self.session.driver.clone(), self.bucket_name.clone());
        ui::run(cx, async move { Ok((fetch_bucket(d1, &name).await, fetch_objects(d2, &name).await)) }, |this, r, cx| {
            this.loading = false;
            let Ok((b, o)) = r else { return };
            if let Some(e) = b.as_ref().err().or(o.as_ref().err()) {
                Toast::error(ui::err_text(e)).show(cx);
            }
            match b {
                Ok(Some(b)) => {
                    this.bucket = Some(b);
                    this.sync_settings_from_bucket(cx);
                }
                Ok(None) => {}
                Err(_) => this.bucket = None,
            }
            this.objects = o.unwrap_or_default();
        });
    }

    fn sync_settings_from_bucket(&mut self, cx: &mut Context<Self>) {
        let Some(b) = self.bucket.clone() else { return };
        self.is_public = b.public;
        self.mime_types = b.allowed_mime_types.clone().unwrap_or_default();
        let mb = b.file_size_limit.map(|l| ((l / (1024. * 1024.)).round() as i64).to_string()).unwrap_or_default();
        self.pending_size_limit = Some(mb);
        cx.notify();
    }

    fn load_policy_count(&mut self, cx: &mut Context<Self>) {
        let driver = self.session.driver.clone();
        let sql = "SELECT count(*) AS count\n         FROM pg_policy p\n         JOIN pg_class c ON c.oid = p.polrelid\n         JOIN pg_namespace n ON n.oid = c.relnamespace\n         WHERE n.nspname = 'storage' AND c.relname = 'objects'".to_string();
        ui::run(cx, async move { exec(&driver, sql).await }, |this, r, _| {
            // count is decorative — hide it on failure
            if let Ok(g) = r {
                this.policy_count = g.rows.first().and_then(|row| g.get(row, "count").parse().ok());
            }
        });
    }

    fn navigate_to(&mut self, target: String, cx: &mut Context<Self>) {
        self.path = target;
        self.selected = None;
        self.preview_url = None;
        cx.notify();
    }

    fn select_file(&mut self, full: String, obj: Object, cx: &mut Context<Self>) {
        self.preview_url = self.file_public_url(&full);
        let is_image = object_mime(obj.metadata.as_ref()).starts_with("image/");
        self.selected = Some((full.clone(), obj));
        cx.notify();
        // Private image previews: a short-lived signed URL when the Storage API is reachable.
        if self.preview_url.is_none() && is_image && self.info.is_some() {
            let (info, bucket) = (self.info.clone(), self.bucket_name.clone());
            ui::run(cx, async move { storage_api(info).await?.signed_url(&bucket, &full, 600).await.map(|u| (full, u)) }, |this, r, _| {
                if let Ok((full, url)) = r {
                    if this.selected.as_ref().is_some_and(|(p, _)| *p == full) {
                        this.preview_url = Some(url);
                    }
                }
            });
        }
    }

    fn run_sql(&mut self, sql: String, ok: String, cx: &mut Context<Self>, after: impl FnOnce(&mut Self, &mut Context<Self>) + 'static) {
        self.busy = true;
        cx.notify();
        let driver = self.session.driver.clone();
        ui::run(cx, async move { exec(&driver, sql).await }, move |this, r, cx| {
            this.busy = false;
            match r {
                Ok(_) => {
                    Toast::success(ok).show(cx);
                    if let Some((_, id)) = this.dialog.take() {
                        rexa_ui::close_overlay(id, cx);
                    }
                    after(this, cx);
                    this.load(cx);
                }
                Err(e) => {
                    Toast::error(ui::err_text(&e)).show(cx);
                }
            }
        });
    }

    fn open_prompt(&mut self, kind: DialogKind, target: Option<String>, initial: String, window: &mut Window, cx: &mut Context<Self>) {
        let bucket = self.bucket_name.clone();
        let (prompt, placeholder) = match kind {
            DialogKind::Folder => (Prompt::new("Create folder", "Create", "Creating…"), "folder-name"),
            DialogKind::RenameFolder => (Prompt::new("Rename folder", "Rename", "Renaming…"), "folder-name"),
            DialogKind::RenameFile => (Prompt::new("Rename file", "Rename", "Renaming…"), "file-name"),
            DialogKind::Move => {
                let file = target.as_deref().and_then(|t| t.rsplit('/').next()).unwrap_or("file").to_string();
                let mut p = Prompt::new(format!("Moving {file} within {bucket}"), "Move files", "Moving…");
                p.description = Some("Enter the path to where you'd like to move the file to.".into());
                p.label = Some(format!("Path to new directory in {bucket}"));
                p.hint = Some("Leave blank to move items to the root of the bucket".into());
                p.max_w = 448.;
                (p, "e.g folder1/subfolder2")
            }
            DialogKind::Settings => return,
        };
        self.target = target;
        let input = cx.new(|cx| InputState::new(window, cx).placeholder(placeholder).default_value(initial));
        self.prompt_input = input.clone();
        let id = ui::open_prompt(cx.entity().downgrade(), input, prompt, |v: &Self| v.busy, move |v, value, cx| v.submit_prompt(kind, value, cx), window, cx);
        self.dialog = Some((kind, id));
    }

    fn submit_prompt(&mut self, kind: DialogKind, value: String, cx: &mut Context<Self>) {
        if self.busy {
            return;
        }
        let b = lit(&self.bucket_name);
        match kind {
            DialogKind::Folder => {
                let name = value.trim().trim_matches('/').to_string();
                if name.is_empty() {
                    Toast::error("Folder name is required.").show(cx);
                    return;
                }
                if name.contains('/') {
                    Toast::error("Folder name cannot contain slashes.").show(cx);
                    return;
                }
                let full = join_path(&[&self.path, &name, EMPTY_FOLDER_PLACEHOLDER]);
                let sql = format!("INSERT INTO storage.objects (bucket_id, name, owner, metadata)\n         VALUES ('{b}', '{}', null, '{{\"mimetype\":\"application/x-directory\"}}'::jsonb)\n         ON CONFLICT DO NOTHING", lit(&full));
                self.run_sql(sql, format!("Folder \"{name}\" created."), cx, |_, _| {});
            }
            DialogKind::RenameFolder => {
                let Some(target) = self.target.clone() else { return };
                let base = path_segments(&target)[..path_segments(&target).len().saturating_sub(1)].join("/");
                let name = value.trim().trim_matches('/').to_string();
                if name.is_empty() {
                    Toast::error("Folder name is required.").show(cx);
                    return;
                }
                if name.contains('/') {
                    Toast::error("Folder name cannot contain slashes.").show(cx);
                    return;
                }
                let new_path = join_path(&[&base, &name]);
                if new_path == target {
                    self.close_dialog(cx);
                    return;
                }
                let safe_old = escape_like(&lit(&target));
                let old_len = target.chars().count() + 1;
                let sql = format!(
                    "UPDATE storage.objects\n         SET name = '{}/' || substring(name from {}),\n             updated_at = now()\n         WHERE bucket_id = '{b}'\n           AND (name = '{}' OR name LIKE '{safe_old}/%' ESCAPE '\\')",
                    lit(&new_path),
                    old_len + 1,
                    lit(&target)
                );
                self.run_sql(sql, format!("Folder renamed to \"{name}\"."), cx, move |this, cx| {
                    if this.path == target || this.path.starts_with(&format!("{target}/")) {
                        let next = format!("{new_path}{}", &this.path[target.len()..]);
                        this.navigate_to(next, cx);
                    }
                });
            }
            DialogKind::RenameFile => {
                let Some(target) = self.target.clone() else { return };
                let segs = path_segments(&target);
                let dir = segs[..segs.len().saturating_sub(1)].join("/");
                let name = value.trim().to_string();
                if name.is_empty() {
                    Toast::error("File name is required.").show(cx);
                    return;
                }
                if name.contains('/') {
                    Toast::error("File name cannot contain slashes — use Move to change folders.").show(cx);
                    return;
                }
                let new_path = join_path(&[&dir, &name]);
                if new_path == target {
                    self.close_dialog(cx);
                    return;
                }
                self.rename_object(target, new_path, "File renamed.".into(), cx);
            }
            DialogKind::Move => {
                let Some(target) = self.target.clone() else { return };
                let file = target.rsplit('/').next().unwrap_or(&target).to_string();
                let dir = value.trim().trim_matches('/').to_string();
                if dir.contains("//") {
                    Toast::error("Invalid directory path.").show(cx);
                    return;
                }
                let new_path = join_path(&[&dir, &file]);
                if new_path == target {
                    self.close_dialog(cx);
                    return;
                }
                let msg = format!("Moved to {new_path}.");
                self.rename_object(target, new_path, msg, cx);
            }
            DialogKind::Settings => {}
        }
    }

    /// `renameObjectPath`: refuse when the destination exists, then UPDATE.
    fn rename_object(&mut self, old: String, new: String, ok: String, cx: &mut Context<Self>) {
        self.busy = true;
        cx.notify();
        let driver = self.session.driver.clone();
        let b = lit(&self.bucket_name);
        let (so, sn) = (lit(&old), lit(&new));
        ui::run(
            cx,
            async move {
                let exists = exec(&driver, format!("SELECT 1 AS one FROM storage.objects WHERE bucket_id = '{b}' AND name = '{sn}' LIMIT 1")).await.map_err(|e| anyhow::anyhow!("{e:#}"))?;
                if !exists.rows.is_empty() {
                    anyhow::bail!("A file already exists at the destination path.");
                }
                exec(&driver, format!("UPDATE storage.objects SET name = '{sn}', updated_at = now()\n       WHERE bucket_id = '{b}' AND name = '{so}'")).await
            },
            move |this, r, cx| {
                this.busy = false;
                match r {
                    Ok(_) => {
                        Toast::success(ok).show(cx);
                        this.close_dialog(cx);
                        if this.selected.as_ref().is_some_and(|(p, _)| *p == old) {
                            this.selected = None;
                        }
                        this.load(cx);
                    }
                    Err(e) => {
                        Toast::error(ui::err_text(&e)).show(cx);
                    }
                }
            },
        );
    }

    fn close_dialog(&mut self, cx: &mut Context<Self>) {
        if let Some((_, id)) = self.dialog.take() {
            rexa_ui::close_overlay(id, cx);
        }
        self.target = None;
    }

    fn delete_folder(&mut self, folder: String, cx: &mut Context<Self>) {
        let opts = ConfirmOptions::destructive("Delete folder").description(format!("Delete \"{folder}\" and all of its contents? This cannot be undone.")).confirm_text("Delete");
        ui::confirm_then(cx, opts, move |this, cx| {
            let b = lit(&this.bucket_name);
            let sql = format!("DELETE FROM storage.objects\n         WHERE bucket_id = '{b}'\n           AND (name = '{}' OR name LIKE '{}/%' ESCAPE '\\')", lit(&folder), escape_like(&lit(&folder)));
            this.run_sql(sql, "Folder deleted.".into(), cx, move |this, cx| {
                if this.path == folder || this.path.starts_with(&format!("{folder}/")) {
                    this.navigate_to(parent_path(&folder), cx);
                }
            });
        });
    }

    fn delete_file(&mut self, full: String, cx: &mut Context<Self>) {
        let opts = ConfirmOptions::destructive("Delete file").description(format!("Delete \"{full}\"? This cannot be undone.")).confirm_text("Delete");
        ui::confirm_then(cx, opts, move |this, cx| {
            let sql = format!("DELETE FROM storage.objects WHERE bucket_id = '{}' AND name = '{}'", lit(&this.bucket_name), lit(&full));
            this.run_sql(sql, "File deleted.".into(), cx, move |this, _| {
                if this.selected.as_ref().is_some_and(|(p, _)| *p == full) {
                    this.selected = None;
                }
            });
        });
    }

    fn get_url(&mut self, full: String, cx: &mut Context<Self>) {
        if let Some(url) = self.file_public_url(&full) {
            ui::copy(url, "Public URL copied.", cx);
            return;
        }
        if self.info.is_none() {
            Toast::message("Public URL is only available for public buckets.").show(cx);
            return;
        }
        // Private bucket: a signed URL valid for one hour (native addition).
        let (info, bucket) = (self.info.clone(), self.bucket_name.clone());
        ui::run(cx, async move { storage_api(info).await?.signed_url(&bucket, &full, 3600).await }, |_, r, cx| match r {
            Ok(url) => ui::copy(url, "Signed URL copied (valid for 1 hour).", cx),
            Err(_) => {
                Toast::message("Public URL is only available for public buckets.").show(cx);
            }
        });
    }

    fn download_file(&mut self, full: String, cx: &mut Context<Self>) {
        let public = self.file_public_url(&full);
        if public.is_none() && self.info.is_none() {
            Toast::message("Download requires a public bucket URL or the Storage API.").show(cx);
            return;
        }
        let file_name = full.rsplit('/').next().unwrap_or(&full).to_string();
        let dir = std::env::var("HOME").map(|h| std::path::PathBuf::from(h).join("Downloads")).unwrap_or_default();
        let prompt = cx.prompt_for_new_path(&dir, Some(&file_name));
        let (info, bucket) = (self.info.clone(), self.bucket_name.clone());
        cx.spawn(async move |_, cx| {
            let Ok(Ok(Some(dest))) = prompt.await else { return };
            let task = rexa_core::runtime::spawn(async move {
                let bytes = match public {
                    Some(url) => {
                        let res = supabase::http().get(url).send().await?;
                        if !res.status().is_success() {
                            anyhow::bail!("Download failed ({})", res.status().as_u16());
                        }
                        res.bytes().await?.to_vec()
                    }
                    None => storage_api(info).await?.download(&bucket, &full).await?,
                };
                tokio::fs::write(&dest, bytes).await?;
                Ok(dest)
            });
            let r = task.await;
            cx.update(|cx| match r {
                Ok(p) => {
                    Toast::success(format!("Downloaded {}.", p.file_name().and_then(|n| n.to_str()).unwrap_or("file"))).show(cx);
                }
                Err(e) => {
                    Toast::error(ui::err_text(&e)).show(cx);
                }
            });
        })
        .detach();
    }

    fn download_folder(&mut self, folder: String, cx: &mut Context<Self>) {
        let files: Vec<String> = list_folder_entries(&self.objects, &folder).into_iter().filter_map(|e| matches!(e, Entry::File(..)).then(|| join_path(&[&folder, e.name()]))).collect();
        if files.is_empty() {
            Toast::message("Folder is empty — nothing to download.").show(cx);
            return;
        }
        if !self.bucket.as_ref().is_some_and(|b| b.public) || self.public_url_base().is_none() {
            Toast::message("Folder download requires a public bucket. Make the bucket public or download files individually from the preview panel.").show(cx);
            return;
        }
        let limited: Vec<String> = files.iter().take(25).cloned().collect();
        if files.len() > limited.len() {
            Toast::message(format!("Downloading the first {} of {} files.", limited.len(), files.len())).show(cx);
        }
        let urls: Vec<(String, String)> = limited.iter().filter_map(|f| Some((f.rsplit('/').next()?.to_string(), self.file_public_url(f)?))).collect();
        let dir = std::env::var("HOME").map(|h| std::path::PathBuf::from(h).join("Downloads")).unwrap_or_default();
        ui::run(
            cx,
            async move {
                let mut n = 0;
                for (name, url) in urls {
                    let res = supabase::http().get(url).send().await?;
                    if res.status().is_success() {
                        tokio::fs::write(dir.join(&name), res.bytes().await?).await?;
                        n += 1;
                    }
                }
                Ok(n)
            },
            |_, r, cx| match r {
                Ok(n) => {
                    Toast::success(format!("Downloaded {n} files to Downloads.")).show(cx);
                }
                Err(e) => {
                    Toast::error(ui::err_text(&e)).show(cx);
                }
            },
        );
    }

    /// Upload files picked in a native dialog (native addition; the original
    /// showed the "requires the Storage API" message only).
    fn upload(&mut self, cx: &mut Context<Self>) {
        if self.info.is_none() {
            Toast::message("File upload requires the Storage API (service role). Use the Supabase client or dashboard to upload binary files.").show(cx);
            return;
        }
        let prompt = cx.prompt_for_paths(gpui::PathPromptOptions { files: true, directories: false, multiple: true, prompt: Some("Upload".into()) });
        let (info, bucket, dir) = (self.info.clone(), self.bucket_name.clone(), self.path.clone());
        cx.spawn(async move |this, cx| {
            let Ok(Ok(Some(paths))) = prompt.await else { return };
            this.update(cx, |v, cx| {
                v.uploading = true;
                cx.notify();
            })
            .ok();
            let task = rexa_core::runtime::spawn(async move {
                let api = storage_api(info).await.map_err(|_| anyhow::anyhow!("File upload requires the Storage API (service role). Use the Supabase client or dashboard to upload binary files."))?;
                let mut n = 0usize;
                for p in paths {
                    let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("file").to_string();
                    let bytes = tokio::fs::read(&p).await?;
                    api.upload(&bucket, &join_path(&[&dir, &name]), bytes, mime_for(&p)).await?;
                    n += 1;
                }
                Ok(n)
            });
            let r = task.await;
            this.update(cx, |v, cx| {
                v.uploading = false;
                match r {
                    Ok(n) => {
                        Toast::success(if n == 1 { "Uploaded 1 file.".to_string() } else { format!("Uploaded {n} files.") }).show(cx);
                        v.load(cx);
                    }
                    Err(e) => {
                        Toast::error(ui::err_text(&e)).show(cx);
                    }
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    fn toggle_public(&mut self, cx: &mut Context<Self>) {
        let Some(b) = self.bucket.clone() else { return };
        let s = lit(&self.bucket_name);
        let sql = format!("UPDATE storage.buckets SET public = {}, updated_at = now()\n         WHERE id = '{s}' OR name = '{s}'", !b.public);
        let msg = if b.public { "Bucket is now private." } else { "Bucket is now public." };
        self.run_sql(sql, msg.into(), cx, |_, cx| notify_buckets_changed(cx));
    }

    fn delete_bucket(&mut self, cx: &mut Context<Self>) {
        let name = self.bucket_name.clone();
        let opts = ConfirmOptions::destructive("Delete bucket").description(format!("Delete bucket \"{name}\" and all of its objects? This cannot be undone.")).confirm_text("Delete");
        ui::confirm_then(cx, opts, move |this, cx| {
            this.deleting = true;
            cx.notify();
            let driver = this.session.driver.clone();
            let s = lit(&name);
            ui::run(
                cx,
                async move {
                    exec(&driver, format!("DELETE FROM storage.objects WHERE bucket_id = '{s}'")).await?;
                    exec(&driver, format!("DELETE FROM storage.buckets WHERE id = '{s}' OR name = '{s}'")).await
                },
                move |this, r, cx| {
                    this.deleting = false;
                    match r {
                        Ok(_) => {
                            Toast::success(format!("Bucket \"{name}\" deleted.")).show(cx);
                            notify_buckets_changed(cx);
                            open_simple("storage-files", cx);
                        }
                        Err(e) => {
                            Toast::error(ui::err_text(&e)).show(cx);
                        }
                    }
                },
            );
        });
    }

    fn add_mime(&mut self, cx: &mut Context<Self>) {
        let v = self.mime_draft.read(cx).value().trim().trim_end_matches(',').trim().to_lowercase();
        if !v.is_empty() && !self.mime_types.contains(&v) {
            self.mime_types.push(v);
        }
        self.clear_mime_draft = true;
        cx.notify();
    }

    fn open_settings(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.sync_settings_from_bucket(cx);
        self.apply_pending_inputs(window, cx);
        let weak = cx.entity().downgrade();
        let (size, draft) = (self.size_limit.clone(), self.mime_draft.clone());
        let id = rexa_ui::open_dialog(cx, move |window, cx| {
            let Some(view) = weak.upgrade() else { return Dialog::new() };
            view.update(cx, |v, cx| v.apply_pending_inputs(window, cx));
            let (public, mimes, busy) = { let v = view.read(cx); (v.is_public, v.mime_types.clone(), v.busy) };
            let t = cx.tokens().clone();
            let (v1, v2) = (view.clone(), view.clone());
            let chips = mimes.iter().map(|m| {
                let (m2, vv) = (m.clone(), view.clone());
                div()
                    .flex()
                    .items_center()
                    .gap_1()
                    .tw_rounded_md()
                    .bg(t.muted)
                    .px_2()
                    .py(px(2.))
                    .tw_text_xs()
                    .child(m.clone())
                    .child(div().id(SharedString::from(format!("rm-mime-{m}"))).cursor_pointer().on_click(move |_, _, cx| vv.update(cx, |s, cx| { s.mime_types.retain(|x| *x != m2); cx.notify(); })).child(Icon::new(IconName::X).size(px(12.)).text_color(t.muted_foreground)))
            });
            Dialog::new()
                .max_w(448.)
                .title("Bucket settings")
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .gap_4()
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .justify_between()
                                .gap_3()
                                .tw_rounded_lg()
                                .border_1()
                                .border_color(t.border)
                                .px_3()
                                .py(px(10.))
                                .child(div().child(div().tw_text_sm().font_weight(FontWeight::MEDIUM).child("Public bucket")).child(div().tw_text_xs().text_color(t.muted_foreground).child("Anyone can access objects without a signed URL when public.")))
                                .child(Switch::new("bs-public").checked(public).on_change(move |v, _, cx| v1.update(cx, |s, cx| { s.is_public = v; cx.notify(); }))),
                        )
                        .child(div().flex().flex_col().gap(px(6.)).child(div().tw_text_sm().font_weight(FontWeight::MEDIUM).child("File size limit (MB)")).child(TextInput::new(&size).h(36.).suffix(div().tw_text_xs().text_color(t.muted_foreground).child("MB"))))
                        .child(
                            div().flex().flex_col().gap(px(6.)).child(div().tw_text_sm().font_weight(FontWeight::MEDIUM).child("Allowed MIME types")).child(
                                div()
                                    .flex()
                                    .flex_wrap()
                                    .items_center()
                                    .gap(px(6.))
                                    .min_h_9()
                                    .tw_rounded_lg()
                                    .border_1()
                                    .border_color(t.border)
                                    .bg(t.background)
                                    .px_2()
                                    .py(px(6.))
                                    .children(chips)
                                    .child(div().flex_1().min_w(px(100.)).tw_text_xs().child(TextInput::new(&draft).h(24.))),
                            ),
                        ),
                )
                .footer(
                    div()
                        .flex()
                        .justify_end()
                        .gap_2()
                        .child(Button::new("bs-cancel").ghost().size(ButtonSize::Sm).label("Cancel").disabled(busy).on_click(|_, _, cx| rexa_ui::close_top(cx)))
                        .child(Button::new("bs-save").size(ButtonSize::Sm).label(if busy { "Saving…" } else { "Save" }).disabled(busy).on_click(move |_, _, cx| v2.update(cx, |s, cx| s.save_configuration(cx)))),
                )
        });
        self.dialog = Some((DialogKind::Settings, id));
    }

    /// Input values set outside a render pass (need a `Window`).
    fn apply_pending_inputs(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(v) = self.pending_size_limit.take() {
            self.size_limit.update(cx, |s, cx| s.set_value(v, window, cx));
        }
        if std::mem::take(&mut self.clear_mime_draft) {
            self.mime_draft.update(cx, |s, cx| s.set_value("", window, cx));
        }
    }

    fn save_configuration(&mut self, cx: &mut Context<Self>) {
        if self.bucket.is_none() || self.busy {
            return;
        }
        self.add_mime(cx);
        let s = lit(&self.bucket_name);
        let raw = self.size_limit.read(cx).value().trim().to_string();
        let limit = if raw.is_empty() { "NULL".to_string() } else { ((raw.parse::<f64>().unwrap_or(0.).max(0.) as i64) * 1024 * 1024).to_string() };
        let mimes = if self.mime_types.is_empty() { "NULL".to_string() } else { format!("ARRAY[{}]::text[]", self.mime_types.iter().map(|t| format!("'{}'", lit(t))).collect::<Vec<_>>().join(",")) };
        let sql = format!("UPDATE storage.buckets\n         SET public = {},\n             file_size_limit = {limit},\n             allowed_mime_types = {mimes},\n             updated_at = now()\n         WHERE id = '{s}' OR name = '{s}'", self.is_public);
        self.run_sql(sql, "Bucket configuration saved.".into(), cx, |_, cx| notify_buckets_changed(cx));
    }

    fn row_menu(&self, id: String, build: impl Fn(Menu) -> Menu + 'static, cx: &App) -> AnyElement {
        let t = cx.tokens().clone();
        let group = SharedString::from(format!("row-{id}"));
        div()
            .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
            .on_mouse_up(MouseButton::Left, |_, _, cx| cx.stop_propagation())
            .child(
                DropdownMenu::new(SharedString::from(format!("menu-{id}")))
                    .align(Align::End)
                    .trigger_with(move |open| {
                        // `opacity-0 group-hover/row:opacity-100 data-[state=open]:opacity-100`
                        div()
                            .size_6()
                            .flex()
                            .flex_shrink_0()
                            .items_center()
                            .justify_center()
                            .tw_rounded_md()
                            .text_color(t.muted_foreground)
                            .when(!open, |d| d.opacity(0.).group_hover(group.clone(), |s| s.opacity(1.)))
                            .hover(|d| d.bg(rexa_ui::white(0.1)).text_color(t.foreground))
                            .child(Icon::new(IconName::Ellipsis).size(px(14.)))
                    })
                    .menu(move |m, _, _| build(m.w(208.))),
            )
            .into_any_element()
    }

    fn folder_menu(&self, folder: String, name: String, cx: &mut Context<Self>) -> AnyElement {
        let w = cx.entity().downgrade();
        let bucket = self.bucket_name.clone();
        let f = folder.clone();
        self.row_menu(folder, move |m| {
            let (w1, w2, w4) = (w.clone(), w.clone(), w.clone());
            let (f1, f2, f3, f4, n1, b) = (f.clone(), f.clone(), f.clone(), f.clone(), name.clone(), bucket.clone());
            m.item(MenuItem::new("Rename").icon(IconName::Pencil).on_select(move |win, cx| {
                let (f, n) = (f1.clone(), n1.clone());
                w1.update(cx, |v, cx| v.open_prompt(DialogKind::RenameFolder, Some(f), n, win, cx)).ok();
            }))
            .item(MenuItem::new("Download").icon(IconName::Download).on_select(move |_, cx| {
                let f = f2.clone();
                w2.update(cx, |v, cx| v.download_folder(f, cx)).ok();
            }))
            .item(MenuItem::new("Copy path to folder").icon(IconName::Copy).on_select(move |_, cx| ui::copy(format!("{b}/{f3}"), "Folder path copied.", cx)))
            .separator()
            .item(MenuItem::new("Delete").icon(IconName::Trash).destructive().on_select(move |_, cx| {
                let f = f4.clone();
                w4.update(cx, |v, cx| v.delete_folder(f, cx)).ok();
            }))
        }, cx)
    }

    fn file_menu(&self, full: String, name: String, cx: &mut Context<Self>) -> AnyElement {
        let w = cx.entity().downgrade();
        let f = full.clone();
        self.row_menu(full, move |m| {
            let (w1, w2, w3, w4, w5) = (w.clone(), w.clone(), w.clone(), w.clone(), w.clone());
            let (f1, f2, f3, f4, f5, n) = (f.clone(), f.clone(), f.clone(), f.clone(), f.clone(), name.clone());
            m.item(MenuItem::new("Get URL").icon(IconName::Copy).on_select(move |_, cx| {
                let f = f1.clone();
                w1.update(cx, |v, cx| v.get_url(f, cx)).ok();
            }))
            .item(MenuItem::new("Download").icon(IconName::Download).on_select(move |_, cx| {
                let f = f2.clone();
                w2.update(cx, |v, cx| v.download_file(f, cx)).ok();
            }))
            .item(MenuItem::new("Rename").icon(IconName::Pencil).on_select(move |win, cx| {
                let (f, n) = (f3.clone(), n.clone());
                w3.update(cx, |v, cx| v.open_prompt(DialogKind::RenameFile, Some(f), n, win, cx)).ok();
            }))
            .item(MenuItem::new("Move").icon(IconName::Move).on_select(move |win, cx| {
                let f = f4.clone();
                w4.update(cx, |v, cx| v.open_prompt(DialogKind::Move, Some(f), String::new(), win, cx)).ok();
            }))
            .separator()
            .item(MenuItem::new("Delete").icon(IconName::Trash).destructive().on_select(move |_, cx| {
                let f = f5.clone();
                w5.update(cx, |v, cx| v.delete_file(f, cx)).ok();
            }))
        }, cx)
    }

    fn render_preview(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
        let (full, obj) = self.selected.clone()?;
        let t = cx.tokens().clone();
        let mime = object_mime(obj.metadata.as_ref());
        let is_image = mime.starts_with("image/");
        let size = ui::format_bytes(object_size(obj.metadata.as_ref()));
        let name = full.rsplit('/').next().unwrap_or(&full).to_string();
        let preview: AnyElement = match (&self.preview_url, is_image) {
            (Some(url), true) => img(SharedString::from(url.clone())).max_w_full().max_h_full().object_fit(gpui::ObjectFit::Contain).with_fallback(move || Icon::new(IconName::File).size(px(48.)).text_color(with_alpha(t.muted_foreground, 0.5)).into_any_element()).into_any_element(),
            _ => Icon::new(IconName::File).size(px(48.)).text_color(with_alpha(t.muted_foreground, 0.5)).into_any_element(),
        };
        let t = cx.tokens().clone();
        let meta = |label: &'static str, value: String| div().child(div().text_color(t.muted_foreground).child(label)).child(div().mt(px(2.)).text_color(t.foreground).child(value));
        let body = div()
            .px_5()
            .pb_6()
            .pt_4()
            .child(div().w_full().h(px(380.)).flex().items_center().justify_center().overflow_hidden().tw_rounded_lg().border_1().border_color(t.border).bg(with_alpha(t.muted, 0.2)).child(preview))
            .child(div().mt_4().tw_text_sm().font_weight(FontWeight::MEDIUM).text_color(t.foreground).child(full.clone()))
            .child(div().mt_1().tw_text_xs().text_color(t.muted_foreground).child(format!("{mime} - {size}")))
            .child(
                div()
                    .mt_5()
                    .flex()
                    .flex_col()
                    .gap_3()
                    .tw_text_xs()
                    .child(meta("Added on", obj.created_at.as_deref().map(ui::date_locale).unwrap_or_else(|| "—".into())))
                    .child(meta("Last modified", obj.updated_at.as_deref().map(ui::date_locale).unwrap_or_else(|| "—".into()))),
            )
            .into_any_element();
        let (f1, f2, f3) = (full.clone(), full.clone(), full.clone());
        let footer = div()
            .flex()
            .w_full()
            .items_center()
            .child(
                div()
                    .mr_auto()
                    .flex()
                    .items_center()
                    .gap_1()
                    .child(Button::new("pv-dl").outline().size(ButtonSize::Xs).icon(IconName::Download).label("Download").on_click(cx.listener(move |this, _, _, cx| this.download_file(f1.clone(), cx))))
                    .child(Button::new("pv-url").outline().size(ButtonSize::Xs).icon(IconName::Copy).label("Get URL").on_click(cx.listener(move |this, _, _, cx| this.get_url(f2.clone(), cx)))),
            )
            .child(Button::new("pv-del").outline().size(ButtonSize::Xs).icon(IconName::Trash).label("Delete file").colors(gpui::transparent_black(), t.muted, t.destructive).on_click(cx.listener(move |this, _, _, cx| this.delete_file(f3.clone(), cx))))
            .into_any_element();
        let w = cx.entity().downgrade();
        Some(ui::studio_sheet("storage-preview", name, body, Some(footer), move |_, cx| { w.update(cx, |v, cx| { v.selected = None; cx.notify(); }).ok(); }, cx))
    }
}

fn escape_like(s: &str) -> String {
    s.replace('%', "\\%").replace('_', "\\_")
}

impl Render for StorageBucketView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        self.apply_pending_inputs(window, cx);
        let t = cx.tokens().clone();
        let crumbs = path_segments(&self.path);
        let parent = parent_path(&self.path);
        let current = crumbs.last().cloned();
        let q = self.search.read(cx).value().trim().to_lowercase();
        let scope = current.clone().unwrap_or_else(|| self.bucket_name.clone());
        let placeholder = format!("Search in {scope}…");
        if self.last_placeholder != placeholder {
            self.last_placeholder = placeholder.clone();
            self.search.update(cx, |s, cx| s.set_placeholder(placeholder, window, cx));
        }
        let folders_at_parent: Vec<String> = list_folder_entries(&self.objects, &parent).into_iter().filter_map(|e| match e { Entry::Folder(n) => Some(n), _ => None }).filter(|n| q.is_empty() || n.to_lowercase().contains(&q)).collect();
        let entries: Vec<Entry> = list_folder_entries(&self.objects, &self.path).into_iter().filter(|e| !self.path.is_empty() || matches!(e, Entry::File(..))).filter(|e| q.is_empty() || e.name().to_lowercase().contains(&q)).collect();
        let public = self.bucket.as_ref().is_some_and(|b| b.public);

        // ---- breadcrumb header
        let chevron = || Icon::new(IconName::ChevronRight).size(px(14.)).text_color(with_alpha(t.muted_foreground, 0.5));
        let crumb_link = |id: String, label: String, strong: bool| {
            div().id(SharedString::from(id)).flex_shrink_0().cursor_pointer().when(strong, |d| d.font_weight(FontWeight::MEDIUM).text_color(t.foreground)).when(!strong, |d| d.text_color(t.muted_foreground)).hover(|d| d.text_color(t.foreground)).child(label)
        };
        let mut trail = div()
            .flex()
            .min_w_0()
            .flex_wrap()
            .items_center()
            .gap_x(px(6.))
            .gap_y_1()
            .tw_text_sm()
            .child(crumb_link("cr-files".into(), "Files".into(), false).on_click(|_, _, cx| open_simple("storage-files", cx)))
            .child(chevron())
            .child(crumb_link("cr-buckets".into(), "Buckets".into(), false).on_click(|_, _, cx| open_simple("storage-files", cx)))
            .child(chevron())
            .child(crumb_link("cr-bucket".into(), self.bucket_name.clone(), true).on_click(cx.listener(|this, _, _, cx| this.navigate_to(String::new(), cx))));
        for (i, seg) in crumbs.iter().enumerate() {
            let target = crumbs[..=i].join("/");
            trail = trail.child(chevron()).child(crumb_link(format!("cr-{i}"), seg.clone(), false).on_click(cx.listener(move |this, _, _, cx| this.navigate_to(target.clone(), cx))));
        }
        let pill = |label: &'static str, amber: bool| {
            div()
                .ml_1()
                .flex_shrink_0()
                .rounded_full()
                .border_1()
                .px_2()
                .py(px(2.))
                .text_size(px(10.))
                .line_height(px(15.))
                .font_weight(FontWeight::MEDIUM)
                .when(amber, |d| d.border_color(with_alpha(tw("amber-400"), 0.4)).bg(with_alpha(tw("amber-400"), 0.1)).text_color(tw("amber-300")))
                .when(!amber, |d| d.border_color(t.border).text_color(t.muted_foreground))
                .child(rexa_ui::tracked_text::tracked(label, 0.025))
        };
        trail = trail.child(if public { pill("PUBLIC", true) } else { pill("PRIVATE", false) });
        let w = cx.entity().downgrade();
        let (w1, w2, w3) = (w.clone(), w.clone(), w.clone());
        let deleting = self.deleting;
        let policies_btn = Button::new("sb-policies")
            .outline()
            .size(ButtonSize::Sm)
            .icon(IconName::Shield)
            .label("Policies")
            .when_some(self.policy_count, |b, n| b.child(div().ml(px(6.)).tw_rounded_md().bg(t.muted).px(px(6.)).py(px(2.)).text_size(px(11.)).text_color(t.muted_foreground).child(n.to_string())))
            .on_click(|_, _, cx| open_simple("storage-policies", cx));
        let edit = DropdownMenu::new("sb-edit")
            .align(Align::End)
            .trigger(Button::new("sb-edit-btn").outline().size(ButtonSize::Sm).icon(IconName::Pencil).label("Edit bucket").icon_end(IconName::ChevronDown))
            .menu(move |m, _, _| {
                let (w1, w2, w3) = (w1.clone(), w2.clone(), w3.clone());
                m.w(208.)
                    .item(MenuItem::new("Bucket settings…").on_select(move |win, cx| { w1.update(cx, |v, cx| v.open_settings(win, cx)).ok(); }))
                    .item(MenuItem::new(if public { "Make private" } else { "Make public" }).on_select(move |_, cx| { w2.update(cx, |v, cx| v.toggle_public(cx)).ok(); }))
                    .separator()
                    .item(MenuItem::new(if deleting { "Deleting…" } else { "Delete bucket…" }).icon(IconName::Trash).destructive().disabled(deleting).on_select(move |_, cx| { w3.update(cx, |v, cx| v.delete_bucket(cx)).ok(); }))
            });
        let header = div()
            .flex()
            .flex_shrink_0()
            .items_center()
            .justify_between()
            .gap_4()
            .border_b_1()
            .border_color(t.border)
            .px_6()
            .py_3()
            .child(trail)
            .child(div().flex().flex_shrink_0().items_center().gap_2().child(policies_btn).child(edit));

        // ---- toolbar
        let toolbar = div()
            .flex()
            .flex_shrink_0()
            .items_center()
            .justify_between()
            .gap_3()
            .border_b_1()
            .border_color(t.border)
            .px_6()
            .py(px(10.))
            .child(div().w_full().max_w(px(384.)).child(ui::search_box(&self.search, 32., cx)))
            .child(
                div()
                    .flex()
                    .flex_shrink_0()
                    .items_center()
                    .gap_2()
                    .child(Button::new("sb-refresh").outline().size(ButtonSize::IconSm).icon(IconName::RefreshCw).on_click(cx.listener(|this, _, _, cx| this.reload(cx))))
                    .child(Button::new("sb-folder").outline().size(ButtonSize::Sm).icon(IconName::FolderPlus).label("Create folder").on_click(cx.listener(|this, _, w, cx| this.open_prompt(DialogKind::Folder, None, String::new(), w, cx))))
                    .child(Button::new("sb-upload").size(ButtonSize::Sm).icon(IconName::Upload).label(if self.uploading { "Uploading…" } else { "Upload files" }).disabled(self.uploading).on_click(cx.listener(|this, _, _, cx| this.upload(cx)))),
            );

        // ---- columns
        let row = |id: String, active: bool| {
            div()
                .id(SharedString::from(id.clone()))
                .group(SharedString::from(format!("row-{}", id.trim_start_matches("f:").trim_start_matches("d:").trim_start_matches("p:"))))
                .flex()
                .h_10()
                .w_full()
                .flex_shrink_0()
                .cursor_pointer()
                .items_center()
                .gap_2()
                .border_b_1()
                .border_color(t.border)
                .px_4()
                .tw_text_xs()
                .hover(|d| d.bg(with_alpha(t.muted, 0.6)))
                .when(active, |d| d.bg(t.muted))
        };
        let placeholder_msg = |text: &'static str| div().px_4().py_8().text_center().tw_text_xs().text_color(t.muted_foreground).child(text).into_any_element();
        let loading_first = self.loading && self.objects.is_empty();
        let folders_col: Vec<AnyElement> = if loading_first {
            vec![placeholder_msg("Loading…")]
        } else if folders_at_parent.is_empty() {
            vec![placeholder_msg(if q.is_empty() { "No folders" } else { "No matching folders" })]
        } else {
            folders_at_parent
                .iter()
                .map(|name| {
                    let full = join_path(&[&parent, name]);
                    let active = full == self.path;
                    let menu = self.folder_menu(full.clone(), name.clone(), cx);
                    let target = full.clone();
                    row(format!("p:{full}"), active)
                        .on_click(cx.listener(move |this, _, _, cx| this.navigate_to(target.clone(), cx)))
                        .child(Icon::new(IconName::Folder).size(px(16.)).text_color(if active { tw("amber-400") } else { t.muted_foreground }))
                        .child(div().flex_1().min_w_0().truncate().font_weight(FontWeight::MEDIUM).text_color(t.foreground).child(name.clone()))
                        .child(menu)
                        .into_any_element()
                })
                .collect()
        };
        let files_col: AnyElement = if loading_first {
            placeholder_msg("Loading…")
        } else if entries.is_empty() {
            let title = if !q.is_empty() { "No matching files" } else if !self.path.is_empty() { "This folder is empty" } else { "No files in this bucket" };
            let desc = if !q.is_empty() { "Try a different search term." } else { "This bucket is empty. Upload a file or create a folder to get started." };
            div()
                .p_6()
                .child(
                    div()
                        .tw_rounded_xl()
                        .border_1()
                        .border_dashed()
                        .border_color(t.border)
                        .p_10()
                        .flex()
                        .flex_col()
                        .items_center()
                        .text_center()
                        .child(Icon::new(IconName::Folder).size(px(32.)).text_color(with_alpha(t.muted_foreground, 0.5)))
                        .child(div().mt_3().tw_text_sm().font_weight(FontWeight::MEDIUM).text_color(t.foreground).child(title))
                        .child(div().mt_1().max_w(px(384.)).tw_text_sm().text_color(t.muted_foreground).child(desc))
                        .when(q.is_empty(), |d| {
                            d.child(
                                div()
                                    .mt_4()
                                    .flex()
                                    .justify_center()
                                    .gap_2()
                                    .child(Button::new("sb-empty-folder").outline().size(ButtonSize::Sm).icon(IconName::FolderPlus).label("Create folder").on_click(cx.listener(|this, _, w, cx| this.open_prompt(DialogKind::Folder, None, String::new(), w, cx))))
                                    .child(Button::new("sb-empty-upload").size(ButtonSize::Sm).icon(IconName::Upload).label("Upload files").on_click(cx.listener(|this, _, _, cx| this.upload(cx)))),
                            )
                        }),
                )
                .into_any_element()
        } else {
            let rows: Vec<AnyElement> = entries
                .iter()
                .map(|e| {
                    let full = join_path(&[&self.path, e.name()]);
                    match e {
                        Entry::Folder(name) => {
                            let menu = self.folder_menu(full.clone(), name.clone(), cx);
                            let target = full.clone();
                            row(format!("d:{full}"), false)
                                .on_click(cx.listener(move |this, _, _, cx| this.navigate_to(target.clone(), cx)))
                                .child(Icon::new(IconName::Folder).size(px(16.)).text_color(t.muted_foreground))
                                .child(div().flex_1().min_w_0().truncate().font_weight(FontWeight::MEDIUM).text_color(t.foreground).child(name.clone()))
                                .child(menu)
                                .into_any_element()
                        }
                        Entry::File(name, obj) => {
                            let active = self.selected.as_ref().is_some_and(|(p, _)| *p == full);
                            let is_img = object_mime(obj.metadata.as_ref()).starts_with("image/");
                            let menu = self.file_menu(full.clone(), name.clone(), cx);
                            let (f, o) = (full.clone(), obj.clone());
                            row(format!("f:{full}"), active)
                                .on_click(cx.listener(move |this, _, _, cx| this.select_file(f.clone(), o.clone(), cx)))
                                .child(Icon::new(if is_img { IconName::Image } else { IconName::File }).size(px(16.)).text_color(t.muted_foreground))
                                .child(div().flex_1().min_w_0().truncate().font_weight(FontWeight::MEDIUM).text_color(t.foreground).child(name.clone()))
                                .child(menu)
                                .into_any_element()
                        }
                    }
                })
                .collect();
            div().flex().flex_col().children(rows).into_any_element()
        };
        let preview = self.render_preview(cx);
        div()
            .size_full()
            .flex()
            .flex_col()
            .overflow_hidden()
            .bg(t.studio_bg)
            .text_color(t.foreground)
            .child(header)
            .child(toolbar)
            .child(
                div()
                    .flex()
                    .flex_1()
                    .min_h_0()
                    .overflow_hidden()
                    .child(div().w(px(240.)).flex_shrink_0().flex().flex_col().overflow_hidden().border_r_1().border_color(t.border).child(div().id("sb-folders").flex_1().min_h_0().overflow_y_scroll().children(folders_col)))
                    .child(div().flex().flex_1().min_w_0().flex_col().overflow_hidden().child(div().id("sb-files").flex_1().min_h_0().overflow_y_scroll().child(files_col)))
                    .children(preview),
            )
    }
}

// ---- storage-policies-view ---------------------------------------------------------------

#[derive(Clone, Debug)]
struct Policy {
    table_name: String,
    name: String,
    permissive: String,
    command: String,
    using: String,
}

const POLICY_TEMPLATES: [(&str, &str, &str); 4] = [
    ("SELECT", "Select policy for bucket", "Allow SELECT for buckets matching a given condition"),
    ("INSERT", "Insert policy for bucket", "Allow INSERT for buckets matching a given condition"),
    ("UPDATE", "Update policy for bucket", "Allow UPDATE for buckets matching a given condition"),
    ("DELETE", "Delete policy for bucket", "Allow DELETE for buckets matching a given condition"),
];

const POLICIES_SQL: &str = "SELECT
           n.nspname AS schema,
           c.relname AS table_name,
           p.polname AS name,
           CASE p.polpermissive WHEN true THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END AS permissive,
           COALESCE(
             (SELECT array_agg(r.rolname::text)
              FROM pg_roles r
              WHERE r.oid = ANY (p.polroles)),
             ARRAY['public']::text[]
           ) AS roles,
           CASE p.polcmd
             WHEN 'r' THEN 'SELECT'
             WHEN 'a' THEN 'INSERT'
             WHEN 'w' THEN 'UPDATE'
             WHEN 'd' THEN 'DELETE'
             ELSE 'ALL'
           END AS command,
           pg_get_expr(p.polqual, p.polrelid) AS using_expression,
           pg_get_expr(p.polwithcheck, p.polrelid) AS with_check_expression
         FROM pg_policy p
         JOIN pg_class c ON c.oid = p.polrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'storage'
           AND c.relname IN ('objects', 'buckets')
         ORDER BY c.relname, p.polname";

pub struct StoragePoliciesView {
    session: Arc<Session>,
    policies: Vec<Policy>,
    loading: bool,
    search: Entity<InputState>,
    show_templates: bool,
}

/// `openCreate`: the RLS policy editor tab prefilled with storage.objects.
fn open_create_policy(cx: &mut App) {
    rexa_core::open_tab(
        TabSpec::View { view: "rls-policy-edit".into(), params: serde_json::json!({ "id": "rls-policy-edit-new-storage-objects", "name": "New RLS Policy", "prefillSchema": "storage", "prefillTable": "objects" }) },
        cx,
    );
}

impl StoragePoliciesView {
    fn new(session: Arc<Session>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let search = search_state("Filter policies", window, cx);
        refresh_on_tab_command("storage-policies", cx, Self::load);
        let mut this = Self { session, policies: vec![], loading: false, search, show_templates: true };
        this.load(cx);
        this
    }

    fn load(&mut self, cx: &mut Context<Self>) {
        self.loading = true;
        cx.notify();
        let driver = self.session.driver.clone();
        ui::run(cx, async move { exec(&driver, POLICIES_SQL.to_string()).await }, |this, r, _| {
            this.loading = false;
            this.policies = match r {
                Ok(g) => g
                    .rows
                    .iter()
                    .map(|row| Policy {
                        table_name: g.get(row, "table_name").into(),
                        name: g.get(row, "name").into(),
                        permissive: g.get(row, "permissive").into(),
                        command: g.get(row, "command").into(),
                        using: g.get(row, "using_expression").into(),
                    })
                    .collect(),
                Err(e) => {
                    eprintln!("[storage] failed to list policies: {e:#}");
                    vec![]
                }
            };
        });
    }
}

impl Render for StoragePoliciesView {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        let q = self.search.read(cx).value().trim().to_lowercase();
        let filtered: Vec<&Policy> = self.policies.iter().filter(|p| q.is_empty() || p.name.to_lowercase().contains(&q) || p.table_name.to_lowercase().contains(&q) || p.command.to_lowercase().contains(&q)).collect();
        let mut by_table: Vec<(String, Vec<&Policy>)> = vec![];
        for p in filtered {
            match by_table.iter_mut().find(|(n, _)| *n == p.table_name) {
                Some((_, l)) => l.push(p),
                None => by_table.push((p.table_name.clone(), vec![p])),
            }
        }
        by_table.sort_by(|a, b| a.0.cmp(&b.0));
        let empty = !self.loading && self.policies.is_empty();
        let new_menu = DropdownMenu::new("sp-new").align(Align::End).trigger(Button::new("sp-new-btn").size(ButtonSize::Sm).icon(IconName::Plus).label("New policies").icon_end(IconName::ChevronDown)).menu(|m, _, _| {
            let mut m = m.w(224.).item(MenuItem::new("Create policy from scratch").on_select(|_, cx| open_create_policy(cx)));
            for (_, title, _) in POLICY_TEMPLATES {
                m = m.item(MenuItem::new(title).on_select(|_, cx| open_create_policy(cx)));
            }
            m
        });
        let description = ui::inline(vec![
            div().child("Control Storage access with Row Level Security policies on").into_any_element(),
            ui::code("storage.objects", cx),
            div().child("and").into_any_element(),
            ui::code("storage.buckets", cx),
            div().child(".").into_any_element(),
        ]);
        let header = ui::page_header(
            "Policies",
            description,
            vec![ui::refresh_button("sp-refresh", self.loading, { let w = cx.entity().downgrade(); move |_, cx| { w.update(cx, |s, cx| s.load(cx)).ok(); } }).into_any_element(), new_menu.into_any_element()],
            cx,
        );
        let body: AnyElement = if self.loading && self.policies.is_empty() {
            div().py_20().text_center().tw_text_sm().text_color(t.muted_foreground).child("Loading storage policies…").into_any_element()
        } else if empty {
            let show = self.show_templates;
            let templates = show.then(|| {
                div()
                    .overflow_hidden()
                    .tw_rounded_xl()
                    .border_1()
                    .border_color(t.border)
                    .child(
                        div()
                            .id("sp-tpl-toggle")
                            .flex()
                            .w_full()
                            .items_center()
                            .justify_between()
                            .bg(with_alpha(t.muted, 0.3))
                            .px_4()
                            .py_3()
                            .cursor_pointer()
                            .on_click(cx.listener(|this, _, _, cx| { this.show_templates = !this.show_templates; cx.notify(); }))
                            .child(div().tw_text_sm().font_weight(FontWeight::MEDIUM).child("Get started quickly"))
                            .child(Icon::new(IconName::ChevronUp).size(px(16.)).text_color(t.muted_foreground)),
                    )
                    .children(POLICY_TEMPLATES.iter().enumerate().map(|(i, (_, title, desc))| {
                        div()
                            .flex()
                            .items_center()
                            .justify_between()
                            .gap_4()
                            .px_4()
                            .py_3()
                            .border_t_1()
                            .border_color(t.border)
                            .child(div().min_w_0().child(div().tw_text_sm().font_weight(FontWeight::MEDIUM).child(*title)).child(div().mt(px(2.)).tw_text_xs().text_color(t.muted_foreground).child(*desc)))
                            .child(Button::new(("sp-tpl", i)).outline().size(ButtonSize::Sm).icon(IconName::Plus).on_click(|_, _, cx| open_create_policy(cx)))
                    }))
            });
            div()
                .mx_auto()
                .flex()
                .w_full()
                .max_w(px(768.))
                .flex_col()
                .gap_4()
                .child(ui::empty_state(
                    IconName::Shield,
                    "No policies created yet",
                    Some("Storage is protected by policies — without them buckets stay private. Create policies to control who can read and write objects.".into()),
                    Some(
                        div()
                            .mt_2()
                            .flex()
                            .flex_wrap()
                            .items_center()
                            .justify_center()
                            .gap_2()
                            .child(Button::new("sp-scratch").outline().size(ButtonSize::Sm).icon(IconName::Plus).label("Create policy from scratch").on_click(|_, _, cx| open_create_policy(cx)))
                            .child(Button::new("sp-toggle").ghost().size(ButtonSize::Sm).label(if show { "Hide templates" } else { "Show templates" }).on_click(cx.listener(|this, _, _, cx| { this.show_templates = !this.show_templates; cx.notify(); })))
                            .into_any_element(),
                    ),
                    cx,
                ))
                .children(templates)
                .into_any_element()
        } else {
            let cols = |d: gpui::Div| d.flex().items_center().gap_2();
            div()
                .flex()
                .flex_col()
                .gap_4()
                .children(by_table.into_iter().map(|(table, list)| {
                    let n = list.len();
                    div()
                        .overflow_hidden()
                        .tw_rounded_lg()
                        .border_1()
                        .border_color(t.border)
                        .bg(with_alpha(t.card, 0.4))
                        .shadow_sm()
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .justify_between()
                                .border_b_1()
                                .border_color(t.border)
                                .bg(with_alpha(t.muted, 0.3))
                                .px_4()
                                .py_3()
                                .child(
                                    div()
                                        .flex()
                                        .min_w_0()
                                        .items_center()
                                        .gap_2()
                                        .child(Icon::new(IconName::Table2).size(px(14.)).text_color(with_alpha(t.primary, 0.6)))
                                        .child(div().truncate().tw_text_xs().font_weight(FontWeight::SEMIBOLD).child(format!("storage.{table}")))
                                        .child(Badge::new(format!("{n} {}", if n == 1 { "policy" } else { "policies" })).variant(BadgeVariant::Secondary)),
                                )
                                .child(Button::new(SharedString::from(format!("sp-new-{table}"))).outline().size(ButtonSize::Xs).icon(IconName::Plus).label("New policy").on_click(|_, _, cx| open_create_policy(cx))),
                        )
                        .child(
                            cols(div())
                                .border_b_1()
                                .border_color(with_alpha(t.border, 0.6))
                                .px_4()
                                .py_2()
                                .child(div().flex_1().child(ui::th("Policy", cx)))
                                .child(div().w(px(100.)).child(ui::th("Command", cx)))
                                .child(div().w(px(120.)).child(ui::th("Mode", cx)))
                                .child(div().flex_1().child(ui::th("Using", cx))),
                        )
                        .children(list.into_iter().enumerate().map(|(i, p)| {
                            cols(div())
                                .when(i > 0, |d| d.border_t_1().border_color(with_alpha(t.border, 0.6)))
                                .px_4()
                                .py_3()
                                .tw_text_xs()
                                .hover(|d| d.bg(with_alpha(t.muted, 0.2)))
                                .child(div().flex_1().min_w_0().truncate().font_weight(FontWeight::MEDIUM).child(p.name.clone()))
                                .child(div().w(px(100.)).text_color(with_alpha(t.primary, 0.8)).child(p.command.clone()))
                                .child(div().w(px(120.)).flex().child(Badge::new(p.permissive.to_uppercase()).variant(BadgeVariant::Secondary)))
                                .child(div().flex_1().min_w_0().truncate().font_family(rexa_ui::MONO).text_size(px(11.)).text_color(t.muted_foreground).child(if p.using.is_empty() { "—".to_string() } else { p.using.clone() }))
                        }))
                }))
                .into_any_element()
        };
        div()
            .size_full()
            .flex()
            .flex_col()
            .overflow_hidden()
            .bg(t.studio_bg)
            .text_color(t.foreground)
            .child(header)
            .child(
                div()
                    .id("sp-body")
                    .flex_1()
                    .min_h_0()
                    .overflow_y_scroll()
                    .p_6()
                    .when(!empty, |d| d.child(div().mb_4().flex().items_center().gap_3().child(div().flex_1().max_w(px(384.)).child(ui::search_box(&self.search, 36., cx)))))
                    .child(body),
            )
    }
}

// ---- storage-settings-view ---------------------------------------------------------------

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct StorageSettings {
    pub file_size_limit_mb: f64,
    pub storage_backend: String,
    pub s3_protocol_access_key_id: String,
    pub s3_protocol_access_key_secret: String,
    pub s3_protocol_region: String,
    pub s3_connection_endpoint: String,
    pub s3_connection_access_key_id: String,
    pub s3_connection_access_key_secret: String,
    pub s3_connection_region: String,
    pub s3_connection_force_path_style: bool,
    pub allowed_mime_types: Vec<String>,
}

impl Default for StorageSettings {
    fn default() -> Self {
        StorageSettings {
            file_size_limit_mb: 50.,
            storage_backend: "file".into(),
            s3_protocol_access_key_id: String::new(),
            s3_protocol_access_key_secret: String::new(),
            s3_protocol_region: String::new(),
            s3_connection_endpoint: String::new(),
            s3_connection_access_key_id: String::new(),
            s3_connection_access_key_secret: String::new(),
            s3_connection_region: String::new(),
            s3_connection_force_path_style: true,
            allowed_mime_types: vec!["image/png".into(), "image/jpg".into()],
        }
    }
}

fn settings_key(connection_id: i64) -> String {
    format!("rexadb-storage-settings:{connection_id}")
}

/// `loadStorageSettings` — app_settings first, then the old app's localStorage.
pub fn load_storage_settings(connection_id: i64) -> StorageSettings {
    let key = settings_key(connection_id);
    let raw = rexa_store::Store::open().ok().and_then(|s| s.setting(&key).ok().flatten()).or_else(|| rexa_store::WebStore::open()?.get(&key).ok().flatten());
    raw.and_then(|r| serde_json::from_str(&r).ok()).unwrap_or_default()
}

pub fn save_storage_settings(connection_id: i64, settings: &StorageSettings) -> anyhow::Result<()> {
    rexa_store::Store::open()?.set_setting(&settings_key(connection_id), &serde_json::to_string(settings)?)
}

pub struct StorageSettingsView {
    connection_id: i64,
    settings: StorageSettings,
    saved: StorageSettings,
    inputs: Vec<(&'static str, Entity<InputState>)>,
    mime_draft: Entity<InputState>,
    reset_inputs: bool,
    reload_fields: bool,
}

const TEXT_FIELDS: [&str; 8] = ["fileSizeLimitMb", "s3ProtocolAccessKeyId", "s3ProtocolAccessKeySecret", "s3ProtocolRegion", "s3ConnectionEndpoint", "s3ConnectionAccessKeyId", "s3ConnectionAccessKeySecret", "s3ConnectionRegion"];

impl StorageSettingsView {
    fn new(session: Arc<Session>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let connection_id = session.connection.id;
        let settings = load_storage_settings(connection_id);
        let inputs = TEXT_FIELDS
            .iter()
            .map(|k| {
                let secret = k.ends_with("Secret");
                let placeholder = match *k {
                    "s3ProtocolAccessKeyId" => "Access key ID",
                    "s3ProtocolAccessKeySecret" => "Access key secret",
                    "s3ProtocolRegion" => "us-east-1",
                    "s3ConnectionEndpoint" => "https://s3.amazonaws.com",
                    _ => "",
                };
                let state = cx.new(|cx| InputState::new(window, cx).placeholder(placeholder).masked(secret).default_value(field_get(&settings, k)));
                cx.subscribe(&state, move |this: &mut Self, s, e: &InputEvent, cx| {
                    if matches!(e, InputEvent::Change) {
                        let v = s.read(cx).value().to_string();
                        field_set(&mut this.settings, k, &v);
                        cx.notify();
                    }
                })
                .detach();
                (*k, state)
            })
            .collect();
        let mime_draft = cx.new(|cx| InputState::new(window, cx));
        cx.subscribe(&mime_draft, |this: &mut Self, s, e: &InputEvent, cx| match e {
            InputEvent::PressEnter { .. } | InputEvent::Blur => this.add_mime(cx),
            InputEvent::Change if s.read(cx).value().ends_with(',') => this.add_mime(cx),
            _ => {}
        })
        .detach();
        Self { connection_id, saved: settings.clone(), settings, inputs, mime_draft, reset_inputs: false, reload_fields: false }
    }

    fn add_mime(&mut self, cx: &mut Context<Self>) {
        let v = self.mime_draft.read(cx).value().trim().trim_end_matches(',').trim().to_lowercase();
        if !v.is_empty() && !self.settings.allowed_mime_types.contains(&v) {
            self.settings.allowed_mime_types.push(v);
        }
        self.reset_inputs = true;
        cx.notify();
    }

    fn input(&self, k: &str) -> Entity<InputState> {
        self.inputs.iter().find(|(n, _)| *n == k).map(|(_, s)| s.clone()).expect("field")
    }

    fn save(&mut self, cx: &mut Context<Self>) {
        match save_storage_settings(self.connection_id, &self.settings) {
            Ok(()) => {
                self.saved = self.settings.clone();
                Toast::success("Storage settings saved.").show(cx);
            }
            Err(e) => {
                Toast::error(ui::err_text(&e)).show(cx);
            }
        }
        cx.notify();
    }

    fn cancel(&mut self, cx: &mut Context<Self>) {
        self.settings = load_storage_settings(self.connection_id);
        self.saved = self.settings.clone();
        self.reset_inputs = true;
        self.reload_fields = true;
        cx.notify();
    }
}

fn field_get(s: &StorageSettings, k: &str) -> String {
    match k {
        "fileSizeLimitMb" => format!("{}", s.file_size_limit_mb),
        "s3ProtocolAccessKeyId" => s.s3_protocol_access_key_id.clone(),
        "s3ProtocolAccessKeySecret" => s.s3_protocol_access_key_secret.clone(),
        "s3ProtocolRegion" => s.s3_protocol_region.clone(),
        "s3ConnectionEndpoint" => s.s3_connection_endpoint.clone(),
        "s3ConnectionAccessKeyId" => s.s3_connection_access_key_id.clone(),
        "s3ConnectionAccessKeySecret" => s.s3_connection_access_key_secret.clone(),
        "s3ConnectionRegion" => s.s3_connection_region.clone(),
        _ => String::new(),
    }
}

fn field_set(s: &mut StorageSettings, k: &str, v: &str) {
    match k {
        "fileSizeLimitMb" => s.file_size_limit_mb = v.trim().parse::<f64>().unwrap_or(1.).max(1.),
        "s3ProtocolAccessKeyId" => s.s3_protocol_access_key_id = v.into(),
        "s3ProtocolAccessKeySecret" => s.s3_protocol_access_key_secret = v.into(),
        "s3ProtocolRegion" => s.s3_protocol_region = v.into(),
        "s3ConnectionEndpoint" => s.s3_connection_endpoint = v.into(),
        "s3ConnectionAccessKeyId" => s.s3_connection_access_key_id = v.into(),
        "s3ConnectionAccessKeySecret" => s.s3_connection_access_key_secret = v.into(),
        "s3ConnectionRegion" => s.s3_connection_region = v.into(),
        _ => {}
    }
}

fn config_row(label: &str, description: impl Into<SharedString>, control: AnyElement, last: bool, cx: &App) -> AnyElement {
    let t = cx.tokens();
    div()
        .flex()
        .items_start()
        .gap_8()
        .py_5()
        .when(!last, |d| d.border_b_1().border_color(with_alpha(t.border, 0.6)))
        .child(div().flex_1().min_w_0().child(div().tw_text_sm().font_weight(FontWeight::MEDIUM).text_color(t.foreground).child(label.to_string())).child(div().mt_1().tw_text_sm().text_color(t.muted_foreground).child(description.into())))
        .child(div().w(px(320.)).flex_shrink_0().child(control))
        .into_any_element()
}

fn section_card(title: &str, rows: Vec<AnyElement>, cx: &App) -> AnyElement {
    let t = cx.tokens();
    div()
        .overflow_hidden()
        .tw_rounded_xl()
        .border_1()
        .border_color(t.border)
        .bg(with_alpha(t.card, 0.4))
        .child(div().border_b_1().border_color(t.border).px_5().py_3().child(div().tw_text_sm().font_weight(FontWeight::SEMIBOLD).child(rexa_ui::tight(title.to_string()))))
        .child(div().px_5().children(rows))
        .into_any_element()
}

impl Render for StorageSettingsView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if std::mem::take(&mut self.reload_fields) {
            for (k, s) in self.inputs.clone() {
                let v = field_get(&self.settings, k);
                s.update(cx, |s, cx| s.set_value(v, window, cx));
            }
        }
        if std::mem::take(&mut self.reset_inputs) {
            self.mime_draft.update(cx, |s, cx| s.set_value("", window, cx));
        }
        let t = cx.tokens().clone();
        let dirty = self.settings != self.saved;
        let s3_disabled = self.settings.storage_backend == "file";
        let only = "Only relevant when using S3 storage backend";
        let field = |this: &Self, k: &str, mono: bool, disabled: bool| {
            div().when(mono, |d| d.font_family(rexa_ui::MONO).tw_text_xs()).child(TextInput::new(&this.input(k)).h(36.).disabled(disabled)).into_any_element()
        };
        let backend = self.settings.storage_backend.clone();
        let w = cx.entity().downgrade();
        let backend_select = Select::new("ss-backend")
            .w_full()
            .options([SelectOption::new("file", "File system"), SelectOption::new("s3", "S3")])
            .value(Some(backend.clone()))
            .on_change(move |v, _, cx| {
                w.update(cx, |s, cx| {
                    s.settings.storage_backend = v.to_string();
                    cx.notify();
                })
                .ok();
            })
            .into_any_element();
        let w2 = cx.entity().downgrade();
        let force = div()
            .flex()
            .h_9()
            .items_center()
            .justify_end()
            .child(Switch::new("ss-force").checked(self.settings.s3_connection_force_path_style).disabled(s3_disabled).on_change(move |v, _, cx| {
                w2.update(cx, |s, cx| {
                    s.settings.s3_connection_force_path_style = v;
                    cx.notify();
                })
                .ok();
            }))
            .into_any_element();
        let chips = self.settings.allowed_mime_types.iter().map(|m| {
            let m2 = m.clone();
            div()
                .flex()
                .items_center()
                .gap_1()
                .tw_rounded_md()
                .bg(t.muted)
                .px_2()
                .py(px(2.))
                .tw_text_xs()
                .text_color(t.foreground)
                .child(m.clone())
                .child(div().id(SharedString::from(format!("ss-rm-{m}"))).cursor_pointer().text_color(t.muted_foreground).hover(|d| d.text_color(t.foreground)).on_click(cx.listener(move |this, _, _, cx| { this.settings.allowed_mime_types.retain(|x| *x != m2); cx.notify(); })).child(Icon::new(IconName::X).size(px(12.))))
        });
        let mimes = div()
            .flex()
            .flex_wrap()
            .items_center()
            .gap(px(6.))
            .min_h_9()
            .tw_rounded_lg()
            .border_1()
            .border_color(t.border)
            .bg(t.background)
            .px_2()
            .py(px(6.))
            .children(chips)
            .child(div().flex_1().min_w(px(120.)).tw_text_xs().child(TextInput::new(&self.mime_draft).h(24.)))
            .into_any_element();
        let size = div().child(TextInput::new(&self.input("fileSizeLimitMb")).h(36.).suffix(div().tw_text_xs().text_color(t.muted_foreground).child("MB"))).into_any_element();
        let header = ui::page_header(
            "Settings",
            "Configure upload limits, backend, and allowed content types for Storage.",
            vec![
                Button::new("ss-cancel").outline().size(ButtonSize::Sm).label("Cancel").disabled(!dirty).on_click(cx.listener(|this, _, _, cx| this.cancel(cx))).into_any_element(),
                Button::new("ss-save").size(ButtonSize::Sm).label("Save changes").disabled(!dirty).on_click(cx.listener(|this, _, _, cx| this.save(cx))).into_any_element(),
            ],
            cx,
        );
        let d = |on: &str| if s3_disabled { only.to_string() } else { on.to_string() };
        div()
            .size_full()
            .flex()
            .flex_col()
            .overflow_hidden()
            .bg(t.studio_bg)
            .text_color(t.foreground)
            .child(header)
            .child(
                div().id("ss-body").flex_1().min_h_0().overflow_y_scroll().child(
                    div()
                        .mx_auto()
                        .flex()
                        .w_full()
                        .max_w(px(896.))
                        .flex_col()
                        .gap_6()
                        .p_6()
                        .child(section_card(
                            "Configuration",
                            vec![
                                config_row("Upload file size limit", "The maximum file size our storage will accept in MB (Max is 50GB, or 51200MB)", size, false, cx),
                                config_row("Storage backend", if backend == "file" { "Currently using local filesystem for object storage" } else { "Currently using S3 for object storage" }, backend_select, true, cx),
                            ],
                            cx,
                        ))
                        .child(section_card(
                            "S3 Connection",
                            vec![
                                config_row("S3 access key ID", "This key ID grants full access to all S3 resources for authentication", field(self, "s3ProtocolAccessKeyId", true, false), false, cx),
                                config_row("S3 access key secret", "This secret key grants full access to all S3 resources for authentication", field(self, "s3ProtocolAccessKeySecret", true, false), false, cx),
                                config_row("Region", "The default region for requests to S3", field(self, "s3ProtocolRegion", false, false), false, cx),
                                config_row("Endpoint", d("Custom S3-compatible endpoint URL"), field(self, "s3ConnectionEndpoint", true, s3_disabled), false, cx),
                                config_row("Access key ID", d("Access key ID for the S3 backend"), field(self, "s3ConnectionAccessKeyId", true, s3_disabled), false, cx),
                                config_row("Access key secret", d("Access key secret for the S3 backend"), field(self, "s3ConnectionAccessKeySecret", true, s3_disabled), false, cx),
                                config_row("Region", d("Region for the S3 backend"), field(self, "s3ConnectionRegion", false, s3_disabled), false, cx),
                                config_row("Force path-style URLs", d("Use path-style addressing instead of virtual-hosted style"), force, true, cx),
                            ],
                            cx,
                        ))
                        .child(section_card("File size restrictions", vec![config_row("Allowed MIME types", "Wildcards such as image/* can also be used as a value. Leave empty to allow any MIME type.", mimes, true, cx)], cx)),
                ),
            )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn obj(name: &str) -> Object {
        Object { name: name.into(), ..Default::default() }
    }

    #[test]
    fn folder_entries() {
        let objs = vec![obj("a.png"), obj("docs/x.txt"), obj("docs/sub/y.txt"), obj("empty/.emptyFolderPlaceholder"), obj(".emptyFolderPlaceholder")];
        let root = list_folder_entries(&objs, "");
        assert_eq!(root.iter().map(Entry::name).collect::<Vec<_>>(), vec!["docs", "empty", "a.png"]);
        let docs = list_folder_entries(&objs, "docs");
        assert_eq!(docs.iter().map(Entry::name).collect::<Vec<_>>(), vec!["sub", "x.txt"]);
        assert!(list_folder_entries(&objs, "empty").is_empty());
    }

    #[test]
    fn paths() {
        assert_eq!(parent_path("a/b/c"), "a/b");
        assert_eq!(parent_path("a"), "");
        assert_eq!(join_path(&["", "a", "b"]), "a/b");
        assert_eq!(encode_storage_path("my dir/a b.png"), "my%20dir/a%20b.png");
    }

    #[test]
    fn bucket_names() {
        assert!(validate_bucket_name("avatars").is_none());
        assert!(validate_bucket_name("").is_some());
        assert!(validate_bucket_name("Bad").is_some());
        assert!(validate_bucket_name("-x").is_some());
        assert_eq!(build_create_bucket_sql("o'k", true), "INSERT INTO storage.buckets (id, name, public)\n         VALUES ('o''k', 'o''k', true)");
    }

    #[test]
    fn settings_roundtrip_camel_case() {
        let s: StorageSettings = serde_json::from_str(r#"{"fileSizeLimitMb":10,"storageBackend":"s3"}"#).unwrap();
        assert_eq!(s.file_size_limit_mb, 10.);
        assert_eq!(s.storage_backend, "s3");
        assert!(s.s3_connection_force_path_style);
        assert!(serde_json::to_string(&s).unwrap().contains("s3ConnectionForcePathStyle"));
    }

    #[test]
    fn object_meta() {
        let m = serde_json::json!({"size": 2048, "mimetype": "image/png"});
        assert_eq!(object_size(Some(&m)), Some(2048.));
        assert_eq!(object_mime(Some(&m)), "image/png");
        assert_eq!(object_mime(None), "—");
    }
}
