import type { QueryResult } from "./client-types";
import { getWsClient, closeAllWsClients } from "./spacetimedb-ws-client";

const cachedModuleDefs = new Map<string, any>();
const cachedReducers = new Map<string, string[]>();

function cacheKey(info: SpacetimeDbConnectionInfo): string {
  return `${info.database}@${info.baseUrl}`;
}

type SpacetimeDbConnectionInfo = {
  baseUrl: string;
  database: string;
  token?: string;
};

function isTauriAvailable(): boolean {
  return typeof window !== "undefined" && (
    typeof (window as any).__TAURI__ !== "undefined" ||
    typeof (window as any).__TAURI_INTERNALS__ !== "undefined"
  );
}

async function tauriInvoke<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

function parseSpacetimeConnectionString(
  connectionString: string,
): SpacetimeDbConnectionInfo {
  const raw = String(connectionString || "").trim();
  if (!raw) throw new Error("SpacetimeDB: empty connection string");
  try {
    const parsed = new URL(raw);
    const host = parsed.hostname || "localhost";
    const protocol = parsed.protocol === "spacetimedbs:" ? "https" : "http";
    const port = parsed.port || (protocol === "https" ? "443" : "3000");
    const database = decodeURIComponent(
      (parsed.pathname || "").replace(/^\/+/, ""),
    );
    if (!database)
      throw new Error("SpacetimeDB: database name is required");
    const token = parsed.searchParams.get("token") || undefined;
    return { baseUrl: `${protocol}://${host}:${port}`, database, token };
  } catch (err: any) {
    if (err.message?.includes("SpacetimeDB")) throw err;
    throw new Error(`SpacetimeDB: invalid connection string - ${err?.message || err}`);
  }
}

function wsClientFor(info: SpacetimeDbConnectionInfo) {
  return getWsClient(info.baseUrl, info.database, info.token);
}

function buildHeaders(
  info: SpacetimeDbConnectionInfo,
): Record<string, string> {
  const headers: Record<string, string> = {};
  if (info.token) headers["authorization"] = `Bearer ${info.token}`;
  return headers;
}

async function browserFetch(
  baseUrl: string,
  path: string,
  headers: Record<string, string>,
  method = "GET",
  body?: BodyInit,
) {
  const url = `${baseUrl}${path}`;
  const res = await fetch(url, { method, headers, body });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `SpacetimeDB ${method} ${path} failed (${res.status}): ${text || res.statusText}`,
    );
  }
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return res.json();
  return res.text();
}

function rowsToObjects(
  schema: any,
  rows: any[],
): Record<string, any>[] {
  if (!schema || !rows) return [];
  const product = schema.Product || schema;
  const elements = product.elements || [];
  const colNames = elements.map(
    (el: any) => el.name?.some ?? el.name ?? "?",
  );
  return rows.map((row) => {
    if (row && typeof row === "object" && !Array.isArray(row)) return row;
    if (!Array.isArray(row)) return { value: row };
    const obj: Record<string, any> = {};
    colNames.forEach((name: string, i: number) => {
      obj[name] = i < row.length ? row[i] : null;
    });
    return obj;
  });
}

function inferFieldsFromSchema(schema: any) {
  const product = schema?.Product || schema;
  const elements = product?.elements || [];
  return elements.map((el: any) => ({
    name: el.name?.some ?? el.name ?? "?",
    dataTypeID: 0,
    dataTypeName: extractTypeName(el.algebraic_type) || "unknown",
  }));
}

