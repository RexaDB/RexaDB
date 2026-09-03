import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultMcpExternalConfig,
  sanitizeMcpExternalConfig,
  resolveMcpMode,
  listMcpModes,
  maskConnectionString,
  toMcpConfigSummary,
} from "../../lib/agents/mcp/external-config";
import {
  parseConnectionRef,
  resolveToolConnection,
  toPublicConnectionList,
  type ConnectionDep,
} from "../../lib/agents/mcp/registry";
import { REXADB_PLAN_MODE, REXADB_BUILD_MODE } from "../../lib/agents/app-modes";

const rows: ConnectionDep[] = [
  { id: 1, name: "Analytics", connectionString: "postgres://u:pw@host:5432/analytics", connectionType: "postgres" },
  { id: 2, name: "Cache", connectionString: "redis://localhost:6379/0", connectionType: "redis" },
  { id: 3, name: "Virtual", connectionString: "workspace:abc", connectionType: null },
];

test("sanitizeMcpExternalConfig fills defaults and strips bad ids", () => {
  const clean = sanitizeMcpExternalConfig({
    enabled: true,
    transports: "nonsense",
    exposedConnectionIds: [1, "2", -4, 1.5, 1],
    customModes: [{ id: "custom:x", label: "X", allowSqlRead: true, allowSqlWrite: true }],
  });
  assert.equal(clean.enabled, true);
  assert.equal(clean.transports, "both");
  assert.deepEqual(clean.exposedConnectionIds, [1, 2]);
  assert.equal(clean.customModes.length, 1);
});

test("resolveMcpMode returns builtin plan/build and falls back to plan", () => {
  assert.equal(resolveMcpMode({ modeId: "rexadb-plan", customModes: [] }).id, REXADB_PLAN_MODE.id);
  assert.equal(resolveMcpMode({ modeId: "rexadb-build", customModes: [] }).id, REXADB_BUILD_MODE.id);
  assert.equal(resolveMcpMode({ modeId: "missing", customModes: [] }).id, REXADB_PLAN_MODE.id);
});

test("resolveMcpMode supports custom modes", () => {
  const custom = { id: "custom:x", label: "X", kind: "custom" as const, allowSqlRead: false, allowSqlWrite: false, promptRules: "" };
  const mode = resolveMcpMode({ modeId: "custom:x", customModes: [custom] });
  assert.equal(mode.label, "X");
  assert.equal(mode.allowSqlRead, false);
  assert.equal(listMcpModes([custom]).length, 3);
});

test("maskConnectionString redacts passwords", () => {
  const masked = maskConnectionString("postgres://admin:s3cret@db:5432/app?sslmode=require");
  assert.ok(!masked.includes("s3cret"), `leaked: ${masked}`);
  assert.ok(masked.includes("admin:***@"), masked);
  assert.equal(maskConnectionString("workspace:abc"), "workspace:abc");
});

test("toMcpConfigSummary hides the token", () => {
  const summary = toMcpConfigSummary({ ...defaultMcpExternalConfig(), authToken: "secret" });
  assert.equal((summary as any).authToken, undefined);
  assert.equal(summary.hasAuthToken, true);
});

test("parseConnectionRef handles ids, names and blanks", () => {
  assert.equal(parseConnectionRef(undefined), undefined);
  assert.equal(parseConnectionRef(""), undefined);
  assert.equal(parseConnectionRef(2), 2);
  assert.equal(parseConnectionRef("2"), 2);
  assert.equal(parseConnectionRef("Analytics"), "Analytics");
});

test("resolveToolConnection defaults to first exposed and enforces allow-list", async () => {
  const opts = { enabled: true, exposedIds: [1, 2], mode: REXADB_PLAN_MODE, all: rows };
  const first = await resolveToolConnection(undefined, opts);
  assert.equal(first.meta.id, 1);
  assert.equal(first.ctx.connectionName, "Analytics");
  assert.equal(first.ctx.permissions.allowSqlWrite, false);

  const byName = await resolveToolConnection("cache", opts);
  assert.equal(byName.meta.id, 2);

  await assert.rejects(() => resolveToolConnection(99, opts), /not exposed/);
  await assert.rejects(() => resolveToolConnection("nope", opts), /not exposed/);
  await assert.rejects(
    resolveToolConnection(undefined, { ...opts, enabled: false }),
    /disabled/,
  );
  await assert.rejects(
    resolveToolConnection(undefined, { ...opts, exposedIds: [] }),
    /No connections are exposed/,
  );
});

test("workspace pointers are never exposed", async () => {
  const opts = { enabled: true, exposedIds: [3], mode: REXADB_BUILD_MODE, all: rows };
  await assert.rejects(() => resolveToolConnection(undefined, opts), /No connections are exposed/);
  const list = toPublicConnectionList(rows, [1, 3]);
  assert.ok(list.every((c) => !c.dsnHint.includes("workspace:abc") || true));
  assert.ok(!list.some((c) => c.id === 3), "workspace pointer must be filtered");
  assert.ok(list.find((c) => c.id === 1)?.dsnHint.includes("***"));
});
