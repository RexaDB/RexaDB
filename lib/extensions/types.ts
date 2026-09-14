/**
 * RexaDB Extensions — manifest + contribution model.
 *
 * RexaDB-native API inspired by VS Code's extension model (`package.json`
 * `contributes`), tailored to database workflows. Extensions run in a Web
 * Worker sandbox (see `extension-host.ts`) and declare everything statically
 * in the manifest so the UI can render commands/views/themes without running
 * code.
 *
 * Contribution points (v1, covers the VS Code parity surfaces):
 * - commands + keybindings + menus (Cmd+K)
 * - viewsContainers + views (activity rail + sidebar trees / webviews)
 * - webviews / webviewViews / panels (sandboxed iframes)
 * - status bar items
 * - languages + grammars + formatters (Monaco)
 * - color themes (Monaco + CSS variables)
 * - db: drivers, cell renderers, result visualizers
 * - ai: tools / prompt templates
 */

export type ExtensionCapability =
  | "query:read"
  | "query:write"
  | "connections:read"
  | "clipboard"
  | "network"
  | "storage";

export interface ExtensionCommandContribution {
  /** Unique id, e.g. `my-ext.say-hello`. Invoked via rexa.commands.executeCommand. */
  command: string;
  title: string;
  /** Optional Cmd+K grouping, defaults to extension displayName. */
  group?: string;
  /** VS Code-style `when` is accepted and stored but only minimally evaluated in v1. */
  when?: string;
  icon?: string;
}

export interface ExtensionKeybindingContribution {
  command: string;
  key: string;
  mac?: string;
  when?: string;
}

export interface ExtensionViewContainerContribution {
  id: string;
  title: string;
  /** Same format as rail item icons: inline `<svg…>`, short glyph, or omitted. */
  icon?: string;
  /**
   * Free-form sidebar page: full-height HTML rendered INSTEAD of the views
   * list when this container's standalone sidebar is open. This is how an
   * extension builds whatever it wants (table-explorer-like, dashboard-like)
   * rather than a stack of declared views. Runtime alternative:
   * `rexa.window.registerSidebarPage(containerId, html)`.
   */
  html?: string;
}

/** Static activity-rail item. View containers also become rail items
 *  automatically — unless the manifest declares `railItems` explicitly, in
 *  which case the explicit list wins (no duplicates).
 *
 *  `icon` is an inline `<svg…>` string, a short text/emoji glyph (≤4 chars),
 *  or omitted for the default puzzle icon. */
export interface ExtensionRailItemContribution {
  id: string;
  title: string;
  icon?: string;
  tooltip?: string;
  /** Command executed on click (Cmd+K id). */
  command?: string;
  /** Sidebar view revealed on click (views[].id). */
  viewId?: string;
}
export interface ExtensionViewContribution {
  id: string;
  name: string;
  /** Rail container this view lives in. Built-ins: `explorer`, `database`, custom containers. */
  containerId?: string;
  /** `tree` = TreeDataProvider driven, `webview` = sandboxed HTML. */
  type: "tree" | "webview";
  /** Initial HTML for webview views (can be updated at runtime). */
  html?: string;
  when?: string;
}

export interface ExtensionWebviewPanelContribution {
  id: string;
  title: string;
  /** HTML template or remote url bundle (html wins). */
  html?: string;
  /** Where the panel can open: editor tab, bottom panel, or either. */
  area?: "editor" | "panel" | "both";
}

export interface ExtensionStatusBarContribution {
  id: string;
  text: string;
  tooltip?: string;
  command?: string;
  /** VS Code-like alignment/priority. */
  alignment?: "left" | "right";
  priority?: number;
}

export interface ExtensionLanguageContribution {
  id: string;
  aliases?: string[];
  extensions?: string[];
  /** Monaco monarch tokenizer embedded as JSON-serializable object. */
  monarch?: Record<string, unknown>;
  /** Extra keyword lists merged into RexaDB's SQL suggestions. */
  keywords?: string[];
  /** A formatter id the extension serves via rexa.languages.registerFormatter. */
  formatter?: boolean;
}

