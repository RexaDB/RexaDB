# RexaDB Extensions (v1)

RexaDB-native extensions, inspired by VS Code's extension model, running in a
**Web Worker sandbox** (no DOM, no Node, no `fetch` unless the
`network` capability is granted).

## Quick start

1. Open any connection → sidebar **Extensions** (rail puzzle icon).
2. **Install from bundle**: paste `resources/extensions/hello-rexa/bundle.json`.
3. Reload — the worker activates:
   - Commands appear in **Cmd+K** under the extension's group.
   - Tree/webview **views** render in the Extensions sidebar section.
   - **Status bar** items appear left/right by alignment.
   - **SQL completions** merge into the Monaco editor.
   - **Panels** open via `rexa.window.openWebviewPanel` (floating dialog).
   - **Themes** apply CSS variables from the manager.

## Writing an extension

Two artifacts:

- `manifest.json` — id (`publisher.name`), semver version,
  `engines.rexadb`, static `contributes` (commands, views, webviewPanels,
  statusBar, languages, themes, resultVisualizers, cellRenderers, dbDrivers,
  aiTools), `capabilities`.
- `main.js` — **single bundled file, no imports**, declaring
  `async function activate(rexa) {...}`.

### Runtime API (`rexa`)

| Namespace | Methods |
|---|---|
| `rexa.commands` | `registerCommand`, `executeCommand`, `getCommands` |
| `rexa.window` | `showInformation/Warning/ErrorMessage`, `showInputBox`, `createStatusBarItem`, `updateStatusBarItem`, `registerTreeDataProvider`, `registerWebviewView`, `registerSidebarPage`, `openWebviewPanel`, `openTab`, `createRailItem` |
| `rexa.workspace` | `getConfiguration`, `updateConfiguration` |
| `rexa.languages` | `registerCompletionItems`, `registerFormatter` |
| `rexa.rexaDb` | `getConnections`, `getActiveConnection`, `executeQuery`, `getSchema`, `readTable`, `getActiveQuery`, `setActiveQuery`, `openResultVisualizer` |
| `rexa.ai` | `registerTool` |
| `rexa.env` | `clipboardWrite` |

### Data + schema access

The host wires a live bridge to the active studio session, so these return
real data (empty fallbacks when no studio is open):

```js
const conns = await rexa.rexaDb.getConnections();       // [{ id, name, dbType }]
const active = await rexa.rexaDb.getActiveConnection(); // { id, name, dbType } | null
const schema = await rexa.rexaDb.getSchema();           // { database, dbType, schemas[], tables: [{ schema, name, columns: [{ name, type, nullable }] }] }
const page = await rexa.rexaDb.readTable("public", "users", 25); // { rows, fields }
const res = await rexa.rexaDb.executeQuery("SELECT COUNT(*) AS n FROM users");
```

Write statements (`INSERT/UPDATE/DELETE/…`, multi-statements) require the
`"query:write"` capability in the manifest — otherwise the host rejects them
(best-effort client guard; keep destructive work behind explicit commands).

`setActiveQuery` writes into the open SQL tab (or opens one); `getActiveQuery`
reads it back.

### Sidebars, rail, tabs

Sidebar views and tab content are separate surfaces — never the same html:

- **Custom sidebars**: each view container gets its own activity-rail entry
  opening a BRAND-NEW standalone sidebar (`extensions:<containerId>`) that the
  extension fills with WHATEVER it wants — explorer-like, dashboard-like.
  Provide the page as static `viewsContainers[].html` or at runtime via
  `await rexa.window.registerSidebarPage(containerId, html)` (full-height,
  theme-aware webview). Only when no page is provided does the sidebar fall
  back to the declared `views` list. Never merged into, and never linking
  to, the Extensions manager sidebar (which is management-only).
- **Editor tabs**: `contributes.webviewPanels[]` with `area: "editor"` open
  via `await rexa.window.openWebviewPanel(panelId, html?)` as full-height
  editor tabs with the panel's OWN html — one tab per panel, so an extension
  can have many tabs next to its single sidebar. Panels with any other area
  open as floating dialogs. `await rexa.window.openTab(viewId)` remains only
  as a sidebar-view pop-out.
- **Rail items**: static `contributes.railItems[]` (`{ id, title, command?, viewId?, tooltip?, icon? }`)
  or runtime `await rexa.window.createRailItem("id", "Title", { command })`.
  `icon` is an inline `<svg…>` string, a short emoji/text glyph, or omitted
  (puzzle fallback). Same format for container icons. If an extension
  declares explicit rail items, they replace its automatic container item
  (per-extension dedup — never 2 icons for one extension). The generic
  Extensions manager rail button is always present regardless.
- **Theming**: webview HTML is sandboxed but theme-aware — a base stylesheet
  maps to app system colors (`color-scheme: light dark`, `CanvasText`), the
  live theme is pushed on every app theme switch
  (`document.documentElement.dataset.rexaTheme`, `style.colorScheme`, and
  `acquireRexaApi().getState().theme`), so extension tabs/panels/views follow
  light/dark automatically.

```js
await rexa.window.createRailItem("my-tab", "My Panel", { viewId: "my-ext.view" });
await rexa.window.openTab("my-ext.view", { title: "My Panel" });
```

### Handler registration (Worker)

Because the sandbox has no shared memory, command/tree handlers are
registered by name for host→worker dispatch:

```js
rexa.__registerHandler("command:my-ext.do-thing", async (...args) => { ... });
rexa.__registerHandler("tree:my-ext.my-view", async (parentId) => [ ...items ]);
await rexa.commands.registerCommand("my-ext.do-thing", "Do thing", "My Ext");
await rexa.window.registerTreeDataProvider("my-ext.my-view");
```

(`runInProcess` in tests also accepts the `registerTreeDataProvider(viewId,
{ getChildren })` object form.)

### Webviews

HTML renders in a sandboxed `<iframe sandbox="allow-scripts">`. Inside, use
the VS Code-like bridge:

```html
<script>
  const api = acquireRexaApi();
  api.postMessage({ hello: "webview" });
  api.onDidReceiveMessage((msg) => console.log(msg));
</script>
```

### Capabilities & security

- Worker has no DOM/XHR by default; `capabilities` gate `query:write`,
  `network`, `clipboard`, `storage`.
- `executeQuery` write statements require `query:write` (enforced by the
  host bridge — the DB layer validates again server-side).
- Webviews are `sandbox="allow-scripts"` with no same-origin access.

## Files

| Path | Purpose |
|---|---|
| `lib/extensions/types.ts` | Manifest + `RexaHostApi` surface |
| `lib/extensions/extension-host.ts` | Worker sandbox + RPC + `runInProcess` test helper |
| `lib/extensions/extension-registry.ts` | Install/enable/disable (localStorage) |
| `lib/extensions/db-bridge.ts` | Live studio bridge (`rexaDb.*`) + write-query guard |
| `lib/extensions/react.tsx` | `ExtensionProvider`, aggregation hooks |
| `lib/extensions/themes.ts` | Theme CSS-variable apply/clear |
| `components/studio/extensions-view.tsx` | Manager UI (Extensions tab) |
| `components/studio/extension-sidebar-section.tsx` | Sidebar views host (grouped by container) |
| `components/studio/extension-tree-view.tsx` | Tree rendering |
| `components/studio/extension-webview.tsx` | Sandboxed iframe + bridge |
| `components/studio/extension-panel-host.tsx` | Floating webview panels |
| `components/studio/extension-tab-view.tsx` | Editor-tab host for webview views |
