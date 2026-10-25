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

/// Strip `keyword` (with word boundary) from the front of `text`,
/// skipping trailing whitespace and SQL comments so keywords separated
/// by comments (e.g. `OR REPLACE /* note */ PROCEDURE`) still match.
fn strip_keyword<'a>(text: &'a str, keyword: &str) -> Option<&'a str> {
    if starts_with_keyword(text, keyword) {
        Some(strip_leading_comments(text[keyword.len()..].trim_start()))
    } else {
        None
    }
}

/// Strip a sequence of keywords separated by whitespace and/or SQL
/// comments (e.g. `OR /* note */ REPLACE`).
fn strip_keyword_seq<'a>(mut text: &'a str, keywords: &[&str]) -> Option<&'a str> {
    for kw in keywords {
        text = strip_leading_comments(text.trim_start());
        text = strip_keyword(text, kw)?;
    }
    Some(strip_leading_comments(text.trim_start()))
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
        // Comments may sit between any opening keywords.
        rest = strip_leading_comments(rest);
        let mut progressed = false;
        for modifier in [
            &["OR", "REPLACE"][..],
            &["EDITIONABLE"][..],
            &["NONEDITIONABLE"][..],
            &["FORCE"][..],
            &["GLOBAL", "TEMPORARY"][..],
            &["PRIVATE", "TEMPORARY"][..],
            &["MATERIALIZED"][..],
            &["UNIQUE"][..],
            &["BITMAP"][..],
        ] {
            if let Some(after) = strip_keyword_seq(rest, modifier) {
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

/// Synthetic row-number column added by `rownum_paginate`, stripped back out
/// of the result before it reaches the caller. Kept to 15 bytes so it is
/// safe under Oracle 11g's 30-byte identifier limit.
const ROWNUM_PAGINATION_COLUMN: &str = "__REXADB_RNUM__";

struct Tok<'a> {
    text: &'a str,
    start: usize,
}

/// Recognizes the opening of an Oracle "q-quote" alternate-quoted literal —
/// `q'<delim> ... <delim>'`, optionally prefixed with `n`/`N` for an nchar
/// literal — whose entire purpose is letting the literal contain unescaped
/// apostrophes (e.g. `q'[it's]'`). `[`, `(`, `{` and `<` pair with their
/// closing bracket; any other delimiter character closes on itself.
///
/// Returns the end index (one past the closing `'`) when `bytes` at `start`
/// opens one, or `None` if it's just an ordinary word starting with `q`/`n`
/// (e.g. an identifier). Once the `q'<delim>` prefix itself has matched
/// there's no ordinary-SQL reading left, so an unterminated literal still
/// returns `Some(bytes.len())` rather than `None` — consistent with how
/// comments and ordinary quotes degrade in `tokenize` below.
fn oracle_q_quote_end(bytes: &[u8], start: usize) -> Option<usize> {
    let n = bytes.len();
    let mut i = start;
    if matches!(bytes.get(i), Some(b'n') | Some(b'N')) {
        i += 1;
    }
    if !matches!(bytes.get(i), Some(b'q') | Some(b'Q')) {
        return None;
    }
    i += 1;
    if bytes.get(i) != Some(&b'\'') {
        return None;
    }
    i += 1;
    let open = *bytes.get(i)?;
    i += 1;
    let close = match open {
        b'[' => b']',
        b'(' => b')',
        b'{' => b'}',
        b'<' => b'>',
        other => other,
    };
    while i < n {
        if bytes[i] == close && bytes.get(i + 1) == Some(&b'\'') {
            return Some(i + 2);
        }
        i += 1;
    }
    Some(n)
}

/// Splits SQL into whitespace-separated tokens, keeping each token's byte
/// offset in `s` so a matched suffix can be sliced back out of the original
/// (non-uppercased) text.
///
/// `--` and `/* */` comments and quoted literals — ordinary `'...'` /
/// `"..."` (honoring Oracle's doubled-quote escape) and q-quoted
/// `q'<delim>...<delim>'` — are skipped as single units and never produce
/// tokens of their own, so a keyword that only appears inside a comment or
/// a string literal can't be mistaken for the pagination clause this is
/// used to find.
///
/// Whitespace/comment/quote delimiters are matched on ASCII bytes only, and
/// every slice boundary sits immediately after one of those single-byte
/// ASCII delimiters (or at `n`), never inside a multi-byte UTF-8 sequence —
/// safe on non-ASCII SQL such as a literal containing `'à'`.
///
/// Runs of identifier bytes (alnum, `_`, `$`, `#`) are one token each; any
/// other non-whitespace, non-comment, non-quote byte (operators and
/// punctuation: `=`, `(`, `,`, …) is its own single-byte token rather than
/// gluing onto a neighboring identifier. Without this, `name=q'[...]'`
/// would tokenize as one word `name=q` — swallowing the `q` that should
/// have started a fresh dispatch — so the q-quote check below would never
/// get to see it as the start of a token.
fn is_ident_byte(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_' || b == b'$' || b == b'#'
}

fn tokenize(s: &str) -> Vec<Tok<'_>> {
    let mut toks = Vec::new();
    let bytes = s.as_bytes();
    let n = s.len();
    let mut i = 0;
    while i < n {
        let c = bytes[i];
        if c.is_ascii_whitespace() {
            i += 1;
            continue;
        }
        if c == b'-' && bytes.get(i + 1) == Some(&b'-') {
            i = match s[i..].find('\n') {
                Some(pos) => i + pos,
                None => n,
            };
            continue;
        }
        if c == b'/' && bytes.get(i + 1) == Some(&b'*') {
            i = match s[i + 2..].find("*/") {
                Some(pos) => i + 2 + pos + 2,
                None => n,
            };
            continue;
        }
        if matches!(c, b'q' | b'Q' | b'n' | b'N') {
            if let Some(end) = oracle_q_quote_end(bytes, i) {
                let start = i;
                toks.push(Tok { text: &s[start..end], start });
                i = end;
                continue;
            }
        }
        if c == b'\'' || c == b'"' {
            let quote = c;
            let start = i;
            i += 1;
            while i < n {
                if bytes[i] == quote {
                    i += 1;
                    if bytes.get(i) == Some(&quote) {
                        i += 1; // doubled quote: escaped, literal continues
                        continue;
                    }
                    break;
                }
                i += 1;
            }
            toks.push(Tok { text: &s[start..i], start });
            continue;
        }
        let start = i;
        if is_ident_byte(c) {
            while i < n && is_ident_byte(bytes[i]) {
                i += 1;
            }
        } else {
            i += 1;
        }
        toks.push(Tok { text: &s[start..i], start });
    }
    toks
}

