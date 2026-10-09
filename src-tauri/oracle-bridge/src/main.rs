//! RexaDB Oracle bridge — JSON lines over stdin/stdout.
//!
//! Protocol (one JSON object per line), matching the JDBC bridge shape:
//!   {"reqId":"1","action":"connect","config":{"connectString":"...","username":"...","password":"..."}}
//!   {"reqId":"2","action":"query","session":1,"sql":"SELECT 1 FROM DUAL"}
//!   {"reqId":"3","action":"schemas","session":1}
//!   {"reqId":"4","action":"tables","session":1,"schema":"HR"}
//!   {"reqId":"5","action":"structure","session":1,"schema":"HR","table":"EMP"}
//!   {"reqId":"6","action":"foreign-keys","session":1,"schema":"HR","table":"EMP"}
//!   {"reqId":"7","action":"disconnect","session":1}

use std::collections::HashMap;
use std::io::{self, BufRead, Write};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;

use oracledb::{Connection, Metadata, OracleNumber, OracleTimestamp, Row};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

static NEXT_SESSION: AtomicU32 = AtomicU32::new(1);
static SESSIONS: Mutex<Option<HashMap<u32, Connection>>> = Mutex::new(None);

fn sessions() -> std::sync::MutexGuard<'static, Option<HashMap<u32, Connection>>> {
    let mut guard = SESSIONS.lock().unwrap_or_else(|e| e.into_inner());
    if guard.is_none() {
        *guard = Some(HashMap::new());
    }
    guard
}

#[derive(Debug, Deserialize)]
struct Request {
    #[serde(rename = "reqId")]
    req_id: Option<String>,
    action: Option<String>,
    session: Option<u32>,
    config: Option<ConnectConfig>,
    sql: Option<String>,
    schema: Option<String>,
    table: Option<String>,
    #[serde(default)]
    params: Vec<Value>,
}

#[derive(Debug, Deserialize)]
struct ConnectConfig {
    #[serde(rename = "connectString")]
    connect_string: String,
    username: Option<String>,
    password: Option<String>,
}

#[derive(Serialize)]
struct Response {
    ok: bool,
    session: u32,
    #[serde(rename = "reqId")]
    req_id: Option<String>,
    data: Value,
}

