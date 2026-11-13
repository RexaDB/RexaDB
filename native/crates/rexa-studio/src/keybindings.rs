//! Port of lib/studio/keybindings.ts and lib/db/keybindings-store.ts (read side):
//! the default map, legacy migrations, combo building from a keystroke and
//! platform formatting. User bindings live in `<app data>/keybindings.json`.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
pub struct Keybinding {
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub schema: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub table: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub database: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub index: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub view: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sidebar: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub combo: Option<String>,
}

impl Keybinding {
    fn of(kind: &str) -> Self {
        Self { kind: kind.into(), ..Default::default() }
    }
    pub fn index(&self) -> Option<usize> {
        match &self.index {
            Some(serde_json::Value::Number(n)) => n.as_u64().map(|n| n as usize),
            Some(serde_json::Value::String(s)) => s.parse().ok(),
            _ => None,
        }
    }
}

pub type Keybindings = BTreeMap<String, Keybinding>;

/// DEFAULT_KEYBINDINGS (in declaration order).
pub fn defaults_raw() -> Vec<(&'static str, Keybinding)> {
    let b = Keybinding::of;
    vec![
        ("Cmd+Alt+G", Keybinding { schema: Some("public".into()), table: Some("users".into()), ..b("NAVIGATE_TABLE") }),
        ("Cmd+Alt+P", Keybinding { schema: Some("public".into()), ..b("NAVIGATE_SCHEMA") }),
        ("Cmd+Alt+0", Keybinding { database: Some("postgres".into()), ..b("NAVIGATE_DATABASE") }),
        ("Cmd+1", Keybinding { index: Some(0.into()), ..b("GO_TO_TAB_INDEX") }),
        ("Cmd+Tab", b("GO_TO_NEXT_TAB")),
        ("Cmd+Shift+Tab", b("GO_TO_PREVIOUS_TAB")),
        ("Cmd+W", b("CLOSE_ACTIVE_TAB")),
        ("Cmd+N", b("OPEN_SQL_EDITOR")),
        ("Cmd+Enter", b("RUN_ACTIVE_QUERY")),
        ("Cmd+.", b("STOP_ACTIVE_QUERY")),
        ("Cmd+R", b("REFRESH_CURRENT_TAB")),
        ("Cmd+Shift+Enter", b("COMMIT_PENDING_CHANGES")),
        ("Cmd+Shift+D", Keybinding { view: Some("schema".into()), ..b("OPEN_DATABASE_VIEW") }),
        ("Cmd+Shift+H", b("OPEN_HISTORY")),
        ("Cmd+Shift+E", b("OPEN_IMPORT_EXPORT")),
        ("Cmd+Shift+M", b("OPEN_DASHBOARD_HOME")),
        ("Cmd+,", b("OPEN_SETTINGS")),
        ("Cmd+Shift+,", b("OPEN_PROFILE_SETTINGS")),
        ("Cmd+Alt+K", b("OPEN_KEYBINDINGS")),
        ("Cmd+Alt+T", b("OPEN_CREATE_TABLE")),
        ("Cmd+Alt+E", b("OPEN_CREATE_ENUM")),
        ("Cmd+Alt+I", b("OPEN_CREATE_INDEX")),
        ("Cmd+Alt+R", b("OPEN_CREATE_TRIGGER")),
        ("Cmd+Alt+S", b("OPEN_CREATE_SCHEMA")),
        ("Cmd+Alt+B", b("OPEN_CREATE_DATABASE")),
        ("Cmd+B", b("TOGGLE_SIDEBAR")),
        ("Cmd+J", b("TOGGLE_BOTTOM_PANEL")),
        ("Cmd+Alt+1", Keybinding { sidebar: Some("tables".into()), ..b("SET_SIDEBAR_VIEW") }),
        ("Cmd+K", b("TOGGLE_COMMAND_MENU")),
        ("Cmd+Shift+F", b("OPEN_UNIVERSAL_SEARCH")),
        ("Cmd+E", b("TOGGLE_GLOBAL_SQL_PANEL")),
        ("Cmd+I", b("TOGGLE_AI_PANEL")),
        ("Cmd+U", b("TOGGLE_PENDING_CHANGES_PANEL")),
        ("Shift+Alt+F", b("FORMAT_QUERY")),
        ("Cmd+Shift+C", b("COPY_QUERY")),
        ("Cmd+T", b("OPEN_SHORTCUT_NAVIGATOR")),
        ("Cmd+Shift+I", b("OPEN_INSERT_SHEET")),
        ("/", b("ACTIVATE_AI_MODE")),
    ]
}