function resolveAlgebraicTypeName(at: any, typespace?: any[]): string {
  if (!at || typeof at !== "object") return "unknown";
  const keys = Object.keys(at);
  if (keys.length === 0) return "unknown";
  const firstKey = keys[0];

  if (firstKey === "Ref" && typespace) {
    const refIdx = at.Ref;
    if (typeof refIdx === "number" && typespace[refIdx]) {
      return resolveAlgebraicTypeName(typespace[refIdx], typespace);
    }
  }

  if (firstKey === "Product") {
    const elements = at.Product?.elements || [];
    if (elements.length === 1) {
      const el = elements[0];
      const innerName = el.name?.some ?? el.name ?? "";
      if (innerName === "__identity__") return "Identity";
      if (innerName === "__timestamp_micros_since_unix_epoch__") return "Timestamp";
      if (innerName === "__time_duration__") return "TimeDuration";
      if (innerName === "__connection_id__") return "ConnectionId";
      if (innerName === "__uuid__") return "Uuid";
      const innerType = el.algebraic_type || {};
      const innerKeys = Object.keys(innerType);
      if (innerKeys.length > 0) {
        const innerFirstKey = innerKeys[0];
        if (innerFirstKey === "U256" && !innerName) return "Identity";
        if (innerFirstKey === "I64" && !innerName) return "Timestamp";
      }
    }
    return "Product";
  }

  if (firstKey === "Sum") {
    const variants = at.Sum?.variants || [];
    const someVar = variants.find((v: any) => v.name?.some === "some");
    if (someVar) {
      const innerType = someVar.algebraic_type || {};
      const innerName = resolveAlgebraicTypeName(innerType, typespace);
      return innerName !== "unknown" ? `Option<${innerName}>` : "Option";
    }
    return "Sum";
  }

  if (firstKey === "Array") {
    const elemTy = at.Array?.elem_ty;
    if (elemTy) {
      return `Array<${resolveAlgebraicTypeName(elemTy, typespace)}>`;
    }
    return "Array";
  }

  return firstKey;
}

function unwrapSatsValue(value: any, algebraicType: any, typespace?: any[]): any {
  if (!value || !algebraicType || typeof algebraicType !== "object") return value;
  const keys = Object.keys(algebraicType);
  if (keys.length === 0) return value;

  const firstKey = keys[0];

  // Resolve Refs through the typespace
  if (firstKey === "Ref" && typespace) {
    const refIdx = algebraicType.Ref;
    if (typeof refIdx === "number" && typespace[refIdx]) {
      return unwrapSatsValue(value, typespace[refIdx], typespace);
    }
  }

  // Product with a single element — unwrap the array wrapper
  if (firstKey === "Product") {
    const elements = algebraicType.Product?.elements || [];
    if (elements.length === 1 && Array.isArray(value)) {
      return value[0];
    }
    return value;
  }

  // Array type — keep as-is (arrays are meaningful)
  if (firstKey === "Array") return value;

  // For any other type: if the value is a singleton array, unwrap it.
  // SATS-JSON primitives (String, U256, I64, bool, etc.) are never wrapped,
  // so a singleton array means the actual type is a Product wrapper.
  if (Array.isArray(value) && value.length === 1) {
    return value[0];
  }

  return value;
}

function extractTypeName(at: any): string {
  if (!at || typeof at !== "object") return "unknown";
  const keys = Object.keys(at);
  if (keys.length === 0) return "unknown";
  const k = keys[0];
  if (k === "Product") return "Product";
  if (k === "Sum") return "Sum";
  if (k === "Ref") return "Ref";
  if (k === "Array") return "Array";
  return k;
}

function extractTableData(
  raw: any,
): { rows: Record<string, any>[]; fields: { name: string; dataTypeID: number; dataTypeName: string }[] } {
  if (Array.isArray(raw)) {
    const first = raw[0];
    if (first && first.schema) {
      return {
        rows: rowsToObjects(first.schema, first.rows),
        fields: inferFieldsFromSchema(first.schema),
      };
    }
    return { rows: raw, fields: [] };
  }
  if (raw.schema) {
    return {
      rows: rowsToObjects(raw.schema, raw.rows),
      fields: inferFieldsFromSchema(raw.schema),
    };
  }
  return { rows: [], fields: [] };
}

