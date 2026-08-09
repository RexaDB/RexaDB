import { createHash, randomUUID } from "crypto";
import { format as formatDate } from "date-fns";
import { toArray, evalExpression, computeAggregate, insertRowsToTable } from "./eval-utils";
import type {
  WorkflowNode,
  WorkflowEdge,
  WorkflowNodeOutput,
  WorkflowRunContext,
  WorkflowProgressEvent,
} from "./types";

// Re-export shared types for backward compatibility
export type {
  WorkflowNode,
  WorkflowEdge,
  WorkflowNodeOutput,
  WorkflowRunContext,
  WorkflowProgressEvent,
} from "./types";

// ─── Resource limits ──────────────────────────────────────────────────

// Maximum execution time for a single workflow node (5 minutes)
const NODE_EXECUTION_TIMEOUT_MS = 5 * 60 * 1000;

// Maximum items in a loop before aborting
const MAX_LOOP_ITEMS = 10_000;

// Maximum HTTP requests per workflow run
const MAX_HTTP_REQUESTS = 100;

// Track HTTP request count per workflow run
const httpRequestCounts = new WeakMap<import("./types").WorkflowRunContext, number>();

function getHttpRequestCount(ctx: import("./types").WorkflowRunContext): number {
  return httpRequestCounts.get(ctx) ?? 0;
}

function incrementHttpRequestCount(ctx: import("./types").WorkflowRunContext): number {
  const current = getHttpRequestCount(ctx);
  if (current >= MAX_HTTP_REQUESTS) {
    throw new Error(`HTTP request limit reached (${MAX_HTTP_REQUESTS}). Workflow stopped.`);
  }
  const next = current + 1;
  httpRequestCounts.set(ctx, next);
  return next;
}

/** Wrap an async function with a timeout */
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const result = await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener('abort', () => {
          reject(new Error(`${label} timed out after ${timeoutMs}ms`));
        });
      }),
    ]);
    return result;
  } finally {
    clearTimeout(timer);
  }
}