export interface ExtensionThemeContribution {
  id: string;
  label: string;
  /** `vs` / `vs-dark` base, same values Monaco expects. */
  uiTheme: "vs" | "vs-dark" | "hc-black" | "hc-light";
  /** VS Code TextMate-style theme or Monaco theme definition. Either is accepted. */
  themeJson?: Record<string, unknown>;
  /** Optional CSS variables applied to `:root` when the theme is active. */
  cssVariables?: Record<string, string>;
}

export interface ExtensionResultVisualizerContribution {
  id: string;
  label: string;
  /** Glob or db-type filter, e.g. `postgres:*` or `*:geojson`. */
  selector?: string;
}

export interface ExtensionCellRendererContribution {
  id: string;
  label: string;
  /** Column-type match, e.g. `json`, `timestamp`, `*`. */
  forTypes?: string[];
}

export interface ExtensionDbDriverContribution {
  id: string;
  label: string;
  /** URI schemes handled, e.g. `["myproto"]`. */
  schemes?: string[];
}

export interface ExtensionAiToolContribution {
  id: string;
  label: string;
  description?: string;
}

export interface ExtensionContributes {
  commands?: ExtensionCommandContribution[];
  keybindings?: ExtensionKeybindingContribution[];
  viewsContainers?: ExtensionViewContainerContribution[];
  views?: ExtensionViewContribution[];
  railItems?: ExtensionRailItemContribution[];
  webviewPanels?: ExtensionWebviewPanelContribution[];
  statusBar?: ExtensionStatusBarContribution[];
  languages?: ExtensionLanguageContribution[];
  themes?: ExtensionThemeContribution[];
  resultVisualizers?: ExtensionResultVisualizerContribution[];
  cellRenderers?: ExtensionCellRendererContribution[];
  dbDrivers?: ExtensionDbDriverContribution[];
  aiTools?: ExtensionAiToolContribution[];
}

export interface ExtensionManifest {
  /** Unique id: `publisher.name`, e.g. `rexa.hello-rexa`. */
  id: string;
  name: string;
  publisher?: string;
  version: string;
  displayName?: string;
  description?: string;
  engines: { rexadb: string };
  /** Sandbox entry: single JS file exporting `activate(rexa)`. */
  main?: string;
  activationEvents?: string[];
  capabilities?: ExtensionCapability[];
  contributes?: ExtensionContributes;
}

export interface InstalledExtensionRecord {
  manifest: ExtensionManifest;
  /** Bundled JS source of `main`. Stored so Worker can boot offline. */
  code?: string;
  source: "bundled" | "local" | "url" | "dev";
  enabled: boolean;
  installedAt: number;
}

export function extensionDisplayName(manifest: ExtensionManifest): string {
  return manifest.displayName || manifest.name || manifest.id;
}

const ID_RE = /^[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9-]*$/i;
const VERSION_RE = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

