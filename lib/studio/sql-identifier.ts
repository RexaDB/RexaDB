import { quoteIdentifier, type SqlDialect } from "@/lib/db/quote-identifier";

/**
 * Helpers for inserting table/column names into the SQL editor so they work
 * as typed: names that the dialect would case-fold, reserved words, and names
 * with special characters are quoted; plain names are left alone.
 */

function words(list: string): Set<string> {
  return new Set(list.trim().split(/\s+/).map((word) => word.toLowerCase()));
}

// Reserved words per dialect: identifiers matching these must be quoted.
// Quoting a non-reserved word is harmless, so the lists err on the side of
// including a word.
const POSTGRES_RESERVED = words(`
  all analyse analyze and any array as asc asymmetric authorization binary both
  case cast check collate collation column concurrently constraint create cross
  current_catalog current_date current_role current_schema current_time
  current_timestamp current_user default deferrable desc distinct do else end
  except false fetch for foreign freeze from full grant group having ilike in
  initially inner intersect into is isnull join lateral leading left like limit
  localtime localtimestamp natural not notnull null offset on only or order
  outer overlaps placing primary references returning right select
  session_user similar some symmetric system_user table tablesample then to
  trailing true union unique user using variadic verbose when where window with
`);

const MYSQL_RESERVED = words(`
  accessible add all alter analyze and as asc asensitive before between bigint
  binary blob both by call cascade case change char character check collate
  column condition constraint continue convert create cross cube cume_dist
  current_date current_time current_timestamp current_user cursor database
  databases day_hour day_microsecond day_minute day_second dec decimal declare
  default delayed delete dense_rank desc describe deterministic distinct
  distinctrow div double drop dual each else elseif empty enclosed escaped
  except exists exit explain false fetch first_value float float4 float8 for
  force foreign from fulltext function generated get grant group grouping
  groups having high_priority hour_microsecond hour_minute hour_second if
  ignore in index infile inner inout insensitive insert int int1 int2 int3 int4
  int8 integer intersect interval into io_after_gtids io_before_gtids is
  iterate join json_table key keys kill lag last_value lateral lead leading
  leave left like limit linear lines load localtime localtimestamp lock long
  longblob longtext loop low_priority master_bind master_ssl_verify_server_cert
  match maxvalue mediumblob mediumint mediumtext middleint minute_microsecond
  minute_second mod modifies natural not no_write_to_binlog nth_value ntile
  null numeric of on optimize optimizer_costs option optionally or order out
  outer outfile over partition percent_rank precision primary procedure purge
  range rank read reads read_write real recursive references regexp release
  rename repeat replace require resignal restrict return revoke right rlike
  row row_number rows schema schemas second_microsecond select sensitive
  separator set show signal smallint spatial specific sql sqlexception
  sqlstate sqlwarning sql_big_result sql_calc_found_rows sql_small_result ssl
  starting stored straight_join system table terminated then tinyblob tinyint
  tinytext to trailing trigger true undo union unique unlock unsigned update
  usage use using utc_date utc_time utc_timestamp values varbinary varchar
  varcharacter varying virtual when where while window with write xor
  year_month zerofill
`);

const MSSQL_RESERVED = words(`
  add all alter and any as asc authorization backup begin between break browse
  bulk by cascade case check checkpoint close clustered coalesce collate column
  commit compute constraint contains containstable continue convert create
  cross current current_date current_time current_timestamp current_user
  cursor database dbcc deallocate declare default delete deny desc disk
  distinct distributed double drop dump else end errlvl escape except exec
  execute exists exit external fetch file fillfactor for foreign freetext
  freetexttable from full function goto grant group having holdlock identity
  identity_insert identitycol if in index inner insert intersect into is join
  key kill left like lineno load merge national nocheck nonclustered not null
  nullif of off offsets on open opendatasource openquery openrowset openxml
  option or order outer over percent pivot plan precision primary print proc
  procedure public raiserror read readtext reconfigure references replication
  restore restrict return revert revoke right rollback rowcount rowguidcol
  rule save schema securityaudit select semantickeyphrasetable
  semanticsimilaritydetailstable semanticsimilaritytable session_user set
  setuser shutdown some statistics system_user table tablesample textsize then
  to top tran transaction trigger truncate try_convert tsequal union unique
  unpivot update updatetext use user values varying view waitfor when where
  while with within writetext
`);

const SQLITE_RESERVED = words(`
  abort action add after all alter always analyze and as asc attach
  autoincrement before begin between by cascade case cast check collate column
  commit conflict constraint create cross current current_date current_time
  current_timestamp database default deferrable deferred delete desc detach
  distinct do drop each else end escape except exclude exclusive exists
  explain fail filter first following for foreign from full generated glob
  group groups having if ignore immediate in index indexed initially inner
  insert instead intersect into is isnull join key last left like limit match
  materialized natural no not nothing notnull null nulls of offset on or order
  others outer over partition plan pragma preceding primary query raise range
  recursive references regexp reindex release rename replace restrict
  returning right rollback row rows savepoint select set table temp temporary
  then ties to transaction trigger unbounded union unique update using vacuum
  values view virtual when where window with without
`);

