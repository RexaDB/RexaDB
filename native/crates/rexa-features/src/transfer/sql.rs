//! Port of lib/transfer/transfer-sql.ts (+ transfer-server-query.ts).
//!
//! Shared SQL helpers for transfer adapters: quoting of source values
//! interpolated into destination SQL, a quote-aware statement splitter,
//! per-table data export as batched multi-row INSERTs, chunk parsing /
//! FK ordering for import, and the resilient (savepoint + retry) row apply.
//!
//! Values: the native drivers return every cell as server-rendered text
//! (Postgres text protocol), which is exactly the input syntax of the same
//! type, so a quoted literal coerces back to the destination column type
//! (INSERT … VALUES applies target column types). Arrays that arrive as JSON
//! text from HTTP drivers (supabase-mgmt) are rebuilt as `ARRAY[…]::elem[]`
//! like `formatValueWithType`.

use anyhow::{anyhow, Result};
use regex::Regex;
use rexa_drivers::{Cell, Driver, Record};
use std::collections::{BTreeSet, HashMap, HashSet};
use std::sync::{Arc, LazyLock};

pub type Db = Arc<dyn Driver>;

/// Large enough to never truncate a transfer read (tables above
/// `MAX_DATA_EXPORT_ROWS` are skipped before reading).
const ROW_LIMIT: usize = 50_000_000;

/// `serverTransferQuery` returning rows.
pub async fn select(db: &Db, sql: &str) -> Result<Vec<Record>> {
    Ok(db.execute(sql, ROW_LIMIT).await?.records())
}

/// `serverTransferQuery` for statements (rows ignored).
pub async fn exec(db: &Db, sql: &str) -> Result<()> {
    db.execute(sql, 1).await.map(|_| ())
}

/// Error text like the original's `String(res.error)`.
pub fn err_text(e: &anyhow::Error) -> String {
    format!("{e:#}")
}

