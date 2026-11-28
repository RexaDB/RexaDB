//! Port of lib/db/advisor/{types,runner}.ts and checks/{performance,security,schema}.ts:
//! the advisor's check catalogue, `formatResult` (detail / suggestion / fix SQL) and
//! `getEntityLabel` of components/advisor/advisor-view.tsx.

use std::collections::HashMap;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Severity {
    Critical,
    Warning,
    Info,
}

impl Severity {
    pub fn label(self) -> &'static str {
        match self {
            Severity::Critical => "Critical",
            Severity::Warning => "Warning",
            Severity::Info => "Info",
        }
    }
}

pub struct AdvisorCheck {
    pub id: &'static str,
    pub title: &'static str,
    pub description: &'static str,
    /// "performance" | "security" | "schema"
    pub category: &'static str,
    pub severity: Severity,
    pub sql: &'static str,
    pub requires_extension: Option<&'static str>,
}

pub type Row = HashMap<String, String>;

#[derive(Clone)]
pub struct AdvisorResult {
    pub check: &'static AdvisorCheck,
    pub passed: bool,
    pub detail: String,
    pub suggestion: Option<String>,
    pub sql_statement: Option<String>,
    pub rows: Vec<Row>,
}

use Severity::*;

/// `[...performanceChecks, ...securityChecks, ...schemaChecks]`
pub static CHECKS: &[AdvisorCheck] = &[
    AdvisorCheck { id: "slow-queries", title: "Slow queries", description: "Queries with average execution time exceeding 1 second", category: "performance", severity: Warning, requires_extension: Some("pg_stat_statements"), sql: r#"
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
    "# },
    AdvisorCheck { id: "unused-indexes", title: "Unused indexes", description: "Indexes that have never been scanned", category: "performance", severity: Warning, requires_extension: None, sql: r#"
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
    "# },
    AdvisorCheck { id: "table-bloat", title: "Table bloat", description: "Tables with high dead tuple ratio causing wasted space", category: "performance", severity: Info, requires_extension: None, sql: r#"
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
    "# },
    AdvisorCheck { id: "cache-hit-ratio", title: "Low cache hit ratio", description: "Tables with cache hit ratio below 99%", category: "performance", severity: Info, requires_extension: None, sql: r#"
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
    "# },
    AdvisorCheck { id: "missing-indexes-on-fk", title: "Missing indexes on foreign keys", description: "Foreign key columns without an index", category: "performance", severity: Warning, requires_extension: None, sql: r#"
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
    "# },
    AdvisorCheck { id: "duplicate-index", title: "Duplicate indexes", description: "Identical indexes on the same table — only one is needed", category: "performance", severity: Warning, requires_extension: None, sql: r#"
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
    "# },
    AdvisorCheck { id: "multiple-permissive-policies", title: "Multiple permissive RLS policies", description: "Tables with multiple PERMISSIVE policies for the same role and action — they OR together, hurting performance", category: "performance", severity: Warning, requires_extension: None, sql: r#"
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
    "# },
    AdvisorCheck { id: "auth-rls-initplan", title: "Auth RLS initPlan", description: "RLS policies calling auth.uid() or current_setting() directly instead of wrapping in SELECT — causes per-row re-evaluation", category: "performance", severity: Warning, requires_extension: None, sql: r#"
      SELECT
        n.nspname AS schema_name,
        c.relname AS table_name,
        p.polname AS policy_name,
        CASE
          WHEN p.qual LIKE '%auth.uid()%' AND LOWER(p.qual) NOT LIKE '%select auth.uid()%' THEN 'auth.uid()'
          WHEN p.qual LIKE '%auth.jwt()%' AND LOWER(p.qual) NOT LIKE '%select auth.jwt()%' THEN 'auth.jwt()'
          WHEN p.qual LIKE '%auth.role()%' AND LOWER(p.qual) NOT LIKE '%select auth.role()%' THEN 'auth.role()'
          WHEN p.qual LIKE '%auth.email()%' AND LOWER(p.qual) NOT LIKE '%select auth.email()%' THEN 'auth.email()'
          WHEN p.qual LIKE '%current\_setting(%)%' AND LOWER(p.qual) NOT LIKE '%select current\_setting(%)%' THEN 'current_setting()'
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
          OR (p.qual LIKE '%current\_setting(%)%' AND LOWER(p.qual) NOT LIKE '%select current\_setting(%)%')
        )
      ORDER BY n.nspname, c.relname, p.polname;
    "# },
    AdvisorCheck { id: "tables-without-rls", title: "Tables without Row-Level Security", description: "Tables in the public schema that do not have RLS enabled", category: "security", severity: Critical, requires_extension: None, sql: r#"
      SELECT
        n.nspname AS schema_name,
        c.relname AS table_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind IN ('r', 'p')
        AND NOT c.relrowsecurity
      ORDER BY c.relname;
    "# },
    AdvisorCheck { id: "tables-without-pk", title: "Tables without primary key", description: "Tables that lack a primary key constraint", category: "security", severity: Warning, requires_extension: None, sql: r#"
      SELECT
        n.nspname AS schema_name,
        c.relname AS table_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_constraint pk
        ON pk.conrelid = c.oid
        AND pk.contype = 'p'
      WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
        AND c.relkind IN ('r', 'p')
        AND pk.oid IS NULL
      ORDER BY n.nspname, c.relname;
    "# },
    AdvisorCheck { id: "superuser-roles", title: "Roles with superuser privileges", description: "Non-default roles that have superuser access", category: "security", severity: Warning, requires_extension: None, sql: r#"
      SELECT
        rolname AS role_name,
        rolcanlogin AS can_login,
        rolcreatedb AS can_create_db
      FROM pg_roles
      WHERE rolsuper
        AND rolname NOT IN (
          'postgres',
          'pg_database_owner',
          'pg_read_all_data',
          'pg_write_all_data',
          'pg_read_all_stats',
          'pg_monitor',
          'pg_read_all_settings',
          'pg_stat_scan_tables',
          'pg_signal_backend',
          'pg_read_server_files',
          'pg_write_server_files',
          'pg_execute_server_program',
          'supabase_admin',
          'supabase_auth_admin',
          'supabase_storage_admin',
          'supabase_replication_admin',
          'supabase_read_only_user',
          'dashboard_user'
        )
      ORDER BY rolname;
    "# },
    AdvisorCheck { id: "rls-policies-missing", title: "RLS enabled but no policies defined", description: "Tables with RLS on but zero policies — all access blocked", category: "security", severity: Info, requires_extension: None, sql: r#"
      SELECT
        n.nspname AS schema_name,
        c.relname AS table_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relrowsecurity
        AND NOT EXISTS (
          SELECT 1 FROM pg_policies p
          WHERE p.schemaname = n.nspname
            AND p.tablename = c.relname
        )
      ORDER BY n.nspname, c.relname;
    "# },
    AdvisorCheck { id: "function-search-path-mutable", title: "Function Search Path Mutable", description: "Detects functions where the search_path parameter is not set.", category: "security", severity: Warning, requires_extension: None, sql: r#"
      SELECT
        n.nspname AS schema_name,
        p.proname AS function_name,
        pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast', 'extensions')
        AND p.prokind IN ('f', 'p')
        AND (
          p.proconfig IS NULL
          OR NOT EXISTS (
            SELECT 1 FROM unnest(p.proconfig) AS cfg(setting)
            WHERE setting LIKE 'search_path=%'
          )
        )
      ORDER BY n.nspname, p.proname;
    "# },
    AdvisorCheck { id: "security-definer-public", title: "Public Can Execute SECURITY DEFINER Function", description: "Detects SECURITY DEFINER functions that are callable without signing in.", category: "security", severity: Warning, requires_extension: None, sql: r#"
      WITH anon_role AS (
        SELECT oid FROM pg_roles WHERE rolname = 'anon'
      )
      SELECT
        n.nspname AS schema_name,
        p.proname AS function_name,
        pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      JOIN anon_role a ON has_function_privilege(a.oid, p.oid, 'EXECUTE')
      WHERE p.prosecdef = true
        AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
      ORDER BY n.nspname, p.proname;
    "# },
    AdvisorCheck { id: "security-definer-authenticated", title: "Signed-In Users Can Execute SECURITY DEFINER Function", description: "Detects SECURITY DEFINER functions that are callable by signed-in users.", category: "security", severity: Warning, requires_extension: None, sql: r#"
      WITH authenticated_role AS (
        SELECT oid FROM pg_roles WHERE rolname = 'authenticated'
      )
      SELECT
        n.nspname AS schema_name,
        p.proname AS function_name,
        pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      JOIN authenticated_role a ON has_function_privilege(a.oid, p.oid, 'EXECUTE')
      WHERE p.prosecdef = true
        AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
      ORDER BY n.nspname, p.proname;
    "# },
    AdvisorCheck { id: "leaked-password-protection", title: "Leaked Password Protection Disabled", description: "Leaked password protection is currently disabled.", category: "security", severity: Warning, requires_extension: Some("auth.config"), sql: r#"
      SELECT 'Auth' AS entity
      FROM auth.config
      WHERE NOT COALESCE(leaked_password_protection_enabled, false)
      LIMIT 1;
    "# },
    AdvisorCheck { id: "disabled-triggers", title: "Disabled triggers", description: "Triggers that are currently disabled", category: "schema", severity: Warning, requires_extension: None, sql: r#"
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
    "# },
    AdvisorCheck { id: "indexes-on-low-cardinality", title: "Indexes on low-cardinality columns", description: "Indexes on columns with fewer than 100 distinct values — likely ineffective", category: "schema", severity: Info, requires_extension: None, sql: r#"
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
    "# },
    AdvisorCheck { id: "missing-foreign-key-indexes", title: "Tables with no indexes at all", description: "Tables in the public schema that have zero indexes", category: "schema", severity: Info, requires_extension: None, sql: r#"
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
    "# },
];

fn plural(n: usize, one: &str, many: &str) -> String {
    format!("{n} {}", if n == 1 { one } else { many })
}

/// `formatDetail`
pub fn format_detail(id: &str, n: usize) -> String {
    match id {
        "slow-queries" => format!("{} detected (avg > 1s)", plural(n, "slow query", "slow queries")),
        "unused-indexes" => format!("{} found", plural(n, "unused index", "unused indexes")),
        "table-bloat" => format!("{} with significant bloat", plural(n, "table", "tables")),
        "cache-hit-ratio" => format!("{} with cache hit rate below 99%", plural(n, "table", "tables")),
        "missing-indexes-on-fk" => format!("{} missing indexes", plural(n, "foreign key", "foreign keys")),
        "tables-without-rls" => format!("{} without RLS enabled", plural(n, "table", "tables")),
        "tables-without-pk" => format!("{} without primary keys", plural(n, "table", "tables")),
        "superuser-roles" => format!("{} with superuser privileges", plural(n, "role", "roles")),
        "rls-policies-missing" => format!("{} with RLS on but no policies", plural(n, "table", "tables")),
        "disabled-triggers" => plural(n, "disabled trigger", "disabled triggers"),
        "indexes-on-low-cardinality" => format!("{} on low-cardinality columns", plural(n, "index", "indexes")),
        "missing-foreign-key-indexes" => format!("{} with no indexes", plural(n, "table", "tables")),
        "function-search-path-mutable" => format!("{} with mutable search_path", plural(n, "function", "functions")),
        "security-definer-public" => format!("{} executable by anon", plural(n, "SECURITY DEFINER function", "SECURITY DEFINER functions")),
        "security-definer-authenticated" => format!("{} executable by authenticated users", plural(n, "SECURITY DEFINER function", "SECURITY DEFINER functions")),
        "leaked-password-protection" => "Leaked password protection is disabled".into(),
        _ => format!("{} found", plural(n, "issue", "issues")),
    }
}

/// `formatSuggestion`
pub fn format_suggestion(id: &str) -> Option<&'static str> {
    Some(match id {
        "slow-queries" => "Review these queries and consider adding indexes or optimizing query structure.",
        "unused-indexes" => "Consider dropping unused indexes to improve write performance and reduce storage.",
        "table-bloat" => "Run VACUUM or VACUUM FULL on these tables to reclaim wasted space.",
        "cache-hit-ratio" => "Consider increasing shared_buffers or reviewing query patterns causing table scans.",
        "missing-indexes-on-fk" => "Add indexes on foreign key columns to improve JOIN performance.",
        "tables-without-rls" => "Enable RLS on these tables and define appropriate policies to restrict access.",
        "tables-without-pk" => "Add a primary key to each table for data integrity and replication support.",
        "superuser-roles" => "Review and revoke superuser privileges from roles that don't require them.",
        "rls-policies-missing" => "Define RLS policies for these tables or disable RLS if not needed.",
        "disabled-triggers" => "Review and re-enable or drop these disabled triggers.",
        "indexes-on-low-cardinality" => "Consider dropping indexes on low-cardinality columns — they add overhead without benefit.",
        "missing-foreign-key-indexes" => "Add indexes to these tables to improve query performance.",
        "function-search-path-mutable" => "Set a fixed search_path for each function: ALTER FUNCTION name SET search_path = public, pg_temp;",
        "security-definer-public" => "Revoke EXECUTE on these functions from the anon role, or change them to SECURITY INVOKER.",
        "security-definer-authenticated" => "Review whether signed-in users should execute these SECURITY DEFINER functions.",
        "leaked-password-protection" => "Enable leaked password protection in your Auth settings to block compromised passwords.",
        _ => return None,
    })
}

fn get<'a>(row: &'a Row, k: &str) -> &'a str {
    row.get(k).map(String::as_str).unwrap_or("")
}

/// `formatSqlStatement`
pub fn format_sql_statement(id: &str, rows: &[Row]) -> Option<String> {
    if rows.is_empty() {
        return None;
    }
    match id {
        "unused-indexes" => Some(rows.iter().map(|r| format!("DROP INDEX IF EXISTS \"{}\".\"{}\";", get(r, "schemaname"), get(r, "indexname"))).collect::<Vec<_>>().join("\n")),
        "tables-without-rls" => Some(rows.iter().map(|r| format!("ALTER TABLE \"{}\".\"{}\" ENABLE ROW LEVEL SECURITY;", get(r, "schema_name"), get(r, "table_name"))).collect::<Vec<_>>().join("\n")),
        "tables-without-pk" => Some(format!(
            "-- Add primary keys manually based on your data model\n{}",
            rows.iter().map(|r| format!("-- ALTER TABLE \"{}\".\"{}\" ADD PRIMARY KEY (id);", get(r, "schema_name"), get(r, "table_name"))).collect::<Vec<_>>().join("\n")
        )),
        _ => None,
    }
}

/// `formatResult`
pub fn format_result(check: &'static AdvisorCheck, rows: Vec<Row>, error: Option<String>) -> AdvisorResult {
    if let Some(error) = error {
        let missing_ext = check.requires_extension.is_some_and(|e| error.contains(e));
        return AdvisorResult {
            check,
            passed: missing_ext,
            detail: if missing_ext { format!("Extension \"{}\" is not available on this database", check.requires_extension.unwrap_or_default()) } else { format!("Check failed: {error}") },
            suggestion: missing_ext.then(|| format!("Install the {} extension: CREATE EXTENSION IF NOT EXISTS \"{}\";", check.requires_extension.unwrap_or_default(), check.requires_extension.unwrap_or_default())),
            sql_statement: None,
            rows: Vec::new(),
        };
    }
    if rows.is_empty() {
        return AdvisorResult { check, passed: true, detail: "No issues found".into(), suggestion: None, sql_statement: None, rows };
    }
    AdvisorResult {
        check,
        passed: false,
        detail: format_detail(check.id, rows.len()),
        suggestion: format_suggestion(check.id).map(str::to_string),
        sql_statement: format_sql_statement(check.id, &rows),
        rows,
    }
}

/// `getEntityLabel` (advisor-view.tsx)
pub fn entity_label(id: &str, r: &Row) -> String {
    match id {
        "tables-without-rls" | "tables-without-pk" | "rls-policies-missing" | "missing-foreign-key-indexes" => format!("{}.{}", get(r, "schema_name"), get(r, "table_name")),
        "superuser-roles" => get(r, "role_name").to_string(),
        "slow-queries" => get(r, "query").chars().take(60).collect::<String>().split_whitespace().collect::<Vec<_>>().join(" "),
        "unused-indexes" => format!("{}.{}", get(r, "schemaname"), get(r, "indexname")),
        "table-bloat" | "cache-hit-ratio" => format!("{}.{}", get(r, "schemaname"), get(r, "table_name")),
        "missing-indexes-on-fk" => format!("{}.{}({})", get(r, "schema_name"), get(r, "table_name"), get(r, "column_name")),
        "disabled-triggers" => format!("{}.{}.{}", get(r, "schema_name"), get(r, "table_name"), get(r, "trigger_name")),
        "indexes-on-low-cardinality" => format!("{}.{}", get(r, "schema_name"), get(r, "index_name")),
        "duplicate-index" => format!("{}.{}", get(r, "schema_name"), get(r, "table_name")),
        "multiple-permissive-policies" => format!("{}.{} ({}, {})", get(r, "schema_name"), get(r, "table_name"), get(r, "role_name"), get(r, "command")),
        "auth-rls-initplan" => format!("{}.{}.{}", get(r, "schema_name"), get(r, "table_name"), get(r, "policy_name")),
        "function-search-path-mutable" | "security-definer-public" | "security-definer-authenticated" => {
            let args = get(r, "args");
            if args.is_empty() {
                format!("{}.{}", get(r, "schema_name"), get(r, "function_name"))
            } else {
                format!("{}.{}({args})", get(r, "schema_name"), get(r, "function_name"))
            }
        }
        "leaked-password-protection" => {
            let e = get(r, "entity");
            if e.is_empty() { "Auth".into() } else { e.into() }
        }
        _ => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalogue_matches_the_original() {
        assert_eq!(CHECKS.len(), 19);
        let rls = CHECKS.iter().find(|c| c.id == "tables-without-rls").unwrap();
        let row: Row = [("schema_name".to_string(), "public".to_string()), ("table_name".to_string(), "t".to_string())].into();
        let r = format_result(rls, vec![row.clone()], None);
        assert!(!r.passed);
        assert_eq!(r.detail, "1 table without RLS enabled");
        assert_eq!(r.sql_statement.as_deref(), Some("ALTER TABLE \"public\".\"t\" ENABLE ROW LEVEL SECURITY;"));
        assert_eq!(entity_label("tables-without-rls", &row), "public.t");
        let slow = CHECKS.iter().find(|c| c.id == "slow-queries").unwrap();
        assert!(format_result(slow, vec![], Some("relation \"pg_stat_statements\" does not exist".into())).passed);
    }
}
