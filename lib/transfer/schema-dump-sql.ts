/**
 * SQL-native schema dump for connections pg_dump cannot dial
 * (supabase-mgmt:// pointers, etc.). DDL is read out of pg_catalog/
 * information_schema through the normal query path and re-emitted as SQL.
 *
 * Type names come from format_type() server-side, so exotic types survive
 * without client-side mapping. Constraint/table ordering is made safe by
 * emitting ALL tables first, then ALL constraints as ALTER TABLEs.
 */

import { escapeIdent, escapeLiteral, isProgrammableStatement, orderChunksByDependency, parseDataChunks, splitSqlStatements, stripCommentLines } from "./transfer-sql";
import type { QueryFn, TableDependency } from "./transfer-sql";
type Rows = Record<string, unknown>[];

async function select(query: QueryFn, conn: string, sql: string): Promise<Rows> {
  const res = await query(conn, sql);
  if (!res.success) throw new Error(String(res.error ?? "query failed"));
  return res.data?.rows ?? [];
}

function ident(value: unknown): string {
  return escapeIdent(String(value ?? ""));
}

/**
 * Parse a Postgres array literal (e.g. `{public,"role,with,comma"}`) as
 * returned for name[] columns through JSON-based query endpoints, which
 * serialize arrays as strings instead of JS arrays.
 */
export function parsePgArrayLiteral(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== "string") return [];
  const s = value.trim();
  if (!s.startsWith("{") || !s.endsWith("}")) return s ? [s] : [];
  const inner = s.slice(1, -1);
  if (inner.trim() === "") return [];
  const out: string[] = [];
  let current = "";
  let inQuotes = false;
  let i = 0;
  while (i < inner.length) {
    const ch = inner[i];
    if (inQuotes) {
      if (ch === "\\" && i + 1 < inner.length) {
        current += inner[i + 1];
        i += 2;
        continue;
      }
      if (ch === '"') {
        inQuotes = false;
        i++;
        continue;
      }
      current += ch;
      i++;
    } else if (ch === '"') {
      inQuotes = true;
      i++;
    } else if (ch === ",") {
      out.push(current);
      current = "";
      i++;
    } else {
      current += ch;
      i++;
    }
  }
  out.push(current);
  return out;
}