/// Quote a Postgres identifier.
pub fn escape_ident(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

/// Quote a string as a SQL literal.
pub fn escape_literal(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

pub fn qualified_table(schema: &str, table: &str) -> String {
    format!("{}.{}", escape_ident(schema), escape_ident(table))
}

/// `formatValueWithType` over text cells.
pub fn format_value_with_type(val: &Cell, udt_name: Option<&str>) -> String {
    let Some(s) = val.as_str() else { return "NULL".into() };
    if let Some(elem) = udt_name.and_then(|u| u.strip_prefix('_')) {
        if s.trim_start().starts_with('[') {
            if let Ok(serde_json::Value::Array(items)) = serde_json::from_str::<serde_json::Value>(s) {
                if items.is_empty() {
                    return format!("ARRAY[]::{elem}[]");
                }
                let parts: Vec<String> = items.iter().map(json_literal).collect();
                return format!("ARRAY[{}]::{elem}[]", parts.join(","));
            }
        }
    }
    if udt_name == Some("bytea") {
        static HEX: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\\x[0-9a-fA-F]*$").unwrap());
        if HEX.is_match(s) {
            return format!("{}::bytea", escape_literal(s));
        }
        return escape_literal(&s.replace('\\', "\\\\"));
    }
    escape_literal(s)
}

fn json_literal(v: &serde_json::Value) -> String {
    match v {
        serde_json::Value::Null => "NULL".into(),
        serde_json::Value::Bool(b) => if *b { "TRUE" } else { "FALSE" }.into(),
        serde_json::Value::Number(n) => n.to_string(),
        serde_json::Value::String(s) => escape_literal(s),
        other => escape_literal(&other.to_string()),
    }
}

fn dollar_tag_at(s: &str, pos: usize) -> Option<String> {
    static TAG: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$)").unwrap());
    TAG.find(&s[pos..]).map(|m| m.as_str().to_string())
}

/// `splitSqlStatements`: split respecting '' literals, "" identifiers,
/// dollar-quoted bodies and `--` line comments.
pub fn split_sql_statements(sql: &str) -> Vec<String> {
    let mut statements = Vec::new();
    let mut current = String::new();
    let b = sql.as_bytes();
    let mut i = 0;
    let mut dollar: Option<String> = None;
    let next_char = |i: usize| sql[i..].chars().next().map_or(1, char::len_utf8);
    while i < b.len() {
        if let Some(tag) = &dollar {
            if sql[i..].starts_with(tag.as_str()) {
                current.push_str(tag);
                i += tag.len();
                dollar = None;
            } else {
                let n = next_char(i);
                current.push_str(&sql[i..i + n]);
                i += n;
            }
            continue;
        }
        let ch = b[i];
        let next = b.get(i + 1).copied();
        if ch == b'-' && next == Some(b'-') {
            let stop = sql[i..].find('\n').map_or(b.len(), |e| i + e);
            current.push_str(&sql[i..stop]);
            i = stop;
            continue;
        }
        if ch == b'\'' || ch == b'"' {
            let q = ch;
            if q == b'\'' && next == Some(b'\'') {
                current.push_str("''");
                i += 2;
                continue;
            }
            current.push(q as char);
            i += 1;
            while i < b.len() {
                if b[i] == q && b.get(i + 1) == Some(&q) {
                    current.push(q as char);
                    current.push(q as char);
                    i += 2;
                    continue;
                }
                let n = next_char(i);
                current.push_str(&sql[i..i + n]);
                let closed = b[i] == q;
                i += n;
                if closed {
                    break;
                }
            }
            continue;
        }
        if ch == b'$' {
            if let Some(tag) = dollar_tag_at(sql, i) {
                current.push_str(&tag);
                i += tag.len();
                dollar = Some(tag);
                continue;
            }
        }
        if ch == b';' {
            let stmt = current.trim();
            if !stmt.is_empty() {
                statements.push(stmt.to_string());
            }
            current.clear();
            i += 1;
            continue;
        }
        let n = next_char(i);
        current.push_str(&sql[i..i + n]);
        i += n;
    }
    let tail = current.trim();
    static COMMENT_ONLY: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^--[^\n]*$").unwrap());
    if !tail.is_empty() && !COMMENT_ONLY.is_match(tail) {
        statements.push(tail.to_string());
    }
    statements
}

/// Tables larger than this are skipped for row-data export (schema still migrates).
pub const MAX_DATA_EXPORT_ROWS: i64 = 10_000;
/// Rows per INSERT statement.
pub const DATA_EXPORT_BATCH_SIZE: usize = 500;

#[derive(Debug, Clone, PartialEq)]
pub enum DataStatus {
    Ok,
    Empty,
    Skipped,
    Failed,
}

#[derive(Debug, Clone)]
pub struct TableDataExport {
    pub sql: String,
    pub exported_rows: i64,
    pub status: DataStatus,
    pub message: Option<String>,
}

impl TableDataExport {
    fn none(status: DataStatus, message: Option<String>) -> Self {
        TableDataExport { sql: String::new(), exported_rows: 0, status, message }
    }
}

async fn fetch_column_types(db: &Db, schema: &str, table: &str) -> HashMap<String, String> {
    let sql = format!(
        "SELECT column_name, udt_name FROM information_schema.columns WHERE table_schema = {} AND table_name = {}",
        escape_literal(schema),
        escape_literal(table)
    );
    select(db, &sql)
        .await
        .map(|rows| rows.iter().filter_map(|r| Some((r.opt("column_name")?, r.opt("udt_name")?))).collect())
        .unwrap_or_default()
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Generated {
    Always,
    ByDefault,
    Stored,
}

/// `fetchGeneratedColumns`
pub async fn fetch_generated_columns(db: &Db, schema: &str, table: &str) -> HashMap<String, Generated> {
    let sql = format!(
        "SELECT a.attname AS column_name, a.attidentity AS identity, a.attgenerated AS generated
       FROM pg_attribute a
       JOIN pg_class c ON c.oid = a.attrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = {} AND c.relname = {}
         AND a.attnum > 0 AND NOT a.attisdropped",
        escape_literal(schema),
        escape_literal(table)
    );
    let mut map = HashMap::new();
    for row in select(db, &sql).await.unwrap_or_default() {
        let Some(name) = row.opt("column_name") else { continue };
        let identity = row.string("identity");
        let generated = row.string("generated");
        if generated == "s" {
            map.insert(name, Generated::Stored);
        } else if identity == "a" {
            map.insert(name, Generated::Always);
        } else if identity == "d" {
            map.insert(name, Generated::ByDefault);
        }
    }
    map
}

/// `exportTableDataSql`
pub async fn export_table_data_sql(db: &Db, schema: &str, table: &str, row_count: i64) -> TableDataExport {
    if row_count <= 0 {
        return TableDataExport::none(DataStatus::Empty, None);
    }
    if row_count >= MAX_DATA_EXPORT_ROWS {
        let message = format!(
            "Skipping data export for {schema}.{table} ({row_count} rows exceeds limit of {MAX_DATA_EXPORT_ROWS}); schema migrates, data does not."
        );
        return TableDataExport::none(DataStatus::Skipped, Some(message));
    }
    let data = db.execute(&format!("SELECT * FROM {}", qualified_table(schema, table)), ROW_LIMIT).await;
    let column_types = fetch_column_types(db, schema, table).await;
    let generated = fetch_generated_columns(db, schema, table).await;
    let data = match data {
        Ok(d) => d,
        Err(e) => {
            let message = format!("Failed to export data for {schema}.{table}: {}", err_text(&e));
            return TableDataExport::none(DataStatus::Failed, Some(message));
        }
    };
    if data.rows.is_empty() {
        return TableDataExport::none(DataStatus::Empty, None);
    }
    let columns: Vec<(usize, &String)> =
        data.columns.iter().enumerate().filter(|(_, c)| generated.get(*c) != Some(&Generated::Stored)).collect();
    if columns.is_empty() {
        let message =
            format!("Skipping data export for {schema}.{table}: every column is generated; values recompute on import.");
        return TableDataExport::none(DataStatus::Skipped, Some(message));
    }
    let has_always = columns.iter().any(|(_, c)| generated.get(*c) == Some(&Generated::Always));
    let target = qualified_table(schema, table);
    let col_list = columns.iter().map(|(_, c)| escape_ident(c)).collect::<Vec<_>>().join(", ");
    let overriding = if has_always { " OVERRIDING SYSTEM VALUE" } else { "" };
    let format_row = |row: &Vec<Cell>| {
        let vals: Vec<String> = columns
            .iter()
            .map(|(i, c)| format_value_with_type(row.get(*i).unwrap_or(&Cell::Null), column_types.get(*c).map(String::as_str)))
            .collect();
        format!("({})", vals.join(", "))
    };
    let mut lines = Vec::new();
    for batch in data.rows.chunks(DATA_EXPORT_BATCH_SIZE) {
        let tuples: Vec<String> = batch.iter().map(format_row).collect();
        lines.push(format!("INSERT INTO {target} ({col_list}){overriding} VALUES {};", tuples.join(",\n")));
    }
    TableDataExport {
        sql: format!("-- Data for {schema}.{table} ({} rows)\n{}\n", data.rows.len(), lines.join("\n")),
        exported_rows: data.rows.len() as i64,
        status: DataStatus::Ok,
        message: None,
    }
}

/// `isProgrammableStatement`
pub fn is_programmable_statement(sql: &str) -> bool {
    static RE: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"(?i)^\s*CREATE\s+(OR\s+REPLACE\s+)?(FUNCTION|PROCEDURE|TRIGGER|POLICY|VIEW|MATERIALIZED\s+VIEW)\b").unwrap()
    });
    RE.is_match(sql)
}

