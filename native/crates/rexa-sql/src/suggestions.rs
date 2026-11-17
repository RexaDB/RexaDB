//! Port of lib/studio/sql-suggestions.ts — the ranking the Monaco completion
//! provider in monaco-sql-input.tsx asks for. Offsets are byte offsets.

use crate::sql_text::*;
use regex::Regex;
use std::collections::HashMap;
use std::sync::OnceLock;

const SQL_KEYWORDS: &[&str] = &[
    "SELECT", "FROM", "WHERE", "INSERT", "INTO", "VALUES", "UPDATE", "SET", "DELETE", "CREATE", "ALTER", "DROP", "TABLE",
    "VIEW", "INDEX", "JOIN", "LEFT", "RIGHT", "INNER", "OUTER", "FULL", "ON", "GROUP", "BY", "ORDER", "LIMIT", "OFFSET",
    "HAVING", "DISTINCT", "UNION", "ALL", "AS", "AND", "OR", "NOT", "NULL", "CASE", "WHEN", "THEN", "ELSE", "END", "LIKE",
    "ILIKE", "IN", "EXISTS", "WITH", "RECURSIVE", "RETURNING", "MERGE", "USING", "ONLY", "LATERAL", "CROSS", "NATURAL",
    "ASC", "DESC", "NULLS", "FIRST", "LAST", "WINDOW", "OVER", "PARTITION", "ROWS", "RANGE", "CURRENT", "ROW",
    "FOLLOWING", "PRECEDING", "BETWEEN", "FETCH", "NEXT", "TIES", "FOR", "SHARE", "LOCKED", "NOWAIT", "SKIP",
    "MATERIALIZED", "TEMP", "TEMPORARY", "IF", "CASCADE", "RESTRICT", "TRUNCATE", "COMMENT", "ANALYZE", "VACUUM",
    "GRANT", "REVOKE", "BEGIN", "COMMIT", "ROLLBACK", "SAVEPOINT", "RELEASE", "DECLARE", "CURSOR", "DO", "LANGUAGE",
    "FUNCTION", "PROCEDURE", "TRIGGER", "SEQUENCE", "SCHEMA", "DATABASE", "TYPE", "ENUM", "PRIMARY", "FOREIGN", "KEY",
    "REFERENCES", "CONSTRAINT", "UNIQUE", "CHECK", "DEFAULT", "GENERATED", "IDENTITY", "SERIAL", "BIGSERIAL",
    "SMALLSERIAL", "BOOLEAN", "INTEGER", "BIGINT", "SMALLINT", "NUMERIC", "DECIMAL", "REAL", "DOUBLE", "PRECISION",
    "TEXT", "VARCHAR", "CHAR", "UUID", "JSON", "JSONB", "DATE", "TIME", "TIMESTAMP", "TIMESTAMPTZ", "INTERVAL", "BYTEA",
    "ARRAY", "CAST", "COALESCE", "GREATEST", "LEAST", "COUNT", "SUM", "AVG", "MIN", "MAX", "ABS", "ROUND", "FLOOR", "CEIL",
    "LOWER", "UPPER", "TRIM", "LTRIM", "RTRIM", "SUBSTRING", "POSITION", "LENGTH", "CONCAT", "REPLACE", "SPLIT_PART",
    "DATE_TRUNC", "EXTRACT", "AGE", "NOW", "CURRENT_DATE", "CURRENT_TIME", "CURRENT_TIMESTAMP", "TRUE", "FALSE",
];

const SQL_FUNCTIONS: &[&str] = &[
    "COUNT", "SUM", "AVG", "MIN", "MAX", "COALESCE", "CAST", "DATE_TRUNC", "EXTRACT", "LOWER", "UPPER", "TRIM",
    "SUBSTRING", "LENGTH", "CONCAT", "ROW_NUMBER", "RANK", "DENSE_RANK", "LAG", "LEAD", "JSON_BUILD_OBJECT",
    "JSONB_BUILD_OBJECT", "ARRAY_AGG", "STRING_AGG", "GREATEST", "LEAST", "NOW",
];

