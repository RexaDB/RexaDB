import type { AdvisorCheck } from "../types";

export const performanceChecks: AdvisorCheck[] = [
  {
    id: "slow-queries",
    title: "Slow queries",
    description: "Queries with average execution time exceeding 1 second",
    category: "performance",
    severity: "warning",
    sql: `
      SELECT
        query,
        calls,
        ROUND(mean_time::numeric, 2) AS mean_time_ms,
        ROUND(total_time::numeric, 2) AS total_time_ms,
        ROUND((100 * mean_time / NULLIF(SUM(mean_time) OVER (), 0))::numeric, 2) AS prop_pct
      FROM pg_stat_statements
      WHERE mean_time > 1000
      ORDER BY mean_time DESC
      LIMIT 20;
    `,
    requiresExtension: "pg_stat_statements",
  },
  {
    id: "unused-indexes",
    title: "Unused indexes",
    description: "Indexes that have never been scanned",
    category: "performance",
    severity: "warning",
    sql: `
      SELECT
        schemaname,
        tablename,
        indexname,
        idx_scan,
        pg_size_pretty(pg_relation_size(indexrelid)) AS index_size
      FROM pg_stat_user_indexes
      WHERE idx_scan = 0
        AND indexrelid NOT IN (
          SELECT conindid FROM pg_constraint WHERE contype IN ('p', 'u')
        )
      ORDER BY pg_relation_size(indexrelid) DESC;
    `,
  },
  {
    id: "table-bloat",
    title: "Table bloat",
    description: "Tables with high dead tuple ratio causing wasted space",
    category: "performance",
    severity: "info",
    sql: `
      SELECT
        schemaname,
        relname AS table_name,
        n_live_tup,
        n_dead_tup,
        CASE WHEN n_live_tup > 0
          THEN ROUND((n_dead_tup::numeric / NULLIF(n_live_tup + n_dead_tup, 0)) * 100, 1)
          ELSE 0
        END AS dead_pct
      FROM pg_stat_user_tables
      WHERE n_dead_tup > 100
        AND (n_dead_tup::numeric / NULLIF(n_live_tup + n_dead_tup, 0)) > 0.1
      ORDER BY n_dead_tup DESC
      LIMIT 20;
    `,
  },
  {
    id: "cache-hit-ratio",
    title: "Low cache hit ratio",
    description: "Tables with cache hit ratio below 99%",
    category: "performance",
    severity: "info",
    sql: `
      SELECT
        schemaname,
        relname AS table_name,
        COALESCE(heap_blks_hit, 0) AS heap_hit,
        COALESCE(heap_blks_read, 0) AS heap_read,
        CASE WHEN (COALESCE(heap_blks_hit, 0) + COALESCE(heap_blks_read, 0)) > 0
          THEN ROUND(
            (COALESCE(heap_blks_hit, 0)::numeric /
             NULLIF(COALESCE(heap_blks_hit, 0) + COALESCE(heap_blks_read, 0), 0)) * 100, 2)
          ELSE NULL
        END AS hit_rate_pct
      FROM pg_statio_user_tables
      WHERE (COALESCE(heap_blks_hit, 0) + COALESCE(heap_blks_read, 0)) > 0
        AND (COALESCE(heap_blks_hit, 0)::numeric /
             NULLIF(COALESCE(heap_blks_hit, 0) + COALESCE(heap_blks_read, 0), 0)) < 0.99
      ORDER BY hit_rate_pct ASC
      LIMIT 10;
    `,
  },
  {
    id: "missing-indexes-on-fk",
    title: "Missing indexes on foreign keys",
    description: "Foreign key columns without an index",
    category: "performance",
    severity: "warning",
    sql: `
      SELECT
        tc.table_schema AS schema_name,
        tc.table_name,
        kcu.column_name,
        ccu.table_name AS referenced_table
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_catalog = kcu.constraint_catalog
        AND tc.constraint_schema = kcu.constraint_schema
        AND tc.constraint_name = kcu.constraint_name
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_catalog = tc.constraint_catalog
        AND ccu.constraint_schema = tc.constraint_schema
        AND ccu.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema NOT IN ('pg_catalog', 'information_schema')
        AND NOT EXISTS (
          SELECT 1
          FROM pg_index i
          JOIN pg_class c ON c.oid = i.indrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = tc.table_schema
            AND c.relname = tc.table_name
            AND kcu.column_name = ANY (
              SELECT a.attname
              FROM pg_attribute a
              WHERE a.attrelid = i.indrelid
                AND a.attnum = ANY(i.indkey)
                AND a.attnum > 0
            )
        )
      ORDER BY tc.table_schema, tc.table_name;
    `,
  },
  {
    id: "duplicate-index",
    title: "Duplicate indexes",
    description: "Identical indexes on the same table — only one is needed",
    category: "performance",
    severity: "warning",
    sql: `
      SELECT
        n.nspname AS schema_name,
        c.relname AS table_name,
        array_agg(pi.indexname ORDER BY pi.indexname)::text AS index_names,
        COUNT(*)::int AS duplicate_count
      FROM pg_indexes pi
      JOIN pg_namespace n ON n.nspname = pi.schemaname
      JOIN pg_class c ON pi.tablename = c.relname AND n.oid = c.relnamespace
      WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
        AND c.relkind IN ('r', 'm')
      GROUP BY n.nspname, c.relkind, c.relname, replace(pi.indexdef, pi.indexname, '')
      HAVING COUNT(*) > 1
      ORDER BY n.nspname, c.relname;
    `,
  },
  {
    id: "multiple-permissive-policies",
    title: "Multiple permissive RLS policies",
    description: "Tables with multiple PERMISSIVE policies for the same role and action — they OR together, hurting performance",
    category: "performance",
    severity: "warning",
    sql: `
      SELECT
        n.nspname AS schema_name,
        c.relname AS table_name,
        roles.rolname AS role_name,
        act.cmd AS command,
        array_agg(p.polname ORDER BY p.polname)::text AS policy_names,
        COUNT(*)::int AS policy_count
      FROM pg_policy p
      JOIN pg_class c ON p.polrelid = c.oid
      JOIN pg_namespace n ON c.relnamespace = n.oid
      CROSS JOIN LATERAL (
        SELECT DISTINCT COALESCE(r.rolname, 'public') AS rolname
        FROM unnest(p.polroles) pr(oid)
        LEFT JOIN pg_roles r ON r.oid = pr.oid
      ) roles
      CROSS JOIN LATERAL (
        SELECT x.cmd FROM unnest(
          CASE p.polcmd
            WHEN 'r' THEN ARRAY['SELECT']
            WHEN 'a' THEN ARRAY['INSERT']
            WHEN 'w' THEN ARRAY['UPDATE']
            WHEN 'd' THEN ARRAY['DELETE']
            WHEN '*' THEN ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']
          END
        ) x(cmd)
      ) act
      WHERE c.relkind = 'r'
        AND p.polpermissive
        AND n.nspname NOT IN ('pg_catalog', 'information_schema')
        AND roles.rolname NOT LIKE 'pg_%'
        AND COALESCE((SELECT rolbypassrls FROM pg_roles WHERE rolname = roles.rolname), false) = false
      GROUP BY n.nspname, c.relname, roles.rolname, act.cmd
      HAVING COUNT(*) > 1
      ORDER BY n.nspname, c.relname;
    `,
  },
  {
    id: "auth-rls-initplan",
    title: "Auth RLS initPlan",
    description: "RLS policies calling auth.uid() or current_setting() directly instead of wrapping in SELECT — causes per-row re-evaluation",
    category: "performance",
    severity: "warning",
    sql: `
      SELECT
        n.nspname AS schema_name,
        c.relname AS table_name,
        p.polname AS policy_name,
        CASE
          WHEN p.qual LIKE '%auth.uid()%' AND LOWER(p.qual) NOT LIKE '%select auth.uid()%' THEN 'auth.uid()'
          WHEN p.qual LIKE '%auth.jwt()%' AND LOWER(p.qual) NOT LIKE '%select auth.jwt()%' THEN 'auth.jwt()'
          WHEN p.qual LIKE '%auth.role()%' AND LOWER(p.qual) NOT LIKE '%select auth.role()%' THEN 'auth.role()'
          WHEN p.qual LIKE '%auth.email()%' AND LOWER(p.qual) NOT LIKE '%select auth.email()%' THEN 'auth.email()'
          WHEN p.qual LIKE '%current\\_setting(%)%' AND LOWER(p.qual) NOT LIKE '%select current\\_setting(%)%' THEN 'current_setting()'
          ELSE 'unknown'
        END AS issue_type
      FROM pg_policy p
      JOIN pg_class c ON p.polrelid = c.oid
      JOIN pg_namespace n ON c.relnamespace = n.oid
      WHERE c.relrowsecurity
        AND n.nspname NOT IN ('pg_catalog', 'information_schema')
        AND (
          (p.qual LIKE '%auth.uid()%' AND LOWER(p.qual) NOT LIKE '%select auth.uid()%')
          OR (p.qual LIKE '%auth.jwt()%' AND LOWER(p.qual) NOT LIKE '%select auth.jwt()%')
          OR (p.qual LIKE '%auth.role()%' AND LOWER(p.qual) NOT LIKE '%select auth.role()%')
          OR (p.qual LIKE '%auth.email()%' AND LOWER(p.qual) NOT LIKE '%select auth.email()%')
          OR (p.qual LIKE '%current\\_setting(%)%' AND LOWER(p.qual) NOT LIKE '%select current\\_setting(%)%')
        )
      ORDER BY n.nspname, c.relname, p.polname;
    `,
  },
];
