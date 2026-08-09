"use client";

import { useEffect, useRef, useState } from "react";

import { fetchAllTablesWithColumns, fetchSchemas, fetchTables } from "@/lib/api/actions-client";
import type { LightSchemaContextTable } from "@/lib/ai/types";

function normalizeRows(rows: any[]): LightSchemaContextTable[] {
  const grouped = new Map<string, LightSchemaContextTable>();

  for (const row of rows) {
    const schema = String(row?.table_schema || row?.schema || "").trim();
    const table = String(row?.table_name || row?.name || "").trim();
    if (!schema || !table) continue;

    const key = `${schema}.${table}`;
    const existing = grouped.get(key) || { schema, table, columns: [] };
    const columnName = String(row?.column_name || "").trim();
    if (columnName) {
      existing.columns.push({
        name: columnName,
        type: String(row?.data_type || "text"),
      });
    }
    grouped.set(key, existing);
  }

  return Array.from(grouped.values()).sort((a, b) =>
    `${a.schema}.${a.table}`.localeCompare(`${b.schema}.${b.table}`),
  );
}

async function loadSchemaTables(connectionString: string) {
  const schemasResult = await fetchSchemas(connectionString);
  if (!schemasResult.success || !schemasResult.data) {
    return null;
  }

  const tableResults = await Promise.all(
    schemasResult.data.map(async (schema: string) => {
      const result = await fetchTables(connectionString, schema);
      return { schema, result };
    }),
  );

  return tableResults.flatMap(({ schema, result }) =>
    result.success && result.data
      ? result.data.map((table: string) => ({ schema, table: String(table), columns: [] }))
      : [],
  );
}

export function useAiMentionCatalog({
  connectionString,
  dbType,
  fallback,
  enabled = true,
}: {
  connectionString: string;
  dbType: string;
  fallback: LightSchemaContextTable[];
  enabled?: boolean;
}) {
  const [catalog, setCatalog] = useState<LightSchemaContextTable[]>(fallback);
  const [source, setSource] = useState<"fallback" | "fetched">("fallback");
  const lastKeyRef = useRef<string>("");
  const fallbackRef = useRef(fallback);

  useEffect(() => {
    fallbackRef.current = fallback;
  }, [fallback]);

  useEffect(() => {
    let cancelled = false;
    const key = `${dbType}:${connectionString}`;

    if (!enabled) {
      setCatalog(fallbackRef.current);
      setSource("fallback");
      return () => {
        cancelled = true;
      };
    }

    if (lastKeyRef.current === key && source === "fetched") {
      return () => {
        cancelled = true;
      };
    }

    lastKeyRef.current = key;

    void (async () => {
      if (!connectionString || dbType === "redis") {
        setCatalog(fallbackRef.current);
        setSource("fallback");
        return;
      }

      if (dbType === "mongodb") {
        const nextCatalog = await loadSchemaTables(connectionString);
        if (cancelled) return;
        const resolved = nextCatalog && nextCatalog.length > 0 ? nextCatalog : fallbackRef.current;
        setCatalog(resolved);
        setSource(nextCatalog && nextCatalog.length > 0 ? "fetched" : "fallback");
        return;
      }

      const result = await fetchAllTablesWithColumns(connectionString);
      if (cancelled) return;

      if (!result.success || !result.data) {
        setCatalog(fallbackRef.current);
        setSource("fallback");
        return;
      }

      const nextCatalog = normalizeRows(result.data);
      setCatalog(nextCatalog.length > 0 ? nextCatalog : fallbackRef.current);
      setSource(nextCatalog.length > 0 ? "fetched" : "fallback");
    })();

    return () => {
      cancelled = true;
    };
  }, [connectionString, dbType, source, enabled]);

  useEffect(() => {
    if (source === "fallback") {
      setCatalog(fallback);
    }
  }, [fallback, source]);

  return catalog;
}
