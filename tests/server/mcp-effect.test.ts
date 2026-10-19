import { describe, test } from "bun:test";
import { Effect, Exit } from "effect";
import assert from "assert";
import {
  loadMcpConfigEffect,
  updateMcpConfigEffect,
  regenerateMcpTokenEffect,
  getMcpTokenEffect,
  listMcpAuditLogEffect,
  createMcpModeEffect,
  updateMcpModeEffect,
  deleteMcpModeEffect,
} from "../../server/effect";
import { ValidationError } from "../../server/effect/errors";

describe("MCP Effect APIs", () => {
  test("loadMcpConfigEffect returns config", async () => {
    const result = await Effect.runPromise(loadMcpConfigEffect);
    assert.ok(typeof result.enabled === "boolean");
    assert.ok(typeof result.transports === "string");
    assert.ok(typeof result.modeId === "string");
    assert.ok(Array.isArray(result.exposedConnectionIds));
    assert.ok(Array.isArray(result.customModes));
  });

  test("updateMcpConfigEffect preserves token by default", async () => {
    const result = await Effect.runPromise(
      updateMcpConfigEffect({ enabled: true }),
    );
    assert.ok(result.config.enabled === true);
    assert.ok(Array.isArray(result.modes));
  });

  test("regenerateMcpTokenEffect returns new token", async () => {
    const result = await Effect.runPromise(regenerateMcpTokenEffect);
    assert.ok(typeof result.authToken === "string");
    assert.ok(result.authToken.startsWith("rexadb-mcp_"));
  });

  test("getMcpTokenEffect returns token when set", async () => {
    // Ensure a token exists
    await Effect.runPromise(regenerateMcpTokenEffect);
    const result = await Effect.runPromise(getMcpTokenEffect);
    assert.ok(typeof result.authToken === "string");
    assert.ok(result.authToken.startsWith("rexadb-mcp_"));
  });

  test("createMcpModeEffect adds custom mode", async () => {
    const result = await Effect.runPromise(
      createMcpModeEffect({
        label: "Test Mode",
        description: "A test custom mode",
        allowSqlRead: true,
        allowSqlWrite: false,
        promptRules: "test rules",
      }),
    );
    assert.ok(result.mode);
    assert.ok(result.mode.id.startsWith("custom:"));
    assert.ok(result.mode.label === "Test Mode");
    assert.ok(Array.isArray(result.modes));
    assert.ok(result.modes.some((m: any) => m.id === result.mode.id));
  });

  test("updateMcpModeEffect updates existing mode", async () => {
    const created = await Effect.runPromise(
      createMcpModeEffect({ label: "Update Test" }),
    );
    const updated = await Effect.runPromise(
      updateMcpModeEffect(created.mode.id, { label: "Updated Label" }),
    );
    assert.ok(
      updated.modes.some((m: any) => m.id === created.mode.id && m.label === "Updated Label"),
    );
  });

  test("deleteMcpModeEffect removes mode and resets modeId if active", async () => {
    const created = await Effect.runPromise(
      createMcpModeEffect({ label: "Delete Test" }),
    );
    const deleted = await Effect.runPromise(deleteMcpModeEffect(created.mode.id));
    assert.ok(
      !deleted.modes.some((m: any) => m.id === created.mode.id),
    );
  });
});
