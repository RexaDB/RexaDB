# RexaDB

> Modern database studio for teams who ship.

[![Website](https://img.shields.io/badge/Website-rexadb.app-black)](https://www.rexadb.app)
[![Download](https://img.shields.io/badge/Download-RexaDB-blue)](https://www.rexadb.app/download)
[![License: GPL-3.0](https://img.shields.io/badge/License-GPL--3.0-green)](LICENSE)
[![Discord](https://img.shields.io/badge/Discord-join-5865F2)](https://discord.gg/zPaWuPAwXy)
[![GitHub](https://img.shields.io/github/stars/RexaDB/RexaDB?style=social)](https://github.com/RexaDB/RexaDB)

<a href="https://www.rexadb.app">
  <img src="https://www.rexadb.app/opengraph.png" alt="RexaDB - Modern Desktop Database Studio" width="100%" />
</a>

RexaDB is a modern desktop database studio for PostgreSQL, MySQL, SQLite, MongoDB, and more. Visualize schemas, write SQL, browse data, and let AI handle the heavy lifting — all from one fast, keyboard-friendly app.

Supports **100+ databases through JDBC** — PostgreSQL, MySQL, SQLite, MongoDB, Redis, MariaDB, ClickHouse, SQL Server, Supabase, Neon, Turso, PlanetScale, Timescale, and more. Sign in with your provider and your databases appear instantly, no saved connections needed.

## Key Features

- **Fast data browsing** — Virtualized grid that handles millions of rows, with filtering and record inspection
- **Lightning queries** — Multi-tab SQL editor (Monaco) with split-view results, autocomplete, formatting, EXPLAIN / profiling, and export to CSV, JSON, or Markdown
- **Schema visualization** — Interactive ER diagrams with real-time updates, relationship explorer, and schema documentation
- **AI Agent** — Generate complex queries, understand schemas, and get results without switching context (Anthropic, Google, OpenAI, and more)
- **Workflow Automation** — Scheduled jobs, chained actions, and one-click runtimes
- **Safe by design** — Read-only mode, transaction safeguards, and connection encryption. Your data never leaves your machine.
- **Team-ready** — Team workspaces, shared connections, role-based access, SSO, query version control, audit logging
- **Cross-platform** — Desktop builds for macOS (arm64 / Intel), Windows, and Linux

## Supported Databases

PostgreSQL • MySQL • SQLite • MongoDB • Redis • MariaDB • ClickHouse • SQL Server • Supabase • Neon • Turso • PlanetScale • Timescale • +100 more via JDBC

## Downloads

Download RexaDB free (no credit card required):

- **Website:** https://www.rexadb.app/download
- **All builds:** [GitHub Releases](https://github.com/RexaDB/RexaDB/releases)

macOS • Windows • Linux

## Getting Started (Development)

```bash
# install dependencies
npm install

# run web app
npm run dev

# run desktop app (Tauri)
npm run tauri:dev
```

## Install with Nix (NixOS / nix)

RexaDB ships a Nix flake (`flake.nix`, `nix/`) with a reproducible dev
shell, per-component packages, the desktop app, and NixOS / Home Manager
modules (Linux-first; macOS gets `nix develop` + headless packages).

```bash
# full toolchain: bun, node, rust, cargo-tauri, JDK 21, WebKitGTK deps
nix develop

# build pieces
nix build .#frontend        # Next.js static export
nix build .#rexadb-server   # compiled sidecar server
nix build .#rexadb-oracle-bridge
nix build .#java-bridge     # bridge.jar + minimal JRE

# desktop app (Linux) — run it, or install via the HM module
nix build .#rexadb
nix run .                   # launch RexaDB
nix run .#server            # sidecar only (REXADB_SERVER_PORT=3867)
```

NixOS module (flake input `inputs.rexadb.url = "github:RexaDB/RexaDB"`):

```nix
services.rexadb = {
  enable = true;
  package = inputs.rexadb.packages.${pkgs.system}.rexadb-server;
};
```

Home Manager:

```nix
programs.rexadb = {
  enable = true;
  package = inputs.rexadb.packages.${pkgs.system}.rexadb;
};
```

Notes:

- First run generates `flake.lock` (needs network); please commit it.
- `.envrc` (`use flake`, for direnv users) is covered by the repo's
  `.env*` gitignore rule — `git add -f .envrc` to commit it.
- `packages.rexadb` is Linux-only (`webkitgtk_4_1` / Tauri bundling).
  `nix flake check --no-build` validates evaluation on all systems.
- Like the other release builds, the Nix frontend build does not bake in
  `.env` secrets — provide runtime config the usual way.
- Supabase config is baked at build time (`NEXT_PUBLIC_*`): the Nix
  packages build with placeholder values, so all local-first features
  work but Supabase-backed features (sign-in, teams) are inert. Real
  secrets must never enter the Nix store; to make a cloud-connected
  build, substitute your own values for `NEXT_PUBLIC_SUPABASE_URL` /
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in `nix/frontend.nix` (and
  `nix/rexadb.nix` for the desktop app).
- The Nix desktop build ships with the Tauri auto-updater disabled (it
  would otherwise require the release signing key, which never enters
  PR/fork builds — signing stays tag-gated in `build.yml`). Update via
  `nix flake update` instead.
- Tag pushes additionally attach `RexaDB_<version>_nix_amd64.deb` to the
  GitHub release as a manual-install asset (it is not an updater target;
  `latest.json` keeps pointing at the official signed builds).

## Links

- Website: https://www.rexadb.app
- Download: https://www.rexadb.app/download
- Blog: https://www.rexadb.app/blog
- Changelog: https://www.rexadb.app/changelog
- Contact: https://www.rexadb.app/contact
- Sponsor: https://www.rexadb.app/sponsor
- Privacy: https://www.rexadb.app/privacy
- Discord: https://discord.gg/zPaWuPAwXy
- X: https://x.com/RexaDB
- YouTube: https://www.youtube.com/@RexaDB

## Sponsors

Thank you to our sponsors for supporting RexaDB:

[![Greptile: The War on Bugs](https://www.greptile.com/badge.svg)](https://www.greptile.com/?utm_source=oss_badge&utm_medium=readme&utm_campaign=greptile_for_open_source)

## License

RexaDB is licensed under the [GNU General Public License v3.0](LICENSE) (GPL-3.0-or-later).

## Copyright

© 2026 RexaDB. All rights reserved.
