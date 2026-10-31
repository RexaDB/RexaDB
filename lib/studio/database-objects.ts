import { quotePgIdentifier } from "@/lib/db/quote-identifier";

export type DatabaseObjectKind =
  | "function"
  | "procedure"
  | "package"
  | "trigger"
  | "sequence"
  | "enum"
  | "index"
  | "synonym"
  | "materialized-view"
  | "db-link";

export interface DatabaseObjectDetail {
  kind: DatabaseObjectKind;
  schema: string;
  name: string;
  /** Table a trigger belongs to; trigger names are only unique per table. */
  parent?: string;
  /** Distinguishes overloads, e.g. the argument list of a function. */
  signature?: string;
  definition: string;
  metadata: Array<{ label: string; value: string }>;
}

export interface DatabaseObjectSection {
  kind: DatabaseObjectKind;
  label: string;
  items: DatabaseObjectDetail[];
}

export interface DatabaseObjectRows {
  functions?: any[];
  triggers?: any[];
  sequences?: any[];
  enums?: any[];
  indexes?: any[];
  packages?: any[];
  synonyms?: any[];
  materializedViews?: any[];
  dbLinks?: any[];
}

export const DATABASE_OBJECT_LABELS: Record<DatabaseObjectKind, string> = {
  function: "Function",
  procedure: "Procedure",
  package: "Package",
  trigger: "Trigger",
  sequence: "Sequence",
  enum: "Enum",
  index: "Index",
  synonym: "Synonym",
  "materialized-view": "Materialized View",
  "db-link": "DB Link",
};

function metadata(entries: Array<[string, unknown]>) {
  return entries
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .map(([label, value]) => ({ label, value: String(value) }));
}

function routineDetail(row: any): DatabaseObjectDetail {
  const isProcedure = String(row.type || "").toUpperCase() === "PROCEDURE";
  return {
    kind: isProcedure ? "procedure" : "function",
    schema: row.schema,
    name: row.name,
    signature: row.argument_types || row.arguments || "",
    definition: row.definition || "",
    metadata: metadata([
      ["Volatility", row.volatility],
      ["Security", row.security_definer === undefined ? null : row.security_definer ? "DEFINER" : "INVOKER"],
      ["Owner", row.owner],
      ["Language", row.language],
      ["Returns", row.return_type],
    ]),
  };
}

function triggerDetails(rows: any[]): DatabaseObjectDetail[] {
  // information_schema.triggers has one row per event of the same trigger.
  const byTrigger = new Map<string, { row: any; events: string[] }>();
  for (const row of rows) {
    const key = JSON.stringify([row.table_name ?? row.table ?? "", row.name]);
    const entry = byTrigger.get(key) ?? { row, events: [] };
    entry.events.push(...String(row.event ?? "").split(",").map((event) => event.trim()).filter(Boolean));
    byTrigger.set(key, entry);
  }
  return Array.from(byTrigger.values(), ({ row, events }) => ({
    kind: "trigger" as const,
    schema: row.schema,
    name: row.name,
    parent: row.table_name ?? row.table ?? undefined,
    definition: row.full_definition || row.definition || "",
    metadata: metadata([
      ["Table", row.table_name ?? row.table],
      ["Timing", row.timing],
      ["Events", Array.from(new Set(events)).join(", ")],
    ]),
  }));
}

function sequenceDefinition(row: any) {
  if (row.start_value === undefined) return "";
  return [
    `CREATE SEQUENCE ${quotePgIdentifier(row.schema)}.${quotePgIdentifier(row.name)}`,
    `  AS ${row.data_type}`,
    `  INCREMENT BY ${row.increment_by}`,
    `  MINVALUE ${row.min_value}`,
    `  MAXVALUE ${row.max_value}`,
    `  START WITH ${row.start_value}`,
    `  CACHE ${row.cache_size}`,
    `  ${row.cycle_flag ? "CYCLE" : "NO CYCLE"};`,
  ].join("\n");
}

function sequenceDetail(row: any): DatabaseObjectDetail {
  return {
    kind: "sequence",
    schema: row.schema,
    name: row.name,
    definition: sequenceDefinition(row),
    metadata: metadata([
      ["Last value", row.last_number],
      ["Increment", row.increment_by],
      ["Cycle", row.cycle_flag === undefined ? null : row.cycle_flag ? "YES" : "NO"],
      ["Owner", row.owner],
    ]),
  };
}

function enumDetail(row: any): DatabaseObjectDetail {
  const values: string[] = row.values ?? [];
  return {
    kind: "enum",
    schema: row.schema,
    name: row.name,
    definition: [
      `CREATE TYPE ${quotePgIdentifier(row.schema)}.${quotePgIdentifier(row.name)} AS ENUM (`,
      values.map((value) => `  '${value.replace(/'/g, "''")}'`).join(",\n"),
      ");",
    ].join("\n"),
    metadata: metadata([["Values", values.length]]),
  };
}

function indexDetail(row: any): DatabaseObjectDetail {
  return {
    kind: "index",
    schema: row.schema,
    name: row.name,
    definition: row.definition || "",
    metadata: metadata([
      ["Table", row.table_name],
      ["Type", row.is_unique ? "UNIQUE" : "INDEX"],
      ["Columns", row.columns?.join(", ")],
    ]),
  };
}

