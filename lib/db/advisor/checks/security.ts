import type { AdvisorCheck } from "../types";

export const securityChecks: AdvisorCheck[] = [
  {
    id: "tables-without-rls",
    title: "Tables without Row-Level Security",
    description: "Tables in the public schema that do not have RLS enabled",
    category: "security",
    severity: "critical",
    sql: `
      SELECT
        n.nspname AS schema_name,
        c.relname AS table_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind IN ('r', 'p')
        AND NOT c.relrowsecurity
      ORDER BY c.relname;
    `,
  },
  {
    id: "tables-without-pk",
    title: "Tables without primary key",
    description: "Tables that lack a primary key constraint",
    category: "security",
    severity: "warning",
    sql: `
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
    `,
  },
  {
    id: "superuser-roles",
    title: "Roles with superuser privileges",
    description: "Non-default roles that have superuser access",
    category: "security",
    severity: "warning",
    sql: `
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
    `,
  },
  {
    id: "rls-policies-missing",
    title: "RLS enabled but no policies defined",
    description: "Tables with RLS on but zero policies — all access blocked",
    category: "security",
    severity: "info",
    sql: `
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
    `,
  },
  {
    id: "function-search-path-mutable",
    title: "Function Search Path Mutable",
    description: "Detects functions where the search_path parameter is not set.",
    category: "security",
    severity: "warning",
    sql: `
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
    `,
  },
  {
    id: "security-definer-public",
    title: "Public Can Execute SECURITY DEFINER Function",
    description: "Detects SECURITY DEFINER functions that are callable without signing in.",
    category: "security",
    severity: "warning",
    sql: `
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
    `,
  },
  {
    id: "security-definer-authenticated",
    title: "Signed-In Users Can Execute SECURITY DEFINER Function",
    description: "Detects SECURITY DEFINER functions that are callable by signed-in users.",
    category: "security",
    severity: "warning",
    sql: `
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
    `,
  },
  {
    id: "leaked-password-protection",
    title: "Leaked Password Protection Disabled",
    description: "Leaked password protection is currently disabled.",
    category: "security",
    severity: "warning",
    requiresExtension: "auth.config",
    sql: `
      SELECT 'Auth' AS entity
      FROM auth.config
      WHERE NOT COALESCE(leaked_password_protection_enabled, false)
      LIMIT 1;
    `,
  },
];