export async function buildSchemaDumpViaSql(
  query: QueryFn,
  connectionString: string,
  schemas: string[],
): Promise<{ sql: string; warnings: string[] }> {
  const parts: string[] = [];
  const warnings: string[] = [];
  const emit = (sql: string) => {
    const trimmed = sql.trim();
    if (trimmed) parts.push(trimmed.endsWith(";") ? trimmed : `${trimmed};`);
  };

  // Extensions (plpgsql is always present; the rest need IF NOT EXISTS so
  // destinations without them fail loudly at import, not silently).
  try {
    const rows = await select(query, connectionString, `SELECT extname FROM pg_extension WHERE extname <> 'plpgsql' ORDER BY 1`);
    for (const row of rows) emit(`CREATE EXTENSION IF NOT EXISTS ${ident(row.extname)}`);
  } catch (error) {
    warnings.push(`Extension list unreadable: ${error instanceof Error ? error.message : String(error)}`);
  }

  for (const schema of schemas) {
    const lit = escapeLiteral(schema);
    emit(`CREATE SCHEMA IF NOT EXISTS ${ident(schema)}`);

    // Custom types BEFORE tables (columns reference them): enums, domains,
    // composites. Anything unmappable warns instead of failing the dump.
    try {
      const enums = await select(
        query,
        connectionString,
        `SELECT t.typname AS name, array_agg(e.enumlabel ORDER BY e.enumsortorder) AS labels
         FROM pg_type t
         JOIN pg_namespace n ON n.oid = t.typnamespace
         JOIN pg_enum e ON e.enumtypid = t.oid
         WHERE n.nspname = ${lit} AND t.typtype = 'e'
         GROUP BY t.typname ORDER BY 1`,
      );
      for (const row of enums) {
        const labels = parsePgArrayLiteral(row.labels);
        if (labels.length === 0) {
          warnings.push(`Enum ${schema}.${String(row.name)} has no labels; skipped.`);
          continue;
        }
        emit(`CREATE TYPE ${ident(schema)}.${ident(row.name)} AS ENUM (${labels.map((l) => escapeLiteral(l)).join(", ")})`);
      }
      const domains = await select(
        query,
        connectionString,
        `SELECT t.typname AS name, format_type(t.typbasetype, t.typtypmod) AS base,
                t.typnotnull AS not_null, t.typdefaultbin IS NOT NULL AS has_default
         FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
         WHERE n.nspname = ${lit} AND t.typtype = 'd' ORDER BY 1`,
      );
      for (const row of domains) {
        let def = `CREATE DOMAIN ${ident(schema)}.${ident(row.name)} AS ${String(row.base)}`;
        if (row.not_null === true || row.not_null === "t") def += " NOT NULL";
        emit(def);
        if (row.has_default === true || row.has_default === "t") {
          warnings.push(`Domain ${schema}.${String(row.name)} has a default that is not migrated; set it manually if needed.`);
        }
      }
      const composites = await select(
        query,
        connectionString,
        // relkind = 'c': standalone composite types ONLY. Every table also
        // owns a typtype='c' rowtype entry (relkind 'r'/'p'/...) — dumping
        // those as CREATE TYPE shadows the real tables and breaks every
        // subsequent ALTER TABLE with "X is a composite type".
        `SELECT t.typname AS name, a.attname AS col, format_type(a.atttypid, a.atttypmod) AS type
         FROM pg_type t
         JOIN pg_class c ON c.oid = t.typrelid
         JOIN pg_namespace n ON n.oid = t.typnamespace
         JOIN pg_attribute a ON a.attrelid = c.oid
         WHERE n.nspname = ${lit} AND t.typtype = 'c' AND c.relkind = 'c' AND a.attnum > 0 AND NOT a.attisdropped
         ORDER BY t.typname, a.attnum`,
      );
      const compByType = new Map<string, string[]>();
      for (const row of composites) {
        const t = String(row.name);
        if (!compByType.has(t)) compByType.set(t, []);
        compByType.get(t)?.push(`${ident(row.col)} ${String(row.type)}`);
      }
      for (const [name, cols] of compByType) {
        emit(`CREATE TYPE ${ident(schema)}.${ident(name)} AS (${cols.join(", ")})`);
      }
    } catch (error) {
      warnings.push(`Custom types unreadable in ${schema}: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Sequences first (serial defaults reference them).
    try {
      const seqs = await select(
        query,
        connectionString,
        `SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema = ${lit} ORDER BY 1`,
      );
      for (const row of seqs) {
        const seqName = String(row.sequence_name);
        emit(`CREATE SEQUENCE IF NOT EXISTS ${ident(schema)}.${ident(seqName)}`);
        try {
          const last = await select(
            query,
            connectionString,
            `SELECT last_value FROM ${ident(schema)}.${ident(seqName)}`,
          );
          const lastValue = Number(last[0]?.last_value);
          if (Number.isFinite(lastValue)) {
            emit(`SELECT pg_catalog.setval('${schema.replace(/'/g, "''")}.${seqName.replace(/'/g, "''")}'::regclass, ${lastValue}, true)`);
          }
        } catch {
          // counter preservation is best-effort
        }
      }
    } catch (error) {
      warnings.push(`Sequences unreadable in ${schema}: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Tables (skip partitions: they are physical slices of a partitioned
    // parent, not standalone tables — re-creating them would duplicate data
    // on load and drop partitioning).
    try {
      const cols = await select(
        query,
        connectionString,
        `SELECT c.relname AS table_name, a.attname AS column_name,
                format_type(a.atttypid, a.atttypmod) AS data_type,
                a.attnotnull AS not_null,
                pg_get_expr(d.adbin, d.adrelid) AS default_value
         FROM pg_attribute a
         JOIN pg_class c ON c.oid = a.attrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
         WHERE n.nspname = ${lit} AND c.relkind IN ('r', 'p')
           AND a.attnum > 0 AND NOT a.attisdropped AND NOT c.relispartition
         ORDER BY c.relname, a.attnum`,
      );
      const byTable = new Map<string, Rows>();
      for (const row of cols) {
        const t = String(row.table_name);
        if (!byTable.has(t)) byTable.set(t, []);
        byTable.get(t)?.push(row);
      }
      for (const [table, columns] of byTable) {
        // IF NOT EXISTS: drops-first design means a hit here is always an
        // anomaly (double execution, leftover state) — proceeding lets the
        // subsequent constraint/data steps validate shape honestly instead
        // of dying on the first table.
        const defs = columns.map((c) => {
          let def = `${ident(c.column_name)} ${String(c.data_type)}`;
          if (c.default_value != null && String(c.default_value) !== "") def += ` DEFAULT ${String(c.default_value)}`;
          if (c.not_null === true || c.not_null === "t" || c.not_null === "true") def += " NOT NULL";
          return def;
        });
        emit(`CREATE TABLE IF NOT EXISTS ${ident(schema)}.${ident(table)} (\n  ${defs.join(",\n  ")}\n)`);
      }
    } catch (error) {
      warnings.push(`Tables unreadable in ${schema}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }

    // Constraints as ALTERs (order-safe): PK, unique, check, FK.
    try {
      const pks = await select(
        query,
        connectionString,
        `SELECT tc.table_name, tc.constraint_name, kcu.column_name, kcu.ordinal_position
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
         WHERE tc.table_schema = ${lit} AND tc.constraint_type = 'PRIMARY KEY'
         ORDER BY tc.table_name, kcu.ordinal_position`,
      );
      const pkByTable = new Map<string, { name: string; cols: string[] }>();
      for (const row of pks) {
        const t = String(row.table_name);
        if (!pkByTable.has(t)) pkByTable.set(t, { name: String(row.constraint_name), cols: [] });
        pkByTable.get(t)?.cols.push(String(row.column_name));
      }
      for (const [table, pk] of pkByTable) {
        emit(`ALTER TABLE ${ident(schema)}.${ident(table)} ADD CONSTRAINT ${ident(pk.name)} PRIMARY KEY (${pk.cols.map(ident).join(", ")})`);
      }
    } catch (error) {
      warnings.push(`Primary keys unreadable in ${schema}: ${error instanceof Error ? error.message : String(error)}`);
    }

    for (const contype of ["u", "c", "f"] as const) {
      try {
        // Referenced schemas included: pg_get_constraintdef text is only
        // valid on the destination when every schema it names migrates too.
        // Constraints pointing at excluded schemas (Supabase auth.*, ...)
        // are skipped with an explicit warning instead of failing the import.
        const rows = await select(
          query,
          connectionString,
          `SELECT c.relname AS table_name, con.conname AS name, pg_get_constraintdef(con.oid) AS def,
                  (SELECT n2.nspname FROM pg_class c2 JOIN pg_namespace n2 ON n2.oid = c2.relnamespace WHERE c2.oid = con.confrelid) AS ref_schema
           FROM pg_constraint con
           JOIN pg_class c ON c.oid = con.conrelid
           JOIN pg_namespace n ON n.oid = con.connamespace
           WHERE n.nspname = ${lit} AND con.contype = '${contype}'`,
        );
        for (const row of rows) {
          const refSchema = row.ref_schema != null ? String(row.ref_schema) : null;
          if (refSchema && !schemas.includes(refSchema)) {
            warnings.push(
              `Constraint ${schema}.${String(row.table_name)}.${String(row.name)} references excluded schema "${refSchema}" — skipped; enforce it manually if needed.`,
            );
            continue;
          }
          emit(`ALTER TABLE ${ident(schema)}.${ident(row.table_name)} ADD CONSTRAINT ${ident(row.name)} ${String(row.def)}`);
        }
      } catch (error) {
        warnings.push(`Constraints unreadable in ${schema}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // Pure indexes (constraint-backed ones already emitted above).
    try {
      const rows = await select(
        query,
        connectionString,
        `SELECT pg_get_indexdef(i.indexrelid) AS def
         FROM pg_index i
         JOIN pg_class c ON c.oid = i.indrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = ${lit} AND NOT i.indisprimary
           AND i.indexrelid NOT IN (SELECT conindid FROM pg_constraint WHERE conindid <> 0)`,
      );
      for (const row of rows) {
        const def = String(row.def);
        // Same IF NOT EXISTS rationale as CREATE TABLE above.
        emit(
          def.replace(
            /^(\s*CREATE\s+(?:UNIQUE\s+)?INDEX\s+)/i,
            (prefix: string) => (/\bIF\s+NOT\s+EXISTS\b/i.test(def) ? prefix : `${prefix}IF NOT EXISTS `),
          ),
        );
      }
    } catch (error) {
      warnings.push(`Indexes unreadable in ${schema}: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Views.
    try {
      const rows = await select(
        query,
        connectionString,
        `SELECT viewname, definition FROM pg_views WHERE schemaname = ${lit}`,
      );
      for (const row of rows) emit(`CREATE OR REPLACE VIEW ${ident(schema)}.${ident(row.viewname)} AS ${String(row.definition)}`);
      const mats = await select(
        query,
        connectionString,
        `SELECT matviewname, definition FROM pg_matviews WHERE schemaname = ${lit}`,
      );
      for (const row of mats) {
        emit(`CREATE MATERIALIZED VIEW ${ident(schema)}.${ident(row.matviewname)} AS ${String(row.definition)} WITH NO DATA`);
        warnings.push(`Materialized view ${schema}.${String(row.matviewname)} migrates WITHOUT data.`);
      }
    } catch (error) {
      warnings.push(`Views unreadable in ${schema}: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Functions (before triggers, which reference them).
    try {
      const rows = await select(
        query,
        connectionString,
        `SELECT pg_get_functiondef(p.oid) AS def
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = ${lit} AND p.prokind IN ('f', 'p', 'w')`,
      );
      for (const row of rows) emit(String(row.def));
    } catch (error) {
      warnings.push(`Functions unreadable in ${schema}: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Triggers.
    try {
      const rows = await select(
        query,
        connectionString,
        `SELECT pg_get_triggerdef(t.oid) AS def
         FROM pg_trigger t
         JOIN pg_class c ON c.oid = t.tgrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = ${lit} AND NOT t.tgisinternal`,
      );
      for (const row of rows) emit(String(row.def));
    } catch (error) {
      warnings.push(`Triggers unreadable in ${schema}: ${error instanceof Error ? error.message : String(error)}`);
    }

    // RLS.
    try {
      const rlsTables = await select(
        query,
        connectionString,
        `SELECT c.relname AS table_name FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = ${lit} AND c.relkind = 'r' AND c.relrowsecurity`,
      );
      for (const row of rlsTables) {
        emit(`ALTER TABLE ${ident(schema)}.${ident(row.table_name)} ENABLE ROW LEVEL SECURITY`);
      }
      const policies = await select(
        query,
        connectionString,
        `SELECT c.relname AS table_name, p.polname AS name, p.polcmd AS cmd,
                p.polpermissive AS permissive,
                COALESCE((SELECT array_agg(r.rolname) FROM pg_roles r WHERE r.oid = ANY (p.polroles)), ARRAY[]::name[]) AS roles,
                pg_get_expr(p.polqual, p.polrelid) AS qual,
                pg_get_expr(p.polwithcheck, p.polrelid) AS with_check
         FROM pg_policy p
         JOIN pg_class c ON c.oid = p.polrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = ${lit}`,
      );
      const cmdMap: Record<string, string> = { r: "SELECT", a: "INSERT", w: "UPDATE", d: "DELETE", "*": "ALL" };
      for (const row of policies) {
        const roles = parsePgArrayLiteral(row.roles);
        const toClause = roles.length === 0 ? "PUBLIC" : roles.map((r) => (r === "public" ? "PUBLIC" : ident(r))).join(", ");
        let stmt = `CREATE POLICY ${ident(row.name)} ON ${ident(schema)}.${ident(row.table_name)}`;
        if (row.permissive === false || row.permissive === "f") stmt += " AS RESTRICTIVE";
        stmt += ` FOR ${cmdMap[String(row.cmd)] ?? "ALL"} TO ${toClause}`;
        if (row.qual != null) stmt += ` USING (${String(row.qual)})`;
        if (row.with_check != null) stmt += ` WITH CHECK (${String(row.with_check)})`;
        emit(stmt);
      }
    } catch (error) {
      warnings.push(`RLS unreadable in ${schema}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { sql: parts.join("\n"), warnings };
}

/**
 * Apply drops + schema + FK-ordered row data through a plain query
 * function (connections with no direct pg-client path, e.g.
 * supabase-mgmt://). There is NO cross-statement transaction here — the
 * management query endpoint executes statement by statement — so callers
 * must disclose that a mid-apply failure can leave a partial destination.
 */
export async function applyTransferViaQuery(
  query: QueryFn,
  connectionString: string,
  dropStatements: string[],
  schemaSql: string,
  dataSql?: string,
): Promise<{ appliedStatements: number; warnings: string[] }> {
  const warnings: string[] = [];
  let applied = 0;

  for (const stmt of dropStatements) {
    const res = await query(connectionString, stmt);
    if (!res.success) {
      throw new Error(`Drop failed, aborting before apply: ${String(res.error ?? "unknown error")}`);
    }
    applied++;
  }

  for (const stmt of splitSqlStatements(schemaSql)) {
    const executable = stripCommentLines(stmt);
    if (!executable) continue;
    if (isProgrammableStatement(executable)) {
      // Best-effort with one retry (ordering): failures warn, never throw.
      // Structural failures below still abort — the destination may then be
      // partial, which the error text discloses.
      let res = await query(connectionString, executable);
      if (!res.success) res = await query(connectionString, executable);
      if (!res.success) {
        warnings.push(
          `Skipped programmable object (${String(res.error ?? "unknown error").slice(0, 200)}): ${executable.replace(/\s+/g, " ").slice(0, 160)}`,
        );
      } else {
        applied++;
      }
      continue;
    }
    const res = await query(connectionString, executable);
    if (!res.success) {
      throw new Error(
        `Schema apply failed (destination may be PARTIALLY modified — no transaction support over this connection): ${String(res.error ?? "unknown error")}`,
      );
    }
    applied++;
  }

  if (dataSql) {
    const chunks = parseDataChunks(dataSql);
    // FK edges read live from the destination (schema just applied).
    const fkRes = await query(
      connectionString,
      `SELECT tc.table_schema AS schema, tc.table_name AS tbl,
              ccu.table_schema AS ref_schema, ccu.table_name AS ref_table
       FROM information_schema.table_constraints AS tc
       JOIN information_schema.key_column_usage AS kcu
         ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
       JOIN information_schema.constraint_column_usage AS ccu
         ON ccu.constraint_name = tc.constraint_name
       WHERE tc.constraint_type = 'FOREIGN KEY'`,
    );
    const seen = new Set<string>();
    const deps: TableDependency[] = [];
    if (fkRes.success) {
      for (const row of fkRes.data?.rows ?? []) {
        const dep = {
          schema: String((row as Record<string, unknown>).schema),
          table: String((row as Record<string, unknown>).tbl),
          refSchema: String((row as Record<string, unknown>).ref_schema),
          refTable: String((row as Record<string, unknown>).ref_table),
        };
        const k = `${dep.schema}.${dep.table}->${dep.refSchema}.${dep.refTable}`;
        if (!seen.has(k)) {
          seen.add(k);
          deps.push(dep);
        }
      }
    } else {
      warnings.push(`FK ordering unavailable (${String(fkRes.error ?? "query failed")}); data loads in export order.`);
    }
    for (const chunk of orderChunksByDependency(chunks, deps)) {
      const res = await query(connectionString, chunk.sql);
      if (!res.success) {
        const where = chunk.table ? `${chunk.schema}.${chunk.table}` : "unmarked statements";
        throw new Error(
          `Data import failed for ${where} (destination may be PARTIALLY modified — no transaction support over this connection): ${String(res.error ?? "unknown error")}`,
        );
      }
      applied++;
    }
  }

  return { appliedStatements: applied, warnings };
}

/**
 * Probe every CREATE EXTENSION statement against the destination BEFORE
 * the transactional import: platforms reject some extensions outright
 * (Neon: pg_cron only in the `postgres` database; supabase_vault not
 * allow-listed at all), and one rejected statement would roll back the
 * ENTIRE transfer. Un-creatable extensions are commented out with the
 * reason recorded — everything else still imports atomically.
 */
export async function sanitizeExtensionsForDestination(
  query: QueryFn,
  connectionString: string,
  schemaSql: string,
): Promise<{ sql: string; warnings: string[] }> {
  const warnings: string[] = [];
  const kept: string[] = [];
  // The splitter consumes statement terminators, so every kept code chunk
  // must be re-terminated on rejoin — otherwise consecutive statements
  // fuse into one and the destination reports a syntax error at the
  // second CREATE. (Pure comment blocks need no terminator.)
  const reterminate = (chunk: string): string => {
    if (!stripCommentLines(chunk)) return chunk;
    return chunk.trimEnd().endsWith(";") ? chunk : `${chunk};`;
  };
  for (const stmt of splitSqlStatements(schemaSql)) {
    const executable = stripCommentLines(stmt);
    if (!executable) {
      kept.push(stmt);
      continue;
    }
    const extMatch = /^\s*CREATE\s+EXTENSION\s+(?:IF\s+NOT\s+EXISTS\s+)?("?(?:[^"\s;]+)"?)/i.exec(executable);
    if (!extMatch) {
      kept.push(reterminate(stmt));
      continue;
    }
    const extName = extMatch[1].replace(/^"|"$/g, "");
    const probe = await query(connectionString, executable);
    if (probe.success) {
      kept.push(reterminate(stmt));
    } else {
      const reason = String(probe.error ?? "not supported").slice(0, 200);
      warnings.push(
        `Extension "${extName}" skipped: destination rejected it (${reason}). Objects depending on it may fail — enable it manually if needed.`,
      );
      kept.push(`-- SKIPPED EXTENSION (destination rejected: ${reason}):\n-- ${executable.split("\n").join("\n-- ")}`);
    }
  }
  return { sql: kept.join("\n"), warnings };
}
