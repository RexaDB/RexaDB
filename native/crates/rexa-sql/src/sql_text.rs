//! Port of lib/studio/split-sql.ts, lib/studio/sql-ai-mode.ts (editor parts),
//! lib/studio/sql-identifier.ts, lib/studio/sql-dialects.ts and
//! lib/studio/db-labels.ts (editor labels).

use std::collections::HashSet;
use std::sync::OnceLock;

// ---- split-sql.ts ---------------------------------------------------------------

/// `splitSqlStatements`: split on `;` outside quotes and dollar-quoted bodies.
pub fn split_sql_statements(sql: &str) -> Vec<String> {
    let chars: Vec<char> = sql.chars().collect();
    let mut statements = Vec::new();
    let mut current = String::new();
    let (mut in_single, mut in_double) = (false, false);
    let mut in_dollar: Option<String> = None;
    let mut i = 0;
    while i < chars.len() {
        let ch = chars[i];
        let next = chars.get(i + 1).copied();
        if !in_double && ch == '\'' && (!in_single || next != Some('\'')) && in_dollar.is_none() {
            in_single = !in_single;
        } else if in_single && ch == '\'' && next == Some('\'') {
            current.push(ch);
            current.push('\'');
            i += 2;
            continue;
        } else if !in_single && ch == '"' && in_dollar.is_none() {
            in_double = !in_double;
        } else if !in_single && !in_double && ch == '$' {
            // /^\$[A-Za-z0-9_]*\$/
            let mut j = i + 1;
            while j < chars.len() && (chars[j].is_ascii_alphanumeric() || chars[j] == '_') {
                j += 1;
            }
            if j < chars.len() && chars[j] == '$' {
                let tag: String = chars[i..=j].iter().collect();
                match &in_dollar {
                    None => in_dollar = Some(tag),
                    Some(t) if *t == tag => in_dollar = None,
                    _ => {}
                }
            }
        }
        if ch == ';' && !in_single && !in_double && in_dollar.is_none() {
            let trimmed = current.trim();
            if !trimmed.is_empty() {
                statements.push(trimmed.to_string());
            }
            current.clear();
            i += 1;
            continue;
        }
        current.push(ch);
        i += 1;
    }
    let trimmed = current.trim();
    if !trimmed.is_empty() {
        statements.push(trimmed.to_string());
    }
    statements
}

// ---- sql-ai-mode.ts ------------------------------------------------------------

/// `isSqlAiPrompt`: `/^\s*\/(?:\s|$)/`
pub fn is_sql_ai_prompt(value: &str) -> bool {
    let rest = value.trim_start();
    match rest.strip_prefix('/') {
        Some(after) => after.is_empty() || after.starts_with(char::is_whitespace),
        None => false,
    }
}

/// `getSqlAiPrompt`: strip the leading `/` (and one space), trim.
pub fn get_sql_ai_prompt(value: &str) -> String {
    let rest = value.trim_start();
    let rest = rest.strip_prefix('/').unwrap_or(rest);
    let rest = rest.strip_prefix(char::is_whitespace).unwrap_or(rest);
    rest.trim().to_string()
}

pub fn comment_prefix(db_type: &str) -> &'static str {
    match db_type {
        "mongodb" => "//",
        "redis" => "#",
        _ => "--",
    }
}

/// `extractFirstCodeBlock`
pub fn extract_first_code_block(value: &str) -> String {
    if let Some(start) = value.find("```") {
        let after = &value[start + 3..];
        let lang_end = after.find(|c: char| !(c.is_ascii_alphanumeric() || c == '_' || c == '-')).unwrap_or(after.len());
        let mut body = &after[lang_end..];
        body = body.strip_prefix('\n').unwrap_or(body);
        if let Some(end) = body.find("```") {
            return body[..end].trim().to_string();
        }
    }
    value.trim().to_string()
}

/// `formatAiSnippetForEditor`
pub fn format_ai_snippet_for_editor(db_type: &str, snippet: &str, explanation: &[String]) -> String {
    let prefix = comment_prefix(db_type);
    let snippet = snippet.trim();
    if explanation.is_empty() {
        return snippet.to_string();
    }
    let mut out = vec![snippet.to_string(), String::new()];
    out.extend(explanation.iter().map(|l| format!("{prefix} {l}")));
    out.join("\n")
}

// ---- db-labels.ts --------------------------------------------------------------

pub fn editor_label(db_type: &str) -> &'static str {
    match db_type {
        "mongodb" => "Query Editor",
        "redis" => "Command Editor",
        _ => "SQL Editor",
    }
}

pub fn editor_badge(db_type: &str) -> &'static str {
    match db_type {
        "mongodb" => "MONGO SHELL",
        "redis" => "CMD",
        "spacetimedb" => "SPACETIME",
        _ => "SQL",
    }
}

