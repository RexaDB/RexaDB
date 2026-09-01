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
            q = q.replace(new RegExp(`\\$${i + 1}\\b`, "g"), escaped);
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
            q = q.replace(new RegExp(`\\$${i + 1}\\b`, "g"), escaped);
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

function asRecord(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function mapSupabaseAuthUserOption(row: any) {
  const rawUserMetaData = asRecord(row?.raw_user_meta_data ?? row?.rawUserMetaData);
  const rawAppMetaData = asRecord(row?.raw_app_meta_data ?? row?.rawAppMetaData);
  const displayName =
    (typeof rawUserMetaData.full_name === "string" && rawUserMetaData.full_name.trim()) ||
    (typeof rawUserMetaData.name === "string" && rawUserMetaData.name.trim()) ||
    (typeof rawUserMetaData.display_name === "string" && rawUserMetaData.display_name.trim()) ||
    (typeof row?.email === "string" ? row.email.split("@")[0] : "") ||
    String(row?.id || "").trim();

  const providers = String(row?.identities || row?.providers || "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

  return {
    id: String(row?.id || "").trim(),
    displayName: displayName || String(row?.id || "").trim(),
    email: typeof row?.email === "string" ? row.email : null,
    phone: typeof row?.phone === "string" ? row.phone : null,
    role: String(row?.role || "authenticated").trim() || "authenticated",
    providers,
    createdAt: row?.created_at ? String(row.created_at) : null,
    rawAppMetaData,
    rawUserMetaData,
  };
}

export async function fetchSupabaseAuthUsers(connectionString: string) {
  return withPgClientRead(connectionString, "supabase auth users", async (executeQuery) => {
    const dbType = detectConnectionDbType(connectionString);

    // For Supabase management connections the Management API's /database/query
    // endpoint can be strict about GROUP BY / string_agg. Use small
    // compatible queries and merge providers client-side. This also avoids the
    // `column must appear in GROUP BY` error that hid all users on some projects.
    const simpleUsersSql = `
      SELECT
        u.id::text AS id,
        u.email,
        u.phone,
        u.role,
        u.created_at,
        u.raw_app_meta_data,
        u.raw_user_meta_data
      FROM auth.users u
      ORDER BY u.created_at DESC
      LIMIT 500
    `;

    const simpleUsersSqlWithPwd = `
      SELECT
        u.id::text AS id,
        u.email,
        u.phone,
        u.role,
        u.created_at,
        u.raw_app_meta_data,
        u.raw_user_meta_data,
        u.encrypted_password
      FROM auth.users u
      ORDER BY u.created_at DESC
      LIMIT 500
    `;

    const tryFetchViaSql = async (): Promise<any[] | null> => {
      let rows: any[] = [];
      let hadEncryptedPassword = false;
      try {
        // Prefer the simpler column list (more compatible). Fall back to including encrypted_password
        // if the base query fails for an unexpected reason and the pwd-including variant succeeds.
        try {
          const res = await executeQuery(connectionString, simpleUsersSql);
          rows = Array.isArray(res?.rows) ? res.rows : [];
        } catch (firstErr: any) {
          const msg = String(firstErr?.message ?? "");
          // If the simple query failed due to something other than column issues, also try pwd variant
          // before bubbling up — the pwd variant may succeed on older Supabase schemas that expect it.
          try {
            const res2 = await executeQuery(connectionString, simpleUsersSqlWithPwd);
            rows = Array.isArray(res2?.rows) ? res2.rows : [];
            hadEncryptedPassword = true;
          } catch {
            throw firstErr;
          }
        }
        // If we used the pwd-less query, also attempt to infer email provider from encrypted_password
        // by fetching that one column separately (best-effort, ignore failures).
        let pwdMap = new Map<string, boolean>();
        if (!hadEncryptedPassword) {
          try {
            const pwdRes = await executeQuery(connectionString, `SELECT id::text AS id, (encrypted_password IS NOT NULL) AS has_pwd FROM auth.users`);
            for (const r of (Array.isArray(pwdRes?.rows) ? pwdRes.rows : [])) {
              const uid = String((r as any)?.id ?? "").trim();
              if (!uid) continue;
              pwdMap.set(uid, Boolean((r as any)?.has_pwd));
            }
          } catch {
            // ignore
          }
        }
        // Best-effort enrichment from auth.identities (ignore if that table is empty / permission denied)
        let providerMap = new Map<string, string[]>();
        try {
          const idRes = await executeQuery(connectionString, `SELECT user_id::text AS user_id, provider FROM auth.identities`);
          for (const r of (Array.isArray(idRes?.rows) ? idRes.rows : [])) {
            const uid = String((r as any)?.user_id ?? "").trim();
            const prov = String((r as any)?.provider ?? "").trim();
            if (!uid || !prov) continue;
            const arr = providerMap.get(uid) ?? [];
            if (!arr.includes(prov)) arr.push(prov);
            providerMap.set(uid, arr);
          }
        } catch {
          // ignore identities fetch failure — fall back to encrypted_password / empty
        }
        const enriched = rows.map((row: any) => {
          const uid = String(row.id ?? "").trim();
          const providersFromIdentities = providerMap.get(uid) ?? [];
          const hasPwd = hadEncryptedPassword ? Boolean(row.encrypted_password) : (pwdMap.get(uid) ?? false);
          const derived =
            providersFromIdentities.length > 0
              ? providersFromIdentities.join(", ")
              : hasPwd
                ? "email"
                : "";
          return { ...row, identities: derived };
        });
        const mapped = enriched.map(mapSupabaseAuthUserOption).filter((u: { id: string }) => Boolean(u.id));
        return mapped;
      } catch (e: any) {
        // Let caller decide fallback
        throw e;
      }
    };

    // Supabase management: try SQL first, then fall back to Management/GoTrue Admin APIs
    if (dbType === "supabase-mgmt") {
      try {
        const viaSql = await tryFetchViaSql();
        if (viaSql && viaSql.length > 0) return viaSql;
        // SQL succeeded but returned 0 rows — could be RLS / empty or query was routed incorrectly.
        // Still attempt the Admin API fallback to avoid showing "No auth.users found" when users exist.
        const viaAdmin = await fetchSupabaseAuthUsersViaMgmtAdmin(connectionString);
        if (viaAdmin && viaAdmin.length > 0) return viaAdmin;
        // Return whatever SQL gave (empty) if admin also empty
        return viaSql ?? [];
      } catch (sqlErr: any) {
        const viaAdmin = await fetchSupabaseAuthUsersViaMgmtAdmin(connectionString);
        if (viaAdmin && viaAdmin.length > 0) return viaAdmin;
        // Re-throw original SQL error so withPgClientRead surfaces it and the UI can log it
        throw sqlErr;
      }
    }

    // Direct Postgres: simple query is sufficient and more robust than the old string_agg
    const viaSql = await tryFetchViaSql();
    if (viaSql) return viaSql;

    // Final fallback to the legacy grouped query (should rarely be needed)
    const legacySql = `
      SELECT
        u.id::text AS id,
        u.email,
        u.phone,
        u.role,
        u.created_at,
        u.raw_app_meta_data,
        u.raw_user_meta_data,
        COALESCE(
          string_agg(DISTINCT i.provider, ', ') FILTER (WHERE i.provider IS NOT NULL),
          CASE
            WHEN u.encrypted_password IS NOT NULL THEN 'email'
            ELSE NULL
          END
        ) AS identities
      FROM auth.users u
      LEFT JOIN auth.identities i ON i.user_id = u.id
      GROUP BY u.id
      ORDER BY u.created_at DESC
      LIMIT 500
    `;
    const res = await executeQuery(connectionString, legacySql);
    return (res.rows || [])
      .map(mapSupabaseAuthUserOption)
      .filter((user: { id: string }) => Boolean(user.id));
  });
}

async function fetchSupabaseAuthUsersViaMgmtAdmin(connectionString: string): Promise<any[] | null> {
  try {
    const { parseSupabaseMgmtConnectionString } = await import("./supabase-mgmt-client");
    const parsed = parseSupabaseMgmtConnectionString(connectionString);
    if (!parsed) return null;
    const { token, projectRef } = parsed;

    // 1) Try via GoTrue Admin API using the service_role key fetched from the Management API.
    // GET /v1/projects/{ref}/api-keys lists the project's API keys; the service_role can then
    // call https://<ref>.supabase.co/auth/v1/admin/users. This bypasses database/query ACLs.
    try {
      const apiKeysRes = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/api-keys`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (apiKeysRes.ok) {
        const keys = await apiKeysRes.json().catch(() => null);
        const list: any[] = Array.isArray(keys) ? keys : Array.isArray((keys as any)?.data) ? (keys as any).data : [];
        const serviceRole = list.find((k: any) => String(k?.name ?? k?.type ?? "").toLowerCase().includes("service_role") || String(k?.api_key ?? k?.apiKey ?? "").length > 40)?.api_key ?? list.find((k: any) => typeof k?.api_key === "string" && k.api_key.startsWith("eyJ"))?.api_key ?? null;
        const anonKey = list.find((k: any) => String(k?.name ?? "").toLowerCase().includes("anon"))?.api_key ?? null;
        // Fallback: keys may be returned as { api_keys: [...] }
        const fallbackKeys = (keys as any)?.api_keys ?? (keys as any)?.apiKeys ?? [];
        let resolvedServiceRole: string | null = serviceRole;
        if (!resolvedServiceRole && Array.isArray(fallbackKeys)) {
          const sr = fallbackKeys.find((k: any) => String(k?.name ?? "").toLowerCase().includes("service"));
          if (sr?.api_key) resolvedServiceRole = sr.api_key;
        }

        if (resolvedServiceRole) {
          // Call the project's GoTrue admin API: https://<ref>.supabase.co/auth/v1/admin/users
          // The Management API token itself is NOT valid there — only the service_role is.
          const projectUrl = `https://${projectRef}.supabase.co`;
          const adminRes = await fetch(`${projectUrl}/auth/v1/admin/users?page=1&per_page=100`, {
            headers: {
              apikey: resolvedServiceRole,
              Authorization: `Bearer ${resolvedServiceRole}`,
            },
          });
          if (adminRes.ok) {
            const payload = await adminRes.json().catch(() => null);
            const users: any[] = Array.isArray(payload?.users) ? payload.users : Array.isArray(payload) ? payload : [];
            if (users.length > 0) {
              // Map GoTrue admin shape to our SupabaseAuthUserOption shape via the same mapper:
              // GoTrue returns { id, email, phone, role, created_at, app_metadata, user_metadata, identities: [{provider}] }
              return users
                .map((u: any) => ({
                  id: String(u.id ?? "").trim(),
                  email: u.email ?? null,
                  phone: u.phone ?? null,
                  role: String(u.role ?? "authenticated"),
                  created_at: u.created_at ?? null,
                  raw_app_meta_data: u.app_metadata ?? u.raw_app_meta_data ?? {},
                  raw_user_meta_data: u.user_metadata ?? u.raw_user_meta_data ?? {},
                  identities: Array.isArray(u.identities) ? u.identities.map((i: any) => i.provider).join(", ") : u.identities ?? "",
                }))
                .map(mapSupabaseAuthUserOption)
                .filter((x: { id: string }) => Boolean(x.id));
            }
          }
        }
      }
    } catch {
      // ignore and try DB fallback already attempted
    }

    // 2) Last resort: try a read-only database/query variant explicitly (some projects only allow read-only)
    try {
      const roRes = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "User-Agent": "supabase-cli",
        },
        body: JSON.stringify({ query: `SELECT id::text AS id, email, phone, role, created_at, raw_app_meta_data, raw_user_meta_data FROM auth.users ORDER BY created_at DESC LIMIT 500` }),
      });
      if (roRes.ok) {
        const rows = await roRes.json().catch(() => []);
        const list: any[] = Array.isArray(rows) ? rows : (rows as any)?.rows ?? [];
        if (list.length > 0) {
          return list
            .map((row: any) => ({ ...row, identities: "" }))
            .map(mapSupabaseAuthUserOption)
            .filter((x: { id: string }) => Boolean(x.id));
        }
      }
    } catch {
      // ignore
    }

    return null;
  } catch {
    return null;
  }
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
