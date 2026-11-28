//! Port of components/studio/keybindings-view.tsx (KeybindingsPanel) and the
//! parts of lib/studio/keybindings.ts it needs (defaults, actions, combo
//! building, platform normalisation). Bindings are stored in
//! `<app data>/keybindings.json` (saveKeybindingsFile), the file the studio reads.

use gpui::{div, prelude::*, px, AnyElement, App, Context, FocusHandle, Focusable, FontWeight, KeyDownEvent, SharedString, Window};
use gpui_component::input::{InputEvent, InputState};
use gpui_component::Icon;
use rexa_ui::{
    open_alert_dialog, close_top, tw, with_alpha, ActiveTokens, Align, AlertDialog, Button, ButtonSize, DropdownMenu, IconName,
    Kbd, MenuItem, Select, SelectOption, TextInput, Tooltip, Tw,
};
use serde_json::{json, Map, Value};

/// KEYBINDING_ACTIONS: (id, name, fields).
pub const ACTIONS: &[(&str, &str, &[&str])] = &[
    ("NAVIGATE_TABLE", "Navigate to Table", &["schema", "table"]),
    ("NAVIGATE_SCHEMA", "Navigate to Schema", &["schema"]),
    ("NAVIGATE_DATABASE", "Navigate to Database", &["database"]),
    ("GO_TO_TAB_INDEX", "Go to Tab (Index)", &["index"]),
    ("GO_TO_NEXT_TAB", "Go to Next Tab", &[]),
    ("GO_TO_PREVIOUS_TAB", "Go to Previous Tab", &[]),
    ("CLOSE_ACTIVE_TAB", "Close Active Tab", &[]),
    ("OPEN_SQL_EDITOR", "Open SQL Editor", &[]),
    ("RUN_ACTIVE_QUERY", "Run Active Query", &[]),
    ("STOP_ACTIVE_QUERY", "Stop Active Query", &[]),
    ("REFRESH_CURRENT_TAB", "Refresh Current Tab", &[]),
    ("COMMIT_PENDING_CHANGES", "Commit Pending Changes", &[]),
    ("OPEN_DATABASE_VIEW", "Open Database View", &["view"]),
    ("OPEN_HISTORY", "Open Query History", &[]),
    ("OPEN_IMPORT_EXPORT", "Open Import / Export", &[]),
    ("OPEN_DASHBOARD_HOME", "Open Dashboard Home", &[]),
    ("OPEN_SETTINGS", "Open Settings", &[]),
    ("OPEN_PROFILE_SETTINGS", "Open Profile Settings", &[]),
    ("OPEN_KEYBINDINGS", "Open Keybindings", &[]),
    ("OPEN_CREATE_TABLE", "Open Create Table", &[]),
    ("OPEN_CREATE_ENUM", "Open Create Enum", &[]),
    ("OPEN_CREATE_INDEX", "Open Create Index", &[]),
    ("OPEN_CREATE_TRIGGER", "Open Create Trigger", &[]),
    ("OPEN_CREATE_SCHEMA", "Open Create Schema", &[]),
    ("OPEN_CREATE_DATABASE", "Open Create Database", &[]),
    ("TOGGLE_SIDEBAR", "Toggle Sidebar", &[]),
    ("SET_SIDEBAR_VIEW", "Set Sidebar View", &["sidebar"]),
    ("TOGGLE_COMMAND_MENU", "Toggle Command Menu", &[]),
    ("OPEN_UNIVERSAL_SEARCH", "Search All Tables", &[]),
    ("TOGGLE_GLOBAL_SQL_PANEL", "Toggle SQL Editor Sheet", &[]),
    ("TOGGLE_BOTTOM_PANEL", "Toggle Bottom Panel", &[]),
    ("TOGGLE_AI_PANEL", "Toggle AI Panel", &[]),
    ("TOGGLE_PENDING_CHANGES_PANEL", "Toggle Pending Changes Panel", &[]),
    ("FORMAT_QUERY", "Format SQL Query", &[]),
    ("COPY_QUERY", "Copy SQL Query", &[]),
    ("OPEN_SHORTCUT_NAVIGATOR", "Open Shortcut Navigator", &[]),
    ("OPEN_INSERT_SHEET", "Insert Row", &[]),
    ("ACTIVATE_AI_MODE", "Activate AI Mode", &[]),
    ("TOGGLE_ACTIVITY_BAR", "Toggle Activity Bar", &[]),
    ("TOGGLE_STATUS_BAR", "Toggle Status Bar", &[]),
];

pub const DB_VIEWS: &[(&str, &str)] = &[
    ("schema", "Schema Diagram"),
    ("tables", "Tables"),
    ("functions", "Functions"),
    ("extensions", "Extensions"),
    ("triggers", "Triggers"),
    ("enums", "Enums"),
    ("indexes", "Indexes"),
    ("rls-policies", "RLS Policies"),
];