/// KEYBINDING_ACTIONS: (id, display name).
pub const ACTIONS: &[(&str, &str)] = &[
    ("NAVIGATE_TABLE", "Navigate to Table"),
    ("NAVIGATE_SCHEMA", "Navigate to Schema"),
    ("NAVIGATE_DATABASE", "Navigate to Database"),
    ("GO_TO_TAB_INDEX", "Go to Tab (Index)"),
    ("GO_TO_NEXT_TAB", "Go to Next Tab"),
    ("GO_TO_PREVIOUS_TAB", "Go to Previous Tab"),
    ("CLOSE_ACTIVE_TAB", "Close Active Tab"),
    ("OPEN_SQL_EDITOR", "Open SQL Editor"),
    ("RUN_ACTIVE_QUERY", "Run Active Query"),
    ("STOP_ACTIVE_QUERY", "Stop Active Query"),
    ("REFRESH_CURRENT_TAB", "Refresh Current Tab"),
    ("COMMIT_PENDING_CHANGES", "Commit Pending Changes"),
    ("OPEN_DATABASE_VIEW", "Open Database View"),
    ("OPEN_HISTORY", "Open Query History"),
    ("OPEN_IMPORT_EXPORT", "Open Import / Export"),
    ("OPEN_DASHBOARD_HOME", "Open Dashboard Home"),
    ("OPEN_SETTINGS", "Open Settings"),
    ("OPEN_PROFILE_SETTINGS", "Open Profile Settings"),
    ("OPEN_KEYBINDINGS", "Open Keybindings"),
    ("OPEN_CREATE_TABLE", "Open Create Table"),
    ("OPEN_CREATE_ENUM", "Open Create Enum"),
    ("OPEN_CREATE_INDEX", "Open Create Index"),
    ("OPEN_CREATE_TRIGGER", "Open Create Trigger"),
    ("OPEN_CREATE_SCHEMA", "Open Create Schema"),
    ("OPEN_CREATE_DATABASE", "Open Create Database"),
    ("TOGGLE_SIDEBAR", "Toggle Sidebar"),
    ("SET_SIDEBAR_VIEW", "Set Sidebar View"),
    ("TOGGLE_COMMAND_MENU", "Toggle Command Menu"),
    ("OPEN_UNIVERSAL_SEARCH", "Search All Tables"),
    ("TOGGLE_GLOBAL_SQL_PANEL", "Toggle SQL Editor Sheet"),
    ("TOGGLE_BOTTOM_PANEL", "Toggle Bottom Panel"),
    ("TOGGLE_AI_PANEL", "Toggle AI Panel"),
    ("TOGGLE_PENDING_CHANGES_PANEL", "Toggle Pending Changes Panel"),
    ("FORMAT_QUERY", "Format SQL Query"),
    ("COPY_QUERY", "Copy SQL Query"),
    ("OPEN_SHORTCUT_NAVIGATOR", "Open Shortcut Navigator"),
    ("OPEN_INSERT_SHEET", "Insert Row"),
    ("ACTIVATE_AI_MODE", "Activate AI Mode"),
    ("TOGGLE_ACTIVITY_BAR", "Toggle Activity Bar"),
    ("TOGGLE_STATUS_BAR", "Toggle Status Bar"),
];

pub fn action_name(kind: &str) -> &str {
    ACTIONS.iter().find(|(id, _)| *id == kind).map_or(kind, |(_, n)| n)
}

