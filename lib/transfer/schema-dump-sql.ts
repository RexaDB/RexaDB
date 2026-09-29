/**
 * SQL-native schema dump for connections pg_dump cannot dial
 * (supabase-mgmt:// pointers, etc.). DDL is read out of pg_catalog/
 * information_schema through the normal query path and re-emitted as SQL.
 *
 * Type names come from format_type() server-side, so exotic types survive
 * without client-side mapping. Constraint/table ordering is made safe by
 * emitting ALL tables first, then ALL constraints as ALTER TABLEs — with
 * foreign keys deferred until every schema's tables exist, so cross-schema
 * references never apply before their target table.
 */

import { applyChunkResiliently, escapeIdent, escapeLiteral, isProgrammableStatement, isSecurityCriticalProgrammable, orderChunksByDependency, parseDataChunks, shortStatement, splitSqlStatements, stripCommentLines } from "./transfer-sql";
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
  // Emission order across the whole dump: schemas/types/sequences first,
  // then functions (table defaults and generated expressions can call
  // them — including cross-schema), then ALL tables, then partitions
  // (topologically parent-before-child), then dependent objects (PKs,
  // constraints, indexes, views, triggers, RLS/policies), then foreign
  // keys last. Function bodies are not validated against tables at CREATE
  // time, and function-apply failures degrade to warnings at import while
  // CREATE TABLE failures abort — so functions-before-tables is the safe
  // direction for the one ordering we cannot satisfy both ways.
  const pendingFk: string[] = [];
  type PendingPartition = {
    schema: string;
    table: string;
    parentSchema: string;
    parentTable: string;
    bound: string;
    partkey: string;
  };
  const pendingPartitions: PendingPartition[] = [];
  const pendingDependents: string[] = [];
  const pendingTables: string[] = [];
  const pendingFunctions: string[] = [];
  const emit = (sql: string) => {
    const trimmed = sql.trim();
    if (trimmed) parts.push(trimmed.endsWith(";") ? trimmed : `${trimmed};`);
  };
  const defer = (sql: string) => {
    const trimmed = sql.trim();
    if (trimmed) pendingDependents.push(trimmed.endsWith(";") ? trimmed : `${trimmed};`);
  };
  const buffer = (list: string[], sql: string) => {
    const trimmed = sql.trim();
    if (trimmed) list.push(trimmed.endsWith(";") ? trimmed : `${trimmed};`);
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

    // Tables (skip partitions: they are emitted below as PARTITION OF their
    // parent so the destination keeps its partition structure).
    try {
      const cols = await select(
        query,
        connectionString,
        `SELECT c.relname AS table_name, c.relkind AS kind,
                pg_get_partkeydef(c.oid) AS partkey,
                a.attname AS column_name,
                format_type(a.atttypid, a.atttypmod) AS data_type,
                a.attnotnull AS not_null,
                a.attidentity AS identity,
                a.attgenerated AS generated,
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
          const identity = String(c.identity ?? "");
          const generated = String(c.generated ?? "");
          const defaultValue = c.default_value != null ? String(c.default_value) : "";
          if (generated === "s" && defaultValue !== "") {
            // Stored generated column: the "default" is the generation
            // expression, not a DEFAULT clause.
            def += ` GENERATED ALWAYS AS (${defaultValue}) STORED`;
          } else if (identity === "a") {
            def += " GENERATED ALWAYS AS IDENTITY";
          } else if (identity === "d") {
            def += " GENERATED BY DEFAULT AS IDENTITY";
          } else if (defaultValue !== "") {
            def += ` DEFAULT ${defaultValue}`;
          }
          if (c.not_null === true || c.not_null === "t" || c.not_null === "true") def += " NOT NULL";
          return def;
        });
        const first = columns[0];
        const partkey = first?.partkey != null ? String(first.partkey) : "";
        const isPartitioned = String(first?.kind ?? "") === "p" && partkey !== "";
        buffer(pendingTables, `CREATE TABLE IF NOT EXISTS ${ident(schema)}.${ident(table)} (\n  ${defs.join(",\n  ")}\n)${isPartitioned ? ` PARTITION BY ${partkey}` : ""}`);
      }
      // Partitions: buffered (see pendingPartitions) so they emit after
      // every schema's tables exist, ordered parent-before-child. The
      // partition key is captured too: a partition that is itself
      // partitioned must keep PARTITION BY or it becomes a leaf and its
      // own subpartitions fail to create.
      try {
        const partitions = await select(
          query,
          connectionString,
          `SELECT c.relname AS table_name, c.relkind AS kind,
                  pg_get_partkeydef(c.oid) AS partkey,
                  pn.nspname AS parent_schema, pc.relname AS parent_table,
                  pg_get_expr(c.relpartbound, c.oid) AS bound
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
           JOIN pg_inherits i ON i.inhrelid = c.oid
           JOIN pg_class pc ON pc.oid = i.inhparent
           JOIN pg_namespace pn ON pn.oid = pc.relnamespace
           WHERE n.nspname = ${lit} AND c.relispartition
           ORDER BY c.relname`,
        );
        for (const p of partitions) {
          const parentSchema = String(p.parent_schema ?? "");
          if (parentSchema && !schemas.includes(parentSchema)) {
            warnings.push(
              `Partition ${schema}.${String(p.table_name)} belongs to excluded parent "${parentSchema}.${String(p.parent_table)}" — skipped.`,
            );
            continue;
          }
          pendingPartitions.push({
            schema,
            table: String(p.table_name),
            parentSchema: parentSchema || schema,
            parentTable: String(p.parent_table),
            bound: String(p.bound),
            partkey: p.partkey != null ? String(p.partkey) : "",
          });
        }
      } catch (error) {
        warnings.push(`Partitions unreadable in ${schema}: ${error instanceof Error ? error.message : String(error)}`);
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
        defer(`ALTER TABLE ${ident(schema)}.${ident(table)} ADD CONSTRAINT ${ident(pk.name)} PRIMARY KEY (${pk.cols.map(ident).join(", ")})`);
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
          const alter = `ALTER TABLE ${ident(schema)}.${ident(row.table_name)} ADD CONSTRAINT ${ident(row.name)} ${String(row.def)}`;
          if (contype === "f") {
            // Deferred: emitted after every schema's tables exist so
            // cross-schema references never run before their target table.
            pendingFk.push(alter);
          } else {
            defer(alter);
          }
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
        defer(
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
      for (const row of rows) defer(`CREATE OR REPLACE VIEW ${ident(schema)}.${ident(row.viewname)} AS ${String(row.definition)}`);
      const mats = await select(
        query,
        connectionString,
        `SELECT matviewname, definition FROM pg_matviews WHERE schemaname = ${lit}`,
      );
      for (const row of mats) {
        defer(`CREATE MATERIALIZED VIEW ${ident(schema)}.${ident(row.matviewname)} AS ${String(row.definition)} WITH NO DATA`);
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
      for (const row of rows) buffer(pendingFunctions, String(row.def));
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
      for (const row of rows) defer(String(row.def));
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
        defer(`ALTER TABLE ${ident(schema)}.${ident(row.table_name)} ENABLE ROW LEVEL SECURITY`);
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
        defer(stmt);
      }
    } catch (error) {
      warnings.push(`RLS unreadable in ${schema}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Flush order: functions (table defaults may call them) → tables →
  // partitions (parent-before-child) → dependents → foreign keys last.
  for (const stmt of pendingFunctions) emit(stmt);
  for (const stmt of pendingTables) emit(stmt);
  {
    const key = (s: string, t: string) => `${s}.${t}`;
    const pendingKeys = new Set(pendingPartitions.map((p) => key(p.schema, p.table)));
    const emitted = new Set<string>();
    let remaining = [...pendingPartitions];
    while (remaining.length > 0) {
      let progressed = false;
      const next: PendingPartition[] = [];
      for (const p of remaining) {
        const parentKey = key(p.parentSchema, p.parentTable);
        if (!pendingKeys.has(parentKey) || emitted.has(parentKey)) {
          const subPartitioned = p.partkey !== "" && String(p.bound ?? "") !== "";
          emit(
            `CREATE TABLE IF NOT EXISTS ${ident(p.schema)}.${ident(p.table)} PARTITION OF ${ident(p.parentSchema)}.${ident(p.parentTable)} FOR VALUES ${p.bound}${subPartitioned ? ` PARTITION BY ${p.partkey}` : ""}`,
          );
          emitted.add(key(p.schema, p.table));
          progressed = true;
        } else {
          next.push(p);
        }
      }
      if (!progressed) {
        for (const p of next) {
          warnings.push(
            `Partition ${p.schema}.${p.table} emitted without confirmed parent ${p.parentSchema}.${p.parentTable} — verify it manually if the import fails.`,
          );
          const subPartitioned = p.partkey !== "" && String(p.bound ?? "") !== "";
          emit(
            `CREATE TABLE IF NOT EXISTS ${ident(p.schema)}.${ident(p.table)} PARTITION OF ${ident(p.parentSchema)}.${ident(p.parentTable)} FOR VALUES ${p.bound}${subPartitioned ? ` PARTITION BY ${p.partkey}` : ""}`,
          );
        }
        break;
      }
      remaining = next;
    }
  }

  for (const stmt of pendingDependents) emit(stmt);

  // Deferred foreign keys: every table and partition now exists, so
  // cross-schema references apply cleanly.
  for (const alter of pendingFk) emit(alter);

  return { sql: parts.join("\n"), warnings };
}

/**
 * Bare function/procedure name from a CREATE statement, lowercased.
 * Quote-aware: `"my schema".my_func(...)` → `my_func` (never a schema
 * fragment), `public."Camel"` → `camel`. Returns null when unparseable.
 */
export function bareFunctionName(def: string): string | null {
  const m = /CREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE)\s+([^(\s][^(]*?)\s*\(/i.exec(def);
  if (!m) return null;
  const parts = m[1].match(/"[^"]*"|[^.]+/g);
  if (!parts || parts.length === 0) return null;
  const bare = parts[parts.length - 1].replace(/^"|"$/g, "").toLowerCase();
  return bare || null;
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
  hooks?: { onPhase?: (phase: "schema" | "data", index: number, total: number, label: string) => void },
): Promise<{ appliedStatements: number; warnings: string[]; skippedRows: number }> {
  const warnings: string[] = [];
  let applied = 0;
  let skippedRows = 0;

  for (const stmt of dropStatements) {
    const res = await query(connectionString, stmt);
    if (!res.success) {
      throw new Error(`Drop failed, aborting before apply: ${String(res.error ?? "unknown error")}`);
    }
    applied++;
  }

  const schemaStatements: string[] = [];
  for (const stmt of splitSqlStatements(schemaSql)) {
    const executable = stripCommentLines(stmt);
    if (executable) schemaStatements.push(executable);
  }
  // File order is the dependency order the dump was built in
  // (functions → tables → partitions → dependents → FKs), so the schema
  // phase runs statements as emitted. Programmable failures are retried
  // immediately and then deferred to end-of-pass fixpoint retries: a SQL
  // function referencing a later table fails mid-pass but succeeds once
  // its table exists, no matter how deep the function chain runs.
  let schemaDone = 0;
  const phaseTotal = schemaStatements.length;
  const noteProgress = (executable: string) => {
    schemaDone++;
    if (schemaDone % 25 === 0 || schemaDone === phaseTotal) {
      hooks?.onPhase?.("schema", schemaDone, phaseTotal, executable.replace(/\s+/g, " ").slice(0, 120));
    }
  };
  const deferred: string[] = [];
  const failedStructural: string[] = [];
  // Function names defined by this dump (bare, lowercased): a structural
  // statement (expression index, CHECK) that fails while naming a defined
  // but not-yet-applied function is retried after the function pass
  // instead of aborting — the function may simply be deferred itself.
  // Quote-aware via bareFunctionName (never a schema fragment).
  const definedFunctions = new Set<string>();
  for (const s of schemaStatements) {
    if (!isProgrammableStatement(s)) continue;
    const name = bareFunctionName(s);
    if (name) definedFunctions.add(name);
  }
  const appliedFunctions = new Set<string>();
  const namesIn = (stmt: string): string[] =>
    [...definedFunctions].filter((name) => new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\(`, "i").test(stmt));
  const markApplied = (stmt: string) => {
    for (const name of namesIn(stmt)) {
      // Only a definition marks it applied (calls don't).
      if (/CREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE)\s+/i.test(stmt)) appliedFunctions.add(name);
    }
  };
  for (const executable of schemaStatements) {
    if (!isProgrammableStatement(executable)) {
      const res = await query(connectionString, executable);
      if (!res.success) {
        // Retry after the function pass when the statement names a dumped
        // function that isn't applied yet; otherwise abort immediately.
        const pendingDeps = namesIn(executable).filter((name) => !appliedFunctions.has(name));
        if (pendingDeps.length > 0) {
          failedStructural.push(executable);
        } else {
          throw new Error(
            `Schema apply failed (destination may be PARTIALLY modified — no transaction support over this connection): ${String(res.error ?? "unknown error")}`,
          );
        }
      } else {
        applied++;
      }
      noteProgress(executable);
      continue;
    }
    // Best-effort with one retry (ordering); persistent failures defer to
    // the end-of-pass retry below instead of warning immediately.
    let res = await query(connectionString, executable);
    if (!res.success) res = await query(connectionString, executable);
    if (!res.success) {
      deferred.push(executable);
    } else {
      applied++;
      markApplied(executable);
    }
    noteProgress(executable);
  }
  // End-of-pass retries, functions before dependents: deferred programmables
  // first, then deferred structural (an index/constraint whose function is
  // now applied). Programmable retries run to fixpoint: a chain F→G where G
  // also failed resolves over successive passes no matter the file order —
  // each progressing pass applies at least one object, and a pass with no
  // progress ends the loop, so this always terminates.
  let remaining = [...deferred];
  const lastError = new Map<string, unknown>();
  while (remaining.length > 0) {
    const next: string[] = [];
    let progressed = false;
    for (const executable of remaining) {
      const res = await query(connectionString, executable);
      if (!res.success) {
        lastError.set(executable, res.error);
        next.push(executable);
      } else {
        applied++;
        markApplied(executable);
        progressed = true;
      }
    }
    if (!progressed) {
      remaining = next;
      break;
    }
    remaining = next;
  }
  for (const executable of remaining) {
    const detail = String(lastError.get(executable) ?? "unknown error").slice(0, 200);
    // EXCEPT security-critical objects (RLS policies, triggers), which
    // abort the transfer instead of leaving the destination without them.
    if (isSecurityCriticalProgrammable(executable)) {
      throw new Error(
        `Security-critical object failed to apply (${detail}): ${executable.replace(/\s+/g, " ").slice(0, 160)} — transfer aborted instead of leaving the destination without it.`,
      );
    }
    warnings.push(
      `Skipped programmable object (${detail}): ${executable.replace(/\s+/g, " ").slice(0, 160)}`,
    );
  }
  for (const executable of failedStructural) {
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
    const orderedChunks = orderChunksByDependency(chunks, deps);
    // Same trigger rationale as the pg-client path (see export-helpers):
    // disable per-table triggers for the load, re-enable after — with an
    // explicit re-enable on failure since there is no transaction here.
    const triggerTables = [...new Map(
      orderedChunks.filter((c) => c.schema && c.table).map((c) => [`${c.schema}.${c.table}`, c] as const),
    ).values()];
    const alterTriggers = async (enable: boolean): Promise<string | null> => {
      const errors: string[] = [];
      for (const c of triggerTables) {
        const res = await query(
          connectionString,
          `ALTER TABLE "${c.schema.replace(/"/g, '""')}"."${c.table.replace(/"/g, '""')}" ${enable ? "ENABLE" : "DISABLE"} TRIGGER USER`,
        );
        if (!res.success) {
          const msg = `Could not ${enable ? "re-enable" : "disable"} triggers on ${c.schema}.${c.table}: ${String(res.error ?? "unknown error")}`;
          if (!enable) warnings.push(`${msg}; row triggers stay live during import.`);
          // Re-enable keeps going so one failure doesn't leave every later
          // table's triggers disabled; all failures surface together below.
          else errors.push(msg);
        }
      }
      return errors.length > 0 ? errors.join("; ") : null;
    };
    await alterTriggers(false);
    // A data-phase failure must still re-enable triggers before surfacing,
    // and a re-enable failure must not mask it — track both explicitly
    // instead of throwing inside `finally`.
    let dataError: unknown = null;
    try {
      let chunkIndex = 0;
      for (const chunk of orderedChunks) {
        chunkIndex++;
        const where = chunk.table ? `${chunk.schema}.${chunk.table}` : "unmarked statements";
        hooks?.onPhase?.("data", chunkIndex, orderedChunks.length, where);
        // Fast path: whole chunk in one call. On failure, fall back to
        // per-row so one bad row neither kills its siblings nor masks the
        // real error behind "transaction is aborted"-style cascades.
        const whole = await query(connectionString, chunk.sql);
        if (whole.success) {
          applied++;
          continue;
        }
        const { applied: rowApplied, failed } = await applyChunkResiliently(async (sql) => {
          const r = await query(connectionString, sql);
          if (!r.success) throw new Error(String(r.error ?? "unknown error"));
        }, chunk.sql);
        applied += rowApplied;
        skippedRows += failed.length;
        for (const f of failed.slice(0, 20)) {
          warnings.push(`Row skipped in ${where} (${f.error.slice(0, 200)}): ${shortStatement(f.statement)}`);
        }
        if (failed.length > 20) warnings.push(`…and ${failed.length - 20} more skipped rows in ${where}.`);
      }
      if (skippedRows > 0) {
        warnings.push(`${skippedRows} row(s) could not be imported and were skipped — see warnings above.`);
      }
    } catch (e) {
      dataError = e;
    }
    {
      const enableError = await alterTriggers(true);
      if (enableError) {
        // No transaction on this path: disabled triggers persist, so a
        // re-enable failure FAILS the transfer instead of warning past it.
        throw new Error(
          `Transfer aborted: ${enableError} — some triggers may still be disabled; re-enable them manually.${dataError ? ` Data phase also failed: ${dataError instanceof Error ? dataError.message : String(dataError)}` : ""}`,
        );
      }
      if (dataError) throw dataError;
      if (triggerTables.length > 0) {
        warnings.push("Row triggers were disabled during data import and re-enabled after; derived rows come from migrated data, not trigger side effects.");
      }
    }
  }

  return { appliedStatements: applied, warnings, skippedRows };
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
  skipWithoutProbing?: (extName: string) => string | null,
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
  // Extensions entirely absent from the destination (not installed server
  // binaries) are skipped WITHOUT probing: probing them fails loudly in
  // server logs for zero information. Location-restricted ones (Neon's
  // pg_cron) still probe, since availability alone can't tell.
  let available: Set<string> | null = null;
  try {
    const availRes = await query(connectionString, `SELECT name FROM pg_available_extensions`);
    if (availRes.success) {
      available = new Set((availRes.data?.rows ?? []).map((r) => String((r as Record<string, unknown>).name)));
    }
  } catch {
    // fall through to probing everything
  }
  // Availability probing is dry-run inside a rolled-back transaction:
  // running the real CREATE EXTENSION would commit outside the later
  // import transaction and leave a newly-installed extension behind when
  // the transfer fails. Endpoints without transaction support fall back
  // to the availability list (or keep the statement untested).
  const dryRunProbe = async (
    executable: string,
  ): Promise<{ success: boolean; error?: unknown }> => {
    let begin: { success: boolean; error?: unknown };
    try {
      begin = await query(connectionString, "BEGIN;");
    } catch (e) {
      begin = { success: false, error: e };
    }
    if (!begin.success) {
      return { success: true };
    }
    let probe: { success: boolean; error?: unknown };
    try {
      probe = await query(connectionString, executable);
    } catch (e) {
      probe = { success: false, error: e };
    } finally {
      try {
        await query(connectionString, "ROLLBACK;");
      } catch {
        // Rollback failure leaves nothing behind that matters: the probe
        // itself either succeeded (extension wanted anyway) or failed.
      }
    }
    return probe;
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
    const skipReason = skipWithoutProbing?.(extName);
    if (skipReason) {
      warnings.push(`Extension "${extName}" skipped: ${skipReason}`);
      kept.push(`-- SKIPPED EXTENSION (${skipReason}):\n-- ${executable.split("\n").join("\n-- ")}`);
      continue;
    }
    if (available && !available.has(extName)) {
      const reason = `extension "${extName}" is not available on the destination`;
      warnings.push(
        `Extension "${extName}" skipped: ${reason}. Objects depending on it may fail — enable it manually if needed.`,
      );
      kept.push(`-- SKIPPED EXTENSION (${reason}):\n-- ${executable.split("\n").join("\n-- ")}`);
      continue;
    }
    const probe = await dryRunProbe(executable);
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
