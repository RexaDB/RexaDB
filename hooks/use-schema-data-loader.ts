import { useCallback, useEffect, useRef } from "react";
import { fetchTables, fetchTableStructure, fetchAllTablesWithColumns } from "@/lib/api/actions-client";
import { inferMongoReferenceTarget } from "@/lib/studio/general-utils";

interface UseSchemaDataLoaderProps {
  dbType: string;
  selectedSchema: string;
  currentConnectionString: string;
  setSchemaData: (data: Record<string, any>) => void;
}

export function useSchemaDataLoader({
  dbType,
  selectedSchema,
  currentConnectionString,
  setSchemaData,
}: UseSchemaDataLoaderProps) {
  const loadTokenRef = useRef(0);
  const loadSchemaData = useCallback(async () => {
    const token = ++loadTokenRef.current;
    const loadStartedAt = performance.now();
    console.log("[schema-load] start", { token, dbType, selectedSchema });
    const rawConnectionString = String(currentConnectionString || "").trim();
    const normalizedRaw = rawConnectionString.toLowerCase();
    if (
      normalizedRaw.startsWith("trino://")
      || normalizedRaw.startsWith("trino+http://")
      || normalizedRaw.startsWith("trino+https://")
    ) {
      if (token === loadTokenRef.current) {
        console.log("[schema-load] skip:trino/redis", { token });
        setSchemaData({});
      }
      return;
    }

    if (dbType === "redis") {
      if (token === loadTokenRef.current) {
        console.log("[schema-load] skip:redis", { token });
        setSchemaData({});
      }
      return;
    }
    if (dbType === "mongodb") {
      if (!selectedSchema) {
        if (token === loadTokenRef.current) {
          console.log("[schema-load] skip:mongodb-missing-schema", { token });
          setSchemaData({});
        }
        return;
      }

      try {
        const tablesRes = await fetchTables(currentConnectionString, selectedSchema);
        if (token !== loadTokenRef.current) return;
        if (!tablesRes.success || !tablesRes.data) {
          if (token === loadTokenRef.current) {
            console.log("[schema-load] mongo tables empty", { token });
            setSchemaData({});
          }
          return;
        }

        const collectionNames: string[] = tablesRes.data as string[];
        const structureResults = await Promise.all(
          collectionNames.map(async (collectionName: string) => {
            const structureRes = await fetchTableStructure(currentConnectionString, selectedSchema, collectionName);
            return { collectionName, structureRes };
          })
        );
        if (token !== loadTokenRef.current) return;

        const grouped: Record<string, any> = {};
        for (const { collectionName, structureRes } of structureResults) {
          if (!structureRes.success || !structureRes.data) continue;

          const columns = (structureRes.data as any[]).map((field) => {
            const fieldName = String(field.column_name || "");
            const fieldType = String(field.data_type || "mixed");
            const inferredTarget = inferMongoReferenceTarget(fieldName, collectionNames);
            const isObjectIdLike = fieldType.toLowerCase().includes("objectid");
            const references = inferredTarget && inferredTarget !== collectionName && isObjectIdLike
              ? {
                schema: selectedSchema,
                table: inferredTarget,
                column: "_id",
              }
              : null;

            return {
              name: fieldName,
              type: fieldType,
              isPrimary: Boolean(field.is_primary_key) || fieldName === "_id",
              isNullable: String(field.is_nullable || "NO") === "YES",
              references,
            };
          });

          grouped[`${selectedSchema}.${collectionName}`] = {
            schema: selectedSchema,
            name: collectionName,
            columns,
          };
        }

        if (token === loadTokenRef.current) {
          console.log("[schema-load] mongo done", { token, durationMs: Math.round(performance.now() - loadStartedAt) });
          setSchemaData(grouped);
        }
      } catch (err) {
        console.error("Error in loadSchemaData (MongoDB):", err);
        if (token === loadTokenRef.current) {
          setSchemaData({});
        }
      }
      return;
    }

    try {
      const res = await fetchAllTablesWithColumns(
        currentConnectionString,
        {
          forceRefresh: dbType === "mysql" || dbType === "clickhouse" || dbType === "spacetimedb",
          schema: selectedSchema || undefined,
        }
      );
      if (token !== loadTokenRef.current) return;
      if (res.success && res.data) {
        console.log("[schema-load] rows", { token, count: res.data.length });
        // Group by schema and table
        const grouped: Record<string, any> = {};
        const batchSize = 800;
        for (let i = 0; i < res.data.length; i += batchSize) {
          if (token !== loadTokenRef.current) return;
          const slice = res.data.slice(i, i + batchSize);
          slice.forEach((row: any) => {
            const tableKey = `${row.table_schema}.${row.table_name}`;
            if (!grouped[tableKey]) {
              grouped[tableKey] = {
                schema: row.table_schema,
                name: row.table_name,
                columns: []
              };
            }
            grouped[tableKey].columns.push({
              name: row.column_name,
              type: row.data_type,
              isPrimary: row.is_primary,
              isNullable: row.is_nullable === 'YES',
              references: row.referenced_table_name ? {
                schema: row.referenced_table_schema,
                table: row.referenced_table_name,
                column: row.referenced_column_name
              } : null
            });
          });
          if (i + batchSize < res.data.length) {
            await new Promise((resolve) => setTimeout(resolve, 0));
          }
        }
        if (token === loadTokenRef.current) {
          const schemasInGrouped = Array.from(new Set(Object.values(grouped).map((g: any) => g.schema)));
          console.log("[schema-load] done", { token, durationMs: Math.round(performance.now() - loadStartedAt), tableCount: Object.keys(grouped).length, schemasInGrouped });
          setSchemaData(grouped);
        }
      } else if (res.error) {
        console.error("Failed to fetch schema data:", res.error, {
          dbType,
          schema: selectedSchema,
          connectionString: rawConnectionString,
        });
      }
    } catch (err) {
      console.error("Error in loadSchemaData:", err, {
        dbType,
        schema: selectedSchema,
        connectionString: rawConnectionString,
      });
    }
  }, [currentConnectionString, dbType, selectedSchema]);

  const cancelSchemaLoad = useCallback(() => {
    loadTokenRef.current += 1;
  }, []);

  useEffect(() => {
    if (currentConnectionString && selectedSchema) {
      loadSchemaData();
    }
  }, [currentConnectionString, selectedSchema, loadSchemaData]);

  return { loadSchemaData, cancelSchemaLoad };
}