/// describeBinding
pub fn describe(b: &Keybinding, fallback: &str) -> String {
    let opt = |o: &Option<String>| o.clone().unwrap_or_default();
    match b.kind.as_str() {
        "NAVIGATE_TABLE" => format!("In {}.{}", opt(&b.schema), opt(&b.table)),
        "NAVIGATE_SCHEMA" => format!("Switch to {}", opt(&b.schema)),
        "NAVIGATE_DATABASE" => format!("Connect to {}", opt(&b.database)),
        "GO_TO_TAB_INDEX" => format!("Open tab at index {}", b.index().map(|i| i.to_string()).unwrap_or_default()),
        "OPEN_DATABASE_VIEW" => {
            let views = [
                ("schema", "Schema Diagram"), ("tables", "Tables"), ("functions", "Functions"), ("extensions", "Extensions"),
                ("triggers", "Triggers"), ("enums", "Enums"), ("indexes", "Indexes"), ("rls-policies", "RLS Policies"),
            ];
            let v = opt(&b.view);
            format!("View {}", views.iter().find(|(id, _)| *id == v).map_or(v.as_str(), |(_, n)| n))
        }
        "SET_SIDEBAR_VIEW" => {
            let views = [
                ("tables", "Tables"), ("sql", "SQL Snippets"), ("database", "Database"), ("dashboard", "Dashboard"),
                ("workflows", "Workflows"), ("erd", "ERD Designer"),
            ];
            let v = opt(&b.sidebar);
            format!("Sidebar {}", views.iter().find(|(id, _)| *id == v).map_or(v.as_str(), |(_, n)| n))
        }
        _ => fallback.to_string(),
    }
}

/// getKeybindingCombo
pub fn combo_for<'a>(bindings: &'a Keybindings, kind: &str) -> Option<&'a str> {
    bindings.iter().find(|(_, b)| b.kind == kind).map(|(c, _)| c.as_str())
}

fn is_mac() -> bool {
    cfg!(target_os = "macos")
}

/// normalizeComboForPlatform
pub fn normalize_combo(combo: &str) -> String {
    let mac = is_mac();
    let input = match (mac, combo) {
        (true, "Ctrl+Tab") => "Cmd+Tab",
        (true, "Ctrl+Shift+Tab") => "Cmd+Shift+Tab",
        _ => combo,
    };
    let mut out: Vec<String> = Vec::new();
    for token in input.split('+').map(str::trim).filter(|t| !t.is_empty()) {
        let token = match token {
            "Command" => "Cmd",
            "Control" => "Ctrl",
            "Option" => "Alt",
            t => t,
        };
        let token = if !mac && token == "Cmd" { "Ctrl" } else { token };
        if !out.iter().any(|t| t == token) {
            out.push(token.to_string());
        }
    }
    out.join("+")
}

pub fn normalize_for_platform(bindings: &Keybindings) -> Keybindings {
    let mut result = Keybindings::new();
    for (combo, binding) in bindings {
        let c = normalize_combo(combo);
        if result.contains_key(&c) {
            continue;
        }
        let mut b = binding.clone();
        b.combo = b.combo.as_deref().map(normalize_combo);
        result.insert(c, b);
    }
    result
}

/// withMissingDefaultKeybindings
pub fn with_missing_defaults(source: Keybindings) -> Keybindings {
    let mut result = source;
    if is_mac() {
        for (old, new) in [("Ctrl+Tab", "Cmd+Tab"), ("Ctrl+Shift+Tab", "Cmd+Shift+Tab")] {
            if result.contains_key(old) && !result.contains_key(new) {
                let b = result.remove(old).unwrap();
                result.insert(new.into(), b);
            }
        }
    }
    let has_bottom = result.values().any(|b| b.kind == "TOGGLE_BOTTOM_PANEL");
    if result.get("Cmd+J").is_some_and(|b| b.kind == "TOGGLE_SIDEBAR") && !has_bottom {
        result.entry("Cmd+B".into()).or_insert_with(|| Keybinding::of("TOGGLE_SIDEBAR"));
        result.insert("Cmd+J".into(), Keybinding::of("TOGGLE_BOTTOM_PANEL"));
    }
    let mut types: std::collections::HashSet<String> = result.values().map(|b| b.kind.clone()).collect();
    for (combo, b) in defaults_raw() {
        if types.contains(&b.kind) || result.contains_key(combo) {
            continue;
        }
        types.insert(b.kind.clone());
        result.insert(combo.into(), b);
    }
    result
}

