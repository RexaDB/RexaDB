//! Port of `lib/db/postgres-compat/*`: compile Postgres-flavoured SQL to a
//! target dialect. Native SQLite (local + remote) runs every user statement
//! through [`compile_for_sqlite`] so the SQL editor matches the web studio
//! (`compilePostgresQuery(..., "sqlite")`).
//!
//! Pipeline (mirrors `compile.ts`):
//! 1. normalize (`SELECT ALL` → `SELECT *`, strip `;` before set-ops)
//! 2. parse with the PostgreSQL dialect (`sqlparser`)
//! 3. DDL → AST renderers (create/alter/index/drop)
//! 4. DML → string transforms: `::type` casts, `ILIKE`, `$n` → `?`
//!
//! Catalog / transactional statements (`PRAGMA`, `BEGIN`, …) pass through —
//! the web sql-engine never sees them (catalog uses `sqlite-client` directly).

mod ddl;

use crate::Value;
use anyhow::{bail, Context, Result};
use regex::Regex;
use sqlparser::ast::Statement;
use sqlparser::dialect::PostgreSqlDialect;
use sqlparser::parser::Parser;
use std::sync::OnceLock;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PgCompatTarget {
    Postgres,
    Sqlite,
    Mysql,
}

#[derive(Debug, Clone, PartialEq)]
pub struct CompiledQuery {
    pub query: String,
    pub params: Vec<Value>,
}

/// Compile for SQLite and return only the rewritten SQL (empty params).
pub fn compile_for_sqlite(sql: &str) -> Result<String> {
    Ok(compile_postgres_query(sql, &[], PgCompatTarget::Sqlite)?.query)
}

/// Port of `compilePostgresQuery`.
pub fn compile_postgres_query(query: &str, params: &[Value], target: PgCompatTarget) -> Result<CompiledQuery> {
    let normalized = normalize_pg_syntax(query);
    if target == PgCompatTarget::Postgres {
        return Ok(CompiledQuery {
            query: normalized,
            params: params.to_vec(),
        });
    }

    let kind = statement_kind(&normalized);
    if !is_supported_kind(kind) {
        // Pass through PRAGMA / BEGIN / ATTACH / VACUUM / … used by catalog
        // and Driver::transaction. Web sql-engine rejects these; native must not.
        return Ok(CompiledQuery {
            query: normalized,
            params: params.to_vec(),
        });
    }

    let statement = parse_postgres_statement(&normalized)?;

    if is_ddl_statement(&statement) {
        let rendered = ddl::compile_ddl_statement(target, &statement)?;
        return Ok(CompiledQuery {
            query: rendered,
            params: Vec::new(),
        });
    }

    let cast_compiled = compile_pg_casts(&normalized);
    let ilike_compiled = compile_pg_ilike(&cast_compiled);
    if target == PgCompatTarget::Sqlite {
        assert_supported_returning(&ilike_compiled, target)?;
        return Ok(compile_pg_params(&ilike_compiled, params));
    }
    // MySQL path: identifiers + upsert (ported lightly for API completeness).
    assert_supported_returning(&ilike_compiled, target)?;
    let mysql = compile_mysql_query(&ilike_compiled)?;
    Ok(compile_pg_params(&mysql, params))
}

fn parse_postgres_statement(query: &str) -> Result<Statement> {
    let dialect = PostgreSqlDialect {};
    let mut stmts = Parser::parse_sql(&dialect, query).with_context(|| format!("Failed to parse Postgres SQL: {query}"))?;
    if stmts.is_empty() {
        bail!("Failed to parse Postgres SQL: empty statement");
    }
    if stmts.len() > 1 {
        // Match pgsql-ast-parser parseFirst: first statement only.
        return Ok(stmts.remove(0));
    }
    Ok(stmts.remove(0))
}