// ---- sql-identifier.ts ---------------------------------------------------------

fn words(list: &str) -> HashSet<String> {
    list.split_whitespace().map(|w| w.to_ascii_lowercase()).collect()
}

const POSTGRES_RESERVED: &str = "all analyse analyze and any array as asc asymmetric authorization binary both
  case cast check collate collation column concurrently constraint create cross
  current_catalog current_date current_role current_schema current_time
  current_timestamp current_user default deferrable desc distinct do else end
  except false fetch for foreign freeze from full grant group having ilike in
  initially inner intersect into is isnull join lateral leading left like limit
  localtime localtimestamp natural not notnull null offset on only or order
  outer overlaps placing primary references returning right select
  session_user similar some symmetric system_user table tablesample then to
  trailing true union unique user using variadic verbose when where window with";

const MYSQL_RESERVED: &str = "accessible add all alter analyze and as asc asensitive before between bigint
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
  year_month zerofill";

const MSSQL_RESERVED: &str = "add all alter and any as asc authorization backup begin between break browse
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
  while with within writetext";

const SQLITE_RESERVED: &str = "abort action add after all alter always analyze and as asc attach
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
  values view virtual when where window with without";

const ORACLE_RESERVED: &str = "access add all alter and any as asc audit between by char check cluster column
  comment compress connect create current date decimal default delete desc
  distinct drop else exclusive exists file float for from grant group having
  identified immediate in increment index initial insert integer intersect
  into is level like lock long maxextents minus mlslabel mode modify noaudit
  nocompress not nowait null number of offline on online option or order
  pctfree prior public raw rename resource revoke row rowid rownum rows select
  session set share size smallint start successful synonym sysdate table then
  to trigger uid union unique update user validate values varchar varchar2
  view whenever where with";

const TRINO_RESERVED: &str = "alter and as between by case cast constraint create cross cube current_catalog
  current_date current_path current_role current_schema current_time
  current_timestamp current_user deallocate delete describe distinct drop else
  end escape except execute exists extract false for from full group grouping
  having in inner insert intersect into is join json_array json_exists
  json_object json_query json_table json_value left like listagg localtime
  localtimestamp natural normalize not null on or order outer prepare
  recursive right rollup select skip table then trim true uescape union unnest
  using values when where with";

const CLICKHOUSE_RESERVED: &str = "all and any array as asc between by case cross desc distinct else end except
  final format from full global group having in inner intersect into is join
  left like limit not null offset on or order outer prewhere right sample
  select settings then union using when where with";

fn reserved_words(db_type: &str) -> &'static HashSet<String> {
    macro_rules! set {
        ($src:expr) => {{
            static S: OnceLock<HashSet<String>> = OnceLock::new();
            S.get_or_init(|| words($src))
        }};
    }
    match db_type {
        "mysql" => set!(MYSQL_RESERVED),
        "mssql" => set!(MSSQL_RESERVED),
        "sqlite" => set!(SQLITE_RESERVED),
        "oracle" => set!(ORACLE_RESERVED),
        "trino" => set!(TRINO_RESERVED),
        "clickhouse" => set!(CLICKHOUSE_RESERVED),
        _ => set!(POSTGRES_RESERVED),
    }
}

#[derive(PartialEq)]
enum CaseFolding {
    Lower,
    Upper,
    None,
}

fn case_folding(db_type: &str) -> CaseFolding {
    match db_type {
        "postgres" | "trino" | "federated" | "spacetimedb" => CaseFolding::Lower,
        "oracle" => CaseFolding::Upper,
        _ => CaseFolding::None,
    }
}

