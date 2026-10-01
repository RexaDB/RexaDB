import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function loadModule(file, dependencies) {
  const source = readFileSync(new URL(`../../lib/db/${file}.ts`, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const exports = {};
  new Function("require", "exports", outputText)(
    (name) => dependencies[name] ?? {},
    exports,
  );
  return exports;
}

const mod = loadModule("supabase-mgmt-client", {
  "@/lib/supabase-mgmt/client": { runMgmtQuery: async () => ({ rows: [] }) },
});

test("inlineMgmtParams leaves param-less queries untouched", () => {
  const q = "SELECT 1";
  assert.equal(mod.inlineMgmtParams(q, []), q);
  assert.equal(mod.inlineMgmtParams(q), q);
});

test("inlineMgmtParams inlines $1/$2 strings with escaping", () => {
  const out = mod.inlineMgmtParams(
    "SELECT c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1 AND c.relname = $2 LIMIT 1;",
    ["public", "o'clock"],
  );
  assert.ok(out.includes("WHERE n.nspname = 'public'"));
  assert.ok(out.includes("AND c.relname = 'o''clock'"));
  assert.ok(!out.includes("$1") && !out.includes("$2"));
});

test("inlineMgmtParams handles numbers, booleans and null", () => {
  const out = mod.inlineMgmtParams("SELECT $1, $2, $3, $4", [42, true, null, undefined]);
  assert.equal(out, "SELECT 42, TRUE, NULL, NULL");
});

test("inlineMgmtParams does not confuse $1 with $10", () => {
  const params = Array.from({ length: 10 }, (_, i) => `v${i + 1}`);
  const out = mod.inlineMgmtParams("SELECT $1, $10, $2", params);
  assert.equal(out, "SELECT 'v1', 'v10', 'v2'");
});

test("inlineMgmtParams leaves unknown placeholders alone", () => {
  const out = mod.inlineMgmtParams("SELECT $1, $9", ["a"]);
  assert.equal(out, "SELECT 'a', $9");
});

test("inlineMgmtParams does not re-scan inserted values", () => {
  const out = mod.inlineMgmtParams("SELECT $1, $2", ["has $2 inside", "second"]);
  assert.equal(out, "SELECT 'has $2 inside', 'second'");
});