fn is_ddl_statement(statement: &Statement) -> bool {
    matches!(
        statement,
        Statement::CreateTable(_)
            | Statement::AlterTable(_)
            | Statement::CreateIndex(_)
            | Statement::CreateSchema { .. }
            | Statement::Drop {
                object_type: sqlparser::ast::ObjectType::Table | sqlparser::ast::ObjectType::Index,
                ..
            }
    )
}

fn statement_kind(query: &str) -> &str {
    let trimmed = query.trim_start();
    let end = trimmed.find(|c: char| !c.is_ascii_alphabetic()).unwrap_or(trimmed.len());
    // Keep a static empty for the lifetime; kinds are compared case-insensitively via bytes.
    // We return a slice of the input for the caller to upper-case.
    &trimmed[..end]
}

fn is_supported_kind(kind: &str) -> bool {
    matches!(
        kind.to_ascii_uppercase().as_str(),
        "SELECT" | "INSERT" | "UPDATE" | "DELETE" | "CREATE" | "ALTER" | "DROP" | "WITH"
    )
}

fn normalize_pg_syntax(query: &str) -> String {
    static SELECT_ALL: OnceLock<Regex> = OnceLock::new();
    static SET_OP_SEMI: OnceLock<Regex> = OnceLock::new();
    let select_all = SELECT_ALL.get_or_init(|| Regex::new(r"(?i)SELECT\s+ALL\s+FROM").unwrap());
    let set_op_semi = SET_OP_SEMI.get_or_init(|| Regex::new(r"(?i);\s*(UNION ALL|UNION|INTERSECT|EXCEPT)\b").unwrap());
    let s = select_all.replace_all(query, "SELECT * FROM");
    set_op_semi.replace_all(&s, " $1").into_owned()
}

fn compile_pg_casts(query: &str) -> String {
    // Port of casts.ts PG_CAST_RE.
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| {
        Regex::new(r#"(\$\d+|\?|"[^"]+"|`[^`]+`|'[^']*'|\b[a-zA-Z_][\w.]*\b|\([^()]+\))::([a-zA-Z_][\w]*)"#).unwrap()
    });
    re.replace_all(query, |caps: &regex::Captures| {
        let expr = &caps[1];
        let mapped = map_cast_type(&caps[2]);
        format!("CAST({expr} AS {mapped})")
    })
    .into_owned()
}

fn map_cast_type(raw_type: &str) -> String {
    match raw_type.trim().to_ascii_lowercase().as_str() {
        "int4" | "integer" => "INTEGER".into(),
        "int8" | "bigint" => "BIGINT".into(),
        "float4" | "float8" | "numeric" | "decimal" => "DECIMAL".into(),
        "bool" | "boolean" => "BOOLEAN".into(),
        "jsonb" => "JSON".into(),
        _ => raw_type.to_ascii_uppercase(),
    }
}

fn compile_pg_ilike(query: &str) -> String {
    // Port of ilike.ts PG_ILIKE_RE.
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| {
        Regex::new(
            r#"(?i)(\([^()]+\)|"[^"]+"|`[^`]+`|\b[a-zA-Z_][\w.]*\b)\s+(NOT\s+)?ILIKE\s+(\$\d+|\?|'[^']*'|\([^()]+\)|"[^"]+"|`[^`]+`|\b[a-zA-Z_][\w.]*\b)"#,
        )
        .unwrap()
    });
    re.replace_all(query, |caps: &regex::Captures| {
        let left = &caps[1];
        let not_word = caps.get(2).map(|m| m.as_str()).unwrap_or("");
        let right = &caps[3];
        let not = if not_word.is_empty() { "" } else { "NOT " };
        format!("LOWER({left}) {not}LIKE LOWER({right})")
    })
    .into_owned()
}

