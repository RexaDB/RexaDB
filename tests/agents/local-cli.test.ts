import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { getLocalCliProviderId, localCliModels } from "../../lib/agents/local-provider";
import { getHarnessClient, type HarnessClient } from "../../lib/agents/harness-clients";
import { runHarness } from "../../lib/agents/run-harness";
import type { AgentProvider, AgentStreamEvent } from "../../lib/agents/provider-types";
import { localChatMode, localChatPrompt } from "../../server/local-cli-chat";
import { parsePiModels } from "../../lib/agents/list-provider-models";
import { localCliPath } from "../../lib/agents/cli-path";
import { delimiter } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "rexa-cli-tests-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const provider = (id: AgentProvider["id"], status: AgentProvider["status"] = "installed"): AgentProvider => ({ id, status, available: status !== "not-installed", name: id, icon: "", description: "", models: [{ id: "model-a", label: "Model A" }] });

describe("local CLI selection", () => {
  test("desktop launches find user-installed CLIs while preserving PATH precedence", () => {
    const entries = localCliPath("/custom/bin", dir).split(delimiter);
    expect(entries[0]).toBe("/custom/bin");
    expect(entries).toContain(join(dir, ".local", "bin"));
    expect(new Set(entries).size).toBe(entries.length);
  });
  test("discovers signed-in CLIs without API configuration and keeps identities separate", () => {
    const models = localCliModels([provider("codex"), provider("claude-code"), provider("rexadb"), provider("opencode", "auth-required"), provider("pi", "not-installed")]);
    expect(models.map((m) => `${m.provider}/${m.model}`)).toEqual(["cli:codex/default", "cli:codex/model-a", "cli:claude-code/default", "cli:claude-code/model-a"]);
    expect(getLocalCliProviderId("cli:codex")).toBe("codex");
    for (const id of ["openai", "codex", "cli:rexadb", "cli:constructor", "cli:arbitrary-command"]) expect(getLocalCliProviderId(id)).toBeNull();
  });
  test("offers CLI defaults for adapters without model selection support", () => {
    expect(localCliModels([provider("cursor"), provider("grok-build"), provider("fx")]).every((m) => m.model === "default")).toBe(true);
  });
  test("sidebar permission mapping never enables writes", () => {
    expect(localChatMode("schema_only")).toMatchObject({ allowSqlRead: false, allowSqlWrite: false });
    expect(localChatMode("schema_with_data")).toMatchObject({ allowSqlRead: true, allowSqlWrite: false });
    expect(localChatMode("build")).toMatchObject({ allowSqlRead: false, allowSqlWrite: false });
  });
  test("sends the current conversation and schema without the database credential", () => {
    const prompt = localChatPrompt({ provider: "cli:codex", model: "default", chatId: "one", connectionId: 1, connectionString: "secret-connection-password", dbType: "sqlite", prompt: "What did I ask?", history: [{ role: "user", content: "Remember widget-42" }], lightSchemaContext: [{ schema: "main", table: "widgets", columns: [{ name: "id", type: "integer" }] }] });
    expect(prompt).toContain("widget-42");
    expect(prompt).toContain("widgets");
    expect(prompt).not.toContain("secret-connection-password");
  });
});

// Exercise actual subprocess creation with a fake executable, not a user's CLI.
const executable = join(dir, "fake cli");
writeFileSync(executable, '#!/usr/bin/env node\nconsole.log(JSON.stringify({argv:process.argv.slice(2), db:process.env.REXADB_CONNECTION_STRING}));\n', { mode: 0o700 });
async function capture(id: "codex" | "claude-code" | "opencode" | "pi", model: string) {
  const child = getHarnessClient(id).spawn({ binaryPath: executable, model, prompt: "hello", cwd: dir, mcp: { name: "rexadb", command: "mcp-command", args: ["run", "entry with spaces.ts"], env: { REXADB_CONNECTION_STRING: "secret-fixture", REXADB_DB_TYPE: "sqlite", REXADB_CONNECTION_NAME: "fixture", REXADB_ALLOW_SQL_READ: "0", REXADB_ALLOW_SQL_WRITE: "0", REXADB_MODE: "plan" } } });
  let output = "";
  child.stdout!.on("data", (chunk) => { output += chunk; });
  await once(child, "close");
  return JSON.parse(output);
}
test("selected model reaches each model-capable CLI, default omits override", async () => {
  for (const id of ["codex", "claude-code", "opencode", "pi"] as const) {
    const selected = await capture(id, "chosen-model");
    expect(selected.argv).toContain("--model");
    expect(selected.argv).toContain("chosen-model");
    expect((await capture(id, "default")).argv).not.toContain("--model");
  }
});
test("Codex receives MCP config without putting database credentials in argv", async () => {
  const result = await capture("codex", "default");
  expect(result.argv.join(" ")).toContain('mcp_servers.rexadb.env_vars');
  expect(result.argv.join(" ")).not.toContain('mcp_servers."rexadb"');
  expect(result.argv.join(" ")).not.toContain("secret-fixture");
  expect(result.db).toBe("secret-fixture");
});
test("Claude max-turn failures are not treated as success", () => {
  const events = getHarnessClient("claude-code").parseLineAll!(JSON.stringify({ type: "result", subtype: "error_max_turns", errors: ["Turn limit reached"] }));
  expect(events).toEqual([{ type: "error", content: "Turn limit reached" }]);
});
test("pi status messages are not offered as models", () => {
  expect(parsePiModels("No models available. Use /login to log into a provider via OAuth or API key.")).toEqual([]);
  expect(parsePiModels("provider model context max-out thinking images\nexample sample-model 200K 16K yes yes").map((m) => m.id)).toEqual(["sample-model"]);
});
test("Codex does not duplicate agent text on item.started and item.completed", () => {
  const client = getHarnessClient("codex");
  const item = { type: "agent_message", text: "hello" };
  expect(client.parseLineAll!(JSON.stringify({ type: "item.started", item }))).toEqual([]);
  expect(client.parseLineAll!(JSON.stringify({ type: "item.completed", item }))).toEqual([{ type: "text_delta", content: "hello" }]);
});

function fakeClient(code: string): HarnessClient {
  return { providerId: "codex", spawn: () => spawn(process.execPath, ["-e", code], { stdio: ["pipe", "pipe", "pipe"] }), parseLine: (line) => JSON.parse(line) };
}
test("runner drains trailing JSON and rejects an unsuccessful exit after done", async () => {
  const events: AgentStreamEvent[] = [];
  await runHarness("codex", { prompt: "test" }, (e) => events.push(e), new AbortController().signal,
    fakeClient('process.stdout.write(JSON.stringify({type:"text_delta",content:"hello"}))'));
  expect(events).toEqual([{ type: "text_delta", content: "hello" }]);
  await expect(runHarness("codex", { prompt: "test" }, () => {}, new AbortController().signal,
    fakeClient('console.log(JSON.stringify({type:"done"}));process.stderr.write("expired session");process.exit(1)'))).rejects.toThrow("expired session");
});
test("cancellation terminates the actual subprocess", async () => {
  const controller = new AbortController();
  let child: ReturnType<typeof spawn> | undefined;
  const client = fakeClient('setInterval(()=>{},1000)');
  const original = client.spawn;
  client.spawn = (options) => { child = original(options); setTimeout(() => controller.abort(), 30); return child; };
  await expect(runHarness("codex", { prompt: "test" }, () => {}, controller.signal, client)).rejects.toMatchObject({ name: "AbortError" });
  expect(child?.signalCode).toBeTruthy();
});
