import test from "node:test";
import assert from "node:assert/strict";
import {
  denyEdgeReadIfNeeded,
  denyEdgeWriteIfNeeded,
} from "../../lib/agents/mcp/handlers";
import {
  extractRowCountForAudit,
  hashQueryForAudit,
  isWriteSqlForAudit,
  previewQueryForAudit,
  type McpAuditDraft,
} from "../../lib/agents/mcp/audit-log";
import { REXADB_PLAN_MODE, REXADB_BUILD_MODE } from "../../lib/agents/app-modes";

const meta = { id: 1, name: "Analytics" };
const audits: McpAuditDraft[] = [];
const deps = {
  audit: (d: McpAuditDraft) => {
    audits.push(d);
  },
};

function reset() {
  audits.length = 0;
}

test("plan mode blocks edge writes server-side and audits the denial", () => {
  reset();
  const denied = denyEdgeWriteIfNeeded(deps, "delete_edge_function", REXADB_PLAN_MODE, meta, {
    slug: "hello",
  });
  assert.ok(denied, "plan mode must deny edge writes");
  assert.equal(denied.isError, true);
  assert.match(String(denied.content[0].text), /read-only/i);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].tool, "delete_edge_function");
  assert.equal(audits[0].isWrite, true);
  assert.equal(audits[0].success, false);
  assert.equal(audits[0].slug, "hello");
});

test("build mode allows edge writes with no denial audit", () => {
  reset();
  const denied = denyEdgeWriteIfNeeded(deps, "delete_edge_function", REXADB_BUILD_MODE, meta);
  assert.equal(denied, null);
  assert.equal(audits.length, 0);
});

test("edge secret writes audit counts only, never values", () => {
  reset();
  const denied = denyEdgeWriteIfNeeded(deps, "upsert_edge_secrets", REXADB_PLAN_MODE, meta, {
    secretCount: 2,
  });
  assert.ok(denied);
  assert.equal(audits[0].secretCount, 2);
  assert.ok(!JSON.stringify(audits[0]).includes("s3cret"));
});

test("edge reads require read permission", () => {
  reset();
  const allowed = denyEdgeReadIfNeeded(deps, "list_edge_functions", REXADB_PLAN_MODE, meta);
  assert.equal(allowed, null);
  const noRead = { id: "custom:x", allowSqlRead: false, allowSqlWrite: false } as typeof REXADB_PLAN_MODE;
  const denied = denyEdgeReadIfNeeded(deps, "list_edge_functions", noRead, meta);
  assert.ok(denied);
  assert.equal(denied.isError, true);
});

test("isWriteSqlForAudit classifies reads vs writes", () => {
  assert.equal(isWriteSqlForAudit("SELECT * FROM users"), false);
  assert.equal(isWriteSqlForAudit("  with x as (select 1) select * from x"), false);
  assert.equal(isWriteSqlForAudit("EXPLAIN SELECT 1"), false);
  assert.equal(isWriteSqlForAudit("DELETE FROM users"), true);
  assert.equal(isWriteSqlForAudit("DROP TABLE users"), true);
  assert.equal(isWriteSqlForAudit(""), true);
});

test("extractRowCountForAudit reads common result shapes", () => {
  assert.equal(extractRowCountForAudit({ rowCount: 7 }), 7);
  assert.equal(extractRowCountForAudit({ rows: [1, 2, 3] }), 3);
  assert.equal(extractRowCountForAudit({ matches: [1] }), 1);
  assert.equal(extractRowCountForAudit(null), null);
  assert.equal(extractRowCountForAudit({}), null);
});

test("query hash is stable and preview truncates secrets bulk", () => {
  const q = "SELECT * FROM users WHERE id = 1";
  assert.equal(hashQueryForAudit(q), hashQueryForAudit(q));
  assert.match(hashQueryForAudit(q), /^[0-9a-f]{32}$/);
  const big = "x".repeat(5000);
  assert.ok(previewQueryForAudit(big).length <= 2000);
  assert.equal(previewQueryForAudit(q), q);
});