pub const SIDEBAR_VIEWS: &[(&str, &str)] =
    &[("tables", "Tables"), ("sql", "SQL Snippets"), ("database", "Database"), ("dashboard", "Dashboard"), ("workflows", "Workflows"), ("erd", "ERD Designer")];

/// DEFAULT_KEYBINDINGS (declaration order).
fn defaults_raw() -> Vec<(&'static str, Value)> {
    vec![
        ("Cmd+Alt+G", json!({"type": "NAVIGATE_TABLE", "schema": "public", "table": "users"})),
        ("Cmd+Alt+P", json!({"type": "NAVIGATE_SCHEMA", "schema": "public"})),
        ("Cmd+Alt+0", json!({"type": "NAVIGATE_DATABASE", "database": "postgres"})),
        ("Cmd+1", json!({"type": "GO_TO_TAB_INDEX", "index": 0})),
        ("Cmd+Tab", json!({"type": "GO_TO_NEXT_TAB"})),
        ("Cmd+Shift+Tab", json!({"type": "GO_TO_PREVIOUS_TAB"})),
        ("Cmd+W", json!({"type": "CLOSE_ACTIVE_TAB"})),
        ("Cmd+N", json!({"type": "OPEN_SQL_EDITOR"})),
        ("Cmd+Enter", json!({"type": "RUN_ACTIVE_QUERY"})),
        ("Cmd+.", json!({"type": "STOP_ACTIVE_QUERY"})),
        ("Cmd+R", json!({"type": "REFRESH_CURRENT_TAB"})),
        ("Cmd+Shift+Enter", json!({"type": "COMMIT_PENDING_CHANGES"})),
        ("Cmd+Shift+D", json!({"type": "OPEN_DATABASE_VIEW", "view": "schema"})),
        ("Cmd+Shift+H", json!({"type": "OPEN_HISTORY"})),
        ("Cmd+Shift+E", json!({"type": "OPEN_IMPORT_EXPORT"})),
        ("Cmd+Shift+M", json!({"type": "OPEN_DASHBOARD_HOME"})),
        ("Cmd+,", json!({"type": "OPEN_SETTINGS"})),
        ("Cmd+Shift+,", json!({"type": "OPEN_PROFILE_SETTINGS"})),
        ("Cmd+Alt+K", json!({"type": "OPEN_KEYBINDINGS"})),
        ("Cmd+Alt+T", json!({"type": "OPEN_CREATE_TABLE"})),
        ("Cmd+Alt+E", json!({"type": "OPEN_CREATE_ENUM"})),
        ("Cmd+Alt+I", json!({"type": "OPEN_CREATE_INDEX"})),
        ("Cmd+Alt+R", json!({"type": "OPEN_CREATE_TRIGGER"})),
        ("Cmd+Alt+S", json!({"type": "OPEN_CREATE_SCHEMA"})),
        ("Cmd+Alt+B", json!({"type": "OPEN_CREATE_DATABASE"})),
        ("Cmd+B", json!({"type": "TOGGLE_SIDEBAR"})),
        ("Cmd+J", json!({"type": "TOGGLE_BOTTOM_PANEL"})),
        ("Cmd+Alt+1", json!({"type": "SET_SIDEBAR_VIEW", "sidebar": "tables"})),
        ("Cmd+K", json!({"type": "TOGGLE_COMMAND_MENU"})),
        ("Cmd+Shift+F", json!({"type": "OPEN_UNIVERSAL_SEARCH"})),
        ("Cmd+E", json!({"type": "TOGGLE_GLOBAL_SQL_PANEL"})),
        ("Cmd+I", json!({"type": "TOGGLE_AI_PANEL"})),
        ("Cmd+U", json!({"type": "TOGGLE_PENDING_CHANGES_PANEL"})),
        ("Shift+Alt+F", json!({"type": "FORMAT_QUERY"})),
        ("Cmd+Shift+C", json!({"type": "COPY_QUERY"})),
        ("Cmd+T", json!({"type": "OPEN_SHORTCUT_NAVIGATOR"})),
        ("Cmd+Shift+I", json!({"type": "OPEN_INSERT_SHEET"})),
        ("/", json!({"type": "ACTIVATE_AI_MODE"})),
    ]
}

/// normalizeComboForPlatform.
pub fn normalize_combo(combo: &str) -> String {
    let mac = cfg!(target_os = "macos");
    let input = match (mac, combo) {
        (true, "Ctrl+Tab") => "Cmd+Tab",
        (true, "Ctrl+Shift+Tab") => "Cmd+Shift+Tab",
        _ => combo,
    };
    let mut out: Vec<String> = Vec::new();
    for tok in input.split('+').map(str::trim).filter(|t| !t.is_empty()) {
        let tok = match tok {
            "Command" => "Cmd",
            "Control" => "Ctrl",
            "Option" => "Alt",
            t => t,
        };
        let tok = if !mac && tok == "Cmd" { "Ctrl" } else { tok };
        if !out.iter().any(|t| t == tok) {
            out.push(tok.to_string());
        }
    }
    out.join("+")
}