export async function testSpacetimeDbConnection(
  connectionString: string,
): Promise<boolean> {
  const info = parseSpacetimeConnectionString(connectionString);
  try {
    const client = wsClientFor(info);
    await client.connect();
    return client.isConnected;
  } catch {
    // Fallback: HTTP ping
    if (isTauriAvailable()) {
      await tauriInvoke("spacetimedb_ping", { connectionString });
      return true;
    }
    const headers = buildHeaders(info);
    await browserFetch(info.baseUrl, `/v1/ping`, headers);
    return true;
  }
}

export async function executeSpacetimeDbQuery(
  connectionString: string,
  query: string,
): Promise<QueryResult> {
  if (/\$\d+/.test(query)) {
    throw new Error(
      "SpacetimeDB does not support parameterized queries ($1, $2, ...). Use inline values."
    );
  }
  const info = parseSpacetimeConnectionString(connectionString);
  try {
    const client = wsClientFor(info);
    await client.connect();
    const response = await client.executeQuery(query);
    if (!response.tables || response.tables.length === 0) {
      return { rows: [], fields: [], rowCount: 0 };
    }
    const table = response.tables[0];
    const tableName = table.table_name;
    const rawRows: any[] = (table.rows || []).map((rowJson: string) => {
      try { return JSON.parse(rowJson); } catch { return { value: rowJson }; }
    });
    let fields: { name: string; dataTypeID: number; dataTypeName: string }[];
    let rows: Record<string, any>[];
    try {
      const moduleDef = await fetchSchema(connectionString);
      const tables = extractV10Tables(moduleDef);
      const match = tables.find((t: any) => t.source_name === tableName);
      if (match) {
        const typeRef = match.product_type_ref;
        const typespaceTypes = extractV10Typespace(moduleDef);
        const typeDef = typespaceTypes[typeRef];
        const elements = typeDef?.Product?.elements || [];

        fields = elements.map((el: any) => ({
          name: el.name?.some ?? el.name ?? "?",
          dataTypeID: 0,
          dataTypeName: resolveAlgebraicTypeName(el.algebraic_type || {}, typespaceTypes),
        }));

        const isPositional = rawRows.length > 0 && Array.isArray(rawRows[0]);

        rows = rawRows.map((raw: any) => {
          if (isPositional && elements.length > 0) {
            const row: Record<string, any> = {};
            for (let i = 0; i < elements.length; i++) {
              const el = elements[i];
              const colName = el.name?.some ?? el.name ?? `col_${i}`;
              const at = el.algebraic_type || {};
              const val = i < raw.length ? raw[i] : null;
              row[colName] = unwrapSatsValue(val, at, typespaceTypes);
            }
            return row;
          }
          const row: Record<string, any> = {};
          for (const key of Object.keys(raw)) {
            row[key] = raw[key];
          }
          return row;
        });
      } else {
        throw new Error("table not found in schema");
      }
    } catch {
      const sample = rawRows[0];
      if (Array.isArray(sample)) {
        rows = rawRows.map((raw: any) => {
          const row: Record<string, any> = {};
          for (let i = 0; i < raw.length; i++) {
            row[`col_${i}`] = Array.isArray(raw[i]) ? raw[i][0] : raw[i];
          }
          return row;
        });
        fields = sample.map((_: any, i: number) => ({
          name: `col_${i}`,
          dataTypeID: 0,
          dataTypeName: typeof (Array.isArray(sample[i]) ? sample[i][0] : sample[i]),
        }));
      } else {
        rows = rawRows;
        fields = sample
          ? Object.keys(sample).map((name) => ({
              name,
              dataTypeID: 0,
              dataTypeName: typeof sample[name],
            }))
          : [];
      }
    }
    return { rows, fields, rowCount: rows.length };
  } catch {
    // Fallback to HTTP
    let raw: any;
    if (isTauriAvailable()) {
      raw = await tauriInvoke("spacetimedb_query", { connectionString, query });
    } else {
      const headers = {
        ...buildHeaders(info),
        "content-type": "text/plain",
      };
      raw = await browserFetch(
        info.baseUrl,
        `/v1/database/${encodeURIComponent(info.database)}/sql`,
        headers,
        "POST",
        query,
      );
    }
    let { rows, fields } = extractTableData(raw);
    // Unwrap SATS-wrapped values
    try {
      const moduleDef = await fetchSchema(connectionString);
      const typespaceTypes = extractV10Typespace(moduleDef);
      const tableSchema = Array.isArray(raw) && raw[0]?.schema
        ? raw[0].schema
        : raw?.schema;
      if (tableSchema) {
        const product = tableSchema.Product || tableSchema;
        const elements = product.elements || [];
        rows = rows.map((row: Record<string, any>) => {
          const unwrapped: Record<string, any> = {};
          for (const key of Object.keys(row)) {
            const el = elements.find((e: any) => (e.name?.some ?? e.name) === key);
            if (el) {
              const at = el.algebraic_type || {};
              unwrapped[key] = unwrapSatsValue(row[key], at, typespaceTypes);
            } else {
              unwrapped[key] = Array.isArray(row[key]) && row[key].length === 1 ? row[key][0] : row[key];
            }
          }
          return unwrapped;
        });
      } else {
        rows = unwrapSingletonArrays(rows);
      }
    } catch {
      rows = unwrapSingletonArrays(rows);
    }
    return { rows, fields, rowCount: rows.length };
  }
}

