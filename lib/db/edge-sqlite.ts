// HTTP-backed SQLite-family drivers (Outerbase Studio parity).
//
// Covers the SQLite-edge backends that speak HTTP instead of the libSQL wire
// protocol or a local file:
//
//   rqlite://host:4001[?user=&password=]      (rqlites:// = TLS)
//   d1://{accountId}/{databaseId}?token=...   (Cloudflare D1 REST API)
//   starbase[s]://host[:port]?token=...       (StarbaseDB /query/raw)
//   valtown://?token=...                      (api.val.town SQLite API)
//
// All drivers expose the same minimal surface the sqlite-client expects
// ({ all, get, run, close }) so every existing table/schema/mutation helper
// keeps working unchanged. Pure fetch — no new native dependencies.

export type EdgeSqliteKind = "rqlite" | "d1" | "starbase" | "valtown";

export type EdgeSqliteTarget =
  | {
      kind: "rqlite";
      baseUrl: string;
      username?: string;
      password?: string;
    }
  | {
      kind: "d1";
      accountId: string;
      databaseId: string;
      token: string;
    }
  | {
      kind: "starbase";
      baseUrl: string;
      token: string;
      source?: string;
    }
  | {
      kind: "valtown";
      token: string;
    };

export interface EdgeSqliteDriver {
  all: (sql: string, args?: unknown[]) => Promise<Record<string, unknown>[]>;
  get: (sql: string, args?: unknown[]) => Promise<Record<string, unknown> | null>;
  run: (sql: string, args?: unknown[]) => Promise<{ changes: number }>;
  close: () => Promise<void>;
}