/// normalizeKeybindingsForPlatform.
pub fn normalize(bindings: &Map<String, Value>) -> Map<String, Value> {
    let mut out = Map::new();
    for (combo, b) in bindings {
        if !b.is_object() {
            continue;
        }
        let c = normalize_combo(combo);
        if out.contains_key(&c) {
            continue;
        }
        let mut b = b.clone();
        if let Some(inner) = b.get("combo").and_then(|v| v.as_str()).map(normalize_combo) {
            b["combo"] = Value::from(inner);
        }
        out.insert(c, b);
    }
    out
}

/// getDefaultKeybindings (platform-normalised).
pub fn defaults() -> Map<String, Value> {
    normalize(&defaults_raw().into_iter().map(|(k, v)| (k.to_string(), v)).collect())
}

pub fn action_name(kind: &str) -> String {
    ACTIONS.iter().find(|(id, _, _)| *id == kind).map_or(kind.to_string(), |(_, n, _)| n.to_string())
}

fn fields_of(kind: &str) -> &'static [&'static str] {
    ACTIONS.iter().find(|(id, _, _)| *id == kind).map_or(&[], |(_, _, f)| f)
}

fn s(b: &Value, k: &str) -> String {
    match b.get(k) {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Number(n)) => n.to_string(),
        Some(Value::Null) | None => "undefined".into(),
        Some(v) => v.to_string(),
    }
}

/// describeBinding.
pub fn describe(b: &Value) -> String {
    let kind = b.get("type").and_then(|v| v.as_str()).unwrap_or_default();
    match kind {
        "NAVIGATE_TABLE" => format!("In {}.{}", s(b, "schema"), s(b, "table")),
        "NAVIGATE_SCHEMA" => format!("Switch to {}", s(b, "schema")),
        "NAVIGATE_DATABASE" => format!("Connect to {}", s(b, "database")),
        "GO_TO_TAB_INDEX" => format!("Open tab at index {}", s(b, "index")),
        "OPEN_DATABASE_VIEW" => {
            let v = s(b, "view");
            format!("View {}", DB_VIEWS.iter().find(|(id, _)| *id == v).map_or(v.clone(), |(_, n)| n.to_string()))
        }
        "SET_SIDEBAR_VIEW" => {
            let v = s(b, "sidebar");
            format!("Sidebar {}", SIDEBAR_VIEWS.iter().find(|(id, _)| *id == v).map_or(v.clone(), |(_, n)| n.to_string()))
        }
        _ => "No additional options".into(),
    }
}

/// buildShortcutCombo from a GPUI keystroke.
pub fn combo_from_keystroke(k: &gpui::Keystroke) -> Option<String> {
    let key = k.key.as_str();
    let token = match key {
        "" | "shift" | "control" | "alt" | "cmd" | "platform" | "function" => return None,
        "space" => "Space".to_string(),
        "escape" => "Escape".into(),
        "enter" => "Enter".into(),
        "tab" => "Tab".into(),
        "backspace" => "Backspace".into(),
        "delete" => "Delete".into(),
        "insert" => "Insert".into(),
        "home" => "Home".into(),
        "end" => "End".into(),
        "pageup" => "PageUp".into(),
        "pagedown" => "PageDown".into(),
        "up" => "ArrowUp".into(),
        "down" => "ArrowDown".into(),
        "left" => "ArrowLeft".into(),
        "right" => "ArrowRight".into(),
        k if k.chars().count() == 1 => k.to_uppercase(),
        k => {
            let mut c = k.chars();
            c.next().map(|f| f.to_uppercase().collect::<String>() + c.as_str()).unwrap_or_default()
        }
    };
    let m = &k.modifiers;
    let mut parts = Vec::new();
    if m.platform {
        parts.push("Cmd".to_string());
    }
    if m.control {
        parts.push("Ctrl".into());
    }
    if m.shift {
        parts.push("Shift".into());
    }
    if m.alt {
        parts.push("Alt".into());
    }
    parts.push(token);
    Some(parts.join("+"))
}

/// The user's bindings: keybindings.json, else the defaults.
pub fn load() -> Map<String, Value> {
    match crate::persist::load_keybindings_file() {
        Some(Value::Object(m)) if !m.is_empty() => m,
        _ => defaults(),
    }
}

#[derive(Clone)]
struct Row {
    combo: String,
    binding: Value,
    action: String,
    description: String,
    is_default: bool,
}