/// What the old app ends up with: keybindings.json (or defaults), defaults
/// filled in, normalized for this platform.
pub fn load() -> Keybindings {
    let path = rexa_store::app_data_dir().join("keybindings.json");
    let user: Option<Keybindings> = std::fs::read_to_string(path).ok().and_then(|s| serde_json::from_str(&s).ok());
    let base = user.unwrap_or_else(|| defaults_raw().into_iter().map(|(c, b)| (c.to_string(), b)).collect());
    normalize_for_platform(&with_missing_defaults(base))
}

/// buildShortcutCombo from a GPUI keystroke ("Cmd+Shift+F").
pub fn combo_from_keystroke(ks: &gpui::Keystroke) -> Option<String> {
    let key = match ks.key.as_str() {
        "shift" | "control" | "alt" | "platform" | "function" | "cmd" | "ctrl" => return None,
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
    let m = &ks.modifiers;
    let mut parts: Vec<&str> = Vec::new();
    if m.platform {
        parts.push("Cmd");
    }
    if m.control {
        parts.push("Ctrl");
    }
    if m.shift {
        parts.push("Shift");
    }
    if m.alt {
        parts.push("Alt");
    }
    let mut s = parts.join("+");
    if !s.is_empty() {
        s.push('+');
    }
    s.push_str(&key);
    Some(s)
}

/// formatShortcutForPlatform: "Cmd+Shift+F" → "⌘⇧F" on macOS, "Ctrl+Shift+F" elsewhere.
pub fn format_shortcut(combo: &str) -> String {
    let mac = is_mac();
    let mapped: Vec<String> = combo
        .split('+')
        .map(str::trim)
        .filter(|t| !t.is_empty())
        .map(|t| {
            let (m, o) = match t {
                "Cmd" => ("⌘", "Ctrl"),
                "Ctrl" | "Control" => ("⌃", "Ctrl"),
                "Shift" => ("⇧", "Shift"),
                "Alt" | "Option" => ("⌥", "Alt"),
                "Enter" | "Return" => ("↩", "Enter"),
                other => return other.to_string(),
            };
            if mac { m } else { o }.to_string()
        })
        .collect();
    if mac { mapped.join("") } else { mapped.join("+") }
}

pub fn shortcut_label(bindings: &Keybindings, kind: &str, fallback: &str) -> String {
    format_shortcut(combo_for(bindings, kind).unwrap_or(fallback))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fills_defaults_and_migrates_cmd_j() {
        let mut user = Keybindings::new();
        user.insert("Cmd+J".into(), Keybinding::of("TOGGLE_SIDEBAR"));
        let r = with_missing_defaults(user);
        assert_eq!(r["Cmd+J"].kind, "TOGGLE_BOTTOM_PANEL");
        assert_eq!(r["Cmd+B"].kind, "TOGGLE_SIDEBAR");
        assert_eq!(r["Cmd+K"].kind, "TOGGLE_COMMAND_MENU");
    }

    #[test]
    fn parses_repo_keybindings_json() {
        let raw = include_str!("../../../../keybindings.json");
        let parsed: Keybindings = serde_json::from_str(raw).unwrap();
        assert_eq!(parsed["Cmd+1"].index(), Some(0));
    }

    #[test]
    fn formats() {
        if cfg!(target_os = "macos") {
            assert_eq!(format_shortcut("Cmd+Shift+F"), "⌘⇧F");
            assert_eq!(format_shortcut("Cmd+K"), "⌘K");
        }
    }
}