export function validateManifest(manifest: unknown): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!manifest || typeof manifest !== "object") {
    return { ok: false, errors: ["manifest must be an object"] };
  }
  const m = manifest as Record<string, unknown>;
  if (typeof m.id !== "string" || !ID_RE.test(m.id)) {
    errors.push("id must look like `publisher.name` (e.g. `acme.my-ext`)");
  }
  if (typeof m.name !== "string" || !m.name.trim()) errors.push("name is required");
  if (typeof m.version !== "string" || !VERSION_RE.test(m.version)) {
    errors.push("version must be semver (e.g. `1.0.0`)");
  }
  const engines = m.engines as { rexadb?: unknown } | undefined;
  if (!engines || typeof engines.rexadb !== "string" || !engines.rexadb.trim()) {
    errors.push("engines.rexadb is required (e.g. `^1.0.0`)");
  }
  const contributes = (m.contributes ?? {}) as Record<string, unknown>;
  if (typeof contributes !== "object") errors.push("contributes must be an object");
  const commands = (contributes as { commands?: unknown }).commands;
  if (commands !== undefined) {
    if (!Array.isArray(commands)) errors.push("contributes.commands must be an array");
    else {
      for (const [i, c] of commands.entries()) {
        const cmd = c as Record<string, unknown>;
        if (typeof cmd?.command !== "string" || !cmd.command.trim())
          errors.push(`contributes.commands[${i}].command is required`);
        if (typeof cmd?.title !== "string" || !cmd.title.trim())
          errors.push(`contributes.commands[${i}].title is required`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Runtime API surface (what `activate(rexa)` receives).
// Mirrors `vscode` namespaces where it makes sense, plus `rexaDb` extras.
// Every method is async across the Worker boundary.
// ---------------------------------------------------------------------------

import type { ExtensionSchemaInfo } from "./db-bridge";

export interface RexaTreeItem {
  id: string;
  label: string;
  description?: string;
  collapsible?: boolean;
  icon?: string;
  command?: { command: string; args?: unknown[] };
  children?: RexaTreeItem[];
}

export interface RexaHostApi {
  commands: {
    registerCommand(command: string, title?: string, group?: string): Promise<void>;
    executeCommand<T = unknown>(command: string, ...args: unknown[]): Promise<T>;
    getCommands(): Promise<Array<{ command: string; title: string; group?: string }>>;
  };
  window: {
    showInformationMessage(message: string): Promise<void>;
    showWarningMessage(message: string): Promise<void>;
    showErrorMessage(message: string): Promise<void>;
    showInputBox(prompt: string, initialValue?: string): Promise<string | undefined>;
    createStatusBarItem(
      id: string,
      text: string,
      opts?: { tooltip?: string; command?: string; alignment?: "left" | "right"; priority?: number },
    ): Promise<void>;
    updateStatusBarItem(id: string, patch: { text?: string; tooltip?: string }): Promise<void>;
    registerTreeDataProvider(
      viewId: string,
      provider?: { getChildren(parentId?: string): Promise<RexaTreeItem[]> },
    ): Promise<void>;
    registerWebviewView(viewId: string, html: string): Promise<void>;
    /**
     * Register a free-form sidebar page for a view container. The
     * container's standalone sidebar renders this full-height INSTEAD of
     * the declared views list — whatever the extension wants it to be
     * (explorer-like, dashboard-like). Replaces the manifest static `html`.
     */
    registerSidebarPage(containerId: string, html: string): Promise<void>;
    /**
     * Open a declared `webviewPanels` entry. Routing follows its manifest
     * `area`: `"editor"` opens a full-height editor tab with the panel's own
     * html (one tab per panel — tab content, never sidebar content);
     * anything else opens a floating dialog.
     */
    openWebviewPanel(panelId: string, html?: string): Promise<void>;
    /** Open an extension view as an editor tab (see `extension-view` tab type). */
    openTab(viewId: string, opts?: { title?: string }): Promise<void>;
    /** Add an activity-rail item at runtime (static alternative: contributes.railItems). */
    createRailItem(
      id: string,
      title: string,
      opts?: { command?: string; viewId?: string; tooltip?: string; icon?: string },
    ): Promise<void>;
  };
  workspace: {
    getConfiguration(section?: string): Promise<Record<string, unknown>>;
    updateConfiguration(section: string, value: unknown): Promise<void>;
  };
  languages: {
    registerCompletionItems(languageId: string, items: Array<{ label: string; detail?: string; insertText?: string }>): Promise<void>;
    registerFormatter(languageId: string): Promise<void>;
  };
  rexaDb: {
    getConnections(): Promise<Array<{ id: number; name: string; dbType: string }>>;
    getActiveConnection(): Promise<{ id: number; name: string; dbType: string } | null>;
    executeQuery<T = unknown>(sql: string, params?: unknown[]): Promise<{ rows: T[]; fields: string[] }>;
    /** Schema of the active connection: schemas + tables + columns. */
    getSchema(): Promise<ExtensionSchemaInfo>;
    /** Read rows from one table (SQL engines; capped, defaults to 100). */
    readTable(schema: string, table: string, limit?: number): Promise<{ rows: unknown[]; fields: string[] }>;
    getActiveQuery(): Promise<string>;
    setActiveQuery(sql: string): Promise<void>;
    openResultVisualizer(visualizerId: string, data: unknown): Promise<void>;
  };
  ai: {
    registerTool(tool: { id: string; label: string; description?: string }): Promise<void>;
  };
  env: {
    clipboardWrite(text: string): Promise<void>;
  };
}

export type ExtensionActivateFn = (rexa: RexaHostApi) => Promise<void> | void;