fn respond(ok: bool, session: u32, req_id: Option<String>, data: Value) {
    let resp = Response {
        ok,
        session,
        req_id,
        data,
    };
    let mut out = io::stdout().lock();
    let _ = writeln!(out, "{}", serde_json::to_string(&resp).unwrap_or_else(|_| r#"{"ok":false,"session":0,"reqId":null,"data":{"error":"serialize failed"}}"#.to_string()));
    let _ = out.flush();
}

fn error_data(msg: impl ToString) -> Value {
    json!({ "error": msg.to_string() })
}

fn escape_literal(value: &str) -> String {
    value.replace('\'', "''")
}

fn cell_to_json(row: &Row, index: usize, meta: &Metadata) -> Value {
    let type_name = meta.db_type().name();

    // Null check via Option on the most common shapes first.
    if type_name.contains("VARCHAR")
        || type_name.contains("CHAR")
        || type_name.contains("CLOB")
        || type_name.contains("LONG")
        || type_name.contains("ROWID")
        || type_name.contains("JSON")
    {
        return match row.get::<Option<String>>(index) {
            Ok(Some(v)) => Value::String(v),
            Ok(None) => Value::Null,
            Err(_) => Value::Null,
        };
    }

    if type_name.contains("NUMBER") || type_name.contains("FLOAT") || type_name.contains("DOUBLE") {
        if let Ok(Some(n)) = row.get::<Option<OracleNumber>>(index) {
            let s = n.to_string();
            if let Ok(i) = s.parse::<i64>() {
                // JSON numbers lose precision above 2^53-1; keep large integers exact as strings.
                const MAX_SAFE: i64 = 9_007_199_254_740_991;
                const MIN_SAFE: i64 = -9_007_199_254_740_991;
                if i >= MIN_SAFE && i <= MAX_SAFE {
                    return json!(i);
                }
                return Value::String(s);
            }
            if let Ok(f) = s.parse::<f64>() {
                return json!(f);
            }
            return Value::String(s);
        }
        if let Ok(Some(f)) = row.get::<Option<f64>>(index) {
            return json!(f);
        }
        if let Ok(Some(i)) = row.get::<Option<i64>>(index) {
            const MAX_SAFE: i64 = 9_007_199_254_740_991;
            const MIN_SAFE: i64 = -9_007_199_254_740_991;
            if i >= MIN_SAFE && i <= MAX_SAFE {
                return json!(i);
            }
            return Value::String(i.to_string());
        }
        return Value::Null;
    }

    if type_name.contains("BOOLEAN") {
        return match row.get::<Option<bool>>(index) {
            Ok(Some(v)) => Value::Bool(v),
            Ok(None) => Value::Null,
            Err(_) => Value::Null,
        };
    }

    if type_name.contains("DATE") || type_name.contains("TIMESTAMP") {
        if let Ok(Some(ts)) = row.get::<Option<OracleTimestamp>>(index) {
            return Value::String(ts.to_string());
        }
        if let Ok(Some(s)) = row.get::<Option<String>>(index) {
            return Value::String(s);
        }
        return Value::Null;
    }

    if type_name.contains("RAW") || type_name.contains("BLOB") {
        return match row.get::<Option<Vec<u8>>>(index) {
            Ok(Some(bytes)) => Value::String(bytes.iter().map(|b| format!("{b:02x}")).collect()),
            Ok(None) => Value::Null,
            Err(_) => Value::Null,
        };
    }

    // Fallback: try string, then number, then null.
    if let Ok(Some(v)) = row.get::<Option<String>>(index) {
        return Value::String(v);
    }
    if let Ok(Some(n)) = row.get::<Option<OracleNumber>>(index) {
        return Value::String(n.to_string());
    }
    if let Ok(Some(i)) = row.get::<Option<i64>>(index) {
        const MAX_SAFE: i64 = 9_007_199_254_740_991;
        const MIN_SAFE: i64 = -9_007_199_254_740_991;
        if i >= MIN_SAFE && i <= MAX_SAFE {
            return json!(i);
        }
        return Value::String(i.to_string());
    }
    if let Ok(Some(f)) = row.get::<Option<f64>>(index) {
        return json!(f);
    }
    if let Ok(None) = row.get::<Option<String>>(index) {
        return Value::Null;
    }
    Value::Null
}

fn fetch_cursor(cursor: oracledb::Cursor) -> Result<(Vec<Value>, Vec<Vec<Value>>), String> {
    let columns_meta: Vec<Metadata> = cursor.columns().to_vec();
    let columns: Vec<Value> = columns_meta
        .iter()
        .map(|m| {
            json!({
                "name": m.name(),
                "type": m.db_type().name(),
            })
        })
        .collect();

    let mut rows: Vec<Vec<Value>> = Vec::new();
    for row_result in cursor {
        let row = row_result.map_err(|e| e.to_string())?;
        let mut values = Vec::with_capacity(columns_meta.len());
        for (i, meta) in columns_meta.iter().enumerate() {
            values.push(cell_to_json(&row, i, meta));
        }
        rows.push(values);
    }
    Ok((columns, rows))
}

fn strip_leading_comments(sql: &str) -> &str {
    let mut rest = sql.trim_start();
    loop {
        if rest.starts_with("--") {
            match rest.find('\n') {
                Some(pos) => rest = rest[pos + 1..].trim_start(),
                None => return "",
            }
            continue;
        }
        if rest.starts_with("/*") {
            match rest.find("*/") {
                Some(pos) => rest = rest[pos + 2..].trim_start(),
                None => return "",
            }
            continue;
        }
        break;
    }
    rest
}

fn is_select_like(sql: &str) -> bool {
    let trimmed = strip_leading_comments(sql);
    let upper = trimmed.to_ascii_uppercase();
    upper.starts_with("SELECT")
        || upper.starts_with("WITH")
        || upper.starts_with("SHOW")
        || upper.starts_with("DESCRIBE")
        || upper.starts_with("DESC ")
        || upper.starts_with("EXPLAIN")
}

fn is_ident_boundary(c: char) -> bool {
    !(c.is_ascii_alphanumeric() || c == '_' || c == '$' || c == '#')
}

/// True when `text` starts with `keyword` followed by a word boundary.
fn starts_with_keyword(text: &str, keyword: &str) -> bool {
    match text.get(..keyword.len()) {
        Some(prefix) if prefix == keyword => text
            .chars()
            .nth(keyword.len())
            .map(is_ident_boundary)
            .unwrap_or(true),
        _ => false,
    }
}

/// Strip `keyword` (with word boundary) from the front of `text`.
fn strip_keyword<'a>(text: &'a str, keyword: &str) -> Option<&'a str> {
    if starts_with_keyword(text, keyword) {
        Some(text[keyword.len()..].trim_start())
    } else {
        None
    }
}