/// `isSecurityCriticalProgrammable`
pub fn is_security_critical_programmable(sql: &str) -> bool {
    static A: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"(?i)^\s*CREATE\s+(OR\s+REPLACE\s+)?(TRIGGER|POLICY)\b").unwrap());
    static B: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)\b(ENABLE|FORCE)\s+ROW\s+LEVEL\s+SECURITY\b").unwrap());
    A.is_match(sql) || B.is_match(sql)
}

#[derive(Debug, Clone)]
pub struct FailedStatement {
    pub statement: String,
    pub error: String,
}

/// Executes one statement in the caller's isolation (savepoint or bare).
pub trait Exec {
    fn run(&mut self, sql: &str) -> impl std::future::Future<Output = Result<()>> + Send;
}

/// `applyRowsResiliently`: each statement isolated; one retry pass.
pub async fn apply_rows_resiliently<E: Exec>(exec: &mut E, statements: &[String]) -> (usize, Vec<FailedStatement>) {
    let mut applied = 0;
    let mut failed = Vec::new();
    for stmt in statements {
        match exec.run(stmt).await {
            Ok(()) => applied += 1,
            Err(e) => failed.push(FailedStatement { statement: stmt.clone(), error: err_text(&e) }),
        }
    }
    let mut still = Vec::new();
    for f in failed {
        match exec.run(&f.statement).await {
            Ok(()) => applied += 1,
            Err(e) => still.push(FailedStatement { statement: f.statement, error: err_text(&e) }),
        }
    }
    (applied, still)
}