function rowInSchema(row: any, schema: string) {
  return !row.schema || String(row.schema) === schema;
}

/** The non-empty object groups of a schema, in sidebar order. */
export function buildDatabaseObjectSections(
  rows: DatabaseObjectRows,
  schema: string,
  query = "",
): DatabaseObjectSection[] {
  const inSchema = (list: any[] = []) => list.filter((row) => rowInSchema(row, schema));
  const routines = inSchema(rows.functions).map(routineDetail);
  const dbLinks = (rows.dbLinks ?? []).map((row): DatabaseObjectDetail => ({
    kind: "db-link",
    schema: row.owner ?? "",
    name: row.name,
    definition: "",
    metadata: metadata([["Owner", row.owner], ["User", row.username], ["Connect string", row.host]]),
  }));

  const sections: DatabaseObjectSection[] = [
    { kind: "function", label: "Functions", items: routines.filter((item) => item.kind === "function") },
    { kind: "procedure", label: "Procedures", items: routines.filter((item) => item.kind === "procedure") },
    {
      kind: "package",
      label: "Packages",
      items: inSchema(rows.packages).map((row) => ({
        kind: "package",
        schema: row.schema,
        name: row.name,
        definition: row.definition || "",
        metadata: metadata([["Status", row.status]]),
      })),
    },
    { kind: "trigger", label: "Triggers", items: triggerDetails(inSchema(rows.triggers)) },
    { kind: "sequence", label: "Sequences", items: inSchema(rows.sequences).map(sequenceDetail) },
    { kind: "enum", label: "Enums", items: inSchema(rows.enums).map(enumDetail) },
    { kind: "index", label: "Indexes", items: inSchema(rows.indexes).map(indexDetail) },
    {
      kind: "synonym",
      label: "Synonyms",
      items: inSchema(rows.synonyms).map((row) => ({
        kind: "synonym",
        schema: row.schema,
        name: row.name,
        definition: "",
        metadata: metadata([
          ["Target", [row.table_owner, row.table_name].filter(Boolean).join(".")],
          ["DB Link", row.db_link],
        ]),
      })),
    },
    {
      kind: "materialized-view",
      label: "Materialized Views",
      items: inSchema(rows.materializedViews).map((row) => ({
        kind: "materialized-view",
        schema: row.schema,
        name: row.name,
        definition: row.query || "",
        metadata: metadata([
          ["Refresh", row.refresh_method || row.refresh_mode],
          ["Staleness", row.staleness],
          ["State", row.compile_state],
        ]),
      })),
    },
    { kind: "db-link", label: "DB Links", items: dbLinks },
  ];

  const needle = query.trim().toLowerCase();
  return sections
    .map((section) => ({
      ...section,
      items: needle
        ? section.items.filter((item) => item.name.toLowerCase().includes(needle))
        : section.items,
    }))
    .filter((section) => section.items.length > 0);
}

export function databaseObjectKey(object: DatabaseObjectDetail) {
  return JSON.stringify([object.kind, object.schema, object.parent ?? "", object.name, object.signature ?? ""]);
}

/**
 * Object tabs hold a snapshot of the object, which only local storage keeps.
 * Tabs restored without one have nothing to show, so they are left out.
 */
export function isRestorableTab(tab: { type: string; databaseObject?: unknown }) {
  return tab.type !== "database-object" || Boolean(tab.databaseObject);
}

const ROUTINE_HEADER = /^\s*CREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE)\s+/i;

/** Reads a bare or double-quoted identifier starting at `start`. */
function readIdentifier(sql: string, start: number) {
  if (sql[start] !== '"') {
    const bare = /^[^\s."(]+/.exec(sql.slice(start))?.[0];
    return bare ? { start, end: start + bare.length, value: bare, quoted: false } : null;
  }
  let value = "";
  for (let index = start + 1; index < sql.length; index++) {
    if (sql[index] !== '"') {
      value += sql[index];
    } else if (sql[index + 1] === '"') {
      value += '"';
      index++;
    } else {
      return { start, end: index + 1, value, quoted: true };
    }
  }
  return null;
}

/**
 * Points a Postgres `CREATE FUNCTION` statement at a new routine name. Returns
 * null unless the statement's routine name is exactly `name`, so a caller never
 * ends up saving a statement that still targets the original routine.
 */
export function renameRoutineDefinition(definition: string, name: string, newName: string) {
  const header = ROUTINE_HEADER.exec(definition);
  if (!header) return null;

  let identifier = readIdentifier(definition, header[0].length);
  while (identifier) {
    const dot = /^\s*\.\s*/.exec(definition.slice(identifier.end));
    if (!dot) break;
    identifier = readIdentifier(definition, identifier.end + dot[0].length);
  }
  if (!identifier || identifier.value !== name) return null;

  const replacement =
    !identifier.quoted && /^[a-z_][a-z0-9_$]*$/.test(newName) ? newName : quotePgIdentifier(newName);
  return definition.slice(0, identifier.start) + replacement + definition.slice(identifier.end);
}