async function runJsCode(code: string, input: unknown, ctx: WorkflowRunContext, logs: string[]): Promise<unknown> {
  const capturedLogs: string[] = [];
  const consoleMock = {
    log: (...args: unknown[]) =>
      capturedLogs.push(args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ")),
    warn: (...args: unknown[]) => capturedLogs.push("[WARN] " + args.join(" ")),
    error: (...args: unknown[]) => capturedLogs.push("[ERROR] " + args.join(" ")),
  };

  try {
    const fn = new Function(
      "$input",
      "$vars",
      "$nodes",
      "console",
      `return (async function() {\n${code}\n})();`,
    );
    const result = await withTimeout(
      fn(input, ctx.vars, ctx.nodeOutputs, consoleMock) as Promise<unknown>,
      NODE_EXECUTION_TIMEOUT_MS,
      "JavaScript execution",
    );
    logs.push(...capturedLogs);
    return result;
  } catch (err: any) {
    logs.push(...capturedLogs);
    throw err;
  }
}

function generateUUID(): string {
  return randomUUID();
}

// ─── Executor type ────────────────────────────────────────────────────

export type NodeExecutor = (
  node: WorkflowNode,
  input: unknown,
  ctx: WorkflowRunContext,
  logs: string[],
  connectionId?: number | null,
) => Promise<unknown>;

// ─── Executor registry ────────────────────────────────────────────────

const executors = new Map<string, NodeExecutor>();

/** Register an executor for a node type */
export function registerExecutor(type: string, fn: NodeExecutor) {
  executors.set(type, fn);
}

/** Get the executor for a node type, or throw if not found */
export function getExecutor(type: string): NodeExecutor {
  const fn = executors.get(type);
  if (!fn) throw new Error(`Node type "${type}" is not yet implemented`);
  return fn;
}

/** Check if an executor is registered */
export function hasExecutor(type: string): boolean {
  return executors.has(type);
}

// ─── Built-in executors ───────────────────────────────────────────────

// --- Triggers ---
registerExecutor("trigger-manual", async (node, input, ctx, logs) => {
  const raw = node.config.initialData;
  if (raw && typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  return input ?? raw ?? null;
});

registerExecutor("trigger-cron", async (node, input, ctx, logs) => {
  return input ?? null;
});

registerExecutor("trigger-datetime", async (node, input, ctx, logs) => {
  return input ?? null;
});

// --- Database ---

async function getDbConnection(connectionId: number | null | undefined) {
  const { runQuery, getConnection } = await import("@/lib/db/actions-core");
  if (!connectionId) throw new Error("This workflow isn't linked to a connection");
  const conn = await getConnection(connectionId);
  if (!conn) throw new Error(`Connection ${connectionId} not found`);
  return { runQuery, connectionString: conn.connectionString };
}

function parseQueryParams(node: WorkflowNode): unknown[] {
  if (!node.config.params) return [];
  try { return JSON.parse(String(node.config.params)); } catch { return []; }
}

async function runDbQuery(node: WorkflowNode, connectionId: number | null | undefined, sql: string) {
  const { runQuery, connectionString } = await getDbConnection(connectionId);
  const params = parseQueryParams(node);
  const result = await runQuery(connectionString, sql, params as any[], {});
  if (!result.success) throw new Error(result.error || "Query failed");
  return result.data?.rows ?? result.data ?? null;
}

registerExecutor("db-query", async (node, input, ctx, logs, connectionId) => {
  const sql = String(node.config.sql || "");
  if (!sql.trim()) throw new Error("SQL is empty");
  const data = await runDbQuery(node, connectionId, sql);
  logs.push(`Returned ${Array.isArray(data) ? data.length : 0} rows`);
  return data;
});

registerExecutor("db-insert", async (node, input, ctx, logs, connectionId) => {
  const { runQuery, getConnection } = await import("@/lib/db/actions-core");
  if (!connectionId) throw new Error("This workflow isn't linked to a connection");
  const conn = await getConnection(connectionId);
  if (!conn) throw new Error(`Connection ${connectionId} not found`);
  const table = String(node.config.table || "");
  if (!table) throw new Error("Table name is required");
  return insertRowsToTable(table, node.config.rows, input, ctx, runQuery, conn.connectionString, logs);
});

async function runRawSql(node: any, connectionId: number | null | undefined) {
  const sql = String(node.config.sql || "");
  if (!sql.trim()) throw new Error("SQL is empty");
  return runDbQuery(node, connectionId, sql);
}

registerExecutor("db-update", (node, input, ctx, logs, connectionId) => runRawSql(node, connectionId));
registerExecutor("db-delete", (node, input, ctx, logs, connectionId) => runRawSql(node, connectionId));

registerExecutor("db-explain", async (node, input, ctx, logs, connectionId) => {
  const sql = `EXPLAIN ANALYZE ${node.config.sql}`;
  if (!sql.trim()) throw new Error("SQL is empty");
  return runDbQuery(node, connectionId, sql);
});

// --- Code ---
registerExecutor("code-js", async (node, input, ctx, logs) => {
  const code = String(node.config.code || "");
  if (!code.trim()) return input;
  return runJsCode(code, input, ctx, logs);
});

registerExecutor("code-json-transform", async (node, input, ctx, logs) => {
  const expr = String(node.config.expression || "");
  if (!expr.trim()) return input;
  return evalExpression(expr, input, ctx);
});

registerExecutor("code-template", async (node, input, ctx, logs) => {
  const template = String(node.config.template || "");
  const data = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const val = data[key];
    return val !== undefined ? String(val) : `{{${key}}}`;
  });
});

// --- Data Transform ---
registerExecutor("data-filter", async (node, input, ctx, logs) => {
  const arr = toArray(input);
  const expr = String(node.config.expression || "true");
  return arr.filter((item) => {
    try {
      return evalExpression(`(function(item){return (${expr})})(item)`, item, ctx);
    } catch {
      return false;
    }
  });
});

registerExecutor("data-sort", async (node, input, ctx, logs) => {
  const arr = toArray(input);
  const field = String(node.config.field || "");
  const dir = String(node.config.direction || "asc");
  return [...arr].sort((a: any, b: any) => {
    const av = field ? a?.[field] : a;
    const bv = field ? b?.[field] : b;
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return dir === "desc" ? -cmp : cmp;
  });
});

registerExecutor("data-limit", async (node, input, ctx, logs) => {
  const arr = toArray(input);
  const limit = Number(node.config.limit ?? 10);
  const offset = Number(node.config.offset ?? 0);
  return arr.slice(offset, offset + limit);
});

registerExecutor("data-group-by", async (node, input, ctx, logs) => {
  const arr = toArray(input);
  const field = String(node.config.field || "");
  const groups: Record<string, unknown[]> = {};
  for (const item of arr) {
    const key = String((item as any)?.[field] ?? "null");
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
  }
  return groups;
});