fn first_word(text: &str) -> &str {
    let end = text
        .find(is_ident_boundary)
        .unwrap_or(text.len());
    &text[..end]
}

fn is_plsql_block(sql: &str) -> bool {
    let upper = strip_leading_comments(sql).to_ascii_uppercase();
    let trimmed = upper.trim_start();
    if starts_with_keyword(trimmed, "BEGIN") || starts_with_keyword(trimmed, "DECLARE") {
        return true;
    }
    // Only CREATE PROCEDURE/FUNCTION/TRIGGER/PACKAGE/TYPE (with optional
    // OR REPLACE / EDITIONABLE / FORCE modifiers) is PL/SQL. The object
    // kind must come immediately after CREATE — e.g. CREATE OR REPLACE
    // VIEW ... AS SELECT object_type ... is ordinary SQL even though the
    // statement text contains "TYPE".
    let Some(mut rest) = strip_keyword(trimmed, "CREATE") else {
        return false;
    };
    loop {
        let mut progressed = false;
        for modifier in [
            "OR REPLACE",
            "EDITIONABLE",
            "NONEDITIONABLE",
            "FORCE",
            "GLOBAL TEMPORARY",
            "PRIVATE TEMPORARY",
            "MATERIALIZED",
            "UNIQUE",
            "BITMAP",
        ] {
            if let Some(after) = strip_keyword(rest, modifier) {
                rest = after;
                progressed = true;
            }
        }
        if !progressed {
            break;
        }
    }
    matches!(
        first_word(rest),
        "PROCEDURE" | "FUNCTION" | "TRIGGER" | "PACKAGE" | "TYPE"
    )
}

fn strip_trailing_delimiter(sql: &str) -> String {
    // A trailing `;` is only a client delimiter on ordinary SQL — Oracle
    // rejects it through the driver. PL/SQL blocks and routine definitions
    // require their final semicolon, so leave them intact.
    if is_plsql_block(sql) {
        return sql.trim_end().to_string();
    }
    let mut out = sql.trim_end().to_string();
    while out.ends_with(';') {
        out.pop();
        out = out.trim_end().to_string();
    }
    out
}

fn value_to_bind(value: &Value) -> Result<Box<dyn oracledb::ToDbValue + '_>, String> {
    match value {
        Value::Null => Ok(Box::new(Option::<String>::None)),
        Value::Bool(b) => Ok(Box::new(*b)),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                Ok(Box::new(i))
            } else if let Some(f) = n.as_f64() {
                Ok(Box::new(f))
            } else {
                Ok(Box::new(n.to_string()))
            }
        }
        Value::String(s) => Ok(Box::new(s.clone())),
        other => Ok(Box::new(other.to_string())),
    }
}

fn rewrite_qmark_binds(sql: &str) -> String {
    // Convert JDBC-style `?` placeholders to Oracle positional `:1`, `:2`, …
    let mut out = String::with_capacity(sql.len() + 8);
    let mut index = 0u32;
    let mut in_single = false;
    let mut in_double = false;
    let mut chars = sql.chars().peekable();
    while let Some(ch) = chars.next() {
        match ch {
            '\'' if !in_double => {
                in_single = !in_single;
                out.push(ch);
            }
            '"' if !in_single => {
                in_double = !in_double;
                out.push(ch);
            }
            '?' if !in_single && !in_double => {
                index += 1;
                out.push(':');
                out.push_str(&index.to_string());
            }
            _ => out.push(ch),
        }
    }
    out
}

