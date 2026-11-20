//! Port of components/studio/settings/settings-search.ts.

pub struct Entry {
    /// Matches the setting row id used for the deep-link highlight.
    pub id: &'static str,
    pub section: &'static str,
    pub title: &'static str,
    pub description: &'static str,
    pub keywords: &'static [&'static str],
}

pub const SECTION_LABELS: &[(&str, &str)] = &[
    ("general", "General"),
    ("editor", "Editor"),
    ("themes", "Themes"),
    ("ai", "AI"),
    ("mcp", "MCP Server"),
    ("security", "Security"),
    ("keybindings", "Keybindings"),
    ("advanced", "Advanced"),
    ("workspace", "Workspace"),
];

pub fn section_label(id: &str) -> &'static str {
    SECTION_LABELS.iter().find(|(s, _)| *s == id).map_or("", |(_, l)| l)
}

pub const INDEX: &[Entry] = &[

    Entry { id: "appearance", section: "general", title: "Appearance", description: "Select how Rexa DB looks on your device (light, dark, system).", keywords: &["theme", "light", "dark", "system", "mode"] },
    Entry { id: "app-theme", section: "general", title: "App Theme", description: "Choose a built-in theme or add a custom palette for the whole app.", keywords: &["theme", "palette", "color", "custom"] },
    Entry { id: "app-font", section: "general", title: "App Font", description: "Customize the application font family.", keywords: &["font", "typography", "text", "family"] },
    Entry { id: "icon-theme", section: "general", title: "Icon Theme", description: "Choose the icon pack used across the app.", keywords: &["icons", "pack", "lucide", "solar"] },
    Entry { id: "app-icon", section: "general", title: "App Icon", description: "Change the icon in the Dock or taskbar, or use your own image.", keywords: &["icon", "dock", "taskbar", "logo", "halloween", "mummy", "skeleton", "custom"] },
    Entry { id: "zoom", section: "general", title: "Zoom Level", description: "Scale the whole application UI.", keywords: &["zoom", "scale", "size"] },
    Entry { id: "infinite-table-scrolling", section: "general", title: "Infinite scrolling", description: "Load more table rows as you scroll. Turn off to use page-by-page navigation.", keywords: &["table", "grid", "infinite", "scroll", "pagination", "rows"] },
    Entry { id: "row-spacing", section: "general", title: "Row Spacing", description: "Adjust the vertical spacing between rows in data tables.", keywords: &["rows", "density", "compact", "comfortable", "table", "grid"] },
    Entry { id: "tui-mode", section: "general", title: "Terminal UI", description: "Switch the app to a blocky terminal-style UI with mono typography.", keywords: &["terminal", "tui", "mono", "experimental"] },
    Entry { id: "tui-theme", section: "general", title: "Terminal Theme", description: "Choose light, dark, or follow system while in terminal UI.", keywords: &["terminal", "tui", "theme"] },
    Entry { id: "sleek-layout", section: "general", title: "Sleek Layout", description: "Add padding and rounded corners to main interface panels.", keywords: &["layout", "padding", "rounded", "panels"] },
    Entry { id: "button-style", section: "general", title: "Button Style", description: "How buttons and dropdowns look in dark mode.", keywords: &["button", "raised", "glass", "flat", "3d", "border", "shadow", "style"] },
    Entry { id: "translucent-bg", section: "general", title: "Translucent Background", description: "Make the outer chrome translucent with a blur effect.", keywords: &["translucent", "blur", "transparency", "vibrancy", "background"] },
    Entry { id: "bg-noise", section: "general", title: "Background Noise", description: "Add a subtle grain texture to the sidebar and outer surface.", keywords: &["noise", "grain", "texture", "background"] },
    Entry { id: "noise-size", section: "general", title: "Noise Size", description: "Scale of the noise pattern (smaller = finer grain).", keywords: &["noise", "grain", "size", "scale"] },
    Entry { id: "noise-blend", section: "general", title: "Noise Blend Mode", description: "How the noise blends with the background.", keywords: &["noise", "blend", "overlay", "multiply"] },
    Entry { id: "noise-color", section: "general", title: "Noise Color", description: "Tint color for the noise texture.", keywords: &["noise", "color", "tint"] },
    Entry { id: "noise-opacity", section: "general", title: "Noise Opacity", description: "Strength of the noise effect.", keywords: &["noise", "opacity", "strength"] },
    Entry { id: "alternating-rows", section: "general", title: "Alternating Row Colors", description: "Apply alternating background colors to rows in data tables.", keywords: &["rows", "striped", "zebra", "table", "grid"] },
    Entry { id: "pending-banner", section: "general", title: "Show Pending Changes Banner", description: "Display a banner above the data grid when there are unsaved changes.", keywords: &["pending", "unsaved", "banner", "changes", "dirty"] },
    Entry { id: "restore-state", section: "general", title: "Restore App State", description: "Reopen tabs and restore your previous session on return.", keywords: &["restore", "session", "tabs", "reopen", "startup"] },
    Entry { id: "open-new-window", section: "general", title: "Open Connections in New Window", description: "Each connection opens in its own window instead of replacing the current one.", keywords: &["window", "new window", "connections", "open", "multi-window", "separate"] },
    Entry { id: "autosave-queries", section: "general", title: "Auto-Save Executed Queries", description: "Automatically save every executed query as a snippet.", keywords: &["autosave", "auto-save", "snippets", "history", "queries"] },
    Entry { id: "local-search-index", section: "general", title: "Local Search Index", description: "Cache universal search results in a local SQLite database.", keywords: &["search", "index", "cache", "sqlite", "local"] },
    Entry { id: "editor-font-size", section: "editor", title: "Editor Font Size", description: "Adjust the font size for query editors.", keywords: &["font", "size", "sql", "editor", "text"] },
    Entry { id: "editor-font-family", section: "editor", title: "Editor Font Family", description: "Use a specific font for the SQL editor.", keywords: &["font", "family", "monospace", "sql", "editor"] },
    Entry { id: "vim-mode", section: "editor", title: "Vim Mode", description: "Enable Vim keybindings for the SQL editor.", keywords: &["vim", "keybindings", "modal", "editing"] },
    Entry { id: "result-tabs", section: "editor", title: "Result Tabs", description: "Show query results in individual tabs for multi-statement queries.", keywords: &["results", "tabs", "multi-statement"] },
    Entry { id: "editor-theme", section: "editor", title: "Editor Theme", description: "Choose a built-in theme or add a custom VS Code theme JSON for editors.", keywords: &["theme", "monaco", "vscode", "colors", "syntax"] },
    Entry { id: "sql-keyword-case", section: "editor", title: "SQL Keyword Case", description: "Casing for SQL keywords (SELECT, FROM, WHERE...).", keywords: &["format", "case", "keywords", "upper", "lower"] },
    Entry { id: "sql-datatype-case", section: "editor", title: "SQL Data Type Case", description: "Casing for data types (INT, VARCHAR...).", keywords: &["format", "case", "types"] },
    Entry { id: "sql-function-case", section: "editor", title: "SQL Function Case", description: "Casing for function names (COUNT, SUM...).", keywords: &["format", "case", "functions"] },
    Entry { id: "sql-identifier-case", section: "editor", title: "SQL Identifier Case", description: "Casing for identifiers (experimental).", keywords: &["format", "case", "identifiers", "columns", "tables"] },
    Entry { id: "sql-tab-width", section: "editor", title: "SQL Tab Width", description: "Number of spaces per indentation level.", keywords: &["format", "indent", "tab", "width", "spaces"] },
    Entry { id: "sql-use-tabs", section: "editor", title: "SQL Use Tabs", description: "Use tab characters instead of spaces for indentation.", keywords: &["format", "indent", "tabs", "spaces"] },
    Entry { id: "sql-logical-newline", section: "editor", title: "SQL Logical Operator Newline", description: "Place AND/OR before or after the newline.", keywords: &["format", "and", "or", "newline", "operators"] },
    Entry { id: "sql-expression-width", section: "editor", title: "SQL Expression Width", description: "Max chars in parentheses before wrapping.", keywords: &["format", "width", "wrap", "line length"] },
    Entry { id: "sql-lines-between", section: "editor", title: "SQL Lines Between Queries", description: "Number of blank lines between separate queries.", keywords: &["format", "blank", "lines", "spacing"] },
    Entry { id: "sql-dense-operators", section: "editor", title: "SQL Dense Operators", description: "Remove spaces around operators (e.g. a=b instead of a = b).", keywords: &["format", "operators", "spaces", "dense"] },
    Entry { id: "sql-newline-semicolon", section: "editor", title: "SQL Newline Before Semicolon", description: "Place semicolons on their own line.", keywords: &["format", "semicolon", "newline"] },
    Entry { id: "themes-browse", section: "themes", title: "Browse Themes", description: "Browse and install community app and editor themes.", keywords: &["themes", "community", "browse", "install", "gallery"] },
    Entry { id: "themes-custom", section: "themes", title: "Custom Themes", description: "Create and manage custom app, editor, and icon themes.", keywords: &["custom", "create", "theme", "creator", "json"] },
    Entry { id: "ai-models", section: "ai", title: "AI Models", description: "Configure provider access and permissions.", keywords: &["ai", "models", "providers", "llm", "permissions"] },
    Entry { id: "ai-providers", section: "ai", title: "AI Providers", description: "Configure providers, API keys, and models.", keywords: &["providers", "api", "key", "openai", "anthropic", "ollama", "configure"] },
    Entry { id: "ai-permissions", section: "ai", title: "AI Permissions", description: "Control what database context the AI can access.", keywords: &["permissions", "schema", "data", "access", "privacy"] },
    Entry { id: "slash-ai-trigger", section: "ai", title: "Slash AI Trigger", description: "Type / in an empty editor to activate AI mode.", keywords: &["slash", "trigger", "/", "ai", "assistant", "autocomplete"] },
    Entry { id: "mcp-enable", section: "mcp", title: "Enable MCP Server", description: "Expose RexaDB over the Model Context Protocol.", keywords: &["mcp", "server", "model context", "enable"] },
    Entry { id: "mcp-transports", section: "mcp", title: "MCP Transports", description: "Configure stdio and HTTP transports for the MCP server.", keywords: &["mcp", "stdio", "http", "transport", "port"] },
    Entry { id: "mcp-token", section: "mcp", title: "MCP HTTP Auth Token", description: "Manage the auth token for HTTP MCP clients.", keywords: &["mcp", "token", "auth", "http", "secret"] },
    Entry { id: "mcp-modes", section: "mcp", title: "MCP Permission Modes", description: "Define read/write permission modes for MCP connections.", keywords: &["mcp", "permissions", "modes", "read", "write", "autopilot"] },
    Entry { id: "mcp-connections", section: "mcp", title: "MCP Connections", description: "Browse connections exposed over MCP.", keywords: &["mcp", "connections", "expose", "database"] },
    Entry { id: "mcp-client-setup", section: "mcp", title: "MCP Client Setup", description: "Copy-paste setup snippets for Claude Desktop, Cursor, and Claude Code.", keywords: &["mcp", "claude", "cursor", "setup", "snippet", "client"] },
    Entry { id: "credential-storage", section: "security", title: "Connection Credential Storage", description: "Choose the operating-system keychain, encrypted local vault, or plaintext storage for saved credentials.", keywords: &["credentials", "password", "keychain", "vault", "encrypt", "secret", "plaintext", "storage"] },
    Entry { id: "execution-mode", section: "security", title: "Execution Mode", description: "Direct execution or review queries in a panel first.", keywords: &["security", "execution", "review", "direct", "confirm", "safe"] },
    Entry { id: "keybindings-list", section: "keybindings", title: "Keybindings", description: "View and customize keyboard shortcuts.", keywords: &["keyboard", "shortcuts", "hotkeys", "keys", "bindings"] },
    Entry { id: "tab-indicator", section: "advanced", title: "Show Tab Indicator", description: "Display the primary color line above the active editor tab.", keywords: &["tabs", "indicator", "active", "highlight"] },
    Entry { id: "window-actions", section: "advanced", title: "Window Action Buttons", description: "Show custom minimize, maximize, and close buttons in the header.", keywords: &["window", "minimize", "maximize", "close", "header", "traffic lights"] },
    Entry { id: "sidebar-toggle-pos", section: "advanced", title: "Sidebar Toggle Before Connection", description: "Move the sidebar toggle button before the connection selector.", keywords: &["sidebar", "toggle", "header", "connection"] },
    Entry { id: "glass-headers", section: "advanced", title: "Glassmorphic Sticky Headers", description: "Translucent, blurred backdrop for grid headers.", keywords: &["glass", "headers", "blur", "grid", "sticky"] },
    Entry { id: "grid-animations", section: "advanced", title: "Grid Micro-Animations", description: "Subtle transition effects on row hover.", keywords: &["grid", "animations", "hover", "transitions"] },
    Entry { id: "sleek-selection", section: "advanced", title: "Sleek Selection States", description: "Subtle box-shadow glow for selected cells and rows.", keywords: &["selection", "highlight", "cells", "rows", "glow"] },
    Entry { id: "colorized-pills", section: "advanced", title: "Colorized Pills", description: "Render Booleans and Enums as elegant, colored pills.", keywords: &["pills", "boolean", "enum", "colors", "badges"] },
    Entry { id: "relative-dates", section: "advanced", title: "Relative Dates", description: "Format dates into a more readable relative format.", keywords: &["dates", "relative", "time", "format", "ago"] },
    Entry { id: "json-inspector", section: "advanced", title: "Rich JSON Inspector", description: "Formatted mini-pill for JSON objects with tooltip.", keywords: &["json", "inspector", "tooltip", "object"] },
    Entry { id: "data-bars", section: "advanced", title: "Data Bars", description: "Inline background progress bar for numeric columns.", keywords: &["bars", "numeric", "progress", "visualization", "columns"] },
    Entry { id: "skeleton-loaders", section: "advanced", title: "Skeleton Loaders", description: "Animated skeleton rows during data loading.", keywords: &["skeleton", "loading", "placeholder", "shimmer"] },
    Entry { id: "fast-table-loading", section: "advanced", title: "Fast table loading", description: "Show SQL table rows before the exact row count finishes.", keywords: &["table", "performance", "count", "filter", "speed", "pagination"] },
    Entry { id: "schema-explorer", section: "advanced", title: "Schema Explorer", description: "Show tables, functions, triggers, and indexes in a unified explorer.", keywords: &["schema", "explorer", "tables", "functions", "triggers", "indexes"] },
    Entry { id: "database-explorer", section: "advanced", title: "Database Explorer", description: "Browse all schemas and object types in a hierarchical tree view.", keywords: &["database", "explorer", "tree", "schemas", "browse"] },
    Entry { id: "table-expansion", section: "advanced", title: "Table Expansion", description: "Show expand/collapse arrows next to table names to view columns inline.", keywords: &["tables", "expand", "collapse", "columns", "sidebar"] },
    Entry { id: "show-table-count", section: "advanced", title: "Show table count", description: "Show the number of tables beside the A-Z / Tags toggle in the Tables sidebar.", keywords: &["tables", "count", "number", "sidebar", "a-z", "tags"] },
    Entry { id: "redis-key-tree-view", section: "advanced", title: "Redis keys tree view", description: "Show Redis keys in the sidebar as a nested tree split on ':' (org:id → org › id). Parent keys stay clickable to open their own value.", keywords: &["redis", "keys", "tree", "nested", "hierarchy", "expand", "sidebar"] },
    Entry { id: "preview-tabs", section: "advanced", title: "Preview Tabs", description: "VS Code-style preview mode for temporary tabs.", keywords: &["preview", "tabs", "temporary", "pin", "vscode"] },
    Entry { id: "autoclose-pane", section: "advanced", title: "Auto-close Empty Panes", description: "Automatically close a split pane when its last tab is closed.", keywords: &["pane", "split", "auto-close", "tabs"] },
    Entry { id: "confirm-sheet-close", section: "advanced", title: "Confirm Unsaved Sheet Close", description: "Show a confirmation dialog when closing a form sheet with unsaved changes.", keywords: &["confirm", "unsaved", "sheet", "dialog", "close"] },
    Entry { id: "sql-engine", section: "advanced", title: "SQL Editor Engine", description: "Choose the underlying SQL editor engine.", keywords: &["engine", "sql", "editor", "monaco"] },
    Entry { id: "rls-tab-editor", section: "advanced", title: "Open RLS Policies in Tab", description: "Edit Row-Level Security policies in an editor tab instead of a side sheet.", keywords: &["rls", "policies", "security", "tab", "row level"] },
    Entry { id: "send-diagnostics", section: "advanced", title: "Send Diagnostics", description: "Upload error reports to help fix crashes. Off by default.", keywords: &["privacy", "telemetry", "diagnostics", "error", "crash", "reports", "opt-in", "opt-out"] },
    Entry { id: "auto-update-checks", section: "advanced", title: "Check for Updates Automatically", description: "Ask GitHub for the latest release when the app starts.", keywords: &["privacy", "updates", "automatic", "network", "offline", "opt-out"] },
    Entry { id: "app-updates", section: "advanced", title: "App Updates", description: "Check for, download, and install application updates.", keywords: &["updates", "version", "download", "install", "upgrade", "license"] },
    Entry { id: "command-menu", section: "advanced", title: "Command Menu Customization", description: "Reorder or show/hide sections in the command menu (⌘K).", keywords: &["command", "menu", "palette", "cmdk", "reorder", "sections"] },
    Entry { id: "danger-zone-reset", section: "advanced", title: "Danger Zone — Reset Everything", description: "Reset all settings to factory defaults and clear local caches.", keywords: &["danger", "reset", "wipe", "clear", "defaults", "factory"] },
    Entry { id: "workspace-local-server", section: "workspace", title: "Local RexaDB Studio Server", description: "Set up, start, or stop a rexadb-studio server on this computer.", keywords: &["workspace", "server", "local", "start", "setup"] },
    Entry { id: "workspace-connect", section: "workspace", title: "Connect Workspace", description: "Connect to a rexadb-studio workspace to manage shared connections.", keywords: &["workspace", "connect", "studio", "shared", "team"] },
    Entry { id: "workspace-invite", section: "workspace", title: "Accept Invite", description: "Join a workspace with an invite token.", keywords: &["invite", "token", "join", "workspace"] },
    Entry { id: "workspace-signin", section: "workspace", title: "Workspace Sign In", description: "Sign in to a workspace with email and password.", keywords: &["sign in", "login", "email", "password", "workspace", "totp", "2fa"] },
    Entry { id: "workspace-saved", section: "workspace", title: "Saved Workspaces", description: "Switch between or remove saved workspaces.", keywords: &["saved", "workspaces", "switch", "remove"] },
];

/// filterSettingsSearch: every whitespace token must appear in
/// "title description sectionLabel keywords" (case-insensitive). The native
/// app is the desktop app, so desktop-only entries always count.
pub fn filter(query: &str) -> Vec<&'static Entry> {
    let q = query.trim().to_lowercase();
    let tokens: Vec<&str> = q.split_whitespace().collect();
    if tokens.is_empty() {
        return Vec::new();
    }
    INDEX
        .iter()
        .filter(|e| {
            let hay = format!("{} {} {} {}", e.title, e.description, section_label(e.section), e.keywords.join(" ")).to_lowercase();
            tokens.iter().all(|t| hay.contains(t))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    #[test]
    fn filters_by_all_tokens() {
        assert_eq!(super::INDEX.len(), 87);
        let r = super::filter("vim");
        assert_eq!(r[0].id, "vim-mode");
        assert!(super::filter("   ").is_empty());
        assert!(super::filter("noise opacity").iter().any(|e| e.id == "noise-opacity"));
    }
}
