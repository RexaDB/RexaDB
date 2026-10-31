import { useCallback, useEffect, useState } from "react";
import {
  fetchDbLinks,
  fetchEnums,
  fetchFunctions,
  fetchIndexes,
  fetchMaterializedViews,
  fetchPackages,
  fetchSequences,
  fetchSynonyms,
  fetchTriggers,
} from "@/lib/api/actions-client";
import {
  isPostgresCatalogDbType,
  supportsIndexCatalog,
  supportsOracleExtraCatalog,
  supportsRoutineCatalog,
  supportsSequenceCatalog,
} from "@/lib/db/connection-type";

type ObjectResult = { success: boolean; data?: unknown };
type ObjectSetter = (rows: any[]) => void;

interface UseSidebarDatabaseObjectsProps {
  enabled: boolean;
  connectionString: string;
  dbType: string | null | undefined;
  schema: string;
  setFunctions: ObjectSetter;
  setTriggers: ObjectSetter;
  setIndexes: ObjectSetter;
  setEnums: ObjectSetter;
  setSequences: ObjectSetter;
  setPackages: ObjectSetter;
  setSynonyms: ObjectSetter;
  setMaterializedViews: ObjectSetter;
  setDbLinks: ObjectSetter;
}

/** Keeps the object sections under the sidebar's table list in sync with the selected schema. */
export function useSidebarDatabaseObjects({
  enabled,
  connectionString,
  dbType,
  schema,
  setFunctions,
  setTriggers,
  setIndexes,
  setEnums,
  setSequences,
  setPackages,
  setSynonyms,
  setMaterializedViews,
  setDbLinks,
}: UseSidebarDatabaseObjectsProps) {
  const [reloadCount, setReloadCount] = useState(0);

  useEffect(() => {
    if (!enabled || !connectionString || !schema) return;
    let cancelled = false;
    // A failed catalog only leaves its section out; tables keep working.
    const load = (request: Promise<ObjectResult>, setRows: ObjectSetter) => {
      request
        .then((res) => {
          if (!cancelled && res.success && Array.isArray(res.data)) setRows(res.data);
        })
        .catch(() => {});
    };

    if (supportsRoutineCatalog(dbType)) {
      load(fetchFunctions(connectionString, schema), setFunctions);
      load(fetchTriggers(connectionString, schema), setTriggers);
    }
    if (supportsIndexCatalog(dbType)) {
      load(fetchIndexes(connectionString, schema), setIndexes);
    }
    if (isPostgresCatalogDbType(dbType)) {
      load(fetchEnums(connectionString), setEnums);
    }
    if (supportsSequenceCatalog(dbType)) {
      load(fetchSequences(connectionString, schema), setSequences);
    }
    if (supportsOracleExtraCatalog(dbType)) {
      load(fetchPackages(connectionString, schema), setPackages);
      load(fetchSynonyms(connectionString, schema), setSynonyms);
      load(fetchMaterializedViews(connectionString, schema), setMaterializedViews);
      load(fetchDbLinks(connectionString), setDbLinks);
    }

    return () => {
      cancelled = true;
    };
  }, [
    enabled,
    connectionString,
    dbType,
    schema,
    reloadCount,
    setFunctions,
    setTriggers,
    setIndexes,
    setEnums,
    setSequences,
    setPackages,
    setSynonyms,
    setMaterializedViews,
    setDbLinks,
  ]);

  return useCallback(() => setReloadCount((count) => count + 1), []);
}