registerExecutor("data-map", async (node, input, ctx, logs) => {
  const arr = toArray(input);
  const expr = String(node.config.expression || "item");
  return arr.map((item) => {
    try {
      return evalExpression(`(function(item){return (${expr})})(item)`, item, ctx);
    } catch {
      return item;
    }
  });
});

registerExecutor("data-merge", async (node, input, ctx, logs) => {
  if (Array.isArray(input)) return input.flat();
  return input;
});

registerExecutor("data-deduplicate", async (node, input, ctx, logs) => {
  const arr = toArray(input);
  const field = node.config.field ? String(node.config.field) : null;
  const seen = new Set<string>();
  return arr.filter((item) => {
    const key = field ? String((item as any)?.[field]) : JSON.stringify(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
});

registerExecutor("data-flatten", async (node, input, ctx, logs) => {
  const arr = toArray(input);
  const field = node.config.field ? String(node.config.field) : null;
  if (field) {
    return arr.flatMap((item: any) => {
      const val = item?.[field];
      return Array.isArray(val) ? val : [item];
    });
  }
  return arr.flat();
});

registerExecutor("data-pick-fields", async (node, input, ctx, logs) => {
  const arr = toArray(input);
  const fields = String(node.config.fields || "")
    .split(",")
    .map((f) => f.trim())
    .filter(Boolean);
  return arr.map((item: any) => {
    const out: Record<string, unknown> = {};
    for (const f of fields) out[f] = item?.[f];
    return out;
  });
});

registerExecutor("data-remove-fields", async (node, input, ctx, logs) => {
  const arr = toArray(input);
  const fields = new Set(
    String(node.config.fields || "")
      .split(",")
      .map((f) => f.trim()),
  );
  return arr.map((item: any) => {
    const out: Record<string, unknown> = { ...item };
    for (const f of fields) delete out[f];
    return out;
  });
});

registerExecutor("data-set-field", async (node, input, ctx, logs) => {
  const arr = toArray(input);
  const field = String(node.config.field || "");
  const valueExpr = String(node.config.value || "null");
  return arr.map((item: any) => {
    let val: unknown;
    try {
      val = evalExpression(`(function(item){return (${valueExpr})})(item)`, item, ctx);
    } catch {
      val = valueExpr;
    }
    return { ...item, [field]: val };
  });
});

registerExecutor("data-aggregate", async (node, input, ctx, logs) => {
  return computeAggregate(toArray(input), String(node.config.field || ""), String(node.config.operation || "count"));
});

registerExecutor("data-chunk", async (node, input, ctx, logs) => {
  const arr = toArray(input);
  const size = Number(node.config.size || 10);
  const chunks: unknown[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
});

// --- HTTP ---
registerExecutor("http-request", async (node, input, ctx, logs) => {
  incrementHttpRequestCount(ctx);
  const method = String(node.config.method || "GET");
  const url = String(node.config.url || "");
  if (!url) throw new Error("URL is required");
  let headers: Record<string, string> = {};
  if (node.config.headers) {
    try {
      headers =
        typeof node.config.headers === "string"
          ? JSON.parse(node.config.headers)
          : (node.config.headers as Record<string, string>);
    } catch {}
  }
  let body: string | undefined;
  if (node.config.body && method !== "GET" && method !== "HEAD") {
    if (typeof node.config.body === "string") {
      try {
        JSON.parse(node.config.body);
        body = node.config.body;
      } catch {
        body = node.config.body;
      }
    } else {
      body = JSON.stringify(node.config.body);
      headers["Content-Type"] = headers["Content-Type"] || "application/json";
    }
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000); // 30s per HTTP request
  try {
    const res = await fetch(url, { method, headers, body, signal: controller.signal });
    const responseType = String(node.config.responseType || "json");
    if (responseType === "text") {
      return { status: res.status, ok: res.ok, body: await res.text() };
    }
    const data = await res.json().catch(() => null);
    logs.push(`HTTP ${method} ${url} → ${res.status}`);
    return { status: res.status, ok: res.ok, body: data };
  } finally {
    clearTimeout(timeout);
  }
});

// --- Flow Control ---
registerExecutor("flow-condition", async (node, input, ctx, logs) => {
  const expr = String(node.config.expression || "false");
  let result: boolean;
  try {
    result = Boolean(evalExpression(`(function($input, $vars){return (${expr})})($input, $vars)`, input, ctx));
  } catch {
    result = false;
  }
  ctx.conditionResult = result;
  logs.push(`Condition: ${result}`);
  return { condition: result, input };
});

registerExecutor("flow-loop-items", async (node, input, ctx, logs) => {
  const arr = toArray(input);
  if (arr.length > MAX_LOOP_ITEMS) {
    throw new Error(`Loop iteration limit exceeded: ${arr.length} items (max ${MAX_LOOP_ITEMS}). Split into smaller batches.`);
  }
  const itemVar = String(node.config.itemVar || "item");
  ctx.vars[itemVar] = arr;
  logs.push(`Loop over ${arr.length} items — use $vars.${itemVar}[i] in subsequent nodes`);
  return arr;
});

registerExecutor("flow-delay", async (node, input, ctx, logs) => {
  const seconds = Number(node.config.seconds || 0);
  if (seconds > 0) {
    await new Promise((r) => setTimeout(r, seconds * 1000));
    logs.push(`Waited ${seconds}s`);
  }
  return input;
});

registerExecutor("flow-stop-error", async (node, input, ctx, logs) => {
  const msg = String(node.config.message || "Workflow stopped");
  throw new Error(msg);
});

registerExecutor("flow-no-op", async (node, input, ctx, logs) => {
  return input;
});

// --- Notifications ---
function fetchWithTimeout(url: string, options: RequestInit & { timeout?: number }): Promise<Response> {
  const timeout = options.timeout ?? 30_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

async function sendWebhook(node: any, ctx: any, logs: string[], service: string, body: Record<string, unknown>) {
  incrementHttpRequestCount(ctx);
  const webhookUrl = String(node.config.webhookUrl || "");
  if (!webhookUrl) throw new Error("Webhook URL is required");
  if (node.config.username) body.username = node.config.username;
  const res = await fetchWithTimeout(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  logs.push(`${service} → ${res.status}`);
  return { sent: res.ok, status: res.status };
}

registerExecutor("notify-slack", async (node, input, ctx, logs) => {
  const data = typeof input === "object" && input !== null ? input : {};
  const text = String(node.config.text || "").replace(/\{\{(\w+)\}\}/g, (_, k) =>
    String((data as any)[k] ?? `{{${k}}}`),
  );
  return sendWebhook(node, ctx, logs, "Slack", { text });
});

registerExecutor("notify-discord", async (node, input, ctx, logs) => {
  return sendWebhook(node, ctx, logs, "Discord", { content: String(node.config.content || "") });
});

registerExecutor("notify-webhook", async (node, input, ctx, logs) => {
  incrementHttpRequestCount(ctx);
  const url = String(node.config.url || "");
  if (!url) throw new Error("URL is required");
  let payload: unknown = input;
  if (node.config.payload && node.config.payload !== "$input") {
    try {
      payload = evalExpression(String(node.config.payload), input, ctx);
    } catch {}
  }
  let headers: Record<string, string> = { "Content-Type": "application/json" };
  if (node.config.headers) {
    try {
      Object.assign(
        headers,
        typeof node.config.headers === "string" ? JSON.parse(String(node.config.headers)) : node.config.headers,
      );
    } catch {}
  }
  const res = await fetchWithTimeout(url, { method: "POST", headers, body: JSON.stringify(payload) });
  logs.push(`Webhook → ${res.status}`);
  return { sent: res.ok, status: res.status };
});

// --- Transform ---
registerExecutor("transform-json-parse", async (node, input, ctx, logs) => {
  const field = node.config.field ? String(node.config.field) : null;
  if (field) {
    const arr = toArray(input);
    return arr.map((item: any) => {
      try {
        return { ...item, [field]: JSON.parse(String(item?.[field])) };
      } catch {
        return item;
      }
    });
  }
  if (typeof input === "string") {
    try {
      return JSON.parse(input);
    } catch {
      return input;
    }
  }
  return input;
});

registerExecutor("transform-json-stringify", async (node, input, ctx, logs) => {
  const indent = Number(node.config.indent ?? 0);
  return JSON.stringify(input, null, indent || undefined);
});

registerExecutor("transform-date-format", async (node, input, ctx, logs) => {
  const arr = toArray(input);
  const field = String(node.config.field || "");
  const fmt = String(node.config.format || "yyyy-MM-dd");
  const outputField = node.config.outputField ? String(node.config.outputField) : field;
  return arr.map((item: any) => {
    try {
      const raw = item?.[field];
      const d = raw ? new Date(raw) : new Date();
      return { ...item, [outputField]: formatDate(d, fmt) };
    } catch {
      return item;
    }
  });
});

function transformBase64(node: any, input: any, encode: boolean) {
  const field = node.config.field ? String(node.config.field) : null;
  const fromEnc = encode ? undefined : "base64";
  const toEnc = encode ? "base64" : "utf8";
  if (field) {
    const arr = toArray(input);
    return arr.map((item: any) => ({
      ...item,
      [field]: Buffer.from(String(item?.[field] ?? ""), fromEnc).toString(toEnc),
    }));
  }
  return Buffer.from(encode ? JSON.stringify(input) : String(input), fromEnc).toString(toEnc);
}

registerExecutor("transform-encode-base64", async (node, input) => transformBase64(node, input, true));
registerExecutor("transform-decode-base64", async (node, input) => transformBase64(node, input, false));

registerExecutor("transform-hash", async (node, input, ctx, logs) => {
  const arr = toArray(input);
  const field = String(node.config.field || "");
  const algorithm = String(node.config.algorithm || "sha256");
  const outputField = node.config.outputField ? String(node.config.outputField) : `${field}_hash`;
  return arr.map((item: any) => {
    const val = String(item?.[field] ?? "");
    const hash = createHash(
      algorithm === "md5" ? "md5" : algorithm === "sha512" ? "sha512" : "sha256",
    )
      .update(val)
      .digest("hex");
    return { ...item, [outputField]: hash };
  });
});

// --- Utility ---
registerExecutor("util-log", async (node, input, ctx, logs) => {
  const msgExpr = node.config.message ? String(node.config.message) : "$input";
  let msg: unknown;
  try {
    msg = msgExpr === "$input" ? input : evalExpression(msgExpr, input, ctx);
  } catch {
    msg = input;
  }
  const level = String(node.config.level || "info");
  logs.push(`[${level.toUpperCase()}] ${JSON.stringify(msg)}`);
  return input;
});

registerExecutor("util-debug", async (node, input, ctx, logs) => {
  logs.push(`DEBUG: ${JSON.stringify(input, null, 2)}`);
  return input;
});

registerExecutor("util-uuid", async (node, input, ctx, logs) => {
  const field = String(node.config.outputField || "uuid");
  const uuid = generateUUID();
  if (typeof input === "object" && input !== null && !Array.isArray(input)) {
    return { ...(input as object), [field]: uuid };
  }
  return { [field]: uuid, input };
});

registerExecutor("util-random", async (node, input, ctx, logs) => {
  const mode = String(node.config.mode || "integer");
  const min = Number(node.config.min ?? 0);
  const max = Number(node.config.max ?? 100);
  if (mode === "pick") {
    const arr = toArray(input);
    if (!arr.length) return null;
    return arr[Math.floor(Math.random() * arr.length)];
  }
  const val =
    mode === "float" ? Math.random() * (max - min) + min : Math.floor(Math.random() * (max - min + 1)) + min;
  if (typeof input === "object" && input !== null) return { ...(input as object), random: val };
  return { random: val };
});

registerExecutor("util-timestamp", async (node, input, ctx, logs) => {
  const field = String(node.config.outputField || "timestamp");
  const fmt = String(node.config.format || "iso");
  let ts: string | number;
  if (fmt === "unix") ts = Math.floor(Date.now() / 1000);
  else if (fmt === "ms") ts = Date.now();
  else ts = new Date().toISOString();
  if (typeof input === "object" && input !== null && !Array.isArray(input)) {
    return { ...(input as object), [field]: ts };
  }
  return { [field]: ts, input };
});

registerExecutor("util-counter", async (node, input, ctx, logs) => {
  const arr = toArray(input);
  const field = String(node.config.outputField || "count");
  return { [field]: arr.length, items: arr };
});

registerExecutor("util-set-variable", async (node, input, ctx, logs) => {
  const name = String(node.config.name || "");
  if (!name) throw new Error("Variable name is required");
  let val: unknown = input;
  if (node.config.value && node.config.value !== "$input") {
    try {
      val = evalExpression(String(node.config.value), input, ctx);
    } catch {
      val = node.config.value;
    }
  }
  ctx.vars[name] = val;
  logs.push(`Set $vars.${name}`);
  return input;
});

registerExecutor("util-get-variable", async (node, input, ctx, logs) => {
  const name = String(node.config.name || "");
  if (!name) throw new Error("Variable name is required");
  const val = ctx.vars[name];
  logs.push(`Got $vars.${name} = ${JSON.stringify(val)}`);
  return val;
});

registerExecutor("util-sleep", async (node, input, ctx, logs) => {
  const ms = Number(node.config.ms || 0);
  if (ms > 0) await new Promise((r) => setTimeout(r, ms));
  return input;
});
