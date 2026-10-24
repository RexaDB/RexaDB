# Use a local CLI in Ask AI

Ask AI and the SQL AI model picker can use installed CLI agents without an API key configured in RexaDB. The CLI runs on the machine hosting the RexaDB sidecar and uses its own login, model configuration, subscription limits, and billing. Model inference still runs through that provider; this does not make cloud models offline.

1. Install a supported CLI and sign in using its own terminal command. For example, `codex login` or `claude auth login`.
2. Open **AI Settings → Local CLI agents**, then click **Refresh**. Discovery also refreshes when the app regains focus.
3. In **Ask AI**, select a model marked **Local CLI**. The SQL AI picker uses the same discovered providers. A local CLI can also be selected as the default provider in AI Settings.
4. Choose **CLI default** to use the CLI's configuration, or an explicit model when the adapter supports it.

RexaDB invokes the official local executable. It does not copy OAuth tokens into API-key fields or implement a token proxy. Signing into the Codex desktop app alone is not a guarantee that the separate `codex` executable has a working session; check `codex login status`. For Claude, check `claude auth status`. Refresh after signing in again. If a CLI reports an expired session or a usage limit, its error is shown in the chat.

## Adapter support

The picker reuses the existing RexaDB harness adapters:

| CLI | Explicit model selection | RexaDB live database tools |
| --- | --- | --- |
| Codex | Yes | MCP |
| Claude Code | Yes | MCP |
| OpenCode | Yes | MCP |
| Cursor Agent (`cursor-agent`) | CLI configuration | ACP/MCP |
| Grok Build | CLI configuration | ACP/MCP |
| fx | CLI configuration | Schema context only |
| pi | Yes | Schema context only |

An installed CLI's authentication and subscription support depend on that CLI. Codex and Claude have been verified end to end; the other adapters retain their existing protocols and need testing with those executables. New CLIs require a detection entry and a harness adapter for their flags/output protocol, rather than treating arbitrary commands as interchangeable.

Each Ask AI turn receives this chat's history and the current schema in a fresh temporary workspace. MCP tools enforce schema-only versus schema-with-data access; this path never enables database writes. CLI-native tools still follow the CLI's own permissions and configuration. CLI adapters do not provide every API-agent workflow or approval feature.

Common installer directories are added to the inherited PATH for desktop launches (including `~/.local/bin`, `~/.bun/bin`, and Homebrew). Nonstandard runtime installations must still be available on PATH. If a model requires a newer CLI, update that CLI or select a compatible model from its discovered list.

## Development and checks

Install dependencies in the repository and `server/` with a Bun version that supports the checked-in lockfile. Run the sidecar and Next.js as usual. To keep development separate from an installed app, set `REXADB_SERVER_PORT` and `REXADB_USER_DATA_DIR` on the sidecar and the matching `NEXT_PUBLIC_REXADB_API_URL` on Next.js. For a different frontend port, include its origin in `REXADB_CORS_ORIGINS`.

```sh
bun test tests/agents tests/server/agents-api.test.ts tests/mcp/edge-gating.test.ts
bun run server:build
REXADB_TEST_COMPILED_SIDECAR=src-tauri/binaries/rexadb-server-aarch64-apple-darwin bun test tests/agents/mcp-stdio.test.ts
```

Adjust the compiled binary name for the target platform. The compiled sidecar supports `--agent-mcp`, so desktop MCP access does not require an external Bun installation or the source checkout. The integration test uses a temporary SQLite fixture and checks schema access plus denied row reads and writes.