fn eq_ignore_case(a: &str, b: &str) -> bool {
    a.eq_ignore_ascii_case(b)
}

/// Rewrites a statement whose final clause is Oracle 12c's
/// `OFFSET n ROWS FETCH {NEXT|FIRST} m ROWS ONLY` into the classic `ROWNUM`
/// pagination idiom, which every Oracle version (8i through current)
/// accepts. 12c+ rejects nothing extra by taking this path either, so it is
/// safe to apply unconditionally rather than branching on a detected server
/// version.
///
/// Older Oracle has no OFFSET/FETCH grammar at all: the parser treats the
/// statement as complete at `ORDER BY ...` and the trailing clause as
/// garbage, raising ORA-00933 ("SQL command not properly ended").
///
/// Returns `None` when the statement doesn't end in that exact clause, so
/// the caller falls back to running it unmodified.
fn rownum_paginate(sql: &str) -> Option<String> {
    let trimmed = sql.trim_end();
    let toks = tokenize(trimmed);
    if toks.len() < 8 {
        return None;
    }
    let last = &toks[toks.len() - 8..];
    if !eq_ignore_case(last[0].text, "OFFSET") {
        return None;
    }
    let offset: u64 = last[1].text.parse().ok()?;
    if !eq_ignore_case(last[2].text, "ROWS") || !eq_ignore_case(last[3].text, "FETCH") {
        return None;
    }
    if !eq_ignore_case(last[4].text, "NEXT") && !eq_ignore_case(last[4].text, "FIRST") {
        return None;
    }
    let limit: u64 = last[5].text.parse().ok()?;
    if !eq_ignore_case(last[6].text, "ROWS") || !eq_ignore_case(last[7].text, "ONLY") {
        return None;
    }
    // Deliberately not trimmed: `core`'s own trailing whitespace may be the
    // newline that terminates a `--` comment on its last line, and trimming
    // it would let the wrapper SQL appended right after get swallowed into
    // that now-unterminated comment. The explicit "\n" below guarantees the
    // same thing independent of whatever core already ends with.
    let core = &trimmed[..last[0].start];
    if core.trim().is_empty() {
        return None;
    }
    let max_row = offset.saturating_add(limit);
    Some(format!(
        "SELECT * FROM (SELECT rexadb_pg__.*, ROWNUM AS \"{col}\" FROM ({core}\n) rexadb_pg__ WHERE ROWNUM <= {max_row}) WHERE \"{col}\" > {offset}",
        col = ROWNUM_PAGINATION_COLUMN,
    ))
}