function unwrapSingletonArrays(rows: Record<string, any>[]) {
  return rows.map((row: Record<string, any>) => {
    const unwrapped: Record<string, any> = {};
    for (const key of Object.keys(row)) {
      unwrapped[key] = Array.isArray(row[key]) && row[key].length === 1 ? row[key][0] : row[key];
    }
    return unwrapped;
  });
}

export async function fetchSchema(
  connectionString: string,
): Promise<any> {
  const info = parseSpacetimeConnectionString(connectionString);
  const key = cacheKey(info);
  const cached = cachedModuleDefs.get(key);
  if (cached) return cached;

  let moduleDef: any;
  if (isTauriAvailable()) {
    moduleDef = await tauriInvoke("spacetimedb_fetch_schema", { connectionString });
  } else {
    const headers = buildHeaders(info);
    moduleDef = await browserFetch(
      info.baseUrl,
      `/v1/database/${encodeURIComponent(info.database)}/schema?version=10`,
      headers,
    );
  }

  cachedModuleDefs.set(key, moduleDef);
  const reducerNames = getSpacetimeDbReducers(moduleDef).map((r: any) => r.name);
  cachedReducers.set(key, reducerNames);
  return moduleDef;
}

export function invalidateSchemaCache(connectionString: string): void {
  const info = parseSpacetimeConnectionString(connectionString);
  cachedModuleDefs.delete(cacheKey(info));
  cachedReducers.delete(cacheKey(info));
}

export function getSpacetimeDbReducerNames(connectionString: string): string[] {
  const info = parseSpacetimeConnectionString(connectionString);
  return cachedReducers.get(cacheKey(info)) || [];
}

export function hasSpacetimeDbReducers(connectionString: string): boolean {
  return getSpacetimeDbReducerNames(connectionString).length > 0;
}

export function closeSpacetimeDbConnection(connectionString: string): void {
  try {
    const info = parseSpacetimeConnectionString(connectionString);
    const client = wsClientFor(info);
    client.disconnect();
  } catch { }
}

export async function getSpacetimeDbDatabases(
  connectionString: string,
): Promise<string[]> {
  try {
    if (isTauriAvailable()) {
      await tauriInvoke("spacetimedb_get_database_info", { connectionString });
      return [parseSpacetimeConnectionString(connectionString).database];
    }
    const info = parseSpacetimeConnectionString(connectionString);
    const headers = buildHeaders(info);
    const result: any = await browserFetch(
      info.baseUrl,
      `/v1/database/${encodeURIComponent(info.database)}`,
      headers,
    );
    if (result?.database_identity) return [info.database];
  } catch {
  }
  return [parseSpacetimeConnectionString(connectionString).database];
}

export async function getSpacetimeDbSchemas(
  connectionString: string,
): Promise<any[]> {
  return [];
}

