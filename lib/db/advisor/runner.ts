import { performanceChecks } from "./checks/performance";
import { securityChecks } from "./checks/security";
import { schemaChecks } from "./checks/schema";
import type { AdvisorCheck, AdvisorResult } from "./types";

export type RunnerResult = {
  results: AdvisorResult[];
  extensionsMissing: string[];
  error: string | null;
};

async function withPgClientRead<T>(
  connectionString: string,
  fn: (executeQuery: (...args: any[]) => any) => Promise<T>,
): Promise<{ success: true; data: T } | { success: false; error: string }> {
  const { isPostgresConnection } = await import("../pg-connection");
  if (!isPostgresConnection(connectionString)) {
    return { success: true, data: [] as any };
  }
  const { executeQuery } = await import("../pg-client");
  try {
    const data = await fn(executeQuery);
    return { success: true, data };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

function formatResult(check: AdvisorCheck, rows: any[], error: string | null): AdvisorResult {
  if (error) {
    const isMissingExt = !!(check.requiresExtension && error.includes(check.requiresExtension));
    return {
      check,
      passed: isMissingExt,
      detail: isMissingExt
        ? `Extension "${check.requiresExtension}" is not available on this database`
        : `Check failed: ${error}`,
      suggestion: isMissingExt
        ? `Install the ${check.requiresExtension} extension: CREATE EXTENSION IF NOT EXISTS "${check.requiresExtension}";`
        : null,
      sqlStatement: null,
    };
  }

  if (rows.length === 0) {
    return {
      check,
      passed: true,
      detail: "No issues found",
      suggestion: null,
      sqlStatement: null,
    };
  }

  const detail = formatDetail(check.id, rows);
  const suggestion = formatSuggestion(check.id, rows);
  const sqlStatement = formatSqlStatement(check.id, rows);

  return {
    check,
    passed: false,
    detail,
    suggestion,
    sqlStatement,
    value: rows.length,
    rows,
  };
}

function formatDetail(checkId: string, rows: any[]): string {
  switch (checkId) {
    case "slow-queries":
      return `${rows.length} slow quer${rows.length === 1 ? "y" : "ies"} detected (avg > 1s)`;
    case "unused-indexes":
      return `${rows.length} unused ind${rows.length === 1 ? "ex" : "exes"} found`;
    case "table-bloat":
      return `${rows.length} table${rows.length === 1 ? "" : "s"} with significant bloat`;
    case "cache-hit-ratio":
      return `${rows.length} table${rows.length === 1 ? "" : "s"} with cache hit rate below 99%`;
    case "missing-indexes-on-fk":
      return `${rows.length} foreign key${rows.length === 1 ? "" : "s"} missing indexes`;
    case "tables-without-rls":
      return `${rows.length} table${rows.length === 1 ? "" : "s"} without RLS enabled`;
    case "tables-without-pk":
      return `${rows.length} table${rows.length === 1 ? "" : "s"} without primary keys`;
    case "superuser-roles":
      return `${rows.length} role${rows.length === 1 ? "" : "s"} with superuser privileges`;
    case "rls-policies-missing":
      return `${rows.length} table${rows.length === 1 ? "" : "s"} with RLS on but no policies`;
    case "disabled-triggers":
      return `${rows.length} disabled trigger${rows.length === 1 ? "" : "s"}`;
    case "indexes-on-low-cardinality":
      return `${rows.length} index${rows.length === 1 ? "" : "es"} on low-cardinality columns`;
    case "missing-foreign-key-indexes":
      return `${rows.length} table${rows.length === 1 ? "" : "s"} with no indexes`;
    case "function-search-path-mutable":
      return `${rows.length} function${rows.length === 1 ? "" : "s"} with mutable search_path`;
    case "security-definer-public":
      return `${rows.length} SECURITY DEFINER function${rows.length === 1 ? "" : "s"} executable by anon`;
    case "security-definer-authenticated":
      return `${rows.length} SECURITY DEFINER function${rows.length === 1 ? "" : "s"} executable by authenticated users`;
    case "leaked-password-protection":
      return "Leaked password protection is disabled";
    default:
      return `${rows.length} issue${rows.length === 1 ? "" : "s"} found`;
  }
}

function formatSuggestion(checkId: string, rows: any[]): string | null {
  switch (checkId) {
    case "slow-queries":
      return "Review these queries and consider adding indexes or optimizing query structure.";
    case "unused-indexes":
      return "Consider dropping unused indexes to improve write performance and reduce storage.";
    case "table-bloat":
      return "Run VACUUM or VACUUM FULL on these tables to reclaim wasted space.";
    case "cache-hit-ratio":
      return "Consider increasing shared_buffers or reviewing query patterns causing table scans.";
    case "missing-indexes-on-fk":
      return "Add indexes on foreign key columns to improve JOIN performance.";
    case "tables-without-rls":
      return "Enable RLS on these tables and define appropriate policies to restrict access.";
    case "tables-without-pk":
      return "Add a primary key to each table for data integrity and replication support.";
    case "superuser-roles":
      return "Review and revoke superuser privileges from roles that don't require them.";
    case "rls-policies-missing":
      return "Define RLS policies for these tables or disable RLS if not needed.";
    case "disabled-triggers":
      return "Review and re-enable or drop these disabled triggers.";
    case "indexes-on-low-cardinality":
      return "Consider dropping indexes on low-cardinality columns — they add overhead without benefit.";
    case "missing-foreign-key-indexes":
      return "Add indexes to these tables to improve query performance.";
    case "function-search-path-mutable":
      return "Set a fixed search_path for each function: ALTER FUNCTION name SET search_path = public, pg_temp;";
    case "security-definer-public":
      return "Revoke EXECUTE on these functions from the anon role, or change them to SECURITY INVOKER.";
    case "security-definer-authenticated":
      return "Review whether signed-in users should execute these SECURITY DEFINER functions.";
    case "leaked-password-protection":
      return "Enable leaked password protection in your Auth settings to block compromised passwords.";
    default:
      return null;
  }
}

function formatSqlStatement(checkId: string, rows: any[]): string | null {
  if (rows.length === 0) return null;

  switch (checkId) {
    case "unused-indexes": {
      const stmts = rows.map(
        (r: any) => `DROP INDEX IF EXISTS "${r.schemaname}"."${r.indexname}";`,
      );
      return stmts.join("\n");
    }
    case "tables-without-rls": {
      const stmts = rows.map(
        (r: any) =>
          `ALTER TABLE "${r.schema_name}"."${r.table_name}" ENABLE ROW LEVEL SECURITY;`,
      );
      return stmts.join("\n");
    }
    case "tables-without-pk":
      return `-- Add primary keys manually based on your data model\n${rows.map((r: any) => `-- ALTER TABLE "${r.schema_name}"."${r.table_name}" ADD PRIMARY KEY (id);`).join("\n")}`;
    default:
      return null;
  }
}

async function runCheck(
  connectionString: string,
  check: AdvisorCheck,
): Promise<AdvisorResult> {
  const result = await withPgClientRead(connectionString, async (executeQuery) => {
    const res = await executeQuery(connectionString, check.sql);
    return res.rows;
  });

  if (result.success === false) {
    return formatResult(check, [], result.error);
  }

  return formatResult(check, result.data as any[], null);
}

export async function runAllChecks(
  connectionString: string,
): Promise<RunnerResult> {
  const allChecks: AdvisorCheck[] = [
    ...performanceChecks,
    ...securityChecks,
    ...schemaChecks,
  ];

  const results: AdvisorResult[] = [];
  const extensionsMissing: string[] = [];

  for (const check of allChecks) {
    const result = await runCheck(connectionString, check);
    results.push(result);

    if (result.passed && result.check.requiresExtension) {
      const isMissing = result.detail.includes("not available");
      if (isMissing) extensionsMissing.push(result.check.requiresExtension);
    }
  }

  return {
    results,
    extensionsMissing,
    error: null,
  };
}