fn compile_pg_params(query: &str, params: &[Value]) -> CompiledQuery {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r"\$(\d+)").unwrap());
    let mut compiled_params = Vec::new();
    let compiled_query = re
        .replace_all(query, |caps: &regex::Captures| {
            let index: usize = caps[1].parse().unwrap_or(0);
            if index >= 1 {
                compiled_params.push(params.get(index - 1).cloned().unwrap_or(Value::Null));
            } else {
                compiled_params.push(Value::Null);
            }
            "?"
        })
        .into_owned();
    CompiledQuery {
        query: compiled_query,
        params: compiled_params,
    }
}

fn assert_supported_returning(query: &str, target: PgCompatTarget) -> Result<()> {
    if target != PgCompatTarget::Mysql {
        return Ok(());
    }
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r"(?i)\bRETURNING\b").unwrap());
    if re.is_match(query) {
        bail!("PostgreSQL RETURNING is not supported for MySQL yet.");
    }
    Ok(())
}

fn compile_mysql_query(query: &str) -> Result<String> {
    // Minimal port: double-quote → backtick + ON CONFLICT DO NOTHING → INSERT IGNORE.
    // Full mysql-upsert/identifiers live in the web stack; extend when MySQL
    // sql-engine parity is needed in native.
    let with_upsert = compile_mysql_upsert(query)?;
    Ok(compile_mysql_identifiers(&with_upsert))
}

fn compile_mysql_upsert(query: &str) -> Result<String> {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r"(?is)^(\s*insert\s+into\b)(.*?)(\bon\s+conflict\b.*)$").unwrap());
    if let Some(caps) = re.captures(query) {
        let head = caps.get(1).map(|m| m.as_str()).unwrap_or("");
        let mid = caps.get(2).map(|m| m.as_str()).unwrap_or("");
        let tail = caps.get(3).map(|m| m.as_str()).unwrap_or("").to_ascii_lowercase();
        if tail.contains("do nothing") {
            // "insert into" → "insert IGNORE into"
            let rewritten_head = Regex::new(r"(?i)^\s*insert\s+into\b")
                .unwrap()
                .replace(head, "insert IGNORE into");
            return Ok(format!("{rewritten_head}{mid}"));
        }
        bail!("PostgreSQL ON CONFLICT forms other than DO NOTHING are not supported for MySQL yet.");
    }
    Ok(query.to_string())
}