/// buildRows.
fn build_rows(bindings: &Map<String, Value>, query: &str) -> Vec<Row> {
    let defaults = defaults();
    let mut entries: Vec<_> = bindings.iter().collect();
    entries.sort_by(|a, b| a.0.to_lowercase().cmp(&b.0.to_lowercase()).then(a.0.cmp(b.0)));
    let rows = entries.into_iter().map(|(combo, b)| {
        let kind = b.get("type").and_then(|v| v.as_str()).unwrap_or_default().to_string();
        let mut with_combo = b.clone();
        with_combo["combo"] = Value::from(combo.clone());
        let is_default = defaults.get(combo).is_some_and(|d| {
            d.get("type") == b.get("type") && {
                let mut dd = d.clone();
                dd["combo"] = Value::from(combo.clone());
                dd == with_combo
            }
        });
        Row { combo: combo.clone(), action: action_name(&kind), description: describe(b), binding: b.clone(), is_default }
    });
    let q = query.trim().to_lowercase();
    rows.filter(|r| {
        q.is_empty()
            || r.combo.to_lowercase().contains(&q)
            || r.action.to_lowercase().contains(&q)
            || r.description.to_lowercase().contains(&q)
            || r.binding.get("type").and_then(|v| v.as_str()).unwrap_or_default().to_lowercase().contains(&q)
    })
    .collect()
}

fn conflicts(rows: &[Row], combo: &str, exclude: Option<&str>) -> Vec<String> {
    if combo.trim().is_empty() {
        return Vec::new();
    }
    rows.iter().filter(|r| Some(r.combo.as_str()) != exclude && r.combo.eq_ignore_ascii_case(combo)).map(|r| r.action.clone()).collect()
}

/// KeybindingPill: one Kbd per token (⌘ ⇧ ⌥ ⌃, single letters upper-cased).
pub fn pill(value: &str) -> impl IntoElement {
    div().flex().items_center().gap_1().children(value.split('+').map(|p| {
        let label = match p {
            "Cmd" => "\u{2318}".to_string(),
            "Shift" => "\u{21e7}".into(),
            "Alt" => "\u{2325}".into(),
            "Ctrl" => "\u{2303}".into(),
            p if p.chars().count() == 1 => p.to_uppercase(),
            p => p.to_string(),
        };
        div().min_w_6().flex().justify_center().child(Kbd::new(label))
    }))
}

/// Per-row editing state (KeybindingTableRow's drafts).
#[derive(Clone, Default)]
struct Draft {
    combo: String,
    binding: Value,
}

pub struct KeybindingsPanel {
    bindings: Map<String, Value>,
    search: gpui::Entity<InputState>,
    query: String,
    search_open: bool,
    adding: bool,
    new_draft: Draft,
    /// Row being edited (original combo) and its drafts.
    editing: Option<(String, Draft)>,
    /// Which combo is recording a shortcut ("new" for the add row).
    recording: Option<String>,
    capture: FocusHandle,
    _subs: Vec<gpui::Subscription>,
}

