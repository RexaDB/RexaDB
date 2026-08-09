export type SpacetimeDbColumnType =
  | "Bool" | "String" | "F32" | "F64"
  | "I8" | "I16" | "I32" | "I64" | "I128" | "I256"
  | "U8" | "U16" | "U32" | "U64" | "U128" | "U256"
  | "Identity" | "ConnectionId" | "Timestamp" | "TimeDuration"
  | "Bytes";

export type SupportedLanguage = "rust" | "typescript" | "csharp" | "cpp";

export interface ColumnDef {
  name: string;
  type: SpacetimeDbColumnType;
  isPrimary: boolean;
  isUnique: boolean;
  autoInc: boolean;
  index: boolean;
}

export interface TableDef {
  name: string;
  access: "public" | "private";
  columns: ColumnDef[];
}

function columnNameToPascal(name: string): string {
  return name
    .split(/[_-]/)
    .map(s => s.charAt(0).toUpperCase() + s.slice(1))
    .join("");
}

function columnNameToCamel(name: string): string {
  const pascal = columnNameToPascal(name);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

function indent(lines: string[], depth: number = 1): string {
  const pad = "  ".repeat(depth);
  return lines.map(l => (l.trim() ? pad + l : l)).join("\n");
}

const TYPE_MAP_RUST: Record<SpacetimeDbColumnType, string> = {
  Bool: "bool", String: "String",
  F32: "f32", F64: "f64",
  I8: "i8", I16: "i16", I32: "i32", I64: "i64", I128: "i128", I256: "i256",
  U8: "u8", U16: "u16", U32: "u32", U64: "u64", U128: "u128", U256: "u256",
  Identity: "Identity", ConnectionId: "ConnectionId",
  Timestamp: "Timestamp", TimeDuration: "TimeDuration",
  Bytes: "Vec<u8>",
};

const TYPE_MAP_TS: Record<SpacetimeDbColumnType, string> = {
  Bool: "t.bool()", String: "t.string()",
  F32: "t.f32()", F64: "t.f64()",
  I8: "t.i8()", I16: "t.i16()", I32: "t.i32()", I64: "t.i64()", I128: "t.i128()", I256: "t.i256()",
  U8: "t.u8()", U16: "t.u16()", U32: "t.u32()", U64: "t.u64()", U128: "t.u128()", U256: "t.u256()",
  Identity: "t.identity()", ConnectionId: "t.connectionId()",
  Timestamp: "t.timestamp()", TimeDuration: "t.timeDuration()",
  Bytes: "t.array(t.u8())",
};

const TYPE_MAP_CS: Record<SpacetimeDbColumnType, string> = {
  Bool: "bool", String: "string",
  F32: "float", F64: "double",
  I8: "sbyte", I16: "short", I32: "int", I64: "long", I128: "SpacetimeDB.I128", I256: "SpacetimeDB.I256",
  U8: "byte", U16: "ushort", U32: "uint", U64: "ulong", U128: "SpacetimeDB.U128", U256: "SpacetimeDB.U256",
  Identity: "Identity", ConnectionId: "ConnectionId",
  Timestamp: "Timestamp", TimeDuration: "TimeDuration",
  Bytes: "List<byte>",
};

const TYPE_MAP_CPP: Record<SpacetimeDbColumnType, string> = {
  Bool: "bool", String: "std::string",
  F32: "float", F64: "double",
  I8: "int8_t", I16: "int16_t", I32: "int32_t", I64: "int64_t", I128: "SpacetimeDB::i128", I256: "SpacetimeDB::i256",
  U8: "uint8_t", U16: "uint16_t", U32: "uint32_t", U64: "uint64_t", U128: "SpacetimeDB::u128", U256: "SpacetimeDB::u256",
  Identity: "Identity", ConnectionId: "ConnectionId",
  Timestamp: "Timestamp", TimeDuration: "TimeDuration",
  Bytes: "std::vector<uint8_t>",
};

function getRustAttrs(col: ColumnDef): string[] {
  const attrs: string[] = [];
  if (col.isPrimary) attrs.push("#[primary_key]");
  if (col.autoInc) attrs.push("#[auto_inc]");
  if (col.isUnique) attrs.push("#[unique]");
  if (col.index) attrs.push("#[index(btree)]");
  return attrs;
}

function getTypeScriptChains(col: ColumnDef): string[] {
  const chains: string[] = [];
  if (col.isPrimary) chains.push("primaryKey()");
  if (col.autoInc) chains.push("autoInc()");
  if (col.isUnique) chains.push("unique()");
  if (col.index) chains.push("index('btree')");
  return chains;
}

function getCSharpAttrs(col: ColumnDef): string[] {
  const attrs: string[] = [];
  if (col.isPrimary) attrs.push("[SpacetimeDB.PrimaryKey]");
  if (col.autoInc) attrs.push("[SpacetimeDB.AutoInc]");
  if (col.isUnique) attrs.push("[SpacetimeDB.Unique]");
  if (col.index) attrs.push("[SpacetimeDB.Index.BTree]");
  return attrs;
}

function getCppFieldMacros(tableAccessor: string, col: ColumnDef): string[] {
  const macros: string[] = [];
  if (col.isPrimary && col.autoInc) {
    macros.push(`FIELD_PrimaryKeyAutoInc(${tableAccessor}, ${col.name})`);
  } else if (col.isPrimary) {
    macros.push(`FIELD_PrimaryKey(${tableAccessor}, ${col.name})`);
  }
  if (col.isUnique && !col.isPrimary) {
    macros.push(`FIELD_Unique(${tableAccessor}, ${col.name})`);
  }
  if (col.index) {
    macros.push(`FIELD_Index(${tableAccessor}, ${col.name})`);
  }
  return macros;
}

export function generateRustTable(table: TableDef): string {
  const structName = columnNameToPascal(table.name);
  const accessorName = table.name;
  const publicAttr = table.access === "public" ? ", public" : "";
  const lines: string[] = [];

  lines.push(`#[spacetimedb::table(name = "${table.name}"${publicAttr})]`);
  lines.push(`pub struct ${structName} {`);
  for (const col of table.columns) {
    for (const attr of getRustAttrs(col)) {
      lines.push(`    ${attr}`);
    }
    lines.push(`    pub ${col.name}: ${TYPE_MAP_RUST[col.type]},`);
  }
  lines.push("}");
  return lines.join("\n") + "\n";
}

export function generateTypeScriptTable(table: TableDef): string {
  const lines: string[] = [];
  const tableAccessor = columnNameToCamel(table.name);

  lines.push(`const ${tableAccessor} = table(`);
  lines.push(`  { name: '${table.name}', public: ${table.access === "public"} },`);
  lines.push("  {");
  for (const col of table.columns) {
    const chains = getTypeScriptChains(col);
    const chained = chains.length > 0 ? "." + chains.join(".") : "";
    lines.push(`    ${col.name}: ${TYPE_MAP_TS[col.type]}${chained},`);
  }
  lines.push("  },");
  lines.push(");");
  lines.push("");
  lines.push("const spacetimedb = schema({");
  lines.push(`  ${tableAccessor},`);
  lines.push("});");
  lines.push("export default spacetimedb;");
  return lines.join("\n") + "\n";
}

export function generateCSharpTable(table: TableDef): string {
  const structName = columnNameToPascal(table.name);
  const lines: string[] = [];

  lines.push(`[SpacetimeDB.Table(Name = "${table.name}", Public = ${table.access === "public"})]`);
  lines.push(`public partial struct ${structName}`);
  lines.push("{");
  for (const col of table.columns) {
    for (const attr of getCSharpAttrs(col)) {
      lines.push(`    ${attr}`);
    }
    const csName = columnNameToPascal(col.name);
    const csType = TYPE_MAP_CS[col.type];
    lines.push(`    public ${csType} ${csName};`);
  }
  lines.push("}");
  return lines.join("\n") + "\n";
}

export function generateCppTable(table: TableDef): string {
  const structName = columnNameToPascal(table.name);
  const tableAccessor = table.name;
  const lines: string[] = [];

  lines.push(`struct ${structName} {`);
  for (const col of table.columns) {
    const cppType = TYPE_MAP_CPP[col.type];
    lines.push(`    ${cppType} ${col.name};`);
  }
  lines.push("};");

  const fieldNames = table.columns.map(c => c.name).join(", ");
  lines.push(`SPACETIMEDB_STRUCT(${structName}, ${fieldNames})`);

  const publicAccess = table.access === "public" ? "Public" : "Private";
  lines.push(`SPACETIMEDB_TABLE(${structName}, ${tableAccessor}, ${publicAccess})`);

  for (const col of table.columns) {
    for (const macro of getCppFieldMacros(tableAccessor, col)) {
      lines.push(macro);
    }
  }

  return lines.join("\n") + "\n";
}

const GENERATORS: Record<SupportedLanguage, (table: TableDef) => string> = {
  rust: generateRustTable,
  typescript: generateTypeScriptTable,
  csharp: generateCSharpTable,
  cpp: generateCppTable,
};

export function generateTableCode(lang: SupportedLanguage, table: TableDef): string {
  const gen = GENERATORS[lang];
  return gen(table);
}

export function generateAllLanguages(table: TableDef): Record<SupportedLanguage, string> {
  return {
    rust: generateRustTable(table),
    typescript: generateTypeScriptTable(table),
    csharp: generateCSharpTable(table),
    cpp: generateCppTable(table),
  };
}

export const LANGUAGE_LABELS: Record<SupportedLanguage, string> = {
  rust: "Rust",
  typescript: "TypeScript",
  csharp: "C#",
  cpp: "C++",
};