/// One-line preview for warnings/errors.
pub fn short_statement(stmt: &str, max: usize) -> String {
    stmt.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(max).collect()
}

/// `splitMultiRowInsert`
pub fn split_multi_row_insert(stmt: &str) -> Vec<String> {
    static RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?s)^(.*?\bVALUES\s+)(.+?);?\s*$").unwrap());
    let trimmed = stmt.trim();
    let Some(m) = RE.captures(trimmed) else { return vec![stmt.to_string()] };
    let prefix = &m[1];
    let body = &m[2];
    let mut tuples = Vec::new();
    let (mut paren, mut bracket, mut brace) = (0i32, 0i32, 0i32);
    let (mut in_single, mut in_double) = (false, false);
    let mut cur = String::new();
    let chars: Vec<char> = body.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        let ch = chars[i];
        let nx = chars.get(i + 1).copied();
        if in_single || in_double {
            let q = if in_single { '\'' } else { '"' };
            if ch == q && nx == Some(q) {
                cur.push(q);
                cur.push(q);
                i += 2;
                continue;
            }
            if ch == q {
                in_single = false;
                in_double = false;
            }
            cur.push(ch);
            i += 1;
            continue;
        }
        match ch {
            '\'' => in_single = true,
            '"' => in_double = true,
            '(' => paren += 1,
            ')' => paren -= 1,
            '[' => bracket += 1,
            ']' => bracket -= 1,
            '{' => brace += 1,
            '}' => brace -= 1,
            _ => {}
        }
        if ch == ',' && paren == 0 && bracket == 0 && brace == 0 {
            if !cur.trim().is_empty() {
                tuples.push(cur.trim().to_string());
            }
            cur.clear();
            i += 1;
            continue;
        }
        cur.push(ch);
        i += 1;
    }
    if !cur.trim().is_empty() {
        tuples.push(cur.trim().to_string());
    }
    if tuples.len() <= 1 {
        return vec![stmt.to_string()];
    }
    tuples.into_iter().map(|t| format!("{prefix}{t};")).collect()
}

/// `applyChunkResiliently`: batches run whole; a failed batch expands to
/// singles with isolation + retry. Every row failing identically is
/// systemic → error.
pub async fn apply_chunk_resiliently<E: Exec>(exec: &mut E, chunk_sql: &str) -> Result<(usize, Vec<FailedStatement>)> {
    let mut applied = 0;
    let mut failed = Vec::new();
    for raw in split_sql_statements(chunk_sql) {
        let stmt = strip_comment_lines(&raw);
        if stmt.is_empty() {
            continue;
        }
        match exec.run(&stmt).await {
            Ok(()) => applied += 1,
            Err(e) => {
                let singles = split_multi_row_insert(&stmt);
                if singles.len() <= 1 {
                    failed.push(FailedStatement { statement: stmt, error: err_text(&e) });
                    continue;
                }
                let (ok, res_failed) = apply_rows_resiliently(exec, &singles).await;
                applied += ok;
                if res_failed.len() == singles.len() && res_failed.iter().all(|f| f.error == res_failed[0].error) {
                    return Err(anyhow!("{}", res_failed[0].error));
                }
                failed.extend(res_failed);
            }
        }
    }
    Ok((applied, failed))
}

/// A per-table slice of a dataSql bundle.
#[derive(Debug, Clone, PartialEq)]
pub struct DataChunk {
    pub schema: String,
    pub table: String,
    pub sql: String,
}

fn chunk_marker(line: &str) -> Option<String> {
    static RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^-- Data for\s+(.+?)(?:\s+\(\d+\s+rows\))?\s*$").unwrap());
    RE.captures(line.trim()).map(|c| c[1].to_string())
}