fn compile_mysql_identifiers(query: &str) -> String {
    // Replace "ident" with `ident` outside strings — simple scan matching web intent.
    let b = query.as_bytes();
    let mut out = String::with_capacity(query.len());
    let mut i = 0;
    while i < b.len() {
        let c = b[i];
        if c == b'\'' {
            out.push('\'');
            i += 1;
            while i < b.len() {
                out.push(b[i] as char);
                if b[i] == b'\'' {
                    if b.get(i + 1) == Some(&b'\'') {
                        out.push('\'');
                        i += 2;
                        continue;
                    }
                    i += 1;
                    break;
                }
                i += 1;
            }
            continue;
        }
        if c == b'"' {
            out.push('`');
            i += 1;
            while i < b.len() {
                if b[i] == b'"' {
                    if b.get(i + 1) == Some(&b'"') {
                        out.push('"');
                        i += 2;
                        continue;
                    }
                    out.push('`');
                    i += 1;
                    break;
                }
                out.push(b[i] as char);
                i += 1;
            }
            continue;
        }
        out.push(c as char);
        i += 1;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text(s: &str) -> Value {
        Value::Text(s.into())
    }

    #[test]
    fn compiles_sqlite_returning_and_params() {
        let compiled = compile_postgres_query(
            r#"insert into "users" ("name") values ($1) returning "id", "name""#,
            &[text("a")],
            PgCompatTarget::Sqlite,
        )
        .unwrap();
        assert_eq!(
            compiled.query,
            r#"insert into "users" ("name") values (?) returning "id", "name""#
        );
        assert_eq!(compiled.params, vec![text("a")]);
    }

    #[test]
    fn compiles_sqlite_casts_and_ilike() {
        let compiled = compile_postgres_query(
            r#"select "name"::text from "users" where "email" ilike $1"#,
            &[text("%a%")],
            PgCompatTarget::Sqlite,
        )
        .unwrap();
        assert_eq!(
            compiled.query,
            r#"select CAST("name" AS TEXT) from "users" where LOWER("email") LIKE LOWER(?)"#
        );
        assert_eq!(compiled.params, vec![text("%a%")]);
    }

    #[test]
    fn compiles_create_table_for_sqlite() {
        let compiled = compile_postgres_query(
            r#"create table "posts" ("id" serial primary key, "user_id" integer references "users"("id"), "slug" text unique)"#,
            &[],
            PgCompatTarget::Sqlite,
        )
        .unwrap();
        assert_eq!(
            compiled.query,
            r#"CREATE TABLE "posts" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "user_id" INTEGER REFERENCES "users"("id"), "slug" TEXT UNIQUE)"#
        );
    }

    #[test]
    fn preserves_referential_actions_on_sqlite_create() {
        let compiled = compile_postgres_query(
            "CREATE TABLE c(id INTEGER PRIMARY KEY, p_id INTEGER REFERENCES p(id) ON DELETE CASCADE)",
            &[],
            PgCompatTarget::Sqlite,
        )
        .unwrap();
        assert_eq!(
            compiled.query,
            r#"CREATE TABLE "c" ("id" INTEGER PRIMARY KEY, "p_id" INTEGER REFERENCES "p"("id") ON DELETE CASCADE)"#
        );
    }

    #[test]
    fn compiles_alter_rename_column_for_sqlite() {
        let compiled = compile_postgres_query(
            r#"alter table "users" rename column "full_name" to "name""#,
            &[],
            PgCompatTarget::Sqlite,
        )
        .unwrap();
        assert_eq!(
            compiled.query,
            r#"ALTER TABLE "users" RENAME COLUMN "full_name" TO "name""#
        );
    }

    #[test]
    fn rejects_alter_column_type_for_sqlite() {
        let err = compile_postgres_query(
            r#"alter table "users" alter column "name" type varchar(255)"#,
            &[],
            PgCompatTarget::Sqlite,
        )
        .unwrap_err();
        assert!(err.to_string().contains("ALTER COLUMN TYPE is not safely supported"));
    }

    #[test]
    fn rejects_sqlite_alter_add_constraint() {
        let err = compile_postgres_query(
            r#"alter table "users" add constraint "users_email_unique" unique ("email")"#,
            &[],
            PgCompatTarget::Sqlite,
        )
        .unwrap_err();
        assert!(err.to_string().contains("SQLite does not safely support ALTER TABLE ADD CONSTRAINT"));
    }

    #[test]
    fn passes_through_pragma() {
        let compiled = compile_postgres_query("PRAGMA database_list", &[], PgCompatTarget::Sqlite).unwrap();
        assert_eq!(compiled.query, "PRAGMA database_list");
    }

    #[test]
    fn postgres_target_is_passthrough() {
        let q = r#"select "name"::text from "users" where "email" ilike $1"#;
        let compiled = compile_postgres_query(q, &[text("%a%")], PgCompatTarget::Postgres).unwrap();
        assert_eq!(compiled.query, q);
        assert_eq!(compiled.params, vec![text("%a%")]);
    }

    #[test]
    fn compiles_mysql_select_ilike() {
        let compiled = compile_postgres_query(
            r#"select "name" from "users" where "email" ilike $1 and id = $2"#,
            &[text("%a%"), Value::Int(7)],
            PgCompatTarget::Mysql,
        )
        .unwrap();
        assert_eq!(
            compiled.query,
            "select `name` from `users` where LOWER(`email`) LIKE LOWER(?) and id = ?"
        );
        assert_eq!(compiled.params, vec![text("%a%"), Value::Int(7)]);
    }
}