const CLAUSE_BOUNDARY_KEYWORDS: &[&str] = &[
    "select", "all", "distinct", "from", "join", "left", "right", "inner", "outer", "full", "where", "on", "group", "by",
    "order", "having", "limit", "offset", "insert", "into", "update", "set", "delete", "values", "as", "and", "or",
    "case", "when", "then", "else",
];

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum SuggestionKind {
    Keyword,
    Table,
    Column,
    Function,
}

#[derive(Clone, Debug, PartialEq)]
pub struct SqlSuggestionItem {
    pub label: String,
    pub insert_text: String,
    pub kind: SuggestionKind,
    pub detail: Option<String>,
    pub filter_text: Option<String>,
}

/// One table of the editor's `schemaData`.
#[derive(Clone, Debug, Default)]
pub struct SchemaEntry {
    pub schema: String,
    pub name: String,
    pub columns: Vec<(String, String)>,
}

pub struct SqlSuggestions {
    pub items: Vec<SqlSuggestionItem>,
    pub token_start: usize,
    pub token_end: usize,
}

const IDENT: &str = r#"(?:"(?:[^"]|"")+"|`(?:[^`]|``)+`|\[(?:[^\]]|\]\])+\]|[a-zA-Z_][a-zA-Z0-9_$]*)"#;