fn split_chunk_name(name: &str) -> (String, String) {
    match name.rfind('.') {
        Some(dot) => (name[..dot].to_string(), name[dot + 1..].to_string()),
        None => (String::new(), name.to_string()),
    }
}

/// `stripCommentLines`: quote-aware removal of full-line `--` comments.
pub fn strip_comment_lines(sql: &str) -> String {
    let (mut in_single, mut in_double) = (false, false);
    let mut dollar: Option<String> = None;
    let mut kept: Vec<&str> = Vec::new();
    for line in sql.split('\n') {
        let is_comment = !in_single && !in_double && dollar.is_none() && line.trim_start().starts_with("--");
        if is_comment {
            continue;
        }
        let b = line.as_bytes();
        let mut i = 0;
        while i < b.len() {
            if let Some(tag) = &dollar {
                if line[i..].starts_with(tag.as_str()) {
                    i += tag.len();
                    dollar = None;
                } else {
                    i += 1;
                }
                continue;
            }
            let ch = b[i];
            let next = b.get(i + 1).copied();
            if in_single || in_double {
                let q = if in_single { b'\'' } else { b'"' };
                if ch == q && next == Some(q) {
                    i += 2;
                } else {
                    if ch == q {
                        in_single = false;
                        in_double = false;
                    }
                    i += 1;
                }
                continue;
            }
            match ch {
                b'\'' => in_single = true,
                b'"' => in_double = true,
                b'$' if line.is_char_boundary(i) => {
                    if let Some(tag) = dollar_tag_at(line, i) {
                        i += tag.len();
                        dollar = Some(tag);
                        continue;
                    }
                }
                _ => {}
            }
            i += 1;
        }
        kept.push(line);
    }
    kept.join("\n").trim().to_string()
}