/// Drops the synthetic `ROWNUM_PAGINATION_COLUMN` that `rownum_paginate`
/// adds, so the rewrite is invisible to callers. Always the last column in
/// the result (the rewrite appends it after `rexadb_pg__.*` and nothing is
/// selected after it at any wrapping level), so it's removed by position —
/// not by name — so a query whose own column is legitimately named
/// `ROWNUM_PAGINATION_COLUMN` can't be confused with the appended one, and
/// doesn't make the removal ambiguous.
fn strip_rownum_column(mut columns: Vec<Value>, rows: Vec<Vec<Value>>) -> (Vec<Value>, Vec<Vec<Value>>) {
    if columns.pop().is_none() {
        return (columns, rows);
    }
    let rows = rows
        .into_iter()
        .map(|mut row| {
            row.pop();
            row
        })
        .collect();
    (columns, rows)
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
        let paginated = rownum_paginate(&rewritten);
        let to_run = paginated.as_deref().unwrap_or(&rewritten);
        let cursor = conn
            .query(to_run, &bind_refs)
            .map_err(|e| e.to_string())?;
        let (columns, rows) = fetch_cursor(cursor)?;
        let (columns, rows) = if paginated.is_some() {
            strip_rownum_column(columns, rows)
        } else {
            (columns, rows)
        };
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
            "CREATE OR REPLACE /* note */ PROCEDURE p AS BEGIN NULL; END;",
            "CREATE /* c */ OR /* d */ REPLACE -- trailing note\nPROCEDURE p AS BEGIN NULL; END;",
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

    #[test]
    fn rewrites_trailing_offset_fetch_to_rownum() {
        let sql = r#"SELECT * FROM "HR"."EMPLOYEES" ORDER BY 1 OFFSET 100 ROWS FETCH NEXT 50 ROWS ONLY"#;
        let rewritten = rownum_paginate(sql).expect("should rewrite");
        assert!(rewritten.contains(r#"SELECT * FROM "HR"."EMPLOYEES" ORDER BY 1"#));
        assert!(rewritten.contains("ROWNUM <= 150"));
        assert!(rewritten.contains(&format!("\"{ROWNUM_PAGINATION_COLUMN}\" > 100")));
        assert!(!rewritten.to_ascii_uppercase().contains("OFFSET"));
    }

    #[test]
    fn rewrites_fetch_first_variant_too() {
        let sql = "SELECT * FROM t ORDER BY 1 OFFSET 0 ROWS FETCH FIRST 10 ROWS ONLY";
        let rewritten = rownum_paginate(sql).expect("should rewrite");
        assert!(rewritten.contains("ROWNUM <= 10"));
    }

    #[test]
    fn leaves_queries_without_a_trailing_offset_fetch_alone() {
        for sql in [
            "SELECT * FROM t",
            "SELECT * FROM t WHERE x = 1 ORDER BY 1",
            "SELECT * FROM (SELECT * FROM t OFFSET 0 ROWS FETCH NEXT 5 ROWS ONLY) sub WHERE sub.x = 1",
        ] {
            assert!(rownum_paginate(sql).is_none(), "should not rewrite: {sql}");
        }
    }

    #[test]
    fn strips_the_synthetic_column_from_results() {
        let columns = vec![
            json!({ "name": "ID", "type": "DB_TYPE_NUMBER" }),
            json!({ "name": ROWNUM_PAGINATION_COLUMN, "type": "DB_TYPE_NUMBER" }),
        ];
        let rows = vec![vec![json!(1), json!(1)], vec![json!(2), json!(2)]];
        let (columns, rows) = strip_rownum_column(columns, rows);
        assert_eq!(columns.len(), 1);
        assert_eq!(columns[0]["name"], "ID");
        assert_eq!(rows, vec![vec![json!(1)], vec![json!(2)]]);
    }

    #[test]
    fn strips_by_position_even_if_the_users_own_column_shares_the_name() {
        // The appended rownum column is always last; a same-named column
        // from the query itself (first here) must survive untouched.
        let columns = vec![
            json!({ "name": ROWNUM_PAGINATION_COLUMN, "type": "DB_TYPE_NUMBER" }),
            json!({ "name": "ID", "type": "DB_TYPE_NUMBER" }),
        ];
        let rows = vec![vec![json!(42), json!(1)]];
        let (columns, rows) = strip_rownum_column(columns, rows);
        assert_eq!(columns.len(), 1);
        assert_eq!(columns[0]["name"], ROWNUM_PAGINATION_COLUMN);
        assert_eq!(rows, vec![vec![json!(42)]]);
    }

    #[test]
    fn tokenize_does_not_panic_on_non_ascii_literals() {
        // 'à' is C3 A0 in UTF-8; A0 alone casts to char U+00A0 (a Unicode
        // whitespace), which used to make the byte-whitespace check slice
        // through the middle of the character and panic.
        let toks = tokenize("SELECT 'à' FROM dual OFFSET 0 ROWS FETCH NEXT 10 ROWS ONLY");
        let texts: Vec<&str> = toks.iter().map(|t| t.text).collect();
        assert_eq!(
            texts,
            vec!["SELECT", "'à'", "FROM", "dual", "OFFSET", "0", "ROWS", "FETCH", "NEXT", "10", "ROWS", "ONLY"]
        );
        assert!(rownum_paginate("SELECT 'à' FROM dual OFFSET 0 ROWS FETCH NEXT 10 ROWS ONLY").is_some());
    }

    #[test]
    fn ignores_pagination_keywords_inside_a_trailing_comment() {
        // The real last tokens are inside a `--` comment, not a live clause.
        let sql = "SELECT * FROM t -- OFFSET 0 ROWS FETCH NEXT 10 ROWS ONLY";
        assert!(rownum_paginate(sql).is_none());
    }

    #[test]
    fn ignores_pagination_keywords_inside_a_string_literal() {
        let sql = "SELECT 'OFFSET 0 ROWS FETCH NEXT 10 ROWS ONLY' FROM dual";
        assert!(rownum_paginate(sql).is_none());
    }

    #[test]
    fn preserves_a_trailing_line_comment_in_the_core_query() {
        // The OFFSET clause is real SQL on the line after a `-- note`
        // comment; the newline that ends that comment must survive into
        // `core` so the wrapper SQL appended after it doesn't get eaten by
        // an unterminated comment.
        let sql = "SELECT * FROM t -- note\nOFFSET 0 ROWS FETCH NEXT 10 ROWS ONLY";
        let rewritten = rownum_paginate(sql).expect("should rewrite");
        let core_line = rewritten.lines().next().unwrap();
        assert!(core_line.ends_with("-- note"), "comment must stay on its own line: {core_line:?}");
        assert!(
            rewritten.contains("ROWNUM <= 10"),
            "wrapper SQL must not have been swallowed by the comment: {rewritten}"
        );
    }

    #[test]
    fn q_quoted_literal_with_embedded_apostrophe_does_not_swallow_the_rest() {
        let sql = "SELECT q'[it's]' FROM dual OFFSET 0 ROWS FETCH NEXT 10 ROWS ONLY";
        let toks = tokenize(sql);
        let texts: Vec<&str> = toks.iter().map(|t| t.text).collect();
        assert_eq!(
            texts,
            vec!["SELECT", "q'[it's]'", "FROM", "dual", "OFFSET", "0", "ROWS", "FETCH", "NEXT", "10", "ROWS", "ONLY"]
        );
        let rewritten = rownum_paginate(sql).expect("should rewrite");
        assert!(rewritten.contains("ROWNUM <= 10"));
    }

    #[test]
    fn q_quoted_filter_with_embedded_apostrophe_still_paginates() {
        // Same shape as a real table filter: name = q'[O'Brien]'
        let sql = "SELECT * FROM people WHERE name = q'[O'Brien]' ORDER BY 1 OFFSET 0 ROWS FETCH NEXT 10 ROWS ONLY";
        let rewritten = rownum_paginate(sql).expect("should rewrite");
        assert!(rewritten.contains("q'[O'Brien]'"));
        assert!(rewritten.contains("ROWNUM <= 10"));
    }

    #[test]
    fn q_quote_delimiter_variants_and_nchar_prefix_are_recognized() {
        for (sql, expected_literal) in [
            ("SELECT q'(a)b)'", "q'(a)b)'"),
            ("SELECT q'{x}'", "q'{x}'"),
            ("SELECT q'<y>'", "q'<y>'"),
            ("SELECT q'!z!'", "q'!z!'"),
            ("SELECT nq'[nchar]'", "nq'[nchar]'"),
            ("SELECT NQ'[NCHAR]'", "NQ'[NCHAR]'"),
        ] {
            let toks = tokenize(sql);
            assert_eq!(toks.last().unwrap().text, expected_literal, "sql: {sql}");
        }
    }

    #[test]
    fn q_prefixed_identifiers_are_not_mistaken_for_q_quotes() {
        // No apostrophe directly after q/n, so these are ordinary words.
        let toks = tokenize("SELECT quantity, name FROM t");
        let texts: Vec<&str> = toks.iter().map(|t| t.text).collect();
        assert_eq!(texts, vec!["SELECT", "quantity", ",", "name", "FROM", "t"]);
    }

    #[test]
    fn q_quote_immediately_after_an_operator_with_no_space_is_recognized() {
        // `=` isn't an identifier byte, so it's its own token and `q'...'`
        // still gets a fresh dispatch right after it, exactly like the
        // `name = q'[O'Brien]'` case but with no surrounding whitespace.
        let sql = "SELECT * FROM people WHERE name=q'[O'Brien]' ORDER BY 1 OFFSET 0 ROWS FETCH NEXT 10 ROWS ONLY";
        let toks = tokenize(sql);
        let texts: Vec<&str> = toks.iter().map(|t| t.text).collect();
        assert!(texts.contains(&"q'[O'Brien]'"), "q-quote must be its own token: {texts:?}");
        let rewritten = rownum_paginate(sql).expect("should rewrite");
        assert!(rewritten.contains("q'[O'Brien]'"));
        assert!(rewritten.contains("ROWNUM <= 10"));
    }

    #[test]
    fn q_quote_immediately_after_open_paren_or_comma_is_recognized() {
        for sql in [
            "SELECT f(q'[a]') FROM dual OFFSET 0 ROWS FETCH NEXT 10 ROWS ONLY",
            "SELECT x,q'[a]' FROM dual OFFSET 0 ROWS FETCH NEXT 10 ROWS ONLY",
        ] {
            assert!(rownum_paginate(sql).is_some(), "should rewrite: {sql}");
        }
    }
}
