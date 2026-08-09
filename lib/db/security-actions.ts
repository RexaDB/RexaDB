import { extractIndexColumns } from "./pg-utils";
import { isPostgresConnection } from "./pg-connection";
import { quotePgIdentifier } from "./quote-identifier";
import { detectConnectionDbType } from "./connection-type";

function isPgLike(connectionString: string): boolean {
  const dt = detectConnectionDbType(connectionString);
  return dt === "postgres" || dt === "supabase-mgmt";
}

async function withPgClientRead<T>(
  connectionString: string,
  label: string,
  fn: (executeQuery: (...args: any[]) => any) => Promise<T>,
): Promise<{ success: true; data: T } | { success: false; error: string }> {
  if (!isPgLike(connectionString)) {
    return { success: true, data: [] as any };
  }
  const dbType = detectConnectionDbType(connectionString);
  const executeQueryFn = dbType === "supabase-mgmt"
    ? async (_connStr: string, sql: string, params?: any[]) => {
        let q = sql;
        if (params && params.length > 0) {
          params.forEach((p, i) => {
            const escaped = typeof p === "string" ? `'${String(p).replace(/'/g, "''")}'` : String(p);
            q = q.replace(new RegExp(`\\$${i + 1}\\b`), escaped);
          });
        }
        const { executeDbQuery } = await import("./db-engine/query");
        return executeDbQuery(connectionString, q);
      }
    : (await import("./pg-client")).executeQuery;
  try {
    const data = await fn(executeQueryFn);
    return { success: true, data };
  } catch (error: any) {
    console.error(`Failed to fetch ${label}:`, error);
    return { success: false, error: error.message };
  }
}

async function withPgClientWrite(
  connectionString: string,
  label: string,
  errorMsg: string,
  fn: (executeQuery: (...args: any[]) => any) => Promise<void>,
): Promise<{ success: true } | { success: false; error: string }> {
  if (!isPgLike(connectionString)) {
    return { success: false, error: errorMsg };
  }
  const dbType = detectConnectionDbType(connectionString);
  const executeQueryFn = dbType === "supabase-mgmt"
    ? async (_connStr: string, sql: string, params?: any[]) => {
        let q = sql;
        if (params && params.length > 0) {
          params.forEach((p, i) => {
            const escaped = typeof p === "string" ? `'${String(p).replace(/'/g, "''")}'` : String(p);
            q = q.replace(new RegExp(`\\$${i + 1}\\b`), escaped);
          });
        }
        const { executeDbQuery } = await import("./db-engine/query");
        return executeDbQuery(connectionString, q);
      }
    : (await import("./pg-client")).executeQuery;
  try {
    await fn(executeQueryFn);
    return { success: true };
  } catch (error: any) {
    console.error(`Failed to ${label}:`, error);
    return { success: false, error: error.message };
  }
}

export async function fetchTableSecurityInfo(connectionString: string, schema: string) {
  return withPgClientRead(connectionString, "table security info", async (executeQuery) => {
    const sql = `
      SELECT
        c.relname AS table_name,
        c.relrowsecurity AS rls_enabled,
        c.relforcerowsecurity AS rls_forced,
        COUNT(p.policyname) AS policy_count
      FROM pg_class c
      JOIN pg_namespace n
        ON n.oid = c.relnamespace
      LEFT JOIN pg_policies p
        ON p.schemaname = n.nspname
       AND p.tablename = c.relname
      WHERE n.nspname = $1
        AND c.relkind IN ('r', 'p')
      GROUP BY c.relname, c.relrowsecurity, c.relforcerowsecurity
      ORDER BY c.relname;
    `;
    const res = await executeQuery(connectionString, sql, [schema]);
    return res.rows;
  });
}

export async function fetchExtensions(connectionString: string) {
  return withPgClientRead(connectionString, "extensions", async (executeQuery) => {
    const sql = `
      SELECT 
        ext.name,
        ext.default_version,
        ext.installed_version,
        ext.comment,
        ns.nspname AS installed_schema,
        details.schema AS default_schema,
        array_to_string(details.requires, ', ') AS requires,
        details.trusted,
        details.relocatable,
        details.superuser,
        array_to_string(
          ARRAY(
            SELECT version_item.version
            FROM pg_available_extension_versions AS version_item
            WHERE version_item.name = ext.name
            ORDER BY version_item.version DESC
          ),
          ', '
        ) AS available_versions
      FROM pg_available_extensions AS ext
      LEFT JOIN pg_extension AS installed_ext
        ON installed_ext.extname = ext.name
      LEFT JOIN pg_namespace AS ns
        ON ns.oid = installed_ext.extnamespace
      LEFT JOIN pg_available_extension_versions AS details
        ON details.name = ext.name
       AND details.version = COALESCE(ext.installed_version, ext.default_version)
      ORDER BY ext.name;
    `;
    const res = await executeQuery(connectionString, sql);
    return res.rows;
  });
}