fn is_plain_identifier(name: &str) -> bool {
    let mut chars = name.chars();
    matches!(chars.next(), Some(c) if c.is_ascii_alphabetic() || c == '_')
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

pub fn sql_identifier_needs_quotes(name: &str, db_type: &str) -> bool {
    if name.is_empty() {
        return false;
    }
    if !is_plain_identifier(name) {
        return true;
    }
    if reserved_words(db_type).contains(&name.to_ascii_lowercase()) {
        return true;
    }
    match case_folding(db_type) {
        CaseFolding::Lower => name != name.to_lowercase(),
        CaseFolding::Upper => name != name.to_uppercase(),
        CaseFolding::None => false,
    }
}

pub fn fold_unquoted_sql_identifier(name: &str, db_type: &str) -> String {
    match case_folding(db_type) {
        CaseFolding::Lower => name.to_lowercase(),
        CaseFolding::Upper => name.to_uppercase(),
        CaseFolding::None => name.to_string(),
    }
}

pub fn sql_dialect_folds_case(db_type: &str) -> bool {
    case_folding(db_type) != CaseFolding::None
}

/// `getSqlIdentifierQuoteChars`
pub fn sql_identifier_quote_chars(db_type: &str) -> (&'static str, &'static str) {
    match db_type {
        "mysql" | "clickhouse" => ("`", "`"),
        "mssql" => ("[", "]"),
        _ => ("\"", "\""),
    }
}

/// `quoteIdentifier` (lib/db/quote-identifier.ts) for the editor's dialects.
pub fn quote_sql_identifier_always(name: &str, db_type: &str) -> String {
    match sql_identifier_quote_chars(db_type) {
        ("`", _) => format!("`{}`", name.replace('`', "``")),
        ("[", _) => format!("[{}]", name.replace(']', "]]")),
        _ => format!("\"{}\"", name.replace('"', "\"\"")),
    }
}

pub fn format_sql_identifier(name: &str, db_type: &str) -> String {
    if !sql_identifier_needs_quotes(name, db_type) {
        return name.to_string();
    }
    quote_sql_identifier_always(name, db_type)
}

pub fn format_qualified_sql_identifier(parts: &[&str], db_type: &str) -> String {
    parts.iter().filter(|p| !p.is_empty()).map(|p| format_sql_identifier(p, db_type)).collect::<Vec<_>>().join(".")
}

pub fn unquote_sql_identifier(value: &str) -> String {
    if value.len() >= 2 {
        let (first, last) = (value.as_bytes()[0], value.as_bytes()[value.len() - 1]);
        let inner = &value[1..value.len() - 1];
        match (first, last) {
            (b'"', b'"') => return inner.replace("\"\"", "\""),
            (b'`', b'`') => return inner.replace("``", "`"),
            (b'[', b']') => return inner.replace("]]", "]"),
            _ => {}
        }
    }
    value.to_string()
}

// ---- sql-dialects.ts -----------------------------------------------------------

#[derive(Clone, Default, Debug)]
pub struct ContinuationRule {
    pub phrase: &'static str,
    pub keywords: &'static [&'static str],
    pub prefer_tables: bool,
    pub prefer_columns: bool,
    pub prefer_functions: bool,
    pub suppress_schema_items: bool,
}

const fn rule(phrase: &'static str, keywords: &'static [&'static str], flags: (bool, bool, bool, bool)) -> ContinuationRule {
    ContinuationRule {
        phrase,
        keywords,
        prefer_tables: flags.0,
        prefer_columns: flags.1,
        prefer_functions: flags.2,
        suppress_schema_items: flags.3,
    }
}

// flags: (preferTables, preferColumns, preferFunctions, suppressSchemaItems)
const N: (bool, bool, bool, bool) = (false, false, false, false);
const S: (bool, bool, bool, bool) = (false, false, false, true);
const T: (bool, bool, bool, bool) = (true, false, false, false);
const C: (bool, bool, bool, bool) = (false, true, false, false);
const CF: (bool, bool, bool, bool) = (false, true, true, false);

pub fn dialect_keywords(db_type: &str) -> &'static [&'static str] {
    match db_type {
        "postgres" => &[
            "ILIKE", "RETURNING", "SERIAL", "BIGSERIAL", "SMALLSERIAL", "JSONB", "TIMESTAMPTZ", "LATERAL", "MATERIALIZED",
            "UNLOGGED", "UPSERT", "DO", "NOTHING", "CONFLICT", "POLICY", "RLS", "VACUUM", "ANALYZE",
        ],
        "sqlite" => &["PRAGMA", "VACUUM", "WITHOUT", "ROWID", "AUTOINCREMENT", "REPLACE", "GLOB", "COLLATE", "ATTACH", "DETACH"],
        "mysql" => &[
            "SHOW", "DESCRIBE", "EXPLAIN", "RENAME", "OPTIMIZE", "REPAIR", "AUTO_INCREMENT", "ENGINE", "UNSIGNED", "ZEROFILL",
            "REGEXP",
        ],
        "clickhouse" => &[
            "FORMAT", "ENGINE", "MERGETREE", "ORDER", "BY", "SETTINGS", "PREWHERE", "SAMPLE", "FINAL", "TTL", "PARTITION",
            "LOWCARDINALITY",
        ],
        "mssql" => &[
            "TOP", "OUTPUT", "NVARCHAR", "BIT", "DATETIME2", "OFFSET", "ROWS", "FETCH", "NEXT", "PERCENT", "IDENTITY", "GO",
            "EXEC", "EXECUTE",
        ],
        "trino" => &[
            "SHOW", "DESCRIBE", "EXPLAIN", "USE", "CATALOGS", "SCHEMAS", "TABLES", "COLUMNS", "PREPARE", "EXECUTE",
            "DEALLOCATE",
        ],
        "spacetimedb" => &["REDUCER", "SUBSCRIBE", "IDENTITY", "SET", "SHOW"],
        _ => &[],
    }
}

