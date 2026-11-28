//! Port of lib/db/sql-guards.ts — shared guards for the agent DB tools.

use anyhow::{bail, Result};
use serde_json::{json, Value};

/// `getDbCapabilities`.
pub fn db_capabilities(db_type: &str) -> Value {
    json!({
        "supportsNamespaces": db_type != "redis",
        "supportsStructuredSchema": db_type != "redis",
        "supportsRelatedTables": !["mongodb", "redis", "clickhouse", "trino"].contains(&db_type),
        "supportsReadOnlyQuery": db_type != "redis",
        "supportsSampleRows": db_type != "redis",
        "querySyntax": match db_type { "mongodb" => "mongo-json-or-shell", "redis" => "redis-command", _ => "sql" },
    })
}

pub fn supports_related_tables(db_type: &str) -> bool {
    !["mongodb", "redis", "clickhouse", "trino"].contains(&db_type)
}

fn starts_with_word(s: &str, words: &[&str]) -> bool {
    let lower = s.trim_start().to_ascii_lowercase();
    words.iter().any(|w| {
        lower.starts_with(w) && lower[w.len()..].chars().next().is_none_or(|c| !(c.is_alphanumeric() || c == '_'))
    })
}

fn contains_word(s: &str, words: &[&str]) -> Option<String> {
    let lower = s.to_ascii_lowercase();
    let tokens = lower.split(|c: char| !(c.is_alphanumeric() || c == '_'));
    for tok in tokens {
        if words.contains(&tok) {
            return Some(tok.to_string());
        }
    }
    None
}

/// `/^(select|with|explain)\b/i`
pub fn is_read_sql(query: &str) -> bool {
    starts_with_word(query, &["select", "with", "explain"])
}

/// `ensureReadOnlySql`.
pub fn ensure_read_only_sql(query: &str) -> Result<()> {
    let normalized = query.trim().trim_end_matches(';');
    if normalized.is_empty() {
        bail!("SQL is required.");
    }
    if !is_read_sql(normalized) {
        bail!("Only read-only SQL is allowed. Use SELECT, WITH, or EXPLAIN.");
    }
    const MUTATING: &[&str] = &[
        "insert", "update", "delete", "merge", "drop", "alter", "create", "truncate", "grant", "revoke", "comment", "vacuum", "analyze",
        "refresh", "reindex", "call", "do", "copy",
    ];
    if contains_word(normalized, MUTATING).is_some() {
        bail!("Potentially mutating SQL was rejected.");
    }
    Ok(())
}

pub const READ_ONLY_REDIS_COMMANDS: &[&str] =
    &["GET", "MGET", "HGET", "HGETALL", "LRANGE", "SMEMBERS", "ZRANGE", "XRANGE", "TYPE", "TTL", "PTTL", "EXISTS", "KEYS", "SCAN", "PING"];

pub fn is_read_only_redis(command: &str) -> bool {
    let name = command.split_whitespace().next().unwrap_or("").to_ascii_uppercase();
    READ_ONLY_REDIS_COMMANDS.contains(&name.as_str())
}

/// The Mongo write heuristic of db-tools-core.ts `runSql`.
pub fn looks_like_mongo_write(query: &str) -> bool {
    contains_word(query, &["insert", "update", "delete", "drop", "create", "replace"]).is_some()
        || ["insertone", "insertmany", "updateone", "updatemany", "deleteone", "deletemany", "replaceone"]
            .iter()
            .any(|w| query.to_ascii_lowercase().contains(w))
}

/// `quoteIdentifier`.
pub fn quote_identifier(db_type: &str, value: &str) -> String {
    match db_type {
        "mysql" | "clickhouse" => format!("`{}`", value.replace('`', "``")),
        "mssql" => format!("[{}]", value.replace(']', "]]")),
        _ => format!("\"{}\"", value.replace('"', "\"\"")),
    }
}

/// `tableRef`.
pub fn table_ref(db_type: &str, schema: &str, table: &str) -> String {
    if schema.is_empty() || db_type == "spacetimedb" {
        return quote_identifier(db_type, table);
    }
    format!("{}.{}", quote_identifier(db_type, schema), quote_identifier(db_type, table))
}

/// `buildSampleQuery`.
pub fn build_sample_query(db_type: &str, schema: &str, table: &str, limit: usize) -> String {
    let r = table_ref(db_type, schema, table);
    match db_type {
        "mssql" => format!("SELECT TOP {limit} * FROM {r};"),
        "oracle" => format!("SELECT * FROM {r} ORDER BY 1 OFFSET 0 ROWS FETCH NEXT {limit} ROWS ONLY;"),
        _ => format!("SELECT * FROM {r} LIMIT {limit};"),
    }
}

/// `isWriteSqlForAudit` (audit-log.ts): anything that isn't a plain read.
pub fn is_write_sql_for_audit(query: &str) -> bool {
    let q = query.trim();
    !q.is_empty() && (!is_read_sql(q) || ensure_read_only_sql(q).is_err())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn guards() {
        assert!(ensure_read_only_sql("select 1;").is_ok());
        assert!(ensure_read_only_sql("WITH x AS (select 1) select * from x").is_ok());
        assert!(ensure_read_only_sql("delete from t").is_err());
        assert!(ensure_read_only_sql("select * from t; drop table t").is_err());
        assert!(ensure_read_only_sql("selection").is_err());
        assert!(ensure_read_only_sql("select created_at from t").is_ok());
        assert!(is_read_only_redis("get foo"));
        assert!(!is_read_only_redis("SET foo 1"));
        assert_eq!(build_sample_query("mssql", "dbo", "t", 5), "SELECT TOP 5 * FROM [dbo].[t];");
        assert_eq!(build_sample_query("mysql", "", "t", 5), "SELECT * FROM `t` LIMIT 5;");
        assert_eq!(table_ref("postgres", "public", "a\"b"), "\"public\".\"a\"\"b\"");
        assert!(is_write_sql_for_audit("update t set a=1"));
        assert!(!is_write_sql_for_audit("select 1"));
        assert!(looks_like_mongo_write("db.users.insertOne({})"));
        assert_eq!(db_capabilities("redis")["querySyntax"], "redis-command");
    }
}