fn re(cell: &'static OnceLock<Regex>, pattern: impl FnOnce() -> String) -> &'static Regex {
    cell.get_or_init(|| Regex::new(&pattern()).unwrap())
}

fn word_tokens(s: &str, with_star: bool) -> Vec<String> {
    static A: OnceLock<Regex> = OnceLock::new();
    static B: OnceLock<Regex> = OnceLock::new();
    let r = if with_star { re(&B, || "[a-zA-Z_*]+".into()) } else { re(&A, || "[a-zA-Z_]+".into()) };
    r.find_iter(s).map(|m| m.as_str().to_lowercase()).collect()
}

struct ContextInfo {
    clause: String,
    has_table_context: bool,
    just_typed_select: bool,
    just_typed_select_modifier: bool,
    start_of_statement: bool,
    trailing_whitespace: bool,
    after_select_star: bool,
    just_typed_union: bool,
    just_typed_union_all: bool,
}

fn get_clause(before: &str) -> String {
    const CLAUSES: &[&str] =
        &["select", "from", "join", "where", "on", "group", "order", "having", "update", "into", "set", "delete", "insert"];
    word_tokens(before, false).into_iter().rev().find(|t| CLAUSES.contains(&t.as_str())).unwrap_or_else(|| "select".into())
}

fn context_info(before: &str, has_table_context: bool) -> ContextInfo {
    static START: OnceLock<Regex> = OnceLock::new();
    static STAR: OnceLock<Regex> = OnceLock::new();
    let tokens = word_tokens(before, true);
    let last = tokens.last().cloned().unwrap_or_default();
    let prev = tokens.len().checked_sub(2).map(|i| tokens[i].clone()).unwrap_or_default();
    let trimmed = before.trim_end();
    ContextInfo {
        clause: get_clause(before),
        has_table_context,
        just_typed_select: last == "select",
        just_typed_select_modifier: prev == "select" && (last == "all" || last == "distinct"),
        start_of_statement: trimmed.is_empty() || re(&START, || r"(?i)[;(]\s*[a-zA-Z_*]*$".into()).is_match(trimmed),
        trailing_whitespace: before.ends_with(char::is_whitespace),
        after_select_star: re(&STAR, || r"(?i)\bselect\s+\*\s*$".into()).is_match(trimmed),
        just_typed_union: last == "union",
        just_typed_union_all: prev == "union" && last == "all",
    }
}

#[derive(Clone)]
struct Ident {
    name: String,
    quoted: bool,
}

fn parse_identifier(raw: &str) -> Ident {
    Ident { name: unquote_sql_identifier(raw), quoted: raw.starts_with(['"', '`', '[']) }
}

fn match_identifier(candidate: &str, id: &Ident, db: &str) -> u8 {
    let resolved = if id.quoted { id.name.clone() } else { fold_unquoted_sql_identifier(&id.name, db) };
    if candidate == resolved {
        return 2;
    }
    if id.quoted && sql_dialect_folds_case(db) {
        return 0;
    }
    if candidate.to_lowercase() == id.name.to_lowercase() {
        1
    } else {
        0
    }
}

fn find_open_identifier_quote(statement: &str, open: &str, close: &str, db: &str) -> Option<usize> {
    let mut open_at: Option<usize> = None;
    let mut i = 0;
    let bytes = statement.as_bytes();
    while i < statement.len() {
        let ch = bytes[i];
        if open_at.is_none() {
            let line_comment = statement[i..].starts_with("--") || (ch == b'#' && db == "mysql");
            if line_comment {
                match statement[i..].find('\n') {
                    Some(e) => {
                        i += e + 1;
                        continue;
                    }
                    None => return None,
                }
            }
            if statement[i..].starts_with("/*") {
                match statement[i + 2..].find("*/") {
                    Some(e) => {
                        i += 2 + e + 2;
                        continue;
                    }
                    None => return None,
                }
            }
            if ch == b'\'' || (ch == b'"' && open != "\"") {
                match statement[i + 1..].find(ch as char) {
                    Some(e) => {
                        i += 1 + e + 1;
                        continue;
                    }
                    None => return None,
                }
            }
            if statement[i..].starts_with(open) {
                open_at = Some(i);
                i += open.len();
                continue;
            }
        } else if statement[i..].starts_with(close) {
            if statement[i + close.len()..].starts_with(close) {
                i += close.len() * 2;
                continue;
            }
            open_at = None;
            i += close.len();
            continue;
        }
        i += 1;
        while i < statement.len() && !statement.is_char_boundary(i) {
            i += 1;
        }
    }
    open_at
}

struct CursorToken {
    token: String,
    quoted: bool,
    span: usize,
    head: String,
}

fn parse_cursor_token(statement: &str, db: &str) -> CursorToken {
    static TOK: OnceLock<Regex> = OnceLock::new();
    let (open, close) = sql_identifier_quote_chars(db);
    if let Some(at) = find_open_identifier_quote(statement, open, close, db) {
        let fragment = &statement[at + open.len()..];
        return CursorToken {
            token: fragment.replace(&format!("{close}{close}"), close),
            quoted: true,
            span: statement.len() - at,
            head: statement[..at].to_string(),
        };
    }
    let token = re(&TOK, || "[a-zA-Z_][a-zA-Z0-9_]*$".into()).find(statement).map(|m| m.as_str().to_string()).unwrap_or_default();
    CursorToken { span: token.len(), head: statement[..statement.len() - token.len()].to_string(), token, quoted: false }
}

fn parse_schema_prefix(head: &str) -> Option<Ident> {
    static R: OnceLock<Regex> = OnceLock::new();
    re(&R, || format!(r"(?i)\b(?:from|join|update|into)\s+({IDENT})\.$")).captures(head).map(|c| parse_identifier(&c[1]))
}

fn parse_alias_context(head: &str) -> Option<Ident> {
    static R: OnceLock<Regex> = OnceLock::new();
    re(&R, || format!(r"({IDENT})\.$")).captures(head).map(|c| parse_identifier(&c[1]))
}

fn find_table_entry<'a>(entries: &'a [SchemaEntry], table: &Ident, schema: Option<&Ident>, db: &str) -> Option<&'a SchemaEntry> {
    let mut best = None;
    let mut best_score = 0;
    for e in entries {
        let ts = match_identifier(&e.name, table, db) as u32;
        if ts == 0 {
            continue;
        }
        let mut score = ts * 2;
        if let Some(s) = schema {
            score += match_identifier(&e.schema, s, db) as u32;
        }
        if score > best_score {
            best = Some(e);
            best_score = score;
        }
    }
    best
}