function extractV10Tables(moduleDef: any): any[] {
  const tablesSection = moduleDef?.sections?.find((s: any) => s.Tables);
  return tablesSection?.Tables || [];
}

function extractV10Typespace(moduleDef: any): any[] {
  const tsSection = moduleDef?.sections?.find((s: any) => s.Typespace);
  return tsSection?.Typespace?.types || [];
}

function isUserTable(t: any): boolean {
  const tt = t.table_type;
  return tt?.User !== undefined || tt === "User";
}

export async function getSpacetimeDbTables(
  connectionString: string,
  _schema: string,
): Promise<{ table_name: string; table_type: string }[]> {
  const moduleDef = await fetchSchema(connectionString);
  const tables = extractV10Tables(moduleDef);
  return tables.filter(isUserTable).map((t: any) => t.source_name);
}

export async function getSpacetimeDbViews(
  _connectionString: string,
  _schema: string,
): Promise<string[]> {
  return [];
}

export async function getSpacetimeDbTableStructure(
  connectionString: string,
  _schema: string,
  table: string,
): Promise<any[]> {
  const moduleDef = await fetchSchema(connectionString);
  const tables = extractV10Tables(moduleDef);
  const match = tables.find((t: any) => t.source_name === table);
  if (!match) return [];

  const typeRef = match.product_type_ref;
  const typespaceTypes = extractV10Typespace(moduleDef);
  const typeDef = typespaceTypes[typeRef];
  const elements = typeDef?.Product?.elements || [];

  return elements.map((el: any) => {
    const colName = el.name?.some ?? el.name ?? "?";
    const at = el.algebraic_type || {};
    const typeName = resolveAlgebraicTypeName(at, typespaceTypes);
    return {
      column_name: colName,
      data_type: typeName,
      is_nullable: "YES",
      column_default: null,
      character_maximum_length: null,
    };
  });
}

export async function getSpacetimeDbAllTablesWithColumns(
  connectionString: string,
): Promise<any[]> {
  const moduleDef = await fetchSchema(connectionString);
  const tables = extractV10Tables(moduleDef);
  const typespaceTypes = extractV10Typespace(moduleDef);
  let databaseName = "spacetimedb";
  try {
    databaseName = parseSpacetimeConnectionString(connectionString).database;
  } catch { }
  const userTables = tables.filter(isUserTable);
  console.log("[spacetimedb-schema] user tables:", userTables.map((t: any) => t.source_name));
  const result: any[] = [];

  // Build product_type_ref → table_name map for FK detection
  const typeRefToTable: Record<number, string> = {};
  for (const tbl of userTables) {
    typeRefToTable[tbl.product_type_ref] = tbl.source_name;
  }

  // Build table → primary key column names for FK ref column lookup
  const tablePkMap: Record<string, { name: string; index: number }[]> = {};
  for (const tbl of userTables) {
    const typeDef = typespaceTypes[tbl.product_type_ref];
    const elements = typeDef?.Product?.elements || [];
    const pks: number[] = tbl.primary_key || [];
    tablePkMap[tbl.source_name] = [];
    for (const pkIdx of pks) {
      const pkEl = elements[pkIdx];
      if (pkEl) {
        tablePkMap[tbl.source_name].push({
          name: pkEl.name?.some ?? pkEl.name ?? "id",
          index: pkIdx,
        });
      }
    }
  }

  for (const tbl of userTables) {
    const typeRef = tbl.product_type_ref;
    const typeDef = typespaceTypes[typeRef];
    const elements = typeDef?.Product?.elements || [];
    const pks: number[] = tbl.primary_key || [];

    for (let elIndex = 0; elIndex < elements.length; elIndex++) {
      const el = elements[elIndex];
      const colName = el.name?.some ?? el.name ?? "?";
      const at = el.algebraic_type || {};
      const typeName = resolveAlgebraicTypeName(at, typespaceTypes);

      // Detect FK: if algebraic_type is Ref, find which table it references
      let referencedTableSchema: string | null = null;
      let referencedTableName: string | null = null;
      let referencedColumnName: string | null = null;

      const refTypeId = at.Ref;
      if (refTypeId !== undefined) {
        const refTableName = typeRefToTable[refTypeId];
        if (refTableName) {
          referencedTableSchema = databaseName;
          referencedTableName = refTableName;
          const pkCols = tablePkMap[refTableName];
          if (pkCols && pkCols.length > 0) {
            referencedColumnName = pkCols[0].name;
          }
        }
      }

      result.push({
        table_schema: databaseName,
        table_name: tbl.source_name,
        column_name: colName,
        data_type: typeName,
        is_nullable: "YES",
        is_primary: pks.includes(elIndex),
        referenced_table_schema: referencedTableSchema,
        referenced_table_name: referencedTableName,
        referenced_column_name: referencedColumnName,
      });
    }
  }
  console.log("[spacetimedb-schema] result count:", result.length, "databaseName:", databaseName);
  return result;
}

