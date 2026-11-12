//! Native database drivers behind one object-safe [`Driver`] trait.
//!
//! Results are rendered through each server's *text* protocol so every type
//! (enums, arrays, geometry, extension types) displays exactly as the server
//! prints it, without per-type decoders.

mod mysql;
mod postgres;
mod sqlite;

use anyhow::{bail, Result};
use async_trait::async_trait;
use std::sync::Arc;
use std::time::Duration;

#[derive(Debug, Clone, PartialEq)]
pub enum Cell {
    Null,
    Text(String),
}

impl Cell {
    pub fn display(&self) -> &str {
        match self {
            Cell::Null => "NULL",
            Cell::Text(s) => s,
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct QueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<Cell>>,
    /// Rows affected for statements that don't return rows.
    pub affected: Option<u64>,
    pub elapsed: Duration,
    /// True when `rows` was cut at the row limit.
    pub truncated: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct TableRef {
    pub schema: String,
    pub name: String,
    pub is_view: bool,
}

#[derive(Debug, Clone)]
pub struct ColumnInfo {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub is_primary_key: bool,
}

pub const DEFAULT_ROW_LIMIT: usize = 10_000;

#[async_trait]
pub trait Driver: Send + Sync {
    fn kind(&self) -> Kind;
    /// Identifier quoting for generated SQL.
    fn quote_ident(&self, ident: &str) -> String {
        format!("\"{}\"", ident.replace('"', "\"\""))
    }
    async fn schemas(&self) -> Result<Vec<String>>;
    async fn tables(&self, schema: &str) -> Result<Vec<TableRef>>;
    async fn columns(&self, table: &TableRef) -> Result<Vec<ColumnInfo>>;
    /// Run one or more statements; the last statement's result set is returned.
    async fn execute(&self, sql: &str, row_limit: usize) -> Result<QueryResult>;

    fn select_preview_sql(&self, table: &TableRef, limit: usize) -> String {
        let qualified = if table.schema.is_empty() {
            self.quote_ident(&table.name)
        } else {
            format!("{}.{}", self.quote_ident(&table.schema), self.quote_ident(&table.name))
        };
        format!("SELECT * FROM {qualified} LIMIT {limit}")
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Postgres,
    MySql,
    Sqlite,
}

impl Kind {
    /// Map a RexaDB `connection_type` (+ connection string) to a native driver.
    pub fn detect(connection_type: &str, connection_string: &str) -> Option<Kind> {
        let cs = connection_string.trim().to_ascii_lowercase();
        match connection_type {
            "postgres" | "supabase" | "neon" | "timescale" | "cockroachdb" => Some(Kind::Postgres),
            "mysql" | "mariadb" | "planetscale" | "tidb" => Some(Kind::MySql),
            "sqlite" => Some(Kind::Sqlite),
            _ if cs.starts_with("postgres://") || cs.starts_with("postgresql://") => Some(Kind::Postgres),
            _ if cs.starts_with("mysql://") || cs.starts_with("mariadb://") => Some(Kind::MySql),
            _ if cs.starts_with("sqlite:") || cs.ends_with(".db") || cs.ends_with(".sqlite") => Some(Kind::Sqlite),
            _ => None,
        }
    }
}

pub async fn connect(kind: Kind, connection_string: &str) -> Result<Arc<dyn Driver>> {
    Ok(match kind {
        Kind::Postgres => Arc::new(postgres::PostgresDriver::connect(connection_string).await?),
        Kind::MySql => Arc::new(mysql::MySqlDriver::connect(connection_string).await?),
        Kind::Sqlite => Arc::new(sqlite::SqliteDriver::open(connection_string)?),
    })
}

pub async fn connect_detect(connection_type: &str, connection_string: &str) -> Result<Arc<dyn Driver>> {
    match Kind::detect(connection_type, connection_string) {
        Some(kind) => connect(kind, connection_string).await,
        None => bail!("`{connection_type}` connections are not supported by the native app yet."),
    }
}
