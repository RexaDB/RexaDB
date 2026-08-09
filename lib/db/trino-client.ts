import type { QueryResult } from "./client-types";

type TrinoColumn = { name: string; type?: string };

type TrinoResponse = {
  id?: string;
  infoUri?: string;
  nextUri?: string;
  columns?: TrinoColumn[];
  data?: any[][];
  error?: { message?: string };
};

type TrinoConnectionInfo = {
  baseUrl: string;
  catalog?: string;
  schema?: string;
};

function joinBaseUrl(base: string) {
  return base.endsWith("/") ? base.slice(0, -1) : base;
}

function parseTrinoConnectionString(connectionString: string): TrinoConnectionInfo {
  const raw = String(connectionString || "").trim();
  if (!raw) {
    return { baseUrl: "http://127.0.0.1:8080" };
  }
  try {
    const parsed = new URL(raw);
    const protocol = parsed.protocol.toLowerCase();
    const host = parsed.hostname || "127.0.0.1";
    const port = parsed.port ? Number(parsed.port) : 8080;
    const path = parsed.pathname && parsed.pathname !== "/" ? parsed.pathname : "";
    const catalog = parsed.searchParams.get("catalog") || undefined;
    const schema = parsed.searchParams.get("schema") || undefined;

    if (protocol === "trino+https:") {
      return { baseUrl: joinBaseUrl(`https://${host}:${port}${path}`), catalog, schema };
    }
    if (protocol === "trino+http:" || protocol === "trino:") {
      return { baseUrl: joinBaseUrl(`http://${host}:${port}${path}`), catalog, schema };
    }
    return { baseUrl: joinBaseUrl(raw) };
  } catch {
    return { baseUrl: "http://127.0.0.1:8080" };
  }
}

function buildHeaders(user: string, catalog?: string, schema?: string) {
  const headers: Record<string, string> = {
    "content-type": "text/plain",
    "X-Trino-User": user,
  };
  if (catalog) headers["X-Trino-Catalog"] = catalog;
  if (schema) headers["X-Trino-Schema"] = schema;
  return headers;
}

function rowsToObjects(columns: TrinoColumn[] = [], data: any[][] = []) {
  if (!columns.length) return data.map((row) => ({ value: row?.[0] }));
  return data.map((row) => {
    const out: Record<string, any> = {};
    columns.forEach((col, index) => {
      out[col.name] = row?.[index];
    });
    return out;
  });
}

export async function executeTrinoQuery(
  connectionString: string,
  query: string,
  opts: { catalog?: string; schema?: string; user?: string } = {}
): Promise<QueryResult> {
  const { baseUrl, catalog, schema } = parseTrinoConnectionString(connectionString);
  const headers = buildHeaders(opts.user || "rexadb", opts.catalog || catalog, opts.schema || schema);

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/v1/statement`, {
      method: "POST",
      headers,
      body: query,
    });
  } catch (error: any) {
    const message = error?.cause?.code ? `${error.cause.code}` : (error?.message || "fetch failed");
    throw new Error(`Trino fetch failed (${baseUrl}): ${message}`);
  }
  const contentType = res.headers.get("content-type") || "";
  let payload: TrinoResponse | null = null;
  if (contentType.includes("application/json")) {
    try {
      payload = await res.json();
    } catch (error: any) {
      const fallbackText = await res.text().catch(() => "");
      throw new Error(fallbackText || error?.message || "Trino returned invalid JSON.");
    }
  } else {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Trino returned non-JSON response (status ${res.status}).`);
  }

  if (!res.ok) {
    const errorMessage = payload?.error?.message || `Trino error (status ${res.status}).`;
    throw new Error(errorMessage);
  }
  if (payload?.error?.message) {
    throw new Error(payload.error.message);
  }
  if (!payload) {
    throw new Error("Trino returned an empty JSON response.");
  }

  let currentPayload: TrinoResponse = payload;
  const columns: TrinoColumn[] = currentPayload.columns ? [...currentPayload.columns] : [];
  const data: any[][] = currentPayload.data ? [...currentPayload.data] : [];

  while (currentPayload.nextUri) {
    const nextResponse: Response = await fetch(currentPayload.nextUri, { headers });
    const nextContentType = nextResponse.headers.get("content-type") || "";
    if (!nextContentType.includes("application/json")) {
      const text = await nextResponse.text().catch(() => "");
      throw new Error(text || `Trino returned non-JSON response (status ${nextResponse.status}).`);
    }
    const nextPayload: TrinoResponse = await nextResponse.json();
    if (nextPayload.error?.message) {
      throw new Error(nextPayload.error.message);
    }
    if (!columns.length && nextPayload.columns) {
      columns.push(...nextPayload.columns);
    }
    if (nextPayload.data?.length) {
      data.push(...nextPayload.data);
    }
    currentPayload = nextPayload;
  }

  const rows = rowsToObjects(columns, data);
  const fields = columns.map((col) => ({
    name: col.name,
    dataTypeID: 0,
    dataTypeName: col.type || "unknown",
  }));
  return {
    rows,
    fields,
    rowCount: rows.length,
  };
}

export async function listCatalogs(connectionString: string) {
  const result = await executeTrinoQuery(connectionString, "SHOW CATALOGS");
  return result.rows.map((row) => String(row.catalog || row.Catalog || row.value || "").trim()).filter(Boolean);
}

export async function listSchemas(connectionString: string, catalog: string) {
  const sql = `SHOW SCHEMAS FROM \"${catalog}\"`;
  const result = await executeTrinoQuery(connectionString, sql);
  return result.rows.map((row) => String(row.schema_name || row.Schema || row.value || "").trim()).filter(Boolean);
}

export async function listTables(connectionString: string, catalog: string, schema: string) {
  const sql = `SHOW TABLES FROM \"${catalog}\".\"${schema}\"`;
  const result = await executeTrinoQuery(connectionString, sql);
  return result.rows.map((row) => String(row.table_name || row.Table || row.value || "").trim()).filter(Boolean);
}

export async function describeTable(connectionString: string, catalog: string, schema: string, table: string) {
  const sql = `DESCRIBE \"${catalog}\".\"${schema}\".\"${table}\"`;
  const result = await executeTrinoQuery(connectionString, sql);
  return result.rows.map((row) => ({
    name: row.column_name || row.Column || row.value || "",
    type: row.data_type || row.Type || row.type || "",
    isNullable: true,
    isPrimary: false,
    references: null,
  }));
}
