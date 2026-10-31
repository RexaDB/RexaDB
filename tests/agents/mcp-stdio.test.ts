import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const launches = [{ name: "source", command: process.execPath, args: ["run", resolve("lib/agents/mcp/stdio.ts")] }];
if (process.env.REXADB_TEST_COMPILED_SIDECAR) {
  launches.push({ name: "compiled sidecar", command: resolve(process.env.REXADB_TEST_COMPILED_SIDECAR), args: ["--agent-mcp"] });
}
for (const launch of launches) {
  test(`${launch.name} MCP exposes schema and enforces read/write permissions`, async () => {
    const dir = mkdtempSync(join(tmpdir(), "rexadb-mcp-test-"));
    const database = join(dir, "fixture.sqlite");
    const db = new Database(database);
    db.run("CREATE TABLE widgets (id INTEGER PRIMARY KEY, label TEXT)");
    db.run("INSERT INTO widgets VALUES (1, 'fixture')");
    db.close();
    const transport = new StdioClientTransport({
      command: launch.command, args: launch.args, stderr: "pipe",
      env: { REXADB_CONNECTION_STRING: database, REXADB_DB_TYPE: "sqlite", REXADB_ALLOW_SQL_READ: "0", REXADB_ALLOW_SQL_WRITE: "0" },
    });
    const client = new Client({ name: "rexadb-test", version: "1" });
    try {
      await client.connect(transport);
      expect((await client.listTools()).tools.map((t) => t.name)).toContain("list_tables");
      const tables = await client.callTool({ name: "list_tables", arguments: { namespace: "main" } });
      expect(JSON.stringify(tables)).toContain("widgets");
      const schema = await client.callTool({ name: "get_table_schema", arguments: { table: "widgets", namespace: "main" } });
      expect(JSON.stringify(schema)).toContain("label");
      const rows = await client.callTool({ name: "sample_rows", arguments: { table: "widgets" } });
      expect(rows.isError).toBe(true);
      const write = await client.callTool({ name: "run_sql", arguments: { query: "DELETE FROM widgets" } });
      expect(write.isError).toBe(true);
    } finally {
      await client.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  test(`${launch.name} MCP offers studio tools only to chat and records their results`, async () => {
    const dir = mkdtempSync(join(tmpdir(), "rexadb-mcp-test-"));
    const database = join(dir, "fixture.sqlite");
    new Database(database).close();
    const artifactFile = join(dir, "artifacts.jsonl");
    const connect = async (extraEnv: Record<string, string>) => {
      const client = new Client({ name: "rexadb-test", version: "1" });
      await client.connect(new StdioClientTransport({
        command: launch.command, args: launch.args, stderr: "pipe",
        env: { REXADB_CONNECTION_STRING: database, REXADB_DB_TYPE: "sqlite", ...extraEnv },
      }));
      return client;
    };
    const agents = await connect({});
    const chat = await connect({ REXADB_STUDIO_ARTIFACT_FILE: artifactFile });
    try {
      expect((await agents.listTools()).tools.map((t) => t.name)).not.toContain("create_dashboard");
      expect((await chat.listTools()).tools.map((t) => t.name)).toEqual(expect.arrayContaining([
        "create_dashboard", "update_dashboard", "create_workflow", "update_workflow", "create_app_theme", "create_editor_theme",
      ]));
      const rejected = await chat.callTool({
        name: "create_dashboard",
        arguments: { name: "Bad", widgets: [{ title: "Drop", type: "metric", query: "DROP TABLE users" }] },
      });
      expect(rejected.isError).toBe(true);
      expect(existsSync(artifactFile)).toBe(false);
      const created = await chat.callTool({
        name: "create_dashboard",
        arguments: { name: "Sales", widgets: [{ title: "Total", type: "metric", query: "SELECT 1 AS value" }] },
      });
      expect(created.isError).toBeFalsy();
      const artifact = JSON.parse(readFileSync(artifactFile, "utf8").trim());
      expect(artifact).toMatchObject({ kind: "dashboard", action: "create", dashboard: { name: "Sales" } });
    } finally {
      await agents.close();
      await chat.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
}