/// `parseDataChunks`
pub fn parse_data_chunks(data_sql: &str) -> Vec<DataChunk> {
    let mut chunks = Vec::new();
    let mut current: Option<(String, String, Vec<String>)> = None;
    let flush = |current: &mut Option<(String, String, Vec<String>)>, chunks: &mut Vec<DataChunk>| {
        if let Some((schema, table, parts)) = current.take() {
            if !parts.is_empty() {
                let terminated: Vec<String> =
                    parts.into_iter().map(|p| if p.ends_with(';') { p } else { format!("{p};") }).collect();
                chunks.push(DataChunk { schema, table, sql: terminated.join("\n") });
            }
        }
    };
    for stmt in split_sql_statements(data_sql) {
        let marker = stmt.split('\n').find_map(chunk_marker);
        let executable = strip_comment_lines(&stmt);
        if let Some(name) = marker {
            flush(&mut current, &mut chunks);
            let (schema, table) = split_chunk_name(&name);
            let mut parts = Vec::new();
            if !executable.is_empty() {
                parts.push(executable);
            }
            current = Some((schema, table, parts));
        } else {
            if executable.is_empty() {
                continue;
            }
            current.get_or_insert_with(|| (String::new(), String::new(), Vec::new())).2.push(executable);
        }
    }
    flush(&mut current, &mut chunks);
    chunks
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct TableDependency {
    pub schema: String,
    pub table: String,
    pub ref_schema: String,
    pub ref_table: String,
}

/// `orderChunksByDependency` (stable Kahn; cycles fall back to export order).
pub fn order_chunks_by_dependency(chunks: &[DataChunk], deps: &[TableDependency]) -> Vec<DataChunk> {
    let key = |s: &str, t: &str| format!("{s}.{t}");
    let mut index_by_key: HashMap<String, usize> = HashMap::new();
    for (i, c) in chunks.iter().enumerate() {
        index_by_key.entry(key(&c.schema, &c.table)).or_insert(i);
    }
    let mut incoming: Vec<HashSet<usize>> = vec![HashSet::new(); chunks.len()];
    for d in deps {
        let (Some(&from), Some(&to)) = (index_by_key.get(&key(&d.schema, &d.table)), index_by_key.get(&key(&d.ref_schema, &d.ref_table)))
        else {
            continue;
        };
        if from != to {
            incoming[from].insert(to);
        }
    }
    let mut remaining: BTreeSet<usize> = (0..chunks.len()).collect();
    let mut ordered = Vec::new();
    while let Some(&first) = remaining.iter().next() {
        let next = remaining.iter().copied().find(|i| incoming[*i].iter().all(|d| !remaining.contains(d))).unwrap_or(first);
        remaining.remove(&next);
        ordered.push(chunks[next].clone());
    }
    ordered
}

/// FK edges (`information_schema` query shared by both apply paths).
pub const FK_EDGES_SQL: &str = "SELECT tc.table_schema AS schema, tc.table_name AS tbl,
        ccu.table_schema AS ref_schema, ccu.table_name AS ref_table
 FROM information_schema.table_constraints AS tc
 JOIN information_schema.key_column_usage AS kcu
   ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
 JOIN information_schema.constraint_column_usage AS ccu
   ON ccu.constraint_name = tc.constraint_name
 WHERE tc.constraint_type = 'FOREIGN KEY'";

pub fn fk_edges(rows: &[Record]) -> Vec<TableDependency> {
    let mut seen = HashSet::new();
    let mut deps = Vec::new();
    for r in rows {
        let d = TableDependency {
            schema: r.string("schema"),
            table: r.string("tbl"),
            ref_schema: r.string("ref_schema"),
            ref_table: r.string("ref_table"),
        };
        if seen.insert(d.clone()) {
            deps.push(d);
        }
    }
    deps
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_respecting_quotes() {
        let sql = "INSERT INTO t VALUES ('a;b');\nCREATE FUNCTION f() RETURNS int AS $$ SELECT 1; $$ LANGUAGE sql;\n-- trailing";
        let s = split_sql_statements(sql);
        assert_eq!(s.len(), 2);
        assert!(s[0].contains("'a;b'"));
        assert!(s[1].contains("SELECT 1;"));
        assert_eq!(split_sql_statements("SELECT \"x;y\"; SELECT 'it''s'"), vec!["SELECT \"x;y\"", "SELECT 'it''s'"]);
    }

    #[test]
    fn multi_row_insert_split() {
        let s = split_multi_row_insert("INSERT INTO t (a, b) VALUES ('x,(y)', ARRAY[1,2]),\n('z', '{1,2}');");
        assert_eq!(s, vec!["INSERT INTO t (a, b) VALUES ('x,(y)', ARRAY[1,2]);", "INSERT INTO t (a, b) VALUES ('z', '{1,2}');"]);
        assert_eq!(split_multi_row_insert("INSERT INTO t VALUES (1)").len(), 1);
    }

    #[test]
    fn chunks_parse_and_order() {
        let data = "-- Data for public.child (1 rows)\nINSERT INTO c VALUES (1);\n-- Data for public.parent (1 rows)\nINSERT INTO p VALUES ('-- not a comment');\n";
        let chunks = parse_data_chunks(data);
        assert_eq!(chunks.len(), 2);
        assert_eq!(chunks[0].table, "child");
        assert_eq!(chunks[1].sql, "INSERT INTO p VALUES ('-- not a comment');");
        let deps = vec![TableDependency { schema: "public".into(), table: "child".into(), ref_schema: "public".into(), ref_table: "parent".into() }];
        let ordered = order_chunks_by_dependency(&chunks, &deps);
        assert_eq!(ordered[0].table, "parent");
    }

    #[test]
    fn strips_comments_quote_aware() {
        assert_eq!(strip_comment_lines("-- x\nSELECT 'a\n-- kept'\n-- gone"), "SELECT 'a\n-- kept'");
    }

    #[test]
    fn formats_values() {
        assert_eq!(format_value_with_type(&Cell::Null, None), "NULL");
        assert_eq!(format_value_with_type(&Cell::Text("it's".into()), Some("text")), "'it''s'");
        assert_eq!(format_value_with_type(&Cell::Text("[\"a\",1]".into()), Some("_text")), "ARRAY['a',1]::text[]");
        assert_eq!(format_value_with_type(&Cell::Text("\\x00ff".into()), Some("bytea")), "'\\x00ff'::bytea");
        assert!(is_programmable_statement("create or replace function x()"));
        assert!(is_security_critical_programmable("ALTER TABLE t ENABLE ROW LEVEL SECURITY"));
    }
}
