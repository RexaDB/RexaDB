const KEYBINDING_FIELDS = ["schema", "table", "database", "index", "view", "sidebar"] as const;

export type KeybindingField = typeof KEYBINDING_FIELDS[number];

export interface KeybindingActionDefinition {
  id: string;
  name: string;
  fields: KeybindingField[];
}

export const KEYBINDING_ACTIONS: KeybindingActionDefinition[] = [
  { id: "NAVIGATE_TABLE", name: "Navigate to Table", fields: ["schema", "table"] },
  { id: "NAVIGATE_SCHEMA", name: "Navigate to Schema", fields: ["schema"] },
  { id: "NAVIGATE_DATABASE", name: "Navigate to Database", fields: ["database"] },
  { id: "GO_TO_TAB_INDEX", name: "Go to Tab (Index)", fields: ["index"] },
  { id: "GO_TO_NEXT_TAB", name: "Go to Next Tab", fields: [] },
  { id: "GO_TO_PREVIOUS_TAB", name: "Go to Previous Tab", fields: [] },
  { id: "CLOSE_ACTIVE_TAB", name: "Close Active Tab", fields: [] },
  { id: "OPEN_SQL_EDITOR", name: "Open SQL Editor", fields: [] },
  { id: "RUN_ACTIVE_QUERY", name: "Run Active Query", fields: [] },
  { id: "STOP_ACTIVE_QUERY", name: "Stop Active Query", fields: [] },
  { id: "REFRESH_CURRENT_TAB", name: "Refresh Current Tab", fields: [] },
  { id: "COMMIT_PENDING_CHANGES", name: "Commit Pending Changes", fields: [] },
  { id: "OPEN_DATABASE_VIEW", name: "Open Database View", fields: ["view"] },
  { id: "OPEN_HISTORY", name: "Open Query History", fields: [] },
  { id: "OPEN_IMPORT_EXPORT", name: "Open Import / Export", fields: [] },
  { id: "OPEN_DASHBOARD_HOME", name: "Open Dashboard Home", fields: [] },
  { id: "OPEN_SETTINGS", name: "Open Settings", fields: [] },
  { id: "OPEN_PROFILE_SETTINGS", name: "Open Profile Settings", fields: [] },
  { id: "OPEN_KEYBINDINGS", name: "Open Keybindings", fields: [] },
  { id: "OPEN_CREATE_TABLE", name: "Open Create Table", fields: [] },
  { id: "OPEN_CREATE_ENUM", name: "Open Create Enum", fields: [] },
  { id: "OPEN_CREATE_INDEX", name: "Open Create Index", fields: [] },
  { id: "OPEN_CREATE_TRIGGER", name: "Open Create Trigger", fields: [] },
  { id: "OPEN_CREATE_SCHEMA", name: "Open Create Schema", fields: [] },
  { id: "OPEN_CREATE_DATABASE", name: "Open Create Database", fields: [] },
  { id: "TOGGLE_SIDEBAR", name: "Toggle Sidebar", fields: [] },
  { id: "SET_SIDEBAR_VIEW", name: "Set Sidebar View", fields: ["sidebar"] },
  { id: "TOGGLE_COMMAND_MENU", name: "Toggle Command Menu", fields: [] },
  { id: "OPEN_UNIVERSAL_SEARCH", name: "Search All Tables", fields: [] },
  { id: "TOGGLE_GLOBAL_SQL_PANEL", name: "Toggle Global SQL Panel", fields: [] },
  { id: "TOGGLE_AI_PANEL", name: "Toggle AI Panel", fields: [] },
  { id: "TOGGLE_PENDING_CHANGES_PANEL", name: "Toggle Pending Changes Panel", fields: [] },
  { id: "FORMAT_QUERY", name: "Format SQL Query", fields: [] },
  { id: "COPY_QUERY", name: "Copy SQL Query", fields: [] },
  { id: "OPEN_SHORTCUT_NAVIGATOR", name: "Open Shortcut Navigator", fields: [] },
  { id: "OPEN_INSERT_SHEET", name: "Insert Row", fields: [] },
  { id: "ACTIVATE_AI_MODE", name: "Activate AI Mode", fields: [] },
];

export const DB_VIEWS = [
  { id: "schema", name: "Schema Diagram" },
  { id: "tables", name: "Tables" },
  { id: "functions", name: "Functions" },
  { id: "extensions", name: "Extensions" },
  { id: "triggers", name: "Triggers" },
  { id: "enums", name: "Enums" },
  { id: "indexes", name: "Indexes" },
  { id: "rls-policies", name: "RLS Policies" },
] as const;

export const SIDEBAR_VIEWS = [
  { id: "tables", name: "Tables" },
  { id: "sql", name: "SQL Snippets" },
  { id: "database", name: "Database" },
  { id: "dashboard", name: "Dashboard" },
  { id: "workflows", name: "Workflows" },
] as const;