impl KeybindingsPanel {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let search = cx.new(|cx| InputState::new(window, cx).placeholder("Search keybindings"));
        let subs = vec![cx.subscribe(&search, |this, s, ev: &InputEvent, cx| match ev {
            InputEvent::Change => {
                this.query = s.read(cx).value().to_string();
                cx.notify();
            }
            InputEvent::Blur if this.query.is_empty() => {
                this.search_open = false;
                cx.notify();
            }
            _ => {}
        })];
        Self {
            bindings: load(),
            search,
            query: String::new(),
            search_open: false,
            adding: false,
            new_draft: Draft { combo: String::new(), binding: json!({"type": "TOGGLE_COMMAND_MENU"}) },
            editing: None,
            recording: None,
            capture: cx.focus_handle(),
            _subs: subs,
        }
    }

    /// setKeybindings + the studio's save effect (saveKeybindingsFile).
    fn commit(&mut self, next: Map<String, Value>, cx: &mut Context<Self>) {
        if let Err(e) = crate::persist::save_keybindings_file(&Value::Object(next.clone())) {
            rexa_ui::toast::error(format!("Failed to save keybindings.json: {e}"), cx);
        }
        self.bindings = next;
        cx.notify();
    }

    fn save_row(&mut self, original: Option<String>, draft: Draft, cx: &mut Context<Self>) {
        let combo = draft.combo.trim().to_string();
        if combo.is_empty() {
            return;
        }
        let mut next = self.bindings.clone();
        if let Some(o) = original.filter(|o| *o != combo) {
            next.remove(&o);
        }
        let mut b = draft.binding;
        b["combo"] = Value::from(combo.clone());
        next.insert(combo, b);
        self.adding = false;
        self.editing = None;
        self.commit(next, cx);
    }

    fn reset_row(&mut self, combo: &str, cx: &mut Context<Self>) {
        let mut next = self.bindings.clone();
        match defaults().get(combo) {
            Some(d) => {
                let mut d = d.clone();
                d["combo"] = Value::from(combo);
                next.insert(combo.to_string(), d);
            }
            None => {
                next.remove(combo);
            }
        }
        self.commit(next, cx);
    }

    fn remove_row(&mut self, combo: &str, cx: &mut Context<Self>) {
        let mut next = self.bindings.clone();
        next.remove(combo);
        self.commit(next, cx);
    }

    fn reset_all(&mut self, cx: &mut Context<Self>) {
        self.adding = false;
        self.commit(defaults(), cx);
        rexa_ui::toast::success("Keybindings reset to defaults.", cx);
    }

    fn start_recording(&mut self, key: String, window: &mut Window, cx: &mut Context<Self>) {
        self.recording = Some(key);
        window.focus(&self.capture, cx);
        cx.notify();
    }

    /// KeyCaptureInput.onKeyDown.
    fn on_capture_key(&mut self, e: &KeyDownEvent, _: &mut Window, cx: &mut Context<Self>) {
        let Some(target) = self.recording.clone() else { return };
        if e.keystroke.key == "tab" && !e.keystroke.modifiers.modified() {
            return;
        }
        cx.stop_propagation();
        let combo = if e.keystroke.key == "escape" { Some(String::new()) } else { combo_from_keystroke(&e.keystroke) };
        let Some(combo) = combo else { return };
        if target == "new" {
            self.new_draft.combo = combo;
        } else {
            let binding = self.bindings.get(&target).cloned().unwrap_or(Value::Null);
            let draft = self.editing.take().filter(|(c, _)| *c == target).map(|(_, d)| d).unwrap_or(Draft { combo: target.clone(), binding });
            self.editing = Some((target, Draft { combo, ..draft }));
        }
        self.recording = None;
        cx.notify();
    }

    fn header(&mut self, count: usize, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        let icon_btn = |id: &'static str, icon: IconName, tip: &'static str| {
            Tooltip::new(tip).child(Button::new(id).ghost().size(ButtonSize::IconSm).icon(icon))
        };
        let search: AnyElement = if self.search_open {
            div()
                .w(px(176.))
                .child(TextInput::new(&self.search).h(28.).prefix(Icon::new(IconName::Search).size_3().text_color(t.muted_foreground)))
                .into_any_element()
        } else {
            div()
                .flex()
                .items_center()
                .gap(px(6.))
                .child(div().tw_text_11().text_color(t.muted_foreground).child(format!("{count} {}", if count == 1 { "binding" } else { "bindings" })))
                .child(
                    Tooltip::new("Search keybindings").child(
                        Button::new("kb-search").ghost().size(ButtonSize::IconSm).icon(IconName::Search).on_click(cx.listener(|this, _, w, cx| {
                            this.search_open = true;
                            let h = this.search.read(cx).focus_handle(cx);
                            w.focus(&h, cx);
                            cx.notify();
                        })),
                    ),
                )
                .into_any_element()
        };
        let this = cx.entity();
        div()
            .flex()
            .items_center()
            .justify_between()
            .child(
                div()
                    .child(div().tw_text_sm().font_weight(FontWeight::SEMIBOLD).child("Keybindings"))
                    .child(div().tw_text_xs().text_color(t.muted_foreground).child("Customize keyboard shortcuts. Click a keybinding to edit, or add a new one.")),
            )
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(6.))
                    .child(search)
                    .child(icon_btn("kb-add", IconName::Plus, "Add keybinding").on_click_child(cx.listener(|this, _, _, cx| {
                        this.adding = true;
                        cx.notify();
                    })))
                    .child(Tooltip::new("Open keybindings.json").child(Button::new("kb-json").ghost().size(ButtonSize::IconSm).icon(IconName::FileBraces).on_click(|_, _, cx| {
                        let path = crate::persist::keybindings_path();
                        if !path.exists() {
                            crate::persist::save_keybindings_file(&Value::Object(load())).ok();
                        }
                        cx.open_url(&format!("file://{}", path.display()));
                    })))
                    .child(Tooltip::new("Reset all keybindings").child(Button::new("kb-reset").ghost().size(ButtonSize::IconSm).icon(IconName::RotateCcw).on_click(
                        move |_, _, cx| {
                            let this = this.clone();
                            open_alert_dialog(cx, move |_, _| {
                                let this = this.clone();
                                AlertDialog::new()
                                    .title("Reset all keybindings?")
                                    .description("This discards every custom keybinding and restores the built-in defaults. This cannot be undone.")
                                    .footer(Button::new("kb-reset-cancel").outline().label("Cancel").on_click(|_, _, cx| close_top(cx)))
                                    .footer(Button::new("kb-reset-ok").destructive().label("Reset all").on_click(move |_, _, cx| {
                                        close_top(cx);
                                        this.update(cx, |p, cx| p.reset_all(cx));
                                    }))
                            });
                        },
                    ))),
            )
    }

    fn capture_box(&self, key: &str, value: &str, cx: &mut Context<Self>) -> AnyElement {
        let t = cx.tokens().clone();
        let recording = self.recording.as_deref() == Some(key);
        let key = key.to_string();
        div()
            .id(SharedString::from(format!("kb-capture-{key}")))
            .h_7()
            .w(px(176.))
            .flex()
            .items_center()
            .px(px(10.))
            .tw_rounded_md()
            .border_1()
            .tw_text_13()
            .border_color(if recording { with_alpha(t.primary, 0.7) } else { t.input })
            .when(recording, |d| d.bg(with_alpha(t.primary, 0.05)))
            .text_color(if recording || value.is_empty() { t.muted_foreground } else { t.foreground })
            .cursor_text()
            .on_click(cx.listener(move |this, _, w, cx| this.start_recording(key.clone(), w, cx)))
            .child(if recording {
                "Press shortcut".to_string()
            } else if value.is_empty() {
                "Unassigned".into()
            } else {
                value.to_string()
            })
            .into_any_element()
    }

    /// ActionFieldsEditor (selects for schema / view / sidebar; text-ish fields show their value).
    fn fields_editor(&self, row_key: &str, binding: &Value, cx: &mut Context<Self>) -> AnyElement {
        let kind = binding.get("type").and_then(|v| v.as_str()).unwrap_or_default().to_string();
        let mut out = div().flex().flex_wrap().items_center().gap_2();
        for field in fields_of(&kind) {
            let options: Option<Vec<(&str, &str)>> = match *field {
                "schema" => Some(vec![("public", "public"), ("information_schema", "information_schema")]),
                "view" => Some(DB_VIEWS.to_vec()),
                "sidebar" => Some(SIDEBAR_VIEWS.to_vec()),
                _ => None,
            };
            let default = match *field {
                "schema" => "public",
                "view" => "schema",
                "sidebar" => "tables",
                _ => "",
            };
            let current = binding.get(*field).map(|v| v.as_str().map(str::to_string).unwrap_or_else(|| v.to_string())).unwrap_or_else(|| default.into());
            let key = row_key.to_string();
            let field_name = field.to_string();
            let this = cx.entity();
            match options {
                Some(opts) => {
                    out = out.child(
                        Select::new(SharedString::from(format!("kb-{key}-{field}")))
                            .small()
                            .w(px(112.))
                            .options(opts.into_iter().map(|(v, l)| SelectOption::new(v, l)))
                            .value(Some(current))
                            .on_change(move |v, _, cx| {
                                let (key, field_name) = (key.clone(), field_name.clone());
                                this.update(cx, |p, cx| p.patch_draft(&key, &field_name, Value::from(v.to_string()), cx))
                            }),
                    )
                }
                None => {
                    out = out.child(
                        div()
                            .h_7()
                            .w(px(112.))
                            .px_2()
                            .flex()
                            .items_center()
                            .tw_rounded_sm()
                            .border_1()
                            .border_color(cx.tokens().input)
                            .tw_text_13()
                            .child(current),
                    )
                }
            }
        }
        out.into_any_element()
    }

    fn patch_draft(&mut self, row_key: &str, field: &str, value: Value, cx: &mut Context<Self>) {
        if row_key == "new" {
            self.new_draft.binding[field] = value;
        } else {
            let binding = self.bindings.get(row_key).cloned().unwrap_or(Value::Null);
            let mut draft = self.editing.take().filter(|(c, _)| c == row_key).map(|(_, d)| d).unwrap_or(Draft { combo: row_key.to_string(), binding });
            draft.binding[field] = value;
            self.editing = Some((row_key.to_string(), draft));
        }
        cx.notify();
    }

    fn conflict_icon(labels: Vec<String>) -> Option<AnyElement> {
        if labels.is_empty() {
            return None;
        }
        let desc = if labels.len() == 1 {
            format!("Conflicts with {}.", labels[0])
        } else {
            format!("Conflicts with {}{}.", labels.iter().take(3).cloned().collect::<Vec<_>>().join(", "), if labels.len() > 3 { ", and more" } else { "" })
        };
        Some(
            Tooltip::new(format!("{desc} The most recent matching binding wins when both conditions can apply."))
                .child(div().size_5().flex().items_center().justify_center().rounded(px(6.)).text_color(tw("amber-500")).child(Icon::new(IconName::TriangleAlert).size(px(14.))))
                .into_any_element(),
        )
    }

    fn grid_row(&self) -> gpui::Div {
        div().flex().items_center().px_4().py(px(6.)).tw_text_sm()
    }

    fn render_row(&self, row: &Row, rows: &[Row], cx: &mut Context<Self>) -> AnyElement {
        let t = cx.tokens().clone();
        let draft = self.editing.as_ref().filter(|(c, _)| *c == row.combo).map(|(_, d)| d.clone()).unwrap_or(Draft { combo: row.combo.clone(), binding: row.binding.clone() });
        let dirty = draft.combo != row.combo || draft.binding != row.binding;
        let recording = self.recording.as_deref() == Some(row.combo.as_str());
        let show_pill = !recording && !dirty && !row.combo.is_empty();
        let combo = row.combo.clone();
        let key_cell: AnyElement = if show_pill {
            let c = combo.clone();
            div()
                .id(SharedString::from(format!("kb-pill-{combo}")))
                .group("kb-pill")
                .h_7()
                .flex()
                .items_center()
                .gap(px(6.))
                .tw_rounded_md()
                .border_1()
                .border_color(gpui::transparent_black())
                .px(px(6.))
                .cursor_pointer()
                .hover(|s| s.border_color(with_alpha(t.border, 0.7)).bg(t.background))
                .on_click(cx.listener(move |this, _, w, cx| this.start_recording(c.clone(), w, cx)))
                .child(pill(&row.combo))
                .child(
                    div()
                        .tw_text_10()
                        .text_color(gpui::transparent_black())
                        .group_hover("kb-pill", |s| s.text_color(with_alpha(t.muted_foreground, 0.7)))
                        .child("EDIT"),
                )
                .into_any_element()
        } else {
            self.capture_box(&row.combo, &draft.combo, cx)
        };
        let (c_save, d_save) = (combo.clone(), draft.clone());
        let (c_reset, c_rm) = (combo.clone(), combo.clone());
        let can_reset = !row.is_default;
        self.grid_row()
            .hover(|s| s.bg(with_alpha(t.accent, 0.4)))
            .child(
                div().flex_1().min_w(px(190.)).pr_4().child(
                    Tooltip::new(row.binding.get("type").and_then(|v| v.as_str()).unwrap_or_default().to_string())
                        .child(div().tw_text_13().font_weight(FontWeight::MEDIUM).overflow_hidden().text_ellipsis().whitespace_nowrap().child(row.action.clone())),
                ),
            )
            .child(
                div()
                    .w(px(240.))
                    .flex()
                    .items_center()
                    .gap_2()
                    .pr_4()
                    .child(key_cell)
                    .when(dirty, |d| {
                        d.child(
                            Button::new(SharedString::from(format!("kb-save-{combo}")))
                                .size(ButtonSize::Sm)
                                .label("Save")
                                .disabled(draft.combo.trim().is_empty())
                                .on_click(cx.listener(move |this, _, _, cx| this.save_row(Some(c_save.clone()), d_save.clone(), cx))),
                        )
                    }),
            )
            .child(div().flex_1().min_w(px(210.)).pr_4().child(self.fields_editor(&row.combo, &draft.binding, cx)))
            .child(
                div()
                    .w(px(60.))
                    .flex()
                    .items_center()
                    .justify_end()
                    .gap_1()
                    .children(Self::conflict_icon(conflicts(rows, &draft.combo, Some(&row.combo))))
                    .child({
                        let this = cx.entity();
                        DropdownMenu::new(SharedString::from(format!("kb-menu-{combo}")))
                            .align(Align::End)
                            .trigger(Button::new(SharedString::from(format!("kb-menu-btn-{combo}"))).ghost().size(ButtonSize::IconSm).icon(IconName::EllipsisVertical))
                            .menu(move |m, _, _| {
                                let (t1, t2, c1, c2) = (this.clone(), this.clone(), c_reset.clone(), c_rm.clone());
                                m.min_w(144.)
                                    .when(can_reset, |m| {
                                        m.item(MenuItem::new("Reset to default").icon(IconName::RotateCcw).on_select(move |_, cx| t1.update(cx, |p, cx| p.reset_row(&c1, cx))))
                                    })
                                    .item(MenuItem::new("Remove").icon(IconName::Trash).destructive().on_select(move |_, cx| t2.update(cx, |p, cx| p.remove_row(&c2, cx))))
                            })
                    }),
            )
            .into_any_element()
    }

    fn render_new_row(&self, rows: &[Row], cx: &mut Context<Self>) -> AnyElement {
        let t = cx.tokens().clone();
        let draft = self.new_draft.clone();
        let kind = draft.binding.get("type").and_then(|v| v.as_str()).unwrap_or_default().to_string();
        let this = cx.entity();
        let d_save = draft.clone();
        self.grid_row()
            .hover(|s| s.bg(with_alpha(t.accent, 0.4)))
            .child(
                div().flex_1().min_w(px(190.)).pr_4().child(
                    Select::with_search("kb-new-action")
                        .small()
                        .w(px(176.))
                        .options(ACTIONS.iter().map(|(id, n, _)| SelectOption::new(*id, *n)))
                        .value(Some(kind))
                        .on_change(move |v, _, cx| this.update(cx, |p, cx| {
                            p.new_draft.binding = json!({"type": v.to_string()});
                            cx.notify();
                        })),
                ),
            )
            .child(
                div()
                    .w(px(240.))
                    .flex()
                    .items_center()
                    .gap_2()
                    .pr_4()
                    .child(self.capture_box("new", &draft.combo, cx))
                    .child(
                        Button::new("kb-new-save")
                            .size(ButtonSize::Sm)
                            .label("Save")
                            .disabled(draft.combo.trim().is_empty())
                            .on_click(cx.listener(move |this, _, _, cx| this.save_row(None, d_save.clone(), cx))),
                    ),
            )
            .child(div().flex_1().min_w(px(210.)).pr_4().child(self.fields_editor("new", &draft.binding, cx)))
            .child(
                div()
                    .w(px(60.))
                    .flex()
                    .items_center()
                    .justify_end()
                    .gap_1()
                    .children(Self::conflict_icon(conflicts(rows, &draft.combo, Some("new"))))
                    .child(Button::new("kb-new-cancel").ghost().size(ButtonSize::IconSm).icon(IconName::X).on_click(cx.listener(|this, _, _, cx| {
                        this.adding = false;
                        cx.notify();
                    }))),
            )
            .into_any_element()
    }
}

