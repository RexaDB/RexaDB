import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { hasMoreTableRows, mergeTableBatch, shouldLoadTableBatch, supportsInfiniteTableScrolling } from "@/lib/studio/table-batches";

import { FastTableCountCache } from "@/lib/studio/fast-table-count";
import { waitForTableCount } from "@/lib/studio/fast-table-loading";

const source = ts.createSourceFile("use-studio.ts", readFileSync(new URL("../../hooks/use-studio.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);

function loadCallback(name: string, bindings: Record<string, unknown>) {
  let callback: ts.Expression | undefined;
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name && node.initializer && ts.isCallExpression(node.initializer)) {
      callback = node.initializer.arguments[0];
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(callback, `Missing ${name}`);
  const compiled = ts.transpileModule(`const callback = ${callback.getText(source)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(bindings), `${compiled}\nreturn callback;`)(...Object.values(bindings));
}

function createLoader({ infinite = true, dbType = "postgres", page = 0, countKnown = true, fast = false } = {}) {
  const tabId = "table-public-accounts";
  const rows = Array.from({ length: 235 }, (_, id) => ({ id }));
  const queries: string[] = [];
  const contexts: unknown[] = [];
  let cache: Record<string, any> = {};
  let visible: any = null;
  let selectedRows = new Set([3]);
  let batchStates: Record<string, any> = {};
  let responseOverride: ((query: string) => Promise<any> | undefined) | undefined;
  const snapshotRef = { current: {} as Record<string, any> };
  const requestIds = { current: {} as Record<string, number> };
  const bindings: Record<string, any> = {
    infiniteScrolling: infinite,
    fastTableLoading: fast,
    fastTableLoadingRef: { current: fast },
    fastRequestsRef: { current: new Map() },
    fastCountCacheRef: { current: new FastTableCountCache() },
    waitForTableCount,
    setCountUnavailable: () => {},
    dbType,
    page,
    pageSize: 100,
    tablePermissionContext: { kind: "role", label: "anon" },
    buildQueryExecutionContext: (context: unknown) => context,
    resolveActiveTableTabId: () => tabId,
    clearTableData: () => { visible = null; },
    getTableTabSnapshot: (id: string) => snapshotRef.current[id] ?? cache[id],
    tableBatchRequestsRef: { current: {} },
    tableRefreshRequestIdRef: { current: 0 },
    tabRefreshRequestIdsRef: requestIds,
    tableTabSnapshotRef: snapshotRef,
    activeTabIdRef: { current: tabId },
    activePaneIdRef: { current: "1" },
    selectedSchemaRef: { current: "public" },
    selectedTableRef: { current: "accounts" },
    splitView: { enabled: false },
    setTableBatchStates: (update: any) => { batchStates = update(batchStates); },
    setTableLoadingById: () => {},
    setError: () => {},
    setExecutionTime: () => {},
    setTotalCount: () => {},
    setResults: (data: any) => { visible = data; },
    setSelectedRows: (selection: Set<number>) => { selectedRows = selection; },
    setSelectedCell: () => {},
    setTableStructure: () => {},
    setTabDataCache: (update: any) => { cache = update(cache); },
    timerRef: { current: null },
    setInterval: () => 1,
    clearInterval: () => {},
    logStudioDebug: () => {},
    addHistoryEntry: () => {},
    currentConnectionString: "fixture",
    tableStructureRef: { current: [{ column_name: "id", is_primary_key: true }] },
    hiddenColumnNamesRef: { current: [] },
    quoteIdentifier: (name: string) => `"${name}"`,
    quoteTableRef: () => '"public"."accounts"',
    fetchTableStructure: async () => ({ success: true, data: [{ column_name: "id", is_primary_key: true }] }),
    hasMoreTableRows,
    mergeTableBatch,
    supportsInfiniteTableScrolling,
    runQuery: async (_connection: string, query: string, _params: unknown, _options: unknown, context: unknown) => {
      queries.push(query);
      contexts.push(context);
      const override = responseOverride?.(query);
      if (override) return override;
      if (query.includes("COUNT(*)")) return countKnown ? { success: true, data: { rows: [{ count: rows.length }] } } : { success: false };
      const limit = Number(query.match(/LIMIT (\d+)/)?.[1] ?? query.match(/FETCH NEXT (\d+)/)?.[1]);
      const offset = Number(query.match(/OFFSET (\d+)/)?.[1] ?? 0);
      return { success: true, data: { rows: rows.slice(offset, offset + limit), fields: [{ name: "id" }], executionTime: 1 } };
    },
  };
  bindings.updateTabStructureCache = loadCallback("updateTabStructureCache", bindings);
  const refresh = loadCallback("refreshTableData", bindings);
  const load = (offset?: number, filter = "", sort: { column: string; direction: "ASC" | "DESC" } | null = null) => refresh("accounts", "public", filter, sort, 100, page, tabId, undefined, undefined, offset);
  return {
    load, queries, contexts, bindings, rows,
    get visible() { return visible; },
    get snapshot() { return cache[tabId]; },
    get batchState() { return batchStates[tabId]; },
    get selection() { return selectedRows; },
    select: (selection: Set<number>) => { selectedRows = selection; },
    override: (override?: typeof responseOverride) => { responseOverride = override; },
  };
}

test("pagination still replaces results with the requested page", async () => {
  const loader = createLoader({ infinite: false, page: 1 });
  await loader.load();
  assert.equal(loader.visible.rows[0].id, 100);
  assert.equal(loader.visible.rows.length, 100);
  assert.equal(loader.snapshot.infiniteScrolling, false);
  assert.match(loader.queries[1], /LIMIT 100 OFFSET 100/);
});

test("infinite batches append in primary-key order and retain row selection", async () => {
  const loader = createLoader();
  await loader.load();
  const selection = new Set([3, 50]);
  loader.select(selection);
  await loader.load(100);
  assert.deepEqual(loader.visible.rows, loader.rows.slice(0, 200));
  assert.equal(loader.selection, selection);
  assert.equal(loader.snapshot.page, 0);
  assert.equal(loader.snapshot.hasMoreRows, true);
  assert.equal(loader.queries.filter((query) => query.includes("COUNT(*)")).length, 1);
  assert.match(loader.queries[2], /ORDER BY "id" ASC LIMIT 100 OFFSET 100/);
  assert.deepEqual(loader.contexts[2], loader.bindings.tablePermissionContext);
});

test("short final batches stop loading even when the count is unavailable", async () => {
  const loader = createLoader({ countKnown: false });
  await loader.load();
  await loader.load(100);
  await loader.load(200);
  assert.equal(loader.visible.rows.length, 235);
  assert.equal(loader.snapshot.totalCount, null);
  assert.equal(loader.snapshot.hasMoreRows, false);
});

test("repeated load requests cannot append the same batch twice", async () => {
  const loader = createLoader();
  await loader.load();
  let release!: (result: any) => void;
  loader.override(() => new Promise((resolve) => { release = resolve; }));
  const pending = loader.load(100);
  await loader.load(100);
  assert.equal(loader.queries.length, 3);
  assert.equal(loader.batchState.loading, true);
  release({ success: true, data: { rows: loader.rows.slice(100, 200), fields: [{ name: "id" }] } });
  await pending;
  assert.equal(loader.visible.rows.length, 200);
  assert.equal(loader.batchState.loading, false);
});

test("a refresh discards an obsolete in-flight batch", async () => {
  const loader = createLoader();
  await loader.load();
  let release!: (result: any) => void;
  loader.override(() => new Promise((resolve) => { release = resolve; }));
  const pending = loader.load(100);
  loader.override();
  await loader.load();
  release({ success: true, data: { rows: loader.rows.slice(100, 200), fields: [{ name: "id" }] } });
  await pending;
  assert.equal(loader.visible.rows.length, 100);
  assert.equal(loader.snapshot.results.rows.length, 100);
});

test("failed batches preserve loaded rows and retry the same offset", async () => {
  const loader = createLoader();
  await loader.load();
  const original = loader.visible;
  loader.override(async () => ({ success: false, error: "Connection lost" }));
  await loader.load(100);
  assert.equal(loader.visible, original);
  assert.equal(loader.batchState.error, "Connection lost");
  assert.equal(loader.batchState.loading, false);
  loader.override();
  await loader.load(100);
  assert.equal(loader.visible.rows.length, 200);
  assert.equal(loader.batchState.error, null);
});

test("limit-only databases append only the newly fetched suffix", async () => {
  for (const dbType of ["trino", "spacetimedb"]) {
    const loader = createLoader({ dbType });
    await loader.load();
    await loader.load(100);
    assert.deepEqual(loader.visible.rows, loader.rows.slice(0, 200));
    assert.match(loader.queries[2], /LIMIT 200;/);
    assert.doesNotMatch(loader.queries[2], /OFFSET/);
  }
});

test("prefetch waits for the viewport and pauses on errors, loading, or exhaustion", () => {
  const state = { visibleEnd: 80, rowCount: 100, loading: false, hasMore: true, error: null };
  assert.equal(shouldLoadTableBatch(state), true);
  assert.equal(shouldLoadTableBatch({ ...state, visibleEnd: 79 }), false);
  assert.equal(shouldLoadTableBatch({ ...state, rowCount: 0 }), false);
  assert.equal(shouldLoadTableBatch({ ...state, loading: true }), false);
  assert.equal(shouldLoadTableBatch({ ...state, hasMore: false }), false);
  assert.equal(shouldLoadTableBatch({ ...state, error: "Failed" }), false);
});


test("filter and sort changes replace accumulated batches and retain a primary-key tie breaker", async () => {
  const loader = createLoader();
  await loader.load();
  await loader.load(100);
  await loader.load(undefined, '"account" = \'active\'', { column: "account", direction: "DESC" });
  assert.equal(loader.visible.rows.length, 100);
  assert.equal(loader.snapshot.filterQuery, '"account" = \'active\'');
  assert.match(loader.queries.at(-1)!, /WHERE "account" = 'active' ORDER BY "account" DESC, "id" ASC LIMIT 100 OFFSET 0/);
});

test("sql server batches use offset and fetch without changing pagination defaults", async () => {
  const loader = createLoader({ dbType: "mssql" });
  await loader.load();
  await loader.load(100);
  assert.equal(loader.visible.rows.length, 200);
  assert.match(loader.queries.at(-1)!, /ORDER BY "id" ASC OFFSET 100 ROWS FETCH NEXT 100 ROWS ONLY/);
});


test("limit-only pagination retains its existing batch limit", async () => {
  const loader = createLoader({ infinite: false, dbType: "trino", page: 2 });
  await loader.load();
  assert.match(loader.queries.at(-1)!, /LIMIT 100;/);
  assert.doesNotMatch(loader.queries.at(-1)!, /OFFSET/);
});

test("empty tables immediately finish infinite loading", async () => {
  const loader = createLoader();
  loader.rows.splice(0);
  await loader.load();
  assert.equal(loader.visible.rows.length, 0);
  assert.equal(loader.snapshot.hasMoreRows, false);
  assert.equal(loader.snapshot.totalCount, 0);
});


test("an empty terminal batch retains the existing column metadata", () => {
  const previous = { rows: [{ id: 1 }], fields: [{ name: "id" }] };
  const merged = mergeTableBatch(previous, { rows: [], fields: [] });
  assert.deepEqual(merged, previous);
  assert.notEqual(merged.rows, previous.rows);
});


test("fast loading appends batches while sharing a delayed count", async () => {
  const loader = createLoader({ fast: true });
  let release!: (result: any) => void;
  loader.override((query) => query.includes("COUNT(*)") ? new Promise((resolve) => { release = resolve; }) : undefined);
  await loader.load();
  assert.equal(loader.visible.rows.length, 100);
  assert.equal(loader.snapshot.totalCount, null);
  await loader.load(100);
  assert.equal(loader.visible.rows.length, 200);
  assert.equal(loader.queries.filter((query) => query.includes("COUNT(*)")).length, 1);
  release({ success: true, data: { rows: [{ count: 235 }] } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(loader.snapshot.totalCount, 235);
  await loader.load(200);
  assert.equal(loader.visible.rows.length, 235);
  assert.equal(loader.snapshot.hasMoreRows, false);
  assert.equal(loader.queries.filter((query) => query.includes("COUNT(*)")).length, 1);
});

test("oracle batches retain offset and fetch support", async () => {
  const loader = createLoader({ dbType: "oracle" });
  await loader.load();
  await loader.load(100);
  assert.equal(loader.visible.rows.length, 200);
  assert.match(loader.queries.at(-1)!, /ORDER BY "id" ASC OFFSET 100 ROWS FETCH NEXT 100 ROWS ONLY;$/);
});

test("row responses preserve metadata that finishes loading while rows are pending", async () => {
  const loader = createLoader({ infinite: false });
  let release!: (result: any) => void;
  loader.override((query) => query.includes("COUNT(*)") ? undefined : new Promise((resolve) => { release = resolve; }));
  const pending = loader.load();
  while (!release) await Promise.resolve();
  const structure = [{ column_name: "account_id", is_primary_key: true }];
  loader.bindings.setTabDataCache((previous: Record<string, any>) => ({
    ...previous,
    "table-public-accounts": { ...previous["table-public-accounts"], tableStructure: structure },
  }));
  release({ success: true, data: { rows: [{ account_id: 1 }], fields: [{ name: "account_id" }] } });
  await pending;
  assert.equal(loader.snapshot.tableStructure, structure);
});

test("infinite scrolling requires a primary key except for MongoDB collections", () => {
  assert.equal(supportsInfiniteTableScrolling("postgres", []), false);
  assert.equal(supportsInfiniteTableScrolling("postgres", [{ is_primary_key: false }]), false);
  assert.equal(supportsInfiniteTableScrolling("postgres", [{ is_primary_key: true }]), true);
  assert.equal(supportsInfiniteTableScrolling("mongodb", []), true);
  assert.equal(supportsInfiniteTableScrolling("redis", [{ is_primary_key: true }]), false);
});

test("a target without a primary key falls back to pagination and rejects append requests", async () => {
  const loader = createLoader({ page: 1 });
  loader.bindings.tableTabSnapshotRef.current["table-public-accounts"] = {
    tableStructure: [{ column_name: "id", is_primary_key: false }],
  };
  await loader.load();
  assert.equal(loader.snapshot.infiniteScrolling, false);
  assert.equal(loader.visible.rows[0].id, 100);
  assert.match(loader.queries.at(-1)!, /LIMIT 100 OFFSET 100/);
  const queryCount = loader.queries.length;
  await loader.load(100);
  assert.equal(loader.queries.length, queryCount);
  assert.equal(loader.visible.rows.length, 100);
});