fn run_query(conn: &Connection, sql: &str, params: &[Value]) -> Result<Value, String> {
    // Plain SQL must not carry the trailing `;` client delimiter; PL/SQL
    // keeps everything except the final delimiter.
    let stripped = strip_trailing_delimiter(sql);
    let rewritten = rewrite_qmark_binds(&stripped);
    let binds: Vec<Box<dyn oracledb::ToDbValue + '_>> = params
        .iter()
        .map(value_to_bind)
        .collect::<Result<Vec<_>, _>>()?;
    let bind_refs: Vec<&dyn oracledb::ToDbValue> = binds.iter().map(|b| b.as_ref()).collect();

    if is_select_like(&rewritten) {
        let cursor = conn
            .query(&rewritten, &bind_refs)
            .map_err(|e| e.to_string())?;
        let (columns, rows) = fetch_cursor(cursor)?;
        let row_count = rows.len();
        Ok(json!({
            "columns": columns,
            "rows": rows,
            "rowCount": row_count,
        }))
    } else {
        let result = conn
            .execute(&rewritten, &bind_refs)
            .map_err(|e| e.to_string())?;
        let _ = conn.commit();
        Ok(json!({
            "columns": [],
            "rows": [],
            "rowCount": result.rows_affected(),
            "affectedRows": result.rows_affected(),
        }))
    }
}

fn handle_connect(config: ConnectConfig) -> Result<u32, String> {
    let username = config.username.unwrap_or_default();
    let password = config.password.unwrap_or_default();
    let cfg = oracledb::Config::default()
        .set_credentials(&username, &password)
        .set_connect_string(&config.connect_string)
        .map_err(|e| e.to_string())?;
    let conn = oracledb::connect(cfg).map_err(|e| e.to_string())?;
    let id = NEXT_SESSION.fetch_add(1, Ordering::SeqCst);
    sessions().as_mut().unwrap().insert(id, conn);
    Ok(id)
}

fn with_session<F>(session: u32, f: F) -> Result<Value, String>
where
    F: FnOnce(&Connection) -> Result<Value, String>,
{
    let guard = sessions();
    let map = guard.as_ref().unwrap();
    let conn = map
        .get(&session)
        .ok_or_else(|| format!("Unknown session {session}"))?;
    f(conn)
}

fn handle_schemas(conn: &Connection) -> Result<Value, String> {
    // Prefer the connected user first, then other non-Oracle-maintained schemas.
    let sql = r#"
SELECT username FROM (
  SELECT USER AS username, 0 AS ord FROM dual
  UNION ALL
  SELECT username, 1 AS ord
  FROM all_users
  WHERE username NOT IN (
    'ANONYMOUS','APPQOSSYS','AUDSYS','CTXSYS','DBSFWUSER','DBSNMP','DIP',
    'DVF','DVSYS','GGSYS','GSMADMIN_INTERNAL','GSMCATUSER','GSMUSER',
    'LBACSYS','MDDATA','MDSYS','OJVMSYS','OLAPSYS','ORACLE_OCM','ORDDATA',
    'ORDPLUGINS','ORDSYS','OUTLN','REMOTE_SCHEDULER_AGENT','SI_INFORMTN_SCHEMA',
    'SYS','SYS$UMF','SYSBACKUP','SYSDG','SYSKM','SYSRAC','SYSTEM','WMSYS','XDB','XS$NULL'
  )
  AND username <> USER
)
ORDER BY ord, username
"#;
    let cursor = conn.query(sql, &[]).map_err(|e| e.to_string())?;
    let (_cols, rows) = fetch_cursor(cursor)?;
    Ok(json!({ "columns": [{ "name": "USERNAME", "type": "DB_TYPE_VARCHAR" }], "rows": rows }))
}

fn handle_tables(conn: &Connection, schema: &str) -> Result<Value, String> {
    let owner = escape_literal(schema);
    let sql = format!(
        r#"
SELECT object_name, object_type, owner FROM (
  SELECT table_name AS object_name, 'TABLE' AS object_type, owner
  FROM all_tables WHERE owner = '{owner}'
  UNION ALL
  SELECT view_name AS object_name, 'VIEW' AS object_type, owner
  FROM all_views WHERE owner = '{owner}'
)
ORDER BY object_type, object_name
"#
    );
    let cursor = conn.query(&sql, &[]).map_err(|e| e.to_string())?;
    let (_cols, rows) = fetch_cursor(cursor)?;
    Ok(json!({
        "columns": [
            { "name": "NAME", "type": "DB_TYPE_VARCHAR" },
            { "name": "TYPE", "type": "DB_TYPE_VARCHAR" },
            { "name": "SCHEMA", "type": "DB_TYPE_VARCHAR" }
        ],
        "rows": rows
    }))
}

