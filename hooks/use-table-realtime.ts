"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { streamTableWatch } from "@/lib/realtime/client";
import type { RealtimeErrorCode } from "@/lib/realtime/types";

export type TableRealtimeStatus = "off" | "connecting" | "live" | "stale" | "error";

interface Options {
  enabled: boolean;
  connectionString: string;
  schema: string;
  table: string | null;
  primaryKey: string[];
  filter: string;
  sort: { column: string; direction: "ASC" | "DESC" } | null;
  limit: number;
  offset: number;
  /** Called after committed changes land: debounced, but at least once per
   *  CHANGE_MAX_WAIT_MS while changes keep arriving. */
  onChange: () => void;
}

const CHANGE_DEBOUNCE_MS = 300;
/** Sustained writes still refresh at least this often. */
const CHANGE_MAX_WAIT_MS = 1000;

/** Keeps one sidecar watch open for the visible table while `enabled`. */
export function useTableRealtime({
  enabled,
  connectionString,
  schema,
  table,
  primaryKey,
  filter,
  sort,
  limit,
  offset,
  onChange,
}: Options) {
  const [status, setStatus] = useState<TableRealtimeStatus>("off");
  const [error, setError] = useState<{ message: string; code?: RealtimeErrorCode } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const pkKey = primaryKey.join("\u0000");
  const sortColumn = sort?.column ?? "";
  const sortDirection = sort?.direction ?? "ASC";

  useEffect(() => {
    if (!enabled || !table || !connectionString) {
      setStatus("off");
      setError(null);
      return;
    }
    setStatus("connecting");
    setError(null);
    let timer: ReturnType<typeof setTimeout> | null = null;
    let firstPendingAt = 0;
    const flush = () => {
      timer = null;
      firstPendingAt = 0;
      onChangeRef.current();
    };
    const stream = streamTableWatch(
      {
        connectionString,
        schema,
        table,
        primaryKey: pkKey ? pkKey.split("\u0000") : [],
        filter,
        sort: sortColumn ? { column: sortColumn, direction: sortDirection } : null,
        limit,
        offset,
      },
      (event) => {
        if (event.type === "change") {
          const now = Date.now();
          if (!firstPendingAt) firstPendingAt = now;
          if (timer) clearTimeout(timer);
          const wait = Math.min(CHANGE_DEBOUNCE_MS, firstPendingAt + CHANGE_MAX_WAIT_MS - now);
          timer = setTimeout(flush, Math.max(wait, 0));
        } else if (event.type === "error") {
          setStatus("error");
          setError({ message: event.message, code: event.code });
        } else if (event.status === "closed") {
          setStatus((prev) => (prev === "error" ? prev : "off"));
        } else {
          setStatus(event.status);
        }
      },
    );
    return () => {
      if (timer) clearTimeout(timer);
      stream.abort();
    };
  }, [enabled, connectionString, schema, table, pkKey, filter, sortColumn, sortDirection, limit, offset, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return { status, error, retry };
}