/// `Tooltip` wrapping a button whose click handler is attached afterwards.
trait OnClickChild {
    fn on_click_child(self, f: impl Fn(&gpui::ClickEvent, &mut Window, &mut App) + 'static) -> AnyElement;
}
impl OnClickChild for Tooltip {
    fn on_click_child(self, f: impl Fn(&gpui::ClickEvent, &mut Window, &mut App) + 'static) -> AnyElement {
        div().id("kb-click-wrap").on_click(f).child(self).into_any_element()
    }
}

impl Render for KeybindingsPanel {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        let rows = build_rows(&self.bindings, &self.query);
        let count = rows.len() + usize::from(self.adding);
        let mut body = div().flex().flex_col();
        let mut items: Vec<AnyElement> = Vec::new();
        if self.adding {
            items.push(self.render_new_row(&rows, cx));
        }
        for r in &rows {
            items.push(self.render_row(r, &rows, cx));
        }
        let n = items.len();
        for (i, item) in items.into_iter().enumerate() {
            body = body.child(div().when(i + 1 < n, |d| d.border_b_1().border_color(with_alpha(t.border, 0.6))).child(item));
        }
        if rows.is_empty() && !self.adding {
            body = body.child(div().px_4().py_12().flex().justify_center().tw_text_sm().text_color(t.muted_foreground).child("No keybindings match your search."));
        }
        div()
            .flex()
            .flex_col()
            .gap_4()
            .track_focus(&self.capture)
            .on_key_down(cx.listener(Self::on_capture_key))
            .child(self.header(count, cx))
            .child(
                div()
                    .tw_rounded_lg()
                    .border_1()
                    .border_color(t.border)
                    .bg(with_alpha(t.card, 0.6))
                    .overflow_hidden()
                    .child(
                        div()
                            .min_w(px(680.))
                            .child(
                                div()
                                    .flex()
                                    .border_b_1()
                                    .border_color(with_alpha(t.border, 0.7))
                                    .bg(with_alpha(t.muted, 0.25))
                                    .px_4()
                                    .py_2()
                                    .tw_text_11()
                                    .font_weight(FontWeight::SEMIBOLD)
                                    .text_color(t.muted_foreground)
                                    .child(div().flex_1().min_w(px(190.)).child("COMMAND"))
                                    .child(div().w(px(240.)).child("KEYBINDING"))
                                    .child(div().flex_1().min_w(px(210.)).child("PARAMETERS"))
                                    .child(div().w(px(60.)).flex().justify_end().child("STATUS")),
                            )
                            .child(body),
                    ),
            )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_and_rows() {
        let d = defaults();
        assert_eq!(d.len(), defaults_raw().len());
        let rows = build_rows(&d, "");
        assert!(rows.iter().all(|r| r.is_default));
        assert!(!build_rows(&d, "command menu").is_empty());
        assert_eq!(describe(&json!({"type": "OPEN_DATABASE_VIEW", "view": "enums"})), "View Enums");
        assert_eq!(normalize_combo("Command+Shift+Shift+K"), if cfg!(target_os = "macos") { "Cmd+Shift+K" } else { "Ctrl+Shift+K" });
    }
}