fn alias_map<'a>(before: &str, entries: &'a [SchemaEntry], db: &str) -> Vec<(String, &'a SchemaEntry)> {
    static R: OnceLock<Regex> = OnceLock::new();
    let r = re(&R, || {
        format!(r"(?i)\b(?:from|join|update|into)\s+({IDENT})(?:\.({IDENT}))?(?:\s+(?:as\s+)?([a-zA-Z_][a-zA-Z0-9_]*))?")
    });
    let mut map: Vec<(String, &SchemaEntry)> = Vec::new();
    let mut set = |k: String, e: &'a SchemaEntry, map: &mut Vec<(String, &'a SchemaEntry)>| {
        if let Some(slot) = map.iter_mut().find(|(key, _)| *key == k) {
            slot.1 = e;
        } else {
            map.push((k, e));
        }
    };
    for c in r.captures_iter(before) {
        let first = parse_identifier(&c[1]);
        let second = c.get(2).map(|m| parse_identifier(m.as_str()));
        let table = second.clone().unwrap_or_else(|| first.clone());
        let Some(entry) = find_table_entry(entries, &table, second.as_ref().map(|_| &first), db) else { continue };
        set(entry.name.clone(), entry, &mut map);
        if let Some(alias) = c.get(3) {
            set(fold_unquoted_sql_identifier(alias.as_str(), db), entry, &mut map);
        }
    }
    map
}

fn lookup_alias<'a>(map: &[(String, &'a SchemaEntry)], alias: &Ident, db: &str) -> Option<&'a SchemaEntry> {
    map.iter()
        .find(|(k, _)| match_identifier(k, alias, db) == 2)
        .or_else(|| map.iter().find(|(k, _)| match_identifier(k, alias, db) == 1))
        .map(|(_, e)| *e)
}

fn score_prefix(label: &str, prefix: &str) -> i32 {
    if prefix.is_empty() {
        return 30;
    }
    let l = label.to_lowercase();
    let p = prefix.to_lowercase();
    if l == p {
        return 140;
    }
    if l.starts_with(&p) {
        return 120 - (l.chars().count() as i32 - p.chars().count() as i32);
    }
    if p.chars().count() <= 2 {
        return -1;
    }
    match l.find(&p) {
        Some(i) => 80 - l[..i].chars().count() as i32,
        None => -1,
    }
}

fn add_ranked(items: &mut Vec<(SqlSuggestionItem, i32)>, item: SqlSuggestionItem, base: i32, prefix: &str) {
    let s = score_prefix(&item.label, prefix);
    if s >= 0 {
        items.push((item, base + s));
    }
}

fn has_exact_token_match(token: &str, entries: &[SchemaEntry], dialect: &[&str], db: &str) -> bool {
    let t = token.to_lowercase();
    if t.is_empty() {
        return false;
    }
    if SQL_KEYWORDS.iter().chain(SQL_FUNCTIONS).chain(dialect).any(|k| k.to_lowercase() == t) {
        return true;
    }
    let bare = |name: &str| name.to_lowercase() == t && !sql_identifier_needs_quotes(name, db);
    entries.iter().any(|e| bare(&e.name) || e.columns.iter().any(|(c, _)| bare(c)))
}

fn kw(label: &str) -> SqlSuggestionItem {
    SqlSuggestionItem { label: label.into(), insert_text: label.into(), kind: SuggestionKind::Keyword, detail: None, filter_text: None }
}