fn handle_structure(conn: &Connection, schema: &str, table: &str) -> Result<Value, String> {
    let owner = escape_literal(schema);
    let table_name = escape_literal(table);
    let sql = format!(
        r#"
SELECT
  c.column_name,
  c.data_type,
  NVL(c.data_length, 0),
  CASE WHEN c.nullable = 'Y' THEN 1 ELSE 0 END,
  c.data_default,
  c.column_id
FROM all_tab_columns c
WHERE c.owner = '{owner}' AND c.table_name = '{table_name}'
ORDER BY c.column_id
"#
    );
    let cursor = conn.query(&sql, &[]).map_err(|e| e.to_string())?;
    let (_cols, rows) = fetch_cursor(cursor)?;
    Ok(json!({
        "columns": [
            { "name": "NAME", "type": "DB_TYPE_VARCHAR" },
            { "name": "TYPE", "type": "DB_TYPE_VARCHAR" },
            { "name": "SIZE", "type": "DB_TYPE_NUMBER" },
            { "name": "NULLABLE", "type": "DB_TYPE_NUMBER" },
            { "name": "DEFAULT", "type": "DB_TYPE_VARCHAR" },
            { "name": "ORDINAL", "type": "DB_TYPE_NUMBER" }
        ],
        "rows": rows
    }))
}

fn handle_foreign_keys(conn: &Connection, schema: &str, table: &str) -> Result<Value, String> {
    let owner = escape_literal(schema);
    let table_name = escape_literal(table);
    let sql = format!(
        r#"
SELECT
  a.column_name AS fk_column,
  c_pk.table_name AS pk_table,
  c_pk.owner AS pk_schema,
  b.column_name AS pk_column
FROM all_cons_columns a
JOIN all_constraints c
  ON a.owner = c.owner AND a.constraint_name = c.constraint_name
JOIN all_constraints c_pk
  ON c.r_owner = c_pk.owner AND c.r_constraint_name = c_pk.constraint_name
JOIN all_cons_columns b
  ON c_pk.owner = b.owner
 AND c_pk.constraint_name = b.constraint_name
 AND a.position = b.position
WHERE c.constraint_type = 'R'
  AND a.owner = '{owner}'
  AND a.table_name = '{table_name}'
ORDER BY a.constraint_name, a.position
"#
    );
    let cursor = conn.query(&sql, &[]).map_err(|e| e.to_string())?;
    let (_cols, rows) = fetch_cursor(cursor)?;
    Ok(json!({
        "columns": [
            { "name": "FK_COLUMN", "type": "DB_TYPE_VARCHAR" },
            { "name": "PK_TABLE", "type": "DB_TYPE_VARCHAR" },
            { "name": "PK_SCHEMA", "type": "DB_TYPE_VARCHAR" },
            { "name": "PK_COLUMN", "type": "DB_TYPE_VARCHAR" }
        ],
        "rows": rows
    }))
}

