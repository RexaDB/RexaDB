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
    const key = `${row.table_name ?? row.table ?? ""}.${row.name}`;
    const entry = byTrigger.get(key) ?? { row, events: [] };
    entry.events.push(...String(row.event ?? "").split(",").map((event) => event.trim()).filter(Boolean));
    byTrigger.set(key, entry);
  }
  return Array.from(byTrigger.values(), ({ row, events }) => ({
    kind: "trigger" as const,
    schema: row.schema,
    name: row.name,
    signature: undefined,
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
    `CREATE SEQUENCE "${row.schema}"."${row.name}"`,
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
      `CREATE TYPE "${row.schema}"."${row.name}" AS ENUM (`,
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
  return !row.schema || String(row.schema).toUpperCase() === schema.toUpperCase();
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
  return `${object.kind}:${object.schema}.${object.name}(${object.signature ?? ""})`;
}

/**
 * Points a `CREATE FUNCTION` statement at a new routine name. Only the text
 * before the argument list is touched, and the schema is skipped by taking the
 * last match, so a schema named like the routine stays intact.
 */
export function renameRoutineDefinition(definition: string, name: string, newName: string) {
  const argumentsStart = definition.indexOf("(");
  const header = argumentsStart === -1 ? definition : definition.slice(0, argumentsStart);
  const nameStart = header.lastIndexOf(name);
  if (nameStart === -1) return definition;
  return definition.slice(0, nameStart) + newName + definition.slice(nameStart + name.length);
}