export async function toggleExtension(connectionString: string, name: string, install: boolean) {
  return withPgClientWrite(connectionString, `${install ? "install" : "uninstall"} extension ${name}`, "Extensions are supported only for PostgreSQL connections.", async (executeQuery) => {
    const sql = install
      ? `CREATE EXTENSION IF NOT EXISTS "${name}" CASCADE;`
      : `DROP EXTENSION IF EXISTS "${name}" CASCADE;`;
    await executeQuery(connectionString, sql);
  });
}

export async function fetchTriggers(connectionString: string, schema?: string) {
  return withPgClientRead(connectionString, "triggers", async (executeQuery) => {
    const sql = `
      SELECT 
        trigger_schema as schema,
        trigger_name as name,
        event_object_table as table_name,
        action_timing as timing,
        event_manipulation as event,
        action_statement as definition
      FROM information_schema.triggers
      WHERE trigger_schema NOT IN ('information_schema', 'pg_catalog')
      ${schema ? "AND trigger_schema = $1" : ""}
      ORDER BY trigger_schema, trigger_name;
    `;
    const res = await executeQuery(connectionString, sql, schema ? [schema] : []);
    return res.rows;
  });
}

export async function fetchEnums(connectionString: string) {
  return withPgClientRead(connectionString, "enums", async (executeQuery) => {
    const sql = `
      SELECT 
        n.nspname as schema,
        t.typname as name,
        e.enumlabel as value,
        e.enumsortorder as sort_order
      FROM pg_type t 
      JOIN pg_enum e ON t.oid = e.enumtypid  
      JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname NOT IN ('information_schema', 'pg_catalog')
      ORDER BY n.nspname, t.typname, e.enumsortorder;
    `;
    const res = await executeQuery(connectionString, sql);

    const enumsMap = res.rows.reduce((acc: any, row: any) => {
      const key = `${row.schema}.${row.name}`;
      if (!acc[key]) {
        acc[key] = { schema: row.schema, name: row.name, values: [] };
      }
      acc[key].values.push(row.value);
      return acc;
    }, {});

    return Object.values(enumsMap);
  });
}

export async function createEnum(connectionString: string, schema: string, name: string, values: string[]) {
  return withPgClientWrite(connectionString, "create enum", "Enum types are supported only for PostgreSQL connections.", async (executeQuery) => {
    const valuesStr = values.map(v => `'${v.replace(/'/g, "''")}'`).join(', ');
    const sql = `CREATE TYPE ${quotePgIdentifier(schema)}.${quotePgIdentifier(name)} AS ENUM (${valuesStr});`;
    await executeQuery(connectionString, sql);
  });
}

export async function deleteEnum(connectionString: string, schema: string, name: string) {
  return withPgClientWrite(connectionString, "delete enum", "Enum types are supported only for PostgreSQL connections.", async (executeQuery) => {
    const sql = `DROP TYPE ${quotePgIdentifier(schema)}.${quotePgIdentifier(name)};`;
    await executeQuery(connectionString, sql);
  });
}

export async function fetchIndexes(connectionString: string, schema?: string) {
  return withPgClientRead(connectionString, "indexes", async (executeQuery) => {
    const sql = `
      SELECT 
        schemaname as schema,
        tablename as table_name,
        indexname as name,
        indexdef as definition,
        CASE WHEN indexdef LIKE 'CREATE UNIQUE INDEX%' THEN true ELSE false END as is_unique
      FROM pg_indexes
      WHERE schemaname NOT IN ('information_schema', 'pg_catalog')
      ${schema ? "AND schemaname = $1" : ""}
      ORDER BY schemaname, tablename, indexname;
    `;
    const res = await executeQuery(connectionString, sql, schema ? [schema] : []);

    const data = res.rows.map((row: any) => ({
      ...row,
      columns: extractIndexColumns(row.definition),
    }));

    return data;
  });
}

export async function fetchRlsPolicies(
  connectionString: string,
  schema?: string | null,
  table?: string | null
) {
  return withPgClientRead(connectionString, "RLS policies", async (executeQuery) => {
    const sql = `
      SELECT
        p.schemaname as schema,
        p.tablename as table_name,
        p.policyname as name,
        p.permissive as permissive,
        p.roles as roles,
        p.cmd as command,
        p.qual as using_expression,
        p.with_check as with_check_expression,
        c.relrowsecurity as rls_enabled,
        c.relforcerowsecurity as rls_forced
      FROM pg_policies p
      JOIN pg_namespace n
        ON n.nspname = p.schemaname
      JOIN pg_class c
        ON c.relname = p.tablename
       AND c.relnamespace = n.oid
      WHERE p.schemaname NOT IN ('information_schema', 'pg_catalog')
        AND ($1::text IS NULL OR p.schemaname = $1)
        AND ($2::text IS NULL OR p.tablename = $2)
      ORDER BY p.schemaname, p.tablename, p.policyname;
    `;
    const res = await executeQuery(connectionString, sql, [schema || null, table || null]);
    return res.rows;
  });
}