fn handle_request(req: Request) {
    let req_id = req.req_id.clone();
    let action = req.action.as_deref().unwrap_or("");
    match action {
        "connect" => match req.config {
            Some(config) => match handle_connect(config) {
                Ok(session) => respond(true, session, req_id, json!({})),
                Err(e) => respond(false, 0, req_id, error_data(e)),
            },
            None => respond(false, 0, req_id, error_data("missing config")),
        },
        "disconnect" => {
            let session = req.session.unwrap_or(0);
            let mut guard = sessions();
            if let Some(conn) = guard.as_mut().unwrap().remove(&session) {
                drop(conn);
            }
            respond(true, session, req_id, json!({}));
        }
        "query" => {
            let session = req.session.unwrap_or(0);
            let sql = req.sql.unwrap_or_default();
            match with_session(session, |conn| run_query(conn, &sql, &req.params)) {
                Ok(data) => respond(true, session, req_id, data),
                Err(e) => respond(false, session, req_id, error_data(e)),
            }
        }
        "schemas" => {
            let session = req.session.unwrap_or(0);
            match with_session(session, handle_schemas) {
                Ok(data) => respond(true, session, req_id, data),
                Err(e) => respond(false, session, req_id, error_data(e)),
            }
        }
        "tables" => {
            let session = req.session.unwrap_or(0);
            let schema = req.schema.unwrap_or_default();
            match with_session(session, |conn| handle_tables(conn, &schema)) {
                Ok(data) => respond(true, session, req_id, data),
                Err(e) => respond(false, session, req_id, error_data(e)),
            }
        }
        "structure" => {
            let session = req.session.unwrap_or(0);
            let schema = req.schema.unwrap_or_default();
            let table = req.table.unwrap_or_default();
            match with_session(session, |conn| handle_structure(conn, &schema, &table)) {
                Ok(data) => respond(true, session, req_id, data),
                Err(e) => respond(false, session, req_id, error_data(e)),
            }
        }
        "foreign-keys" => {
            let session = req.session.unwrap_or(0);
            let schema = req.schema.unwrap_or_default();
            let table = req.table.unwrap_or_default();
            match with_session(session, |conn| handle_foreign_keys(conn, &schema, &table)) {
                Ok(data) => respond(true, session, req_id, data),
                Err(e) => respond(false, session, req_id, error_data(e)),
            }
        }
        "" => respond(false, 0, req_id, error_data("no action")),
        other => respond(
            false,
            0,
            req_id,
            error_data(format!("unknown action: {other}")),
        ),
    }
}

fn main() {
    let stdin = io::stdin();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        match serde_json::from_str::<Request>(line) {
            Ok(req) => handle_request(req),
            Err(e) => respond(false, 0, None, error_data(format!("invalid json: {e}"))),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plsql_blocks_keep_their_semicolon() {
        for sql in [
            "BEGIN NULL; END;",
            "  DECLARE x NUMBER; BEGIN x := 1; END;",
            "CREATE OR REPLACE PROCEDURE p AS BEGIN NULL; END;",
            "CREATE PROCEDURE p AS BEGIN NULL; END;",
            "CREATE OR REPLACE EDITIONABLE FUNCTION f RETURN NUMBER AS BEGIN RETURN 1; END;",
            "CREATE OR REPLACE TRIGGER t BEFORE INSERT ON emp FOR EACH ROW BEGIN NULL; END;",
            "CREATE OR REPLACE PACKAGE pkg AS PROCEDURE p; END pkg;",
            "CREATE OR REPLACE TYPE t AS OBJECT (x NUMBER);",
        ] {
            assert!(is_plsql_block(sql), "expected PL/SQL: {sql}");
            assert!(
                strip_trailing_delimiter(sql).ends_with(';'),
                "semicolon must be preserved: {sql}"
            );
        }
    }

    #[test]
    fn ordinary_sql_is_not_plsql() {
        for sql in [
            "SELECT object_type FROM all_objects;",
            "CREATE OR REPLACE VIEW v AS SELECT object_type FROM all_objects;",
            "CREATE OR REPLACE FORCE VIEW v AS SELECT 1 FROM dual;",
            "CREATE TABLE t (object_type VARCHAR2(30));",
            "CREATE INDEX i ON t (object_type);",
            "CREATE OR REPLACE SYNONYM s FOR rexadb.employees;",
            "-- comment mentioning TYPE\nSELECT 1 FROM dual;",
            "/* PACKAGE */ SELECT 1 FROM dual;",
        ] {
            assert!(!is_plsql_block(sql), "expected ordinary SQL: {sql}");
            assert!(
                !strip_trailing_delimiter(sql).ends_with(';'),
                "delimiter must be stripped: {sql}"
            );
        }
    }

    #[test]
    fn commented_selects_take_the_cursor_path() {
        assert!(is_select_like("-- report\nSELECT 1 FROM dual"));
        assert!(is_select_like("/* nightly */ WITH x AS (SELECT 1 FROM dual) SELECT * FROM x"));
    }
}