export async function getSpacetimeDbPrimaryKey(
  connectionString: string,
  table: string,
): Promise<string | null> {
  const moduleDef = await fetchSchema(connectionString);
  const tables = extractV10Tables(moduleDef);
  const match = tables.find((t: any) => t.source_name === table);
  if (!match) return null;
  const pks: number[] = match.primary_key || [];
  if (pks.length === 0) return null;
  const typeRef = match.product_type_ref;
  const typespaceTypes = extractV10Typespace(moduleDef);
  const typeDef = typespaceTypes[typeRef];
  const elements = typeDef?.Product?.elements || [];
  const colIndex = pks[0];
  const el = elements[colIndex];
  return el?.name?.some ?? el?.name ?? null;
}

export async function callSpacetimeDbReducer(
  connectionString: string,
  reducer: string,
  args: any[],
): Promise<any> {
  const info = parseSpacetimeConnectionString(connectionString);
  try {
    const client = wsClientFor(info);
    await client.connect();
    return await client.callReducer(reducer, args);
  } catch {
    // Fallback to HTTP
    if (isTauriAvailable()) {
      return tauriInvoke("spacetimedb_call_reducer", {
        connectionString,
        reducer,
        args: { args },
      });
    }
    const headers = {
      ...buildHeaders(info),
      "content-type": "application/json",
    };
    return browserFetch(
      info.baseUrl,
      `/v1/database/${encodeURIComponent(info.database)}/call/${encodeURIComponent(reducer)}`,
      headers,
      "POST",
      JSON.stringify({ args }),
    );
  }
}

export function getSpacetimeDbReducers(moduleDef: any): Array<{ name: string; args: Array<{ name: string; algebraic_type: any; type_name: string }> }> {
  const typespaceTypes = extractV10Typespace(moduleDef);
  const reducersSection = moduleDef?.sections?.find(
    (s: any) => s.Reducers || s.reducers
  ) || moduleDef?.reducers;
  const reducers: any[] = reducersSection?.Reducers || reducersSection?.reducers || reducersSection || [];
  return reducers
    .filter((r: any) => {
      const n = r.source_name?.some ?? r.source_name ?? r.name?.some ?? r.name;
      return n;
    })
    .map((r: any) => {
      const params = r.params || r.args || [];
      const args = Array.isArray(params?.elements) ? params.elements : Array.isArray(params) ? params : [];
      const reducerName = r.source_name?.some ?? r.source_name ?? r.name?.some ?? r.name ?? "?";
      return {
        name: reducerName,
        args: args.map((a: any) => ({
          name: a.name?.some ?? a.name ?? "?",
          algebraic_type: a.algebraic_type || {},
          type_name: resolveAlgebraicTypeName(a.algebraic_type || {}, typespaceTypes),
        })),
      };
    });
}



export type SpacetimeDbLogLevel = "trace" | "debug" | "info" | "warn" | "error" | "panic";

export interface SpacetimeDbLogLine {
  time: string;
  level: SpacetimeDbLogLevel;
  target: string;
  filename: string;
  line_number: number;
  message: string;
}