function stripTrailingSlash(value: string) {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function readParam(parsed: URL, names: string[]): string {
  for (const name of names) {
    const value = parsed.searchParams.get(name);
    if (value) return value;
  }
  return "";
}

/** Normalize a token that may arrive as userinfo or a query param. */
function readToken(parsed: URL): string {
  return (
    parsed.password ||
    parsed.username ||
    readParam(parsed, ["token", "authToken", "auth_token", "apiToken", "api_token"])
  );
}

// ---------------------------------------------------------------------------
// Detection + parsing
// ---------------------------------------------------------------------------

export function detectEdgeSqliteKind(connectionString: string): EdgeSqliteKind | null {
  const raw = String(connectionString || "").trim().toLowerCase();
  if (
    raw.startsWith("rqlite://") ||
    raw.startsWith("rqlites://") ||
    raw.startsWith("rqlite+http://") ||
    raw.startsWith("rqlite+https://")
  ) {
    return "rqlite";
  }
  if (raw.startsWith("d1://") || raw.startsWith("cloudflare-d1://")) return "d1";
  if (
    raw.startsWith("starbase://") ||
    raw.startsWith("starbases://") ||
    raw.startsWith("starbasedb://") ||
    raw.startsWith("starbasedbs://")
  ) {
    return "starbase";
  }
  if (raw.startsWith("valtown://") || raw.startsWith("val.town://")) return "valtown";
  return null;
}

function parseRqlite(connectionString: string): EdgeSqliteTarget {
  const raw = String(connectionString || "").trim();
  const normalized = raw
    .replace(/^rqlites:\/\//i, "https://")
    .replace(/^rqlite:\/\//i, "http://")
    .replace(/^rqlite\+https:\/\//i, "https://")
    .replace(/^rqlite\+http:\/\//i, "http://");
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error("Invalid rqlite connection string. Use rqlite://host:4001");
  }
  const username =
    decodeURIComponent(parsed.username || "") ||
    readParam(parsed, ["user", "username"]) ||
    undefined;
  const password =
    decodeURIComponent(parsed.password || "") ||
    readParam(parsed, ["password", "pass"]) ||
    undefined;
  const baseUrl = stripTrailingSlash(`${parsed.protocol}//${parsed.host}`);
  return { kind: "rqlite", baseUrl, username, password };
}

function parseD1(connectionString: string): EdgeSqliteTarget {
  // d1://{accountId}/{databaseId}?token=...
  const raw = String(connectionString || "").trim();
  const withoutScheme = raw.replace(/^[a-z0-9+.-]+:\/\//i, "");
  const [pathPart, queryPart] = withoutScheme.split("?");
  const segments = pathPart.split("/").filter(Boolean);
  if (segments.length < 2) {
    throw new Error(
      "Invalid Cloudflare D1 connection string. Use d1://{accountId}/{databaseId}?token=...",
    );
  }
  const params = new URLSearchParams(queryPart || "");
  const token =
    params.get("token") ||
    params.get("authToken") ||
    params.get("auth_token") ||
    params.get("apiToken") ||
    params.get("api_token") ||
    "";
  if (!token) {
    throw new Error("Cloudflare D1 connection string is missing ?token= (API token).");
  }
  return {
    kind: "d1",
    accountId: segments[0],
    databaseId: segments[1],
    token,
  };
}

function parseStarbase(connectionString: string): EdgeSqliteTarget {
  const raw = String(connectionString || "").trim();
  const normalized = raw
    .replace(/^starbases:\/\//i, "https://")
    .replace(/^starbasedbs:\/\//i, "https://")
    .replace(/^starbase:\/\//i, "http://")
    .replace(/^starbasedb:\/\//i, "http://");
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error("Invalid StarbaseDB connection string. Use starbase://host:8787?token=...");
  }
  const token = readToken(parsed);
  if (!token) {
    throw new Error("StarbaseDB connection string is missing ?token=.");
  }
  const baseUrl = stripTrailingSlash(`${parsed.protocol}//${parsed.host}${parsed.pathname || ""}`);
  const source = readParam(parsed, ["source"]) || undefined;
  return { kind: "starbase", baseUrl, token, source };
}

function parseValtown(connectionString: string): EdgeSqliteTarget {
  const raw = String(connectionString || "").trim();
  // Accept valtown://?token=..., valtown://TOKEN, valtown://TOKEN@val.town
  const normalized = raw.replace(/^val\.town:\/\//i, "valtown://");
  let token = "";
  try {
    const parsed = new URL(normalized);
    token = readToken(parsed);
    if (!token && parsed.hostname && parsed.hostname !== "val.town" && parsed.hostname !== "api.val.town") {
      // Bare-token form: valtown://<token> (single-label host is the token).
      token = parsed.hostname;
    }
  } catch {
    token = normalized.replace(/^valtown:\/\//i, "").split("?")[0].replace(/\/+$/, "");
  }
  if (!token) {
    throw new Error("Val.town connection string is missing a token. Use valtown://?token=...");
  }
  return { kind: "valtown", token };
}

export function parseEdgeSqliteTarget(connectionString: string): EdgeSqliteTarget | null {
  const kind = detectEdgeSqliteKind(connectionString);
  if (!kind) return null;
  switch (kind) {
    case "rqlite":
      return parseRqlite(connectionString);
    case "d1":
      return parseD1(connectionString);
    case "starbase":
      return parseStarbase(connectionString);
    case "valtown":
      return parseValtown(connectionString);
    default:
      return null;
  }
}

export function getEdgeDatabaseLabel(target: EdgeSqliteTarget): string {
  switch (target.kind) {
    case "rqlite":
      try {
        return new URL(target.baseUrl).hostname || "rqlite";
      } catch {
        return "rqlite";
      }
    case "d1":
      return `d1:${target.databaseId.slice(0, 8)}`;
    case "starbase":
      try {
        return new URL(target.baseUrl).hostname || "starbase";
      } catch {
        return "starbase";
      }
    case "valtown":
      return "valtown";
    default:
      return "edge-sqlite";
  }
}

// ---------------------------------------------------------------------------
// Shared HTTP helpers
// ---------------------------------------------------------------------------

async function postJson(url: string, headers: Record<string, string>, body: unknown) {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Edge SQLite request failed (${url}): ${message}`);
  }
  const contentType = res.headers.get("content-type") || "";
  let payload: unknown = null;
  if (contentType.includes("application/json")) {
    try {
      payload = await res.json();
    } catch {
      const text = await res.text().catch(() => "");
      throw new Error(text || `Edge SQLite endpoint returned invalid JSON (status ${res.status}).`);
    }
  } else {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Edge SQLite endpoint returned non-JSON response (status ${res.status}).`);
  }
  if (!res.ok) {
    const message =
      (payload as { error?: string })?.error ||
      (payload as { errors?: Array<{ message?: string }> })?.errors?.[0]?.message ||
      `Edge SQLite error (status ${res.status}).`;
    throw new Error(message);
  }
  return payload as Record<string, unknown>;
}

function normalizeArgs(args?: unknown[]): unknown[] {
  return Array.isArray(args) ? [...args] : [];
}

function rowsToFields(rows: Record<string, unknown>[]) {
  if (!rows.length) return [];
  return Object.keys(rows[0]).map((name) => ({
    name,
    dataTypeID: 0,
    dataTypeName: "unknown",
  }));
}

/**
 * Single-statement HTTP backends auto-commit every request, so the
 * BEGIN/COMMIT/ROLLBACK wrappers issued by the local mutation helpers are
 * no-ops here. Swallowing them keeps update/delete flows working instead of
 * failing on backends (e.g. rqlite) that reject bare transaction commands.
 */
function isTransactionControl(sql: string) {
  return /^\s*(BEGIN|COMMIT|ROLLBACK|END|SAVEPOINT|RELEASE)\b/i.test(String(sql || ""));
}

// ---------------------------------------------------------------------------
// rqlite — unified /db/request endpoint
// ---------------------------------------------------------------------------

type RqliteResult = {
  columns?: string[];
  types?: string[];
  values?: unknown[][];
  rows_affected?: number;
  last_insert_id?: number;
  time?: number;
  error?: string;
};

function rqliteResultToRows(raw: RqliteResult): { rows: Record<string, unknown>[]; changes: number } {
  if (raw.error) throw new Error(raw.error);
  const columns = raw.columns ?? [];
  const values = raw.values ?? [];
  const seen = new Set<string>();
  const names = columns.map((col) => {
    let name = col;
    for (let i = 0; i < 20 && seen.has(name); i++) name = `__${col}_${i}`;
    seen.add(name);
    return name;
  });
  const rows = values.map((tuple) => {
    const row: Record<string, unknown> = {};
    names.forEach((name, index) => {
      row[name] = tuple?.[index] ?? null;
    });
    return row;
  });
  return { rows, changes: Number(raw.rows_affected ?? 0) };
}

async function rqliteRequest(
  target: Extract<EdgeSqliteTarget, { kind: "rqlite" }>,
  statements: Array<[string, ...unknown[]]>,
): Promise<RqliteResult[]> {
  const headers: Record<string, string> = {};
  if (target.username) {
    headers.Authorization = `Basic ${Buffer.from(`${target.username}:${target.password ?? ""}`).toString("base64")}`;
  }
  const payload = await postJson(
    `${target.baseUrl}/db/request?timings`,
    headers,
    statements,
  );
  const results = (payload.results ?? payload) as RqliteResult[] | RqliteResult;
  const list = Array.isArray(results) ? results : [results];
  for (const item of list) {
    if (item?.error) throw new Error(item.error);
  }
  return list;
}

function createRqliteDriver(
  target: Extract<EdgeSqliteTarget, { kind: "rqlite" }>,
): EdgeSqliteDriver {
  return {
    all: async (sql, args) => {
      const [result] = await rqliteRequest(target, [[sql, ...normalizeArgs(args)]]);
      return rqliteResultToRows(result ?? {}).rows;
    },
    get: async (sql, args) => {
      const [result] = await rqliteRequest(target, [[sql, ...normalizeArgs(args)]]);
      return rqliteResultToRows(result ?? {}).rows[0] ?? null;
    },
    run: async (sql, args) => {
      if (isTransactionControl(sql)) return { changes: 0 };
      const [result] = await rqliteRequest(target, [[sql, ...normalizeArgs(args)]]);
      return { changes: rqliteResultToRows(result ?? {}).changes };
    },
    close: async () => {},
  };
}

// ---------------------------------------------------------------------------
// Cloudflare D1 — REST API
// ---------------------------------------------------------------------------

type D1QueryResult = {
  results?: Record<string, unknown>[];
  meta?: {
    changes?: number;
    last_row_id?: number;
    rows_read?: number;
    rows_written?: number;
    duration?: number;
  };
};

async function d1Request(
  target: Extract<EdgeSqliteTarget, { kind: "d1" }>,
  sql: string,
  args: unknown[],
): Promise<D1QueryResult> {
  const url =
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(target.accountId)}` +
    `/d1/database/${encodeURIComponent(target.databaseId)}/query`;
  const payload = await postJson(
    url,
    { Authorization: `Bearer ${target.token}` },
    { sql, params: normalizeArgs(args) },
  );
  const errors = (payload.errors as Array<{ message?: string }> | undefined) ?? [];
  if (!payload.success && errors.length) {
    throw new Error(errors.map((e) => e.message || "D1 error").join("; "));
  }
  const result = (payload.result as D1QueryResult[] | undefined) ?? [];
  if (!result.length) return {};
  return result[0] ?? {};
}

function createD1Driver(target: Extract<EdgeSqliteTarget, { kind: "d1" }>): EdgeSqliteDriver {
  return {
    all: async (sql, args) => {
      const res = await d1Request(target, sql, normalizeArgs(args));
      return (res.results ?? []) as Record<string, unknown>[];
    },
    get: async (sql, args) => {
      const res = await d1Request(target, sql, normalizeArgs(args));
      return (res.results ?? [])[0] ?? null;
    },
    run: async (sql, args) => {
      if (isTransactionControl(sql)) return { changes: 0 };
      const res = await d1Request(target, sql, normalizeArgs(args));
      return { changes: Number(res.meta?.changes ?? 0) };
    },
    close: async () => {},
  };
}

// ---------------------------------------------------------------------------
// StarbaseDB — /query/raw
// ---------------------------------------------------------------------------

type StarbaseResult = {
  columns?: string[];
  rows?: unknown[][];
  meta?: { rows_read?: number; rows_written?: number };
};

async function starbaseRequest(
  target: Extract<EdgeSqliteTarget, { kind: "starbase" }>,
  statements: Array<{ sql: string; params?: unknown[] }>,
): Promise<StarbaseResult[]> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${target.token}`,
  };
  if (target.source) headers["X-Starbase-Source"] = target.source;
  const body =
    statements.length === 1
      ? { sql: statements[0].sql, params: statements[0].params ?? [] }
      : { transaction: statements };
  const payload = await postJson(`${target.baseUrl}/query/raw`, headers, body);
  const raw = (payload as { result?: StarbaseResult | StarbaseResult[] }).result;
  if (!raw) {
    const error = (payload as { error?: string }).error;
    if (error) throw new Error(error);
    return [];
  }
  return Array.isArray(raw) ? raw : [raw];
}

function starbaseResultToRows(raw: StarbaseResult): Record<string, unknown>[] {
  const columns = raw.columns ?? [];
  const seen = new Set<string>();
  const names = columns.map((col) => {
    let name = col;
    for (let i = 0; i < 20 && seen.has(name); i++) name = `__${col}_${i}`;
    seen.add(name);
    return name;
  });
  return (raw.rows ?? []).map((tuple) => {
    const row: Record<string, unknown> = {};
    names.forEach((name, index) => {
      row[name] = tuple?.[index] ?? null;
    });
    return row;
  });
}

function createStarbaseDriver(
  target: Extract<EdgeSqliteTarget, { kind: "starbase" }>,
): EdgeSqliteDriver {
  return {
    all: async (sql, args) => {
      const [result] = await starbaseRequest(target, [{ sql, params: normalizeArgs(args) }]);
      return starbaseResultToRows(result ?? {});
    },
    get: async (sql, args) => {
      const [result] = await starbaseRequest(target, [{ sql, params: normalizeArgs(args) }]);
      return starbaseResultToRows(result ?? {})[0] ?? null;
    },
    run: async (sql, args) => {
      if (isTransactionControl(sql)) return { changes: 0 };
      const [result] = await starbaseRequest(target, [{ sql, params: normalizeArgs(args) }]);
      return { changes: Number(result?.meta?.rows_written ?? 0) };
    },
    close: async () => {},
  };
}

// ---------------------------------------------------------------------------
// Val.town — api.val.town SQLite API (libSQL-shaped)
// ---------------------------------------------------------------------------

type ValtownResultSet = {
  columns?: string[];
  columnTypes?: unknown[];
  rows?: unknown[][];
  rowsAffected?: number;
  lastInsertRowid?: unknown;
  error?: string;
};

function valtownResultToRows(raw: ValtownResultSet): Record<string, unknown>[] {
  if (raw.error) throw new Error(raw.error);
  const columns = raw.columns ?? [];
  const seen = new Set<string>();
  const names = columns.map((col) => {
    let name = col;
    for (let i = 0; i < 20 && seen.has(name); i++) name = `__${col}_${i}`;
    seen.add(name);
    return name;
  });
  return (raw.rows ?? []).map((tuple) => {
    const row: Record<string, unknown> = {};
    names.forEach((name, index) => {
      const value = tuple?.[index];
      row[name] = value instanceof Uint8Array ? Array.from(value) : (value ?? null);
    });
    return row;
  });
}

async function valtownExecute(
  target: Extract<EdgeSqliteTarget, { kind: "valtown" }>,
  sql: string,
  args: unknown[],
): Promise<ValtownResultSet> {
  const payload = await postJson(
    "https://api.val.town/v1/sqlite/execute",
    { Authorization: `Bearer ${target.token}` },
    { statement: { sql, args: normalizeArgs(args) } },
  );
  if ((payload as ValtownResultSet).error) {
    throw new Error(String((payload as ValtownResultSet).error));
  }
  return payload as ValtownResultSet;
}

function createValtownDriver(
  target: Extract<EdgeSqliteTarget, { kind: "valtown" }>,
): EdgeSqliteDriver {
  return {
    all: async (sql, args) => valtownResultToRows(await valtownExecute(target, sql, normalizeArgs(args))),
    get: async (sql, args) =>
      valtownResultToRows(await valtownExecute(target, sql, normalizeArgs(args)))[0] ?? null,
    run: async (sql, args) => {
      if (isTransactionControl(sql)) return { changes: 0 };
      const res = await valtownExecute(target, sql, normalizeArgs(args));
      return { changes: Number(res.rowsAffected ?? 0) };
    },
    close: async () => {},
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createEdgeSqliteDriver(target: EdgeSqliteTarget): EdgeSqliteDriver {
  switch (target.kind) {
    case "rqlite":
      return createRqliteDriver(target);
    case "d1":
      return createD1Driver(target);
    case "starbase":
      return createStarbaseDriver(target);
    case "valtown":
      return createValtownDriver(target);
    default:
      throw new Error(`Unsupported edge SQLite kind: ${(target as { kind: string }).kind}`);
  }
}

export { rowsToFields };
