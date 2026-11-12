# Porting RexaDB to GPUI

Goal: the native app must **look and behave exactly like the existing app**
(Next.js UI in `../components`, `../app`, `../hooks`, logic in `../lib`,
Bun sidecar in `../server`, Tauri shell in `../src-tauri`). It is a port, not
a redesign. The TypeScript is the spec: read it, then reproduce it.

## Layout

| Crate | Owns (ports of) |
|---|---|
| `rexa-store` | app DB `sqlite.db`, credentials (keychain / vault), WebKit localStorage reader |
| `rexa-drivers` | `lib/db/*` database clients: Driver trait + one module per database |
| `rexa-core` | runtime, navigation (`Route`), open sessions, screen/tab `Registry`, `TabSpec`, studio event bus |
| `rexa-ui` | design system: theme tokens, Tailwind helpers, `components/ui/*` |
| `rexa-connections` | `components/connections/*`, provider account screens |
| `rexa-studio` | studio shell: sidebar/explorer, tabs, navigation rail, command menu, welcome, persistence |
| `rexa-grid` | table data editor (`data-grid-ag`, `grid/`, `table-editor-view`, toolbar, sheets) |
| `rexa-sql` | SQL editor, results, history, snippets, find, explain |
| `rexa-schema` | create/alter views, ERD, data catalog, database objects, schema compare, dictionary |
| `rexa-settings` | settings, keybindings, profile, theme creator, extensions, onboarding, auth page |
| `rexa-ai` | AI agent (`components/studio/{agents,ai}`, `lib/{ai,agents,acp}`) on the Claude API |
| `rexa-features` | transfer, workflows, snapshots, notes, dashboards, import/export |
| `rexa-providers` | storage, edge functions, payments, Supabase auth, redis, spacetimedb, neon, planetscale, team, analytics, advisor |
| `rexa-app` | binary: window + route dispatch only |

Each crate exposes `pub fn init(cx: &mut App)` which registers its screens
(`Registry::screen`) and studio tabs (`Registry::tab`). Crates never depend on
sibling feature crates; they talk through `rexa-core` (`navigate`,
`open_tab`, `StudioEvent`, `Sessions`).

## Ownership rules (parallel work)

- Edit **only your crate**. If you truly need something elsewhere:
  - `rexa-ui`: add a new file `crates/rexa-ui/src/<name>.rs` + one `pub mod` line. Don't rewrite existing primitives (the ui-kit owner does).
  - `rexa-core`: additive only (new `TabSpec`/`Route` variants, new helpers). Never rename/remove.
  - `rexa-store`: additive only, in a new file `crates/rexa-store/src/<area>.rs`.
  - `rexa-drivers`: owned by the drivers port. Others run dialect SQL through `driver.execute()` / `driver.kind()` inside their own crate, or add a capability trait in their own crate.
- Commit often on your branch with clear messages. Run `cargo build` and `cargo test` for the workspace before each commit; leave it compiling.

## Fidelity rules

1. Start every module with `//! Port of <original path(s)>`. Port file by file;
   keep the original's structure and names where reasonable so diffs are reviewable.
2. Colors: only `cx.tokens()` fields / `tokens.var("--name")`, `rexa_ui::tw("emerald-400")`
   (Tailwind v4 palette), `rexa_ui::white(alpha)`, `with_alpha(color, a)`. Never hand-pick hex.
3. Spacing: GPUI's `p_4`, `gap_2`, `h_9`, … equal Tailwind's (1 unit = 4px). Arbitrary values → `px(n)`.
4. Text: use `Tw` (`tw_text_xs/sm/13/…`) — they set Tailwind's line heights. GPUI's own
   `text_sm()` does not, which breaks row heights. `font-medium` → `FontWeight::MEDIUM`.
   `tracking-tight` → `rexa_ui::tight("…")`. Monospace = `rexa_ui::MONO` (Menlo — what the old app really renders).
5. Radius: `--radius` = 10px → `tw_rounded_sm/md/lg/xl` = 6/8/10/14.
6. Icons: the old app uses lucide-react; `Icon::new(IconName::X)` has the full Lucide set (same SVGs). Provider logos: `img("providers/<file>")` (copied from `public/providers`). Multi-color SVGs must use `img()`, single-color use `svg().path()`.
7. Use `rexa_ui` primitives (`Button`, `Badge`, `Kbd`, `TextInput`, `Separator`, …) for anything that exists in `components/ui`. Overlays not yet re-implemented are re-exported in `rexa_ui::overlay` / `rexa_ui::widgets` — use them through those paths.
8. Watch for CSS behaviour GPUI doesn't have and emulate it explicitly (document it in a comment): inline-block line boxes, `truncate`, `max-w-*`, hover/group-hover, `backdrop-blur`, radial gradients.
9. Behaviour matters as much as pixels: keyboard shortcuts (`../keybindings.json`, `lib/*/keybindings*`), context menus, empty/loading/error states, toasts, confirmations.

## Data

- Persisted state lives where the old app keeps it: `rexa_store::Store` (`sqlite.db` tables like
  `connections`, `app_settings`, `query_history`, `snippets`, `open_tabs`, …). Read the original's
  `lib/db/*-actions*.ts` / `server/*-api.ts` to see the exact tables/keys and keep using them, so both apps share data.
- State the old app kept in browser `localStorage`: read it once via `rexa_store::WebStore` for
  migration; store it from now on in `app_settings` under the same key.
- Never call the Bun sidecar. Port its logic into Rust.
- Async I/O: `rexa_core::runtime::spawn(fut)` then await it inside `cx.spawn(...)`.

## Verifying visually

- `tools/run-native.sh /path/out.png [ROUTE]` builds, launches at 1470×864 (the reference size),
  captures **only the app's own window**, and quits. Routes: `studio:<connection id>`, `screen:<connection-screen id>`.
  Add new `REXA_ROUTE` forms in `rexa-app/src/main.rs` if needed (small additive edit).
- `tools/pixdiff.sh ref.png ours.png diff.png` highlights differences in red.
- Never take full-screen screenshots, never interact with other apps or windows, and never
  click inside the user's running RexaDB.app. Put scratch files in your scratchpad/tmp dir, not the repo.
- Reference images of the original live in `native/reference/` when available.

## Saved connections on this machine (for manual testing)

Use `sqlite3 "file:$HOME/Library/Application Support/com.rexadb/sqlite.db?mode=ro" "select id,name,connection_type from connections"`.
A local Postgres accepts `postgres://$USER@localhost/postgres`. Do not modify the user's databases;
create scratch schemas/tables only in a throwaway local database you create yourself (e.g. `createdb rexa_port_test`).