export type Keybinding = {
  type: string;
  schema?: string;
  table?: string;
  database?: string;
  index?: number;
  view?: string;
  sidebar?: string;
  combo?: string;
};

const DEFAULT_KEYBINDINGS: Record<string, Keybinding> = {
  "Cmd+Alt+G": { type: "NAVIGATE_TABLE", schema: "public", table: "users" },
  "Cmd+Alt+P": { type: "NAVIGATE_SCHEMA", schema: "public" },
  "Cmd+Alt+0": { type: "NAVIGATE_DATABASE", database: "postgres" },
  "Cmd+1": { type: "GO_TO_TAB_INDEX", index: 0 },
  "Ctrl+Tab": { type: "GO_TO_NEXT_TAB" },
  "Ctrl+Shift+Tab": { type: "GO_TO_PREVIOUS_TAB" },
  "Cmd+W": { type: "CLOSE_ACTIVE_TAB" },
  "Cmd+N": { type: "OPEN_SQL_EDITOR" },
  "Cmd+Enter": { type: "RUN_ACTIVE_QUERY" },
  "Cmd+.": { type: "STOP_ACTIVE_QUERY" },
  "Cmd+R": { type: "REFRESH_CURRENT_TAB" },
  "Cmd+Shift+Enter": { type: "COMMIT_PENDING_CHANGES" },
  "Cmd+Shift+D": { type: "OPEN_DATABASE_VIEW", view: "schema" },
  "Cmd+Shift+H": { type: "OPEN_HISTORY" },
  "Cmd+Shift+E": { type: "OPEN_IMPORT_EXPORT" },
  "Cmd+Shift+M": { type: "OPEN_DASHBOARD_HOME" },
  "Cmd+,": { type: "OPEN_SETTINGS" },
  "Cmd+Shift+,": { type: "OPEN_PROFILE_SETTINGS" },
  "Cmd+Alt+K": { type: "OPEN_KEYBINDINGS" },
  "Cmd+Alt+T": { type: "OPEN_CREATE_TABLE" },
  "Cmd+Alt+E": { type: "OPEN_CREATE_ENUM" },
  "Cmd+Alt+I": { type: "OPEN_CREATE_INDEX" },
  "Cmd+Alt+R": { type: "OPEN_CREATE_TRIGGER" },
  "Cmd+Alt+S": { type: "OPEN_CREATE_SCHEMA" },
  "Cmd+Alt+B": { type: "OPEN_CREATE_DATABASE" },
  "Cmd+J": { type: "TOGGLE_SIDEBAR" },
  "Cmd+Alt+1": { type: "SET_SIDEBAR_VIEW", sidebar: "tables" },
  "Cmd+K": { type: "TOGGLE_COMMAND_MENU" },
  "Cmd+Shift+F": { type: "OPEN_UNIVERSAL_SEARCH" },
  "Cmd+E": { type: "TOGGLE_GLOBAL_SQL_PANEL" },
  "Cmd+I": { type: "TOGGLE_AI_PANEL" },
  "Cmd+U": { type: "TOGGLE_PENDING_CHANGES_PANEL" },
  "Shift+Alt+F": { type: "FORMAT_QUERY" },
  "Cmd+Shift+C": { type: "COPY_QUERY" },
  "Cmd+T": { type: "OPEN_SHORTCUT_NAVIGATOR" },
  "Cmd+Shift+I": { type: "OPEN_INSERT_SHEET" },
  "/": { type: "ACTIVATE_AI_MODE" },
};

export function describeBinding(
  binding: Keybinding,
  fallback = "No additional options",
): string {
  if (binding.type === "NAVIGATE_TABLE")
    return `In ${binding.schema}.${binding.table}`;
  if (binding.type === "NAVIGATE_SCHEMA") return `Switch to ${binding.schema}`;
  if (binding.type === "NAVIGATE_DATABASE")
    return `Connect to ${binding.database}`;
  if (binding.type === "GO_TO_TAB_INDEX")
    return `Open tab at index ${binding.index}`;
  if (binding.type === "OPEN_DATABASE_VIEW") {
    return `View ${DB_VIEWS.find((view) => view.id === binding.view)?.name || binding.view}`;
  }
  if (binding.type === "SET_SIDEBAR_VIEW") {
    return `Sidebar ${SIDEBAR_VIEWS.find((view) => view.id === binding.sidebar)?.name || binding.sidebar}`;
  }
  return fallback;
}

export function getKeybindingCombo(
  keybindings: Record<string, Keybinding>,
  actionType: string
): string | null {
  for (const [combo, binding] of Object.entries(keybindings)) {
    if (binding.type === actionType) return combo;
  }
  return null;
}

