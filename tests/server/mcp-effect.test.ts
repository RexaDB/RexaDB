import { describe, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

describe("MCP Effect APIs", () => {
  test("MCP Effect APIs use isolated storage", async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), "rexadb-mcp-effect-test-"));
    try {
      const script = `
        import { Effect } from "effect";
        import assert from "node:assert/strict";
        import {
          loadMcpConfigEffect,
          updateMcpConfigEffect,
          regenerateMcpTokenEffect,
          getMcpTokenEffect,
          createMcpModeEffect,
          updateMcpModeEffect,
          deleteMcpModeEffect,
        } from "./server/effect";

        const loaded = await Effect.runPromise(loadMcpConfigEffect);
        assert.equal(typeof loaded.enabled, "boolean");
        assert.equal(typeof loaded.transports, "string");
        assert.equal(typeof loaded.modeId, "string");
        assert.ok(Array.isArray(loaded.exposedConnectionIds));
        assert.ok(Array.isArray(loaded.customModes));

        const updatedConfig = await Effect.runPromise(updateMcpConfigEffect({ enabled: true }));
        assert.equal(updatedConfig.config.enabled, true);
        assert.ok(Array.isArray(updatedConfig.modes));

        const regenerated = await Effect.runPromise(regenerateMcpTokenEffect);
        assert.ok(regenerated.authToken.startsWith("rexadb-mcp_"));
        const token = await Effect.runPromise(getMcpTokenEffect);
        assert.ok(token.authToken.startsWith("rexadb-mcp_"));

        const created = await Effect.runPromise(createMcpModeEffect({
          label: "Test Mode", description: "A test custom mode",
          allowSqlRead: true, allowSqlWrite: false, promptRules: "test rules",
        }));
        assert.ok(created.mode.id.startsWith("custom:"));
        assert.equal(created.mode.label, "Test Mode");
        assert.ok(created.modes.some((mode) => mode.id === created.mode.id));

        const updated = await Effect.runPromise(updateMcpModeEffect(created.mode.id, { label: "Updated Label" }));
        assert.ok(updated.modes.some((mode) => mode.id === created.mode.id && mode.label === "Updated Label"));

        const second = await Effect.runPromise(createMcpModeEffect({ label: "Delete Test" }));
        const deleted = await Effect.runPromise(deleteMcpModeEffect(second.mode.id));
        assert.ok(!deleted.modes.some((mode) => mode.id === second.mode.id));
      `;
      const result = spawnSync(process.execPath, ["-e", script], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          REXADB_USER_DATA_DIR: dataDirectory,
          REXADB_MCP_CONFIG_PATH: join(dataDirectory, "rexadb-mcp.json"),
        },
        encoding: "utf8",
      });
      if (result.status !== 0) {
        throw new Error(`MCP Effect API subprocess failed:\n${result.stderr || result.stdout}`);
      }
    } finally {
      await rm(dataDirectory, { recursive: true, force: true });
    }
  });
});
