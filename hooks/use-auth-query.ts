import { useCallback, useEffect, useState } from "react";
import { runQuery } from "@/lib/api/actions-client";

interface UseAuthQueryResult<T> {
  data: T[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useAuthQuery<T>(
  connectionString: string,
  enabled: boolean,
  query: string,
  errorMessage: string,
  processRow?: (row: any) => T,
): UseAuthQueryResult<T> {
  // fallow-ignore-next-line code-duplication
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    if (!connectionString) {
      setError("Missing connection string.");
      return;
    }
    setLoading(true);
    setError(null);
    const res = await runQuery(connectionString, query);
    if (!res.success) {
      setError(res.error || errorMessage);
      setLoading(false);
      return;
    }
    const rows = Array.isArray(res.data?.rows) ? res.data.rows : [];
    setData((processRow ? rows.map(processRow) : rows) as T[]);
    setLoading(false);
  }, [connectionString, enabled, query, errorMessage, processRow]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { data, loading, error, refresh };
}
