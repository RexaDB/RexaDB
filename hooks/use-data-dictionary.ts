"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getDictionaryScope,
  setTableDescription,
  setColumnDescription,
  setColumnDecorator,
} from "@/lib/dictionary/client";
import type { ColumnDecorator, DictionaryScope } from "@/lib/dictionary/types";
import { freshEmptyScope } from "@/lib/dictionary/types";

export interface DataDictionaryApi {
  scope: DictionaryScope;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  saveTable: (schema: string, table: string, description: string) => Promise<boolean>;
  saveColumn: (
    schema: string,
    table: string,
    column: string,
    description: string,
  ) => Promise<boolean>;
  saveDecorator: (
    schema: string,
    table: string,
    column: string,
    decorator: ColumnDecorator | null,
  ) => Promise<boolean>;
}

export function useDataDictionary(connectionId: number | null | undefined): DataDictionaryApi {
  const [scope, setScope] = useState<DictionaryScope>(freshEmptyScope);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!connectionId || connectionId <= 0) {
      setScope(freshEmptyScope());
      setLoading(false);
      return;
    }
    const requestId = ++requestRef.current;
    setLoading(true);
    setError(null);
    try {
      const next = await getDictionaryScope(connectionId);
      if (requestRef.current === requestId) setScope(next);
    } catch (err) {
      if (requestRef.current === requestId) {
        setError(err instanceof Error ? err.message : "Failed to load data dictionary.");
      }
    } finally {
      if (requestRef.current === requestId) setLoading(false);
    }
  }, [connectionId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const mutate = useCallback(
    async (fn: () => Promise<void>): Promise<boolean> => {
      try {
        await fn();
        await refresh();
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save.");
        return false;
      }
    },
    [refresh],
  );

  const saveTable = useCallback(
    (schema: string, table: string, description: string) =>
      mutate(() => setTableDescription(connectionId as number, schema, table, description)),
    [connectionId, mutate],
  );

  const saveColumn = useCallback(
    (schema: string, table: string, column: string, description: string) =>
      mutate(() =>
        setColumnDescription(connectionId as number, schema, table, column, description),
      ),
    [connectionId, mutate],
  );

  const saveDecorator = useCallback(
    (schema: string, table: string, column: string, decorator: ColumnDecorator | null) =>
      mutate(() =>
        setColumnDecorator(connectionId as number, schema, table, column, decorator),
      ),
    [connectionId, mutate],
  );

  return { scope, loading, error, refresh, saveTable, saveColumn, saveDecorator };
}