const ORACLE_RESERVED = words(`
  access add all alter and any as asc audit between by char check cluster column
  comment compress connect create current date decimal default delete desc
  distinct drop else exclusive exists file float for from grant group having
  identified immediate in increment index initial insert integer intersect
  into is level like lock long maxextents minus mlslabel mode modify noaudit
  nocompress not nowait null number of offline on online option or order
  pctfree prior public raw rename resource revoke row rowid rownum rows select
  session set share size smallint start successful synonym sysdate table then
  to trigger uid union unique update user validate values varchar varchar2
  view whenever where with
`);

const TRINO_RESERVED = words(`
  alter and as between by case cast constraint create cross cube current_catalog
  current_date current_path current_role current_schema current_time
  current_timestamp current_user deallocate delete describe distinct drop else
  end escape except execute exists extract false for from full group grouping
  having in inner insert intersect into is join json_array json_exists
  json_object json_query json_table json_value left like listagg localtime
  localtimestamp natural normalize not null on or order outer prepare
  recursive right rollup select skip table then trim true uescape union unnest
  using values when where with
`);

// ClickHouse reserves very little; quote the words its parser treats as clause starts.
const CLICKHOUSE_RESERVED = words(`
  all and any array as asc between by case cross desc distinct else end except
  final format from full global group having in inner intersect into is join
  left like limit not null offset on or order outer prewhere right sample
  select settings then union using when where with
`);

function getReservedWords(dbType: string): Set<string> {
  switch (dbType) {
    case "mysql":
      return MYSQL_RESERVED;
    case "mssql":
      return MSSQL_RESERVED;
    case "sqlite":
      return SQLITE_RESERVED;
    case "oracle":
      return ORACLE_RESERVED;
    case "trino":
      return TRINO_RESERVED;
    case "clickhouse":
      return CLICKHOUSE_RESERVED;
    default:
      // postgres, duckdb, federated, spacetimedb
      return POSTGRES_RESERVED;
  }
}

type CaseFolding = "lower" | "upper" | "none";

function getQuoteDialect(dbType: string): SqlDialect {
  switch (dbType) {
    case "mysql":
    case "clickhouse":
    case "mssql":
    case "sqlite":
    case "duckdb":
    case "oracle":
      return dbType;
    default:
      return "postgres";
  }
}

function getCaseFolding(dbType: string): CaseFolding {
  switch (dbType) {
    case "postgres":
    case "trino":
    case "federated":
    case "spacetimedb":
      return "lower";
    case "oracle":
      return "upper";
    default:
      return "none";
  }
}

export function sqlIdentifierNeedsQuotes(name: string, dbType: string): boolean {
  if (!name) return false;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return true;
  if (getReservedWords(dbType).has(name.toLowerCase())) return true;
  const folding = getCaseFolding(dbType);
  if (folding === "lower") return name !== name.toLowerCase();
  if (folding === "upper") return name !== name.toUpperCase();
  return false;
}

/** The name the database resolves an unquoted identifier to. */
export function foldUnquotedSqlIdentifier(name: string, dbType: string): string {
  const folding = getCaseFolding(dbType);
  if (folding === "lower") return name.toLowerCase();
  if (folding === "upper") return name.toUpperCase();
  return name;
}

/** Whether `dbType` changes the case of unquoted identifiers. */
export function sqlDialectFoldsCase(dbType: string): boolean {
  return getCaseFolding(dbType) !== "none";
}

/** Quote `name` for `dbType` only when it would not work unquoted. */
export function formatSqlIdentifier(name: string, dbType: string): string {
  if (!sqlIdentifierNeedsQuotes(name, dbType)) return name;
  return quoteIdentifier(name, getQuoteDialect(dbType));
}

/** Format a `schema.table` reference, quoting each part independently. */
export function formatQualifiedSqlIdentifier(
  parts: Array<string | null | undefined>,
  dbType: string,
): string {
  return parts
    .filter((part): part is string => Boolean(part))
    .map((part) => formatSqlIdentifier(part, dbType))
    .join(".");
}

/** The opening/closing characters used to quote identifiers in `dbType`. */
export function getSqlIdentifierQuoteChars(dbType: string): [string, string] {
  switch (getQuoteDialect(dbType)) {
    case "mysql":
    case "clickhouse":
      return ["`", "`"];
    case "mssql":
      return ["[", "]"];
    default:
      return ['"', '"'];
  }
}

/** Strip identifier quotes (`"x"`, `` `x` ``, `[x]`) and un-double escaped quotes. */
export function unquoteSqlIdentifier(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if (first === '"' && last === '"') return value.slice(1, -1).replace(/""/g, '"');
    if (first === "`" && last === "`") return value.slice(1, -1).replace(/``/g, "`");
    if (first === "[" && last === "]") return value.slice(1, -1).replace(/]]/g, "]");
  }
  return value;
}

/** Quote `name` for `dbType` unconditionally (used when the user opened a quote). */
export function quoteSqlIdentifierAlways(name: string, dbType: string): string {
  return quoteIdentifier(name, getQuoteDialect(dbType));
}