export function getDefaultKeybindings(): Record<string, Keybinding> {
  return { ...DEFAULT_KEYBINDINGS };
}

export function withMissingDefaultKeybindings(
  source: Record<string, Keybinding>
): Record<string, Keybinding> {
  const result: Record<string, Keybinding> = { ...source };
  const existingTypes = new Set(
    Object.values(source)
      .map((binding) => binding?.type)
      .filter((type): type is string => typeof type === "string")
  );

  for (const [combo, binding] of Object.entries(DEFAULT_KEYBINDINGS)) {
    if (!existingTypes.has(binding.type)) {
      result[combo] = { ...binding };
      existingTypes.add(binding.type);
    }
  }

  return result;
}

const KEY_TOKEN_MAP: Record<string, string> = {
  " ": "Space",
  Escape: "Escape",
  Enter: "Enter",
  Return: "Enter",
  Tab: "Tab",
  Backspace: "Backspace",
  Delete: "Delete",
  Insert: "Insert",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  ArrowUp: "ArrowUp",
  ArrowDown: "ArrowDown",
  ArrowLeft: "ArrowLeft",
  ArrowRight: "ArrowRight",
};

function getShortcutKeyToken(rawKey: string): string | null {
  if (!rawKey || ["Control", "Shift", "Alt", "Meta"].includes(rawKey)) {
    return null;
  }
  if (KEY_TOKEN_MAP[rawKey]) {
    return KEY_TOKEN_MAP[rawKey];
  }
  return rawKey.length === 1 ? rawKey.toUpperCase() : rawKey;
}

export function buildShortcutCombo(input: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): string | null {
  const keyToken = getShortcutKeyToken(input.key);
  if (!keyToken) return null;

  const combo: string[] = [];
  if (input.metaKey) combo.push("Cmd");
  if (input.ctrlKey) combo.push("Ctrl");
  if (input.shiftKey) combo.push("Shift");
  if (input.altKey) combo.push("Alt");
  combo.push(keyToken);
  return combo.join("+");
}

type ShortcutPlatform = "mac" | "windows" | "linux";

const PLATFORM_TOKEN_MAP: Record<string, { mac: string; other: string }> = {
  Cmd: { mac: "⌘", other: "Ctrl" },
  Ctrl: { mac: "⌃", other: "Ctrl" },
  Control: { mac: "⌃", other: "Ctrl" },
  Shift: { mac: "⇧", other: "Shift" },
  Alt: { mac: "⌥", other: "Alt" },
  Option: { mac: "⌥", other: "Alt" },
  Enter: { mac: "↩", other: "Enter" },
  Return: { mac: "↩", other: "Enter" },
};

function resolvePlatform(explicit?: ShortcutPlatform): ShortcutPlatform {
  if (explicit) return explicit;
  if (typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/i.test(navigator.platform)) {
    return "mac";
  }
  if (typeof process !== "undefined" && process.platform) {
    return process.platform === "darwin" ? "mac" : process.platform === "win32" ? "windows" : "linux";
  }
  return "windows";
}

export function formatShortcutForPlatform(combo: string, platform?: ShortcutPlatform): string {
  const tokens = combo
    .split("+")
    .map((token) => token.trim())
    .filter(Boolean);
  const resolved = resolvePlatform(platform);
  const isMac = resolved === "mac";
  const mapped = tokens.map((token) => {
    const entry = PLATFORM_TOKEN_MAP[token];
    if (!entry) return token;
    return isMac ? entry.mac : entry.other;
  });
  return isMac ? mapped.join("") : mapped.join("+");
}

function normalizeComboForPlatform(combo: string, platform?: ShortcutPlatform): string {
  const resolved = resolvePlatform(platform);
  const tokens = combo
    .split("+")
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => {
      if (token === "Command") return "Cmd";
      if (token === "Control") return "Ctrl";
      if (token === "Option") return "Alt";
      return token;
    })
    .map((token) => {
      if (resolved === "mac") return token;
      return token === "Cmd" ? "Ctrl" : token;
    });
  const deduped: string[] = [];
  for (const token of tokens) {
    if (deduped.includes(token)) continue;
    deduped.push(token);
  }
  return deduped.join("+");
}

export function normalizeKeybindingsForPlatform(
  bindings: Record<string, Keybinding>,
  platform?: ShortcutPlatform
): Record<string, Keybinding> {
  const result: Record<string, Keybinding> = {};
  for (const [combo, binding] of Object.entries(bindings)) {
    const normalizedCombo = normalizeComboForPlatform(combo, platform);
    if (result[normalizedCombo]) continue;
    result[normalizedCombo] = {
      ...binding,
      combo: binding.combo ? normalizeComboForPlatform(binding.combo, platform) : binding.combo,
    };
  }
  return result;
}
