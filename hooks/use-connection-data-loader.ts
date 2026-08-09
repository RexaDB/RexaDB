import { useCallback } from "react";
import {
  fetchSchemas,
  fetchTables,
  fetchViews,
  fetchFunctions,
  fetchExtensions,
  fetchTriggers,
  fetchEnums,
  fetchIndexes,
  fetchRlsPolicies,
  fetchPostgresRoles,
  fetchTableSecurityInfo,
} from "@/lib/api/actions-client";
import { detectConnectionDbType } from "@/lib/db/connection-type";
import { usesDatabaseNamespaces } from "@/lib/db/namespace-display";
import { fetchNamespaceList } from "@/lib/db/namespace-list";
import { getDatabaseFromConnectionString } from "@/lib/studio/db-helpers";

interface UseConnectionDataLoaderProps {
  setFetchingSchemas: (loading: boolean) => void;
  setSchemas: (schemas: string[]) => void;
  setSelectedSchema: (schema: string) => void;
  setTables: (tables: string[]) => void;
  setViewTables: (viewTables: string[]) => void;
  setTableSecurity: (tableSecurity: Record<string, { rlsEnabled: boolean; policyCount: number }>) => void;
  setFunctions: (functions: any[]) => void;
  setExtensions: (extensions: any[]) => void;
  setTriggers: (triggers: any[]) => void;
  setEnums: (enums: any[]) => void;
  setIndexes: (indexes: any[]) => void;
  setRlsPolicies: (policies: any[]) => void;
  setPostgresRoles: (roles: string[]) => void;
}

export function useConnectionDataLoader({
  setFetchingSchemas,
  setSchemas,
  setSelectedSchema,
  setTables,
  setViewTables,
  setTableSecurity,
  setFunctions,
  setExtensions,
  setTriggers,
  setEnums,
  setIndexes,
  setRlsPolicies,
  setPostgresRoles,
}: UseConnectionDataLoaderProps) {

  const loadInitialDataWithConn = useCallback(async (connString: string, forceRefresh: boolean = false) => {
    const connType = detectConnectionDbType(connString);
    const isPgLike = connType === "postgres" || connType === "supabase-mgmt";
    setFetchingSchemas(true);
    try {
      const res = await fetchNamespaceList(connString, { forceRefresh });
      if (res.success && res.data && res.data.length > 0) {
        const normalizedSchemas = Array.from(new Set(res.data.map((s) => String(s ?? "").trim()).filter(Boolean)));
        if (normalizedSchemas.length === 0) {
          if (usesDatabaseNamespaces(connType)) {
            const dbName = getDatabaseFromConnectionString(connString);
            if (dbName) {
              setSchemas([dbName]);
              setSelectedSchema(dbName);
            } else {
              setSchemas([]);
            }
          } else {
            setSchemas([]);
          }
          return;
        }
        setSchemas(normalizedSchemas);
        let defaultSchema = isPgLike
          ? (normalizedSchemas.includes("public") ? "public" : normalizedSchemas[0])
          : normalizedSchemas[0];
        if (usesDatabaseNamespaces(connType)) {
          const dbName = getDatabaseFromConnectionString(connString);
          if (dbName && normalizedSchemas.includes(dbName)) {
            defaultSchema = dbName;
          }
        }
        setSelectedSchema(defaultSchema);

        // Load other data
        fetchTables(connString, defaultSchema, { forceRefresh }).then(r => r.success && r.data && setTables(r.data));
        fetchViews(connString, defaultSchema).then(r => r.success && r.data && setViewTables(r.data));
        if (isPgLike) {
          fetchFunctions(connString, defaultSchema).then(r => r.success && r.data && setFunctions(r.data));
          fetchTableSecurityInfo(connString, defaultSchema).then((r) => {
            if (r.success && r.data) {
              const next: Record<string, { rlsEnabled: boolean; policyCount: number }> = {};
              for (const row of r.data) {
                next[row.table_name] = {
                  rlsEnabled: Boolean(row.rls_enabled),
                  policyCount: Number(row.policy_count ?? 0),
                };
              }
              setTableSecurity(next);
            }
          });
          fetchRlsPolicies(connString, defaultSchema || null, null).then(r => r.success && r.data && setRlsPolicies(r.data));
          fetchTriggers(connString, defaultSchema).then(r => r.success && r.data && setTriggers(r.data));
          fetchIndexes(connString, defaultSchema).then(r => r.success && r.data && setIndexes(r.data));
        } else {
          setFunctions([]);
          setTableSecurity({});
        }
      }

      if (isPgLike) {
        fetchExtensions(connString).then(r => r.success && r.data && setExtensions(r.data));
        fetchTriggers(connString).then(r => r.success && r.data && setTriggers(r.data));
        fetchEnums(connString).then(r => r.success && r.data && setEnums(r.data));
        fetchIndexes(connString).then(r => r.success && r.data && setIndexes(r.data));
        fetchPostgresRoles(connString).then(r => r.success && r.data && setPostgresRoles(r.data));
      } else {
        setExtensions([]);
        setTriggers([]);
        setEnums([]);
        setIndexes([]);
        setRlsPolicies([]);
        setPostgresRoles([]);
        setTableSecurity({});
      }
    } finally {
      setFetchingSchemas(false);
    }
  }, [setFetchingSchemas, setSchemas, setSelectedSchema, setTables, setViewTables, setTableSecurity, setFunctions, setExtensions, setTriggers, setEnums, setIndexes, setRlsPolicies, setPostgresRoles]);

  return { loadInitialDataWithConn };
}
