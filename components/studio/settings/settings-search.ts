"use client";

import type { SettingsSectionId } from "./settings-sidebar";

export interface SettingsSearchEntry {
  /** Stable id. Matches the `data-setting-id` attribute rendered in SettingsView for deep-scroll. */
  id: string;
  section: SettingsSectionId;
  title: string;
  description: string;
  keywords: string[];
}

export const SETTINGS_SECTION_LABELS: Record<SettingsSectionId, string> = {
  general: "General",
  editor: "Editor",
  themes: "Themes",
  ai: "AI",
  mcp: "MCP Server",
  security: "Security",
  keybindings: "Keybindings",
  advanced: "Advanced",
  workspace: "Workspace",
};

export const SETTINGS_SEARCH_INDEX: SettingsSearchEntry[] = [
  // ---- General ----
  { id: "appearance", section: "general", title: "Appearance", description: "Select how Rexa DB looks on your device (light, dark, system).", keywords: ["theme", "light", "dark", "system", "mode"] },
  { id: "app-theme", section: "general", title: "App Theme", description: "Choose a built-in theme or add a custom palette for the whole app.", keywords: ["theme", "palette", "color", "custom"] },
  { id: "app-font", section: "general", title: "App Font", description: "Customize the application font family.", keywords: ["font", "typography", "text", "family"] },
  { id: "icon-theme", section: "general", title: "Icon Theme", description: "Choose the icon pack used across the app.", keywords: ["icons", "pack", "lucide", "solar"] },
  { id: "zoom", section: "general", title: "Zoom Level", description: "Scale the whole application UI.", keywords: ["zoom", "scale", "size"] },
  { id: "row-spacing", section: "general", title: "Row Spacing", description: "Adjust the vertical spacing between rows in data tables.", keywords: ["rows", "density", "compact", "comfortable", "table", "grid"] },
  { id: "tui-mode", section: "general", title: "Terminal UI", description: "Switch the app to a blocky terminal-style UI with mono typography.", keywords: ["terminal", "tui", "mono", "experimental"] },
  { id: "tui-theme", section: "general", title: "Terminal Theme", description: "Choose light, dark, or follow system while in terminal UI.", keywords: ["terminal", "tui", "theme"] },
  { id: "sleek-layout", section: "general", title: "Sleek Layout", description: "Add padding and rounded corners to main interface panels.", keywords: ["layout", "padding", "rounded", "panels"] },
  { id: "translucent-bg", section: "general", title: "Translucent Background", description: "Make the outer chrome translucent with a blur effect.", keywords: ["translucent", "blur", "transparency", "vibrancy", "background"] },
  { id: "bg-noise", section: "general", title: "Background Noise", description: "Add a subtle grain texture to the sidebar and outer surface.", keywords: ["noise", "grain", "texture", "background"] },
  { id: "noise-size", section: "general", title: "Noise Size", description: "Scale of the noise pattern (smaller = finer grain).", keywords: ["noise", "grain", "size", "scale"] },
  { id: "noise-blend", section: "general", title: "Noise Blend Mode", description: "How the noise blends with the background.", keywords: ["noise", "blend", "overlay", "multiply"] },
  { id: "noise-color", section: "general", title: "Noise Color", description: "Tint color for the noise texture.", keywords: ["noise", "color", "tint"] },
  { id: "noise-opacity", section: "general", title: "Noise Opacity", description: "Strength of the noise effect.", keywords: ["noise", "opacity", "strength"] },
  { id: "alternating-rows", section: "general", title: "Alternating Row Colors", description: "Apply alternating background colors to rows in data tables.", keywords: ["rows", "striped", "zebra", "table", "grid"] },
  { id: "pending-banner", section: "general", title: "Show Pending Changes Banner", description: "Display a banner above the data grid when there are unsaved changes.", keywords: ["pending", "unsaved", "banner", "changes", "dirty"] },
  { id: "restore-state", section: "general", title: "Restore App State", description: "Reopen tabs and restore your previous session on return.", keywords: ["restore", "session", "tabs", "reopen", "startup"] },
  { id: "autosave-queries", section: "general", title: "Auto-Save Executed Queries", description: "Automatically save every executed query as a snippet.", keywords: ["autosave", "auto-save", "snippets", "history", "queries"] },
  { id: "local-search-index", section: "general", title: "Local Search Index", description: "Cache universal search results in a local SQLite database.", keywords: ["search", "index", "cache", "sqlite", "local"] },

  // ---- Editor ----
  { id: "editor-font-size", section: "editor", title: "Editor Font Size", description: "Adjust the font size for query editors.", keywords: ["font", "size", "sql", "editor", "text"] },
  { id: "editor-font-family", section: "editor", title: "Editor Font Family", description: "Use a specific font for the SQL editor.", keywords: ["font", "family", "monospace", "sql", "editor"] },
  { id: "vim-mode", section: "editor", title: "Vim Mode", description: "Enable Vim keybindings for the SQL editor.", keywords: ["vim", "keybindings", "modal", "editing"] },
  { id: "result-tabs", section: "editor", title: "Result Tabs", description: "Show query results in individual tabs for multi-statement queries.", keywords: ["results", "tabs", "multi-statement"] },
  { id: "editor-theme", section: "editor", title: "Editor Theme", description: "Choose a built-in theme or add a custom VS Code theme JSON for editors.", keywords: ["theme", "monaco", "vscode", "colors", "syntax"] },
  { id: "sql-keyword-case", section: "editor", title: "SQL Keyword Case", description: "Casing for SQL keywords (SELECT, FROM, WHERE...).", keywords: ["format", "case", "keywords", "upper", "lower"] },
  { id: "sql-datatype-case", section: "editor", title: "SQL Data Type Case", description: "Casing for data types (INT, VARCHAR...).", keywords: ["format", "case", "types"] },
  { id: "sql-function-case", section: "editor", title: "SQL Function Case", description: "Casing for function names (COUNT, SUM...).", keywords: ["format", "case", "functions"] },
  { id: "sql-identifier-case", section: "editor", title: "SQL Identifier Case", description: "Casing for identifiers (experimental).", keywords: ["format", "case", "identifiers", "columns", "tables"] },
  { id: "sql-tab-width", section: "editor", title: "SQL Tab Width", description: "Number of spaces per indentation level.", keywords: ["format", "indent", "tab", "width", "spaces"] },
  { id: "sql-use-tabs", section: "editor", title: "SQL Use Tabs", description: "Use tab characters instead of spaces for indentation.", keywords: ["format", "indent", "tabs", "spaces"] },
  { id: "sql-logical-newline", section: "editor", title: "SQL Logical Operator Newline", description: "Place AND/OR before or after the newline.", keywords: ["format", "and", "or", "newline", "operators"] },
  { id: "sql-expression-width", section: "editor", title: "SQL Expression Width", description: "Max chars in parentheses before wrapping.", keywords: ["format", "width", "wrap", "line length"] },
  { id: "sql-lines-between", section: "editor", title: "SQL Lines Between Queries", description: "Number of blank lines between separate queries.", keywords: ["format", "blank", "lines", "spacing"] },
  { id: "sql-dense-operators", section: "editor", title: "SQL Dense Operators", description: "Remove spaces around operators (e.g. a=b instead of a = b).", keywords: ["format", "operators", "spaces", "dense"] },
  { id: "sql-newline-semicolon", section: "editor", title: "SQL Newline Before Semicolon", description: "Place semicolons on their own line.", keywords: ["format", "semicolon", "newline"] },

  // ---- Themes ----
  { id: "themes-browse", section: "themes", title: "Browse Themes", description: "Browse and install community app and editor themes.", keywords: ["themes", "community", "browse", "install", "gallery"] },
  { id: "themes-custom", section: "themes", title: "Custom Themes", description: "Create and manage custom app, editor, and icon themes.", keywords: ["custom", "create", "theme", "creator", "json"] },

  // ---- AI ----
  { id: "ai-models", section: "ai", title: "AI Models", description: "Configure provider access and permissions.", keywords: ["ai", "models", "providers", "llm", "permissions"] },
  { id: "ai-providers", section: "ai", title: "AI Providers", description: "Configure providers, API keys, and models.", keywords: ["providers", "api", "key", "openai", "anthropic", "ollama", "configure"] },
  { id: "ai-permissions", section: "ai", title: "AI Permissions", description: "Control what database context the AI can access.", keywords: ["permissions", "schema", "data", "access", "privacy"] },
  { id: "slash-ai-trigger", section: "ai", title: "Slash AI Trigger", description: "Type / in an empty editor to activate AI mode.", keywords: ["slash", "trigger", "/", "ai", "assistant", "autocomplete"] },

  // ---- MCP ----
  { id: "mcp-enable", section: "mcp", title: "Enable MCP Server", description: "Expose RexaDB over the Model Context Protocol.", keywords: ["mcp", "server", "model context", "enable"] },
  { id: "mcp-transports", section: "mcp", title: "MCP Transports", description: "Configure stdio and HTTP transports for the MCP server.", keywords: ["mcp", "stdio", "http", "transport", "port"] },
  { id: "mcp-token", section: "mcp", title: "MCP HTTP Auth Token", description: "Manage the auth token for HTTP MCP clients.", keywords: ["mcp", "token", "auth", "http", "secret"] },
  { id: "mcp-modes", section: "mcp", title: "MCP Permission Modes", description: "Define read/write permission modes for MCP connections.", keywords: ["mcp", "permissions", "modes", "read", "write", "autopilot"] },
  { id: "mcp-connections", section: "mcp", title: "MCP Connections", description: "Browse connections exposed over MCP.", keywords: ["mcp", "connections", "expose", "database"] },
  { id: "mcp-client-setup", section: "mcp", title: "MCP Client Setup", description: "Copy-paste setup snippets for Claude Desktop, Cursor, and Claude Code.", keywords: ["mcp", "claude", "cursor", "setup", "snippet", "client"] },

  // ---- Security ----
  { id: "execution-mode", section: "security", title: "Execution Mode", description: "Direct execution or review queries in a panel first.", keywords: ["security", "execution", "review", "direct", "confirm", "safe"] },

  // ---- Keybindings ----
  { id: "keybindings-list", section: "keybindings", title: "Keybindings", description: "View and customize keyboard shortcuts.", keywords: ["keyboard", "shortcuts", "hotkeys", "keys", "bindings"] },

  // ---- Advanced ----
  { id: "tab-indicator", section: "advanced", title: "Show Tab Indicator", description: "Display the primary color line above the active editor tab.", keywords: ["tabs", "indicator", "active", "highlight"] },
  { id: "window-actions", section: "advanced", title: "Window Action Buttons", description: "Show custom minimize, maximize, and close buttons in the header.", keywords: ["window", "minimize", "maximize", "close", "header", "traffic lights"] },
  { id: "sidebar-toggle-pos", section: "advanced", title: "Sidebar Toggle Before Connection", description: "Move the sidebar toggle button before the connection selector.", keywords: ["sidebar", "toggle", "header", "connection"] },
  { id: "glass-headers", section: "advanced", title: "Glassmorphic Sticky Headers", description: "Translucent, blurred backdrop for grid headers.", keywords: ["glass", "headers", "blur", "grid", "sticky"] },
  { id: "grid-animations", section: "advanced", title: "Grid Micro-Animations", description: "Subtle transition effects on row hover.", keywords: ["grid", "animations", "hover", "transitions"] },
  { id: "sleek-selection", section: "advanced", title: "Sleek Selection States", description: "Subtle box-shadow glow for selected cells and rows.", keywords: ["selection", "highlight", "cells", "rows", "glow"] },
  { id: "colorized-pills", section: "advanced", title: "Colorized Pills", description: "Render Booleans and Enums as elegant, colored pills.", keywords: ["pills", "boolean", "enum", "colors", "badges"] },
  { id: "relative-dates", section: "advanced", title: "Relative Dates", description: "Format dates into a more readable relative format.", keywords: ["dates", "relative", "time", "format", "ago"] },
  { id: "json-inspector", section: "advanced", title: "Rich JSON Inspector", description: "Formatted mini-pill for JSON objects with tooltip.", keywords: ["json", "inspector", "tooltip", "object"] },
  { id: "data-bars", section: "advanced", title: "Data Bars", description: "Inline background progress bar for numeric columns.", keywords: ["bars", "numeric", "progress", "visualization", "columns"] },
  { id: "skeleton-loaders", section: "advanced", title: "Skeleton Loaders", description: "Animated skeleton rows during data loading.", keywords: ["skeleton", "loading", "placeholder", "shimmer"] },
  { id: "schema-explorer", section: "advanced", title: "Schema Explorer", description: "Show tables, functions, triggers, and indexes in a unified explorer.", keywords: ["schema", "explorer", "tables", "functions", "triggers", "indexes"] },
  { id: "database-explorer", section: "advanced", title: "Database Explorer", description: "Browse all schemas and object types in a hierarchical tree view.", keywords: ["database", "explorer", "tree", "schemas", "browse"] },
  { id: "table-expansion", section: "advanced", title: "Table Expansion", description: "Show expand/collapse arrows next to table names to view columns inline.", keywords: ["tables", "expand", "collapse", "columns", "sidebar"] },
  { id: "preview-tabs", section: "advanced", title: "Preview Tabs", description: "VS Code-style preview mode for temporary tabs.", keywords: ["preview", "tabs", "temporary", "pin", "vscode"] },
  { id: "autoclose-pane", section: "advanced", title: "Auto-close Empty Panes", description: "Automatically close a split pane when its last tab is closed.", keywords: ["pane", "split", "auto-close", "tabs"] },
  { id: "confirm-sheet-close", section: "advanced", title: "Confirm Unsaved Sheet Close", description: "Show a confirmation dialog when closing a form sheet with unsaved changes.", keywords: ["confirm", "unsaved", "sheet", "dialog", "close"] },
  { id: "sql-engine", section: "advanced", title: "SQL Editor Engine", description: "Choose the underlying SQL editor engine.", keywords: ["engine", "sql", "editor", "monaco"] },
  { id: "rls-tab-editor", section: "advanced", title: "Open RLS Policies in Tab", description: "Edit Row-Level Security policies in an editor tab instead of a side sheet.", keywords: ["rls", "policies", "security", "tab", "row level"] },
  { id: "app-updates", section: "advanced", title: "App Updates", description: "Check for, download, and install application updates.", keywords: ["updates", "version", "download", "install", "upgrade", "license"] },
  { id: "command-menu", section: "advanced", title: "Command Menu Customization", description: "Reorder or show/hide sections in the command menu (⌘K).", keywords: ["command", "menu", "palette", "cmdk", "reorder", "sections"] },

  // ---- Workspace ----
  { id: "workspace-connect", section: "workspace", title: "Connect Workspace", description: "Connect to a rexadb-studio workspace to manage shared connections.", keywords: ["workspace", "connect", "studio", "shared", "team"] },
  { id: "workspace-invite", section: "workspace", title: "Accept Invite", description: "Join a workspace with an invite token.", keywords: ["invite", "token", "join", "workspace"] },
  { id: "workspace-signin", section: "workspace", title: "Workspace Sign In", description: "Sign in to a workspace with email and password.", keywords: ["sign in", "login", "email", "password", "workspace", "totp", "2fa"] },
  { id: "workspace-saved", section: "workspace", title: "Saved Workspaces", description: "Switch between or remove saved workspaces.", keywords: ["saved", "workspaces", "switch", "remove"] },
];

export function filterSettingsSearch(query: string): SettingsSearchEntry[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  return SETTINGS_SEARCH_INDEX.filter((entry) => {
    const haystack =
      `${entry.title} ${entry.description} ${SETTINGS_SECTION_LABELS[entry.section]} ${entry.keywords.join(" ")}`.toLowerCase();
    return tokens.every((token) => haystack.includes(token));
  });
}