export async function fetchSpacetimeDbLogs(
  connectionString: string,
  options?: { numLines?: number; follow?: boolean; level?: SpacetimeDbLogLevel },
): Promise<SpacetimeDbLogLine[]> {
  const info = parseSpacetimeConnectionString(connectionString);
  const headers = buildHeaders(info);
  const params = new URLSearchParams();
  params.set("num_lines", String(options?.numLines ?? 100));
  if (options?.follow) params.set("follow", "true");
  if (options?.level) params.set("level", options.level);
  const url = `${info.baseUrl}/v1/database/${encodeURIComponent(info.database)}/logs?${params}`;

  if (isTauriAvailable()) {
    return tauriInvoke("spacetimedb_fetch_logs", { connectionString, ...options });
  }
  const res = await fetch(url, { headers, method: "GET" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`SpacetimeDB logs fetch failed (${res.status}): ${text || res.statusText}`);
  }
  return res.json();
}

export async function streamSpacetimeDbLogs(
  connectionString: string,
  onLine: (line: SpacetimeDbLogLine) => void,
  onError: (error: Error) => void,
  options?: { numLines?: number },
): Promise<AbortController> {
  const info = parseSpacetimeConnectionString(connectionString);
  const headers = buildHeaders(info);
  const params = new URLSearchParams();
  params.set("num_lines", String(options?.numLines ?? 1000));
  params.set("follow", "true");
  const url = `${info.baseUrl}/v1/database/${encodeURIComponent(info.database)}/logs?${params}`;

  const controller = new AbortController();

  if (isTauriAvailable()) {
    // Tauri fallback: just fetch once
    try {
      const lines: SpacetimeDbLogLine[] = await tauriInvoke("spacetimedb_fetch_logs", {
        connectionString,
        ...options,
        follow: false,
      });
      for (const line of lines) onLine(line);
    } catch (err: any) {
      onError(err);
    }
    return controller;
  }

  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`SpacetimeDB log stream failed (${response.status}): ${text || response.statusText}`);
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("SpacetimeDB: no response body for log stream");

    const decoder = new TextDecoder();
    let buffer = "";

    const pump = async () => {
      try {
        // fallow-ignore-next-line code-duplication
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const raw of lines) {
            if (!raw.trim()) continue;
            try {
              const parsed = JSON.parse(raw);
              onLine(parsed);
            } catch { /* skip malformed lines */ }
          }
        }
      } catch (err: any) {
        if (err.name !== "AbortError") onError(err);
      }
    };
    pump();
  } catch (err: any) {
    if (err.name !== "AbortError") onError(err);
  }

  return controller;
}

export async function deleteSpacetimeDbRows(
  connectionString: string,
  _schema: string,
  table: string,
  pkColumn: string,
  pkValues: any[],
): Promise<any> {
  if (!pkValues || pkValues.length === 0) return { deleted: 0 };
  const reducer = `delete_${table}`;
  for (const pkVal of pkValues) {
    await callSpacetimeDbReducer(connectionString, reducer, [pkVal]);
  }
  return { deleted: pkValues.length };
}

export async function updateSpacetimeDbRows(
  connectionString: string,
  _schema: string,
  table: string,
  updates: Array<{
    where: Record<string, any>;
    set: Record<string, any>;
  }>,
): Promise<any> {
  const moduleDef = await fetchSchema(connectionString);
  const reducerName = `update_${table}`;
  const reducers = getSpacetimeDbReducers(moduleDef);
  const reducer = reducers.find((r) => r.name === reducerName);
  if (!reducer) throw new Error(`No ${reducerName} reducer found`);

  for (const upd of updates) {
    const merged = { ...upd.set, ...upd.where };
    const args = reducer.args.map((arg) => {
      const raw = merged[arg.name];
      if (raw === undefined || raw === null) return null;
      return raw;
    });
    await callSpacetimeDbReducer(connectionString, reducerName, args);
  }
  return { updated: updates.length };
}