export async function fetchPostgresRoles(connectionString: string) {
  return withPgClientRead(connectionString, "postgres roles", async (executeQuery) => {
    const sql = `
      SELECT rolname AS name
      FROM pg_roles
      WHERE rolname !~ '^pg_'
      ORDER BY rolname;
    `;
    const res = await executeQuery(connectionString, sql);
    const roles = res.rows
      .map((row: any) => String(row.name || "").trim())
      .filter(Boolean);
    return roles;
  });
}

export async function deleteIndex(connectionString: string, schema: string, name: string) {
  return withPgClientWrite(connectionString, "delete index", "Index management is supported only for PostgreSQL connections.", async (executeQuery) => {
    const sql = `DROP INDEX "${schema}"."${name}";`;
    await executeQuery(connectionString, sql);
  });
}

async function createIndex(
  connectionString: string,
  schema: string,
  table: string,
  name: string,
  columns: string[],
  unique: boolean = false,
  method: string = 'btree'
) {
  return withPgClientWrite(connectionString, "create index", "Index management is supported only for PostgreSQL connections.", async (executeQuery) => {
    const columnsStr = columns.map(c => `"${c}"`).join(', ');
    const uniqueStr = unique ? 'UNIQUE ' : '';
    const ALLOWED_METHODS = ['btree', 'hash', 'gin', 'gist', 'spgist', 'brin', 'bloom', 'hypopg'];
    const safeMethod = ALLOWED_METHODS.includes(method.toLowerCase()) ? method.toLowerCase() : 'btree';
    const sql = `CREATE ${uniqueStr}INDEX "${name}" ON "${schema}"."${table}" USING ${safeMethod} (${columnsStr});`;
    await executeQuery(connectionString, sql);
  });
}

export async function fetchSessions(connectionString: string) {
  return withPgClientRead(connectionString, "sessions", async (executeQuery) => {
    const sql = `
      SELECT
        pid,
        datname AS database,
        usename AS username,
        application_name,
        client_addr,
        client_port,
        state,
        query,
        query_start,
        wait_event_type,
        wait_event,
        backend_type,
        state_change
      FROM pg_stat_activity
      WHERE pid <> pg_backend_pid()
        AND datname IS NOT NULL
      ORDER BY query_start DESC NULLS LAST;
    `;
    const res = await executeQuery(connectionString, sql);
    return res.rows;
  });
}

export async function killSession(connectionString: string, pid: number) {
  return withPgClientWrite(connectionString, `kill session ${pid}`, "Session management is supported only for PostgreSQL connections.", async (executeQuery) => {
    const sql = `SELECT pg_terminate_backend($1);`;
    await executeQuery(connectionString, sql, [pid]);
  });
}

export async function cancelSessionQuery(connectionString: string, pid: number) {
  return withPgClientWrite(connectionString, `cancel query on session ${pid}`, "Session management is supported only for PostgreSQL connections.", async (executeQuery) => {
    const sql = `SELECT pg_cancel_backend($1);`;
    await executeQuery(connectionString, sql, [pid]);
  });
}

export async function fetchLocks(connectionString: string) {
  return withPgClientRead(connectionString, "locks", async (executeQuery) => {
    const sql = `
      SELECT
        l.locktype,
        l.database,
        l.relation::regclass AS relation_name,
        l.pid,
        l.mode,
        l.granted,
        l.fastpath,
        l.virtualtransaction,
        l.transactionid,
        l.classid,
        l.objid,
        l.objsubid,
        l.virtualxid,
        l.page,
        l.tuple,
        a.query,
        a.state,
        a.query_start,
        a.application_name,
        a.usename,
        a.client_addr
      FROM pg_locks l
      LEFT JOIN pg_stat_activity a ON a.pid = l.pid
      WHERE a.pid <> pg_backend_pid()
      ORDER BY l.pid, l.locktype, l.relation;
    `;
    const res = await executeQuery(connectionString, sql);
    return res.rows;
  });
}

async function createTrigger(
  connectionString: string,
  schema: string,
  table: string,
  name: string,
  events: string[],
  timing: string,
  orientation: string,
  functionName: string
) {
  return withPgClientWrite(connectionString, "create trigger", "Triggers are supported only for PostgreSQL connections.", async (executeQuery) => {
    const ALLOWED_EVENTS = ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'];
    const validEvents = events.filter(e => ALLOWED_EVENTS.includes(e.toUpperCase()));
    if (validEvents.length === 0) {
      throw new Error('At least one valid trigger event (INSERT, UPDATE, DELETE, TRUNCATE) is required.');
    }
    const ALLOWED_TIMING = ['BEFORE', 'AFTER', 'INSTEAD OF'];
    const safeTiming = ALLOWED_TIMING.includes(timing.toUpperCase()) ? timing.toUpperCase() : 'AFTER';
    const eventsStr = validEvents.join(' OR ');
    const forEachStr = orientation === 'ROW' ? 'FOR EACH ROW' : 'FOR EACH STATEMENT';

    const sql = `
      CREATE TRIGGER "${name}"
      ${safeTiming} ${eventsStr}
      ON "${schema}"."${table}"
      ${forEachStr}
      EXECUTE FUNCTION "${schema}"."${functionName}"();
    `;

    await executeQuery(connectionString, sql);
  });
}