/// `getSqlSuggestions`
pub fn get_sql_suggestions(query: &str, cursor: usize, entries: &[SchemaEntry], db: &str) -> Option<SqlSuggestions> {
    let cursor = cursor.min(query.len());
    let before = &query[..cursor];
    let current = before.rsplit(';').next().unwrap_or(before);
    let CursorToken { token, quoted, span, head } = parse_cursor_token(current, db);
    let schema_prefix = parse_schema_prefix(&head);
    let mut schema_names: Vec<&str> = Vec::new();
    for e in entries {
        if !e.schema.is_empty() && !schema_names.contains(&e.schema.as_str()) {
            schema_names.push(&e.schema);
        }
    }
    let schema_prefix_name = schema_prefix.as_ref().and_then(|p| {
        schema_names
            .iter()
            .find(|n| match_identifier(n, p, db) == 2)
            .or_else(|| schema_names.iter().find(|n| match_identifier(n, p, db) == 1))
            .map(|s| s.to_string())
    });
    let alias_context = if schema_prefix_name.is_some() { None } else { parse_alias_context(&head) };
    let amap = alias_map(current, entries, db);
    let context_text: &str = if quoted { &head } else { current };
    let ctx = context_info(context_text, !amap.is_empty());
    let trimmed_tokens = word_tokens(context_text.trim_end(), true);
    let last_completed = trimmed_tokens.last().cloned().unwrap_or_default();
    let rule = sql_continuation_rule(db, &trimmed_tokens);
    let dialect = dialect_keywords(db);
    let exact = has_exact_token_match(&token, entries, dialect, db);
    let open_on_boundary = token.is_empty()
        && ctx.trailing_whitespace
        && (CLAUSE_BOUNDARY_KEYWORDS.contains(&last_completed.as_str()) || rule.is_some() || ctx.clause == "select");
    let qualifying = alias_context.is_some() || schema_prefix_name.is_some();
    if !qualifying && !quoted && !token.is_empty() && !ctx.trailing_whitespace && exact {
        return None;
    }
    if !qualifying && !quoted && token.is_empty() && !open_on_boundary {
        return None;
    }

    let (open_q, close_q) = sql_identifier_quote_chars(db);
    let token_start = cursor - span;
    let token_end = if quoted && query[cursor..].starts_with(close_q) { cursor + close_q.len() } else { cursor };
    let ident_text = |name: &str| if quoted { quote_sql_identifier_always(name, db) } else { format_sql_identifier(name, db) };
    let filter_text = |label: &str| quoted.then(|| format!("{open_q}{label}"));
    let mut ranked: Vec<(SqlSuggestionItem, i32)> = Vec::new();
    let short_prefix = token.chars().count() <= 2;

    if let Some(schema) = &schema_prefix_name {
        for e in entries.iter().filter(|e| !e.name.is_empty() && &e.schema == schema) {
            add_ranked(
                &mut ranked,
                SqlSuggestionItem {
                    label: e.name.clone(),
                    insert_text: ident_text(&e.name),
                    kind: SuggestionKind::Table,
                    detail: Some(format!("Table ({schema})")),
                    filter_text: filter_text(&e.name),
                },
                240,
                &token,
            );
        }
    } else if let Some(alias) = &alias_context {
        let entry = lookup_alias(&amap, alias, db)?;
        for (col, _) in entry.columns.iter().filter(|(c, _)| !c.is_empty()) {
            let schema = if entry.schema.is_empty() { "public" } else { &entry.schema };
            add_ranked(
                &mut ranked,
                SqlSuggestionItem {
                    label: col.clone(),
                    insert_text: ident_text(col),
                    kind: SuggestionKind::Column,
                    detail: Some(format!("{schema}.{}.{col}", entry.name)),
                    filter_text: filter_text(col),
                },
                240,
                &token,
            );
        }
    } else {
        let clause = ctx.clause.as_str();
        let prefer_tables = matches!(clause, "from" | "join" | "update" | "into");
        let prefer_columns = matches!(clause, "select" | "where" | "on" | "group" | "order" | "having" | "set");
        let prefer_keywords = short_prefix && !prefer_tables;
        let constrained_select = clause == "select" && !ctx.has_table_context;
        let r = rule.clone().unwrap_or_default();
        let suppress_short = !quoted && ((short_prefix && !ctx.has_table_context && !prefer_tables) || r.suppress_schema_items);
        let tl = token.to_lowercase();
        let strongly_prefer_kw = !quoted
            && short_prefix
            && !prefer_tables
            && ["un", "sel", "se", "fro", "fr", "whe", "wh", "ord", "gro", "ins", "upd", "del", "set", "val", "joi", "jon", "uni"]
                .contains(&tl.as_str());
        const STARTERS: &[&str] = &["SELECT", "SET", "SHOW", "WITH", "INSERT", "UPDATE", "DELETE", "CREATE", "ALTER", "DROP"];
        const SELECT_LEAD: &[&str] =
            &["DISTINCT", "ALL", "CASE", "CAST", "COALESCE", "COUNT", "SUM", "AVG", "MIN", "MAX", "NULL", "TRUE", "FALSE"];
        const SELECT_FOLLOW: &[&str] = &["FROM", "CASE", "CAST", "COALESCE", "COUNT", "SUM", "AVG", "MIN", "MAX"];
        const UNION_LEAD: &[&str] = &["ALL", "SELECT"];

        if !quoted && (tl == "s" || tl == "se") {
            add_ranked(&mut ranked, kw("SELECT"), 1000, &token);
        }
        if !quoted && ctx.just_typed_select {
            add_ranked(&mut ranked, kw("*"), 820, &token);
        }
        if !quoted && ctx.just_typed_union {
            for k in UNION_LEAD {
                add_ranked(&mut ranked, kw(k), if *k == "ALL" { 520 } else { 500 }, &token);
            }
        }
        if !quoted && ctx.just_typed_union_all {
            add_ranked(&mut ranked, kw("SELECT"), 560, &token);
        }
        let show_schema = !suppress_short && !strongly_prefer_kw;
        for e in entries.iter().filter(|e| !e.name.is_empty()) {
            let qualified = if e.schema.is_empty() { e.name.clone() } else { format!("{}.{}", e.schema, e.name) };
            if show_schema || r.prefer_tables {
                let insert = if quoted {
                    let mut parts = Vec::new();
                    if !e.schema.is_empty() {
                        parts.push(format_sql_identifier(&e.schema, db));
                    }
                    parts.push(ident_text(&e.name));
                    parts.join(".")
                } else {
                    format_qualified_sql_identifier(&[&e.schema, &e.name], db)
                };
                let base = if r.prefer_tables {
                    320
                } else if prefer_tables {
                    240
                } else if constrained_select {
                    15
                } else if prefer_keywords {
                    40
                } else {
                    90
                };
                add_ranked(
                    &mut ranked,
                    SqlSuggestionItem {
                        label: qualified.clone(),
                        insert_text: insert,
                        kind: SuggestionKind::Table,
                        detail: Some(if e.schema.is_empty() { "Table".into() } else { format!("Table ({})", e.schema) }),
                        filter_text: filter_text(&qualified),
                    },
                    base,
                    &token,
                );
            }
            for (col, _) in e.columns.iter().filter(|(c, _)| !c.is_empty()) {
                if show_schema || r.prefer_columns {
                    let base = if r.prefer_columns {
                        300
                    } else if constrained_select {
                        10
                    } else if prefer_columns {
                        if prefer_keywords {
                            80
                        } else {
                            220
                        }
                    } else {
                        90
                    };
                    add_ranked(
                        &mut ranked,
                        SqlSuggestionItem {
                            label: col.clone(),
                            insert_text: ident_text(col),
                            kind: SuggestionKind::Column,
                            detail: Some(format!("{qualified}.{col}")),
                            filter_text: filter_text(col),
                        },
                        base,
                        &token,
                    );
                }
            }
        }
        if !quoted {
            for f in SQL_FUNCTIONS {
                let base = if r.prefer_functions {
                    300
                } else if constrained_select {
                    120
                } else if prefer_columns {
                    if prefer_keywords {
                        120
                    } else {
                        200
                    }
                } else {
                    95
                };
                add_ranked(
                    &mut ranked,
                    SqlSuggestionItem {
                        label: f.to_string(),
                        insert_text: format!("{f}()"),
                        kind: SuggestionKind::Function,
                        detail: Some("SQL function".into()),
                        filter_text: None,
                    },
                    base,
                    &token,
                );
            }
            let mut pool: Vec<&str> = Vec::new();
            for k in SQL_KEYWORDS.iter().chain(dialect) {
                if !pool.contains(k) {
                    pool.push(k);
                }
            }
            for k in pool {
                if token.is_empty() && ctx.trailing_whitespace && k.to_lowercase() == last_completed {
                    continue;
                }
                let is_clause_kw = if prefer_tables {
                    ["FROM", "JOIN", "WHERE", "ON", "ORDER", "GROUP", "LIMIT"].contains(&k)
                } else if prefer_columns {
                    ["AS", "DISTINCT", "FROM", "WHERE", "AND", "OR", "CASE"].contains(&k)
                } else {
                    false
                };
                let after_star = ctx.after_select_star && k == "FROM";
                let starter = ctx.start_of_statement && STARTERS.contains(&k);
                let union_cont = ctx.just_typed_union && UNION_LEAD.contains(&k);
                let union_all_cont = ctx.just_typed_union_all && k == "SELECT";
                let rule_kw = r.keywords.contains(&k);
                let preferred_select = if constrained_select || last_completed == "all" || last_completed == "distinct" {
                    if ctx.just_typed_select || ctx.just_typed_select_modifier {
                        SELECT_LEAD.contains(&k)
                    } else {
                        SELECT_FOLLOW.contains(&k)
                    }
                } else {
                    false
                };
                let base = if rule_kw {
                    600
                } else if union_all_cont {
                    560
                } else if union_cont {
                    if k == "ALL" {
                        520
                    } else {
                        500
                    }
                } else if strongly_prefer_kw {
                    420
                } else if after_star {
                    500
                } else if starter {
                    360
                } else if preferred_select {
                    300
                } else if prefer_keywords {
                    230
                } else if is_clause_kw {
                    150
                } else {
                    60
                };
                add_ranked(&mut ranked, kw(k), base, &token);
            }
        }
    }

    let mut dedup: HashMap<(SuggestionKind, String), (SqlSuggestionItem, i32)> = HashMap::new();
    for (item, score) in ranked {
        let key = (item.kind, item.label.clone());
        match dedup.get(&key) {
            Some((_, s)) if *s >= score => {}
            _ => {
                dedup.insert(key, (item, score));
            }
        }
    }
    let mut items: Vec<(SqlSuggestionItem, i32)> = dedup.into_values().collect();
    // `localeCompare` ≈ case-insensitive comparison, then exact.
    items.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.label.to_lowercase().cmp(&b.0.label.to_lowercase())).then_with(|| a.0.label.cmp(&b.0.label)));
    let items: Vec<SqlSuggestionItem> = items.into_iter().take(20).map(|(i, _)| i).collect();
    if items.is_empty() {
        return None;
    }
    Some(SqlSuggestions { items, token_start, token_end })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn schema() -> Vec<SchemaEntry> {
        vec![SchemaEntry {
            schema: "public".into(),
            name: "users".into(),
            columns: vec![("id".into(), "int4".into()), ("email".into(), "text".into())],
        }]
    }

    #[test]
    fn select_prefix_ranks_select_first() {
        let s = get_sql_suggestions("se", 2, &schema(), "postgres").unwrap();
        assert_eq!(s.items[0].label, "SELECT");
        assert_eq!((s.token_start, s.token_end), (0, 2));
    }

    #[test]
    fn tables_after_from() {
        let q = "select * from pub";
        let s = get_sql_suggestions(q, q.len(), &schema(), "postgres").unwrap();
        assert_eq!(s.items[0].label, "public.users");
        assert_eq!(s.items[0].insert_text, "public.users");
    }

    #[test]
    fn alias_columns() {
        let q = "select * from users u where u.";
        let s = get_sql_suggestions(q, q.len(), &schema(), "postgres").unwrap();
        let labels: Vec<_> = s.items.iter().map(|i| i.label.as_str()).collect();
        assert_eq!(labels, vec!["email", "id"]);
    }

    #[test]
    fn exact_keyword_closes() {
        assert!(get_sql_suggestions("select", 6, &schema(), "postgres").is_none());
    }
}