fn dialect_rules(db_type: &str) -> Vec<ContinuationRule> {
    match db_type {
        "postgres" => vec![
            rule("returning", &[], C),
            rule("on", &["CONFLICT"], N),
            rule("on conflict", &["DO"], N),
            rule("do", &["NOTHING", "UPDATE"], N),
        ],
        "sqlite" => vec![rule("pragma", &["table_info", "index_list", "foreign_key_list"], S)],
        "mysql" => vec![rule("show", &["DATABASES", "TABLES", "COLUMNS", "INDEX", "CREATE"], S), rule("describe", &[], T)],
        "clickhouse" => vec![
            rule("order", &["BY"], S),
            rule("by", &[], C),
            rule("format", &["JSON", "JSONEachRow", "CSV", "TSV", "Pretty"], S),
            rule("engine", &["MergeTree", "ReplacingMergeTree", "SummingMergeTree"], S),
        ],
        "mssql" => vec![
            rule("select", &["TOP", "DISTINCT", "ALL"], CF),
            rule("top", &["(", "PERCENT"], S),
            rule("offset", &["ROWS"], S),
            rule("fetch", &["NEXT", "FIRST"], S),
            rule("fetch next", &["ROWS"], S),
        ],
        "trino" => vec![
            rule("show", &["CATALOGS", "SCHEMAS", "TABLES", "COLUMNS", "FUNCTIONS"], S),
            rule("describe", &[], T),
            rule("use", &["catalog", "schema"], S),
        ],
        "spacetimedb" => vec![rule("set", &["row_limit"], S), rule("show", &["row_limit"], S)],
        _ => vec![],
    }
}

const SELECT_LEAD: &[&str] = &["*", "CASE", "CAST", "COALESCE", "COUNT", "SUM", "AVG", "MIN", "MAX", "NULL", "TRUE", "FALSE"];

fn base_rules() -> Vec<ContinuationRule> {
    vec![
        rule("select", &["*", "DISTINCT", "ALL"], (false, true, true, true)),
        rule("select *", &["FROM"], S),
        rule("select all", SELECT_LEAD, (false, false, true, true)),
        rule("select distinct", SELECT_LEAD, (false, false, true, true)),
        rule("from", &[], T),
        rule("join", &[], T),
        rule("update", &[], T),
        rule("into", &[], T),
        rule("where", &[], CF),
        rule("on", &[], CF),
        rule("having", &[], CF),
        rule("set", &[], C),
        rule("group", &["BY"], S),
        rule("order", &["BY"], S),
        rule("group by", &[], C),
        rule("order by", &[], C),
        rule("union", &["ALL", "SELECT"], S),
        rule("union all", &["SELECT"], S),
        rule("insert", &["INTO"], S),
        rule("insert into", &[], T),
        rule("delete", &["FROM"], S),
        rule("limit", &["10", "100", "1000"], S),
    ]
}

/// `getSqlContinuationRule`
pub fn sql_continuation_rule(db_type: &str, tokens: &[String]) -> Option<ContinuationRule> {
    let n = tokens.len();
    let phrase = |k: usize| tokens[n.saturating_sub(k)..].join(" ").to_lowercase().trim().to_string();
    let phrases: Vec<String> = [3, 2, 1].iter().map(|&k| phrase(k)).filter(|p| !p.is_empty()).collect();
    let mut rules = dialect_rules(db_type);
    rules.extend(base_rules());
    for p in phrases {
        if let Some(r) = rules.iter().find(|r| r.phrase == p) {
            return Some(r.clone());
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_statements() {
        assert_eq!(split_sql_statements("select 1; select ';'; "), vec!["select 1", "select ';'"]);
        assert_eq!(
            split_sql_statements("do $$ begin; end $$; select 'it''s'"),
            vec!["do $$ begin; end $$", "select 'it''s'"]
        );
    }

    #[test]
    fn ai_prompt() {
        assert!(is_sql_ai_prompt("/ find users"));
        assert!(is_sql_ai_prompt("/"));
        assert!(!is_sql_ai_prompt("/* x */"));
        assert_eq!(get_sql_ai_prompt("  / find users "), "find users");
    }

    #[test]
    fn identifiers() {
        assert_eq!(format_sql_identifier("users", "postgres"), "users");
        assert_eq!(format_sql_identifier("Users", "postgres"), "\"Users\"");
        assert_eq!(format_sql_identifier("order", "mysql"), "`order`");
        assert_eq!(format_sql_identifier("Users", "sqlite"), "Users");
        assert_eq!(unquote_sql_identifier("\"a\"\"b\""), "a\"b");
    }
}
