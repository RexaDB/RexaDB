import type { AdvisorCheck } from "../types";

export const schemaChecks: AdvisorCheck[] = [
  {
    id: "disabled-triggers",
    title: "Disabled triggers",
    description: "Triggers that are currently disabled",
    category: "schema",
    severity: "warning",
    sql: `
      SELECT
        n.nspname AS schema_name,
        c.relname AS table_name,
        t.tgname AS trigger_name,
        CASE t.tgenabled
          WHEN 'D' THEN 'disabled'
          WHEN 'A' THEN 'always'
          WHEN 'O' THEN 'origin'
          WHEN 'S' THEN 'slave'
          ELSE 'other'
        END AS trigger_status
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal
        AND t.tgenabled = 'D'
      ORDER BY n.nspname, c.relname;
    `,
  },
  {
    id: "indexes-on-low-cardinality",
    title: "Indexes on low-cardinality columns",
    description: "Indexes on columns with fewer than 100 distinct values — likely ineffective",
    category: "schema",
    severity: "info",
    sql: `
      SELECT
        n.nspname AS schema_name,
        c.relname AS table_name,
        i.relname AS index_name,
        s.n_distinct,
        s.null_frac
      FROM pg_class i
      JOIN pg_index ix ON i.oid = ix.indexrelid
      JOIN pg_class c ON c.oid = ix.indrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_stats s ON s.schemaname = n.nspname
        AND s.tablename = c.relname
        AND s.attname = (SELECT a.attname
          FROM pg_attribute a
          WHERE a.attrelid = ix.indrelid
            AND a.attnum = ix.indkey[0]
            AND a.attnum > 0)
      WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
        AND s.n_distinct > 0
        AND s.n_distinct < 100
      ORDER BY s.n_distinct ASC;
    `,
  },
  {
    id: "missing-foreign-key-indexes",
    title: "Tables with no indexes at all",
    description: "Tables in the public schema that have zero indexes",
    category: "schema",
    severity: "info",
    sql: `
      SELECT
        n.nspname AS schema_name,
        c.relname AS table_name,
        c.reltuples::bigint AS estimated_rows
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
        AND c.relkind IN ('r', 'p')
        AND c.reltuples > 0
        AND NOT EXISTS (
          SELECT 1 FROM pg_index i
          WHERE i.indrelid = c.oid
            AND i.indisprimary = false
        )
      ORDER BY c.reltuples DESC;
    `,
  },
];
