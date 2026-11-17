//! Port of `lib/db/*` (database clients) and the data/metadata endpoints of
//! `server/database-actions-api.ts`, `server/database-metadata-api.ts` and
//! `server/connection-actions-api.ts` (`testConnection`).
//!
//! # Overview
//!
//! Every engine implements the object-safe [`Driver`] trait. Get one with
//! [`connect_detect`] (saved `connection_type` + connection string, exactly
//! like the original's `detectConnectionDbType`) or [`connect`] /
//! [`connect_with`] when the [`Kind`] is already known.
//!
//! * **Values** are always text ([`Cell`]): every engine renders values the
//!   way the server prints them (Postgres/MySQL text protocol, ISO dates,
//!   hex for binary, JSON for documents). [`QueryResult::column_types`]
//!   carries the server type name plus a coarse [`TypeCategory`] so the grid
//!   can align, format and pick editors by type.
//! * **SQL generation** for the table editor lives in [`grid`] (filter rules,
//!   sort, paging — a port of `hooks/use-studio.ts#refreshTableData` and
//!   `components/studio/toolbar/toolbar-filter-sort.tsx#buildRuleClause`),
//!   row edits in [`Driver::update_rows`] / [`Driver::delete_rows`] /
//!   [`Driver::insert_rows`], DDL in [`ddl`].
//! * **Catalog** objects (indexes, enums, functions, triggers, sequences,
//!   extensions, RLS policies, roles, …) are typed structs in [`catalog`],
//!   with the original's field names. Engines that the original does not
//!   support for a given object return an empty list (as the original did);
//!   use [`Driver::capabilities`] (a port of the support matrix in
//!   `lib/db/connection-type.ts`) to decide what to show.
//! * Identifier quoting / literals / table references per engine are in
//!   [`Dialect`] (`lib/db/quote-identifier.ts`, `useStudio#quoteTableRef`).
//!
//! All methods are async and must run inside a Tokio runtime
//! (`rexa_core::runtime::spawn`).

pub mod catalog;
pub mod ddl;
pub mod detect;
pub mod dialect;
pub mod grid;
pub mod records;
pub mod split;
pub mod types;
pub mod value;

// mod bridge;
mod http;
mod ssh;

mod clickhouse;
// mod duckdb;
// mod federated;
// mod jdbc;
// #[cfg(feature = "mongodb")]
// mod mongo;
// #[cfg(feature = "mssql")]
// mod mssql;
mod mysql;
mod oracle;
mod pgcat;
mod postgres;
mod redis;
mod spacetimedb;
mod sqlite;
mod sqlite_remote;
mod supabase_mgmt;
mod trino;

pub use catalog::*;
pub use detect::{detect_provider, Provider};
pub use dialect::Dialect;
pub use grid::{FilterOperator, FilterRule, SortConfig, SortDirection, TableFilter, TableQuery};
pub use records::Record;
pub use types::{ColumnMeta, TypeCategory};
pub use value::Value;

use anyhow::{bail, Result};
use async_trait::async_trait;
use std::sync::Arc;
use std::time::Duration;

/// One result cell. Values are rendered as text by every engine.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum Cell {
    Null,
    Text(String),
}

impl Cell {
    /// Text for display; `NULL` renders as the literal `NULL`.
    pub fn display(&self) -> &str {
        match self {
            Cell::Null => "NULL",
            Cell::Text(s) => s,
        }
    }

    /// `None` for SQL NULL.
    pub fn as_str(&self) -> Option<&str> {
        match self {
            Cell::Null => None,
            Cell::Text(s) => Some(s),
        }
    }

    pub fn is_null(&self) -> bool {
        matches!(self, Cell::Null)
    }

    pub(crate) fn text(s: impl Into<String>) -> Cell {
        Cell::Text(s.into())
    }

    pub(crate) fn opt(s: Option<impl Into<String>>) -> Cell {
        s.map_or(Cell::Null, |s| Cell::Text(s.into()))
    }
}

/// Result of one statement.
#[derive(Debug, Clone, Default)]
pub struct QueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<Cell>>,
    /// Rows affected for statements that don't return rows.
    pub affected: Option<u64>,
    pub elapsed: Duration,
    /// True when `rows` was cut at the row limit.
    pub truncated: bool,
    /// Type metadata, parallel to `columns` (may be shorter/empty when the
    /// engine reports no types, e.g. SQLite expressions or HTTP JSON APIs —
    /// use [`QueryResult::column_type`]).
    pub column_types: Vec<ColumnMeta>,
}

impl QueryResult {
    pub fn column_index(&self, name: &str) -> Option<usize> {
        self.columns.iter().position(|c| c == name)
    }

    /// Type of column `i` (falls back to an `unknown`/[`TypeCategory::Other`] entry).
    pub fn column_type(&self, i: usize) -> ColumnMeta {
        self.column_types.get(i).cloned().unwrap_or_else(|| ColumnMeta::unknown(self.columns.get(i).cloned().unwrap_or_default()))
    }

    /// Rows as name-addressable [`Record`]s.
    pub fn records(&self) -> Vec<Record> {
        records::records(self)
    }

    /// First column of every row (`NULL`s skipped).
    pub fn first_column(&self) -> Vec<String> {
        self.rows.iter().filter_map(|r| r.first().and_then(|c| c.as_str()).map(str::to_string)).collect()
    }

    pub(crate) fn from_columns(columns: Vec<String>) -> Self {
        QueryResult { columns, ..Default::default() }
    }
}

/// Result of a multi-statement script ([`Driver::execute_script`]).
#[derive(Debug, Clone, Default)]
pub struct ScriptResult {
    /// One entry per statement that ran successfully, in order.
    pub results: Vec<QueryResult>,
    /// The statement that failed (execution stops there), if any.
    pub error: Option<ScriptError>,
    pub elapsed: Duration,
}

#[derive(Debug, Clone)]
pub struct ScriptError {
    /// Zero-based index of the failing statement.
    pub statement_index: usize,
    pub statement: String,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Default)]
pub struct TableRef {
    pub schema: String,
    pub name: String,
    pub is_view: bool,
}

impl TableRef {
    pub fn new(schema: impl Into<String>, name: impl Into<String>) -> Self {
        TableRef { schema: schema.into(), name: name.into(), is_view: false }
    }
}

/// Minimal column description (kept for existing callers). See
/// [`Driver::table_structure`] for the full [`ColumnDetail`].
#[derive(Debug, Clone)]
pub struct ColumnInfo {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub is_primary_key: bool,
}

/// One row edit for [`Driver::update_rows`]: `UPDATE t SET set… WHERE where…`
/// (the original's `{ where, set }` objects; order is preserved).
#[derive(Debug, Clone, Default)]
pub struct RowUpdate {
    pub r#where: Vec<(String, Value)>,
    pub set: Vec<(String, Value)>,
}

/// Values of a row by column name (insert payload / delete target).
pub type RowValues = Vec<(String, Value)>;

/// One page of table data ([`Driver::read_table`]).
#[derive(Debug, Clone, Default)]
pub struct TablePage {
    pub result: QueryResult,
    /// The SQL (or engine command) that produced `result` — the original logs
    /// it in the query history as a `system` entry.
    pub query: String,
    /// `SELECT COUNT(*)` with the same filter, when requested.
    pub total_count: Option<u64>,
}

/// Explain output ([`Driver::explain`]).
#[derive(Debug, Clone, Default)]
pub struct ExplainResult {
    pub result: QueryResult,
    /// The statement actually sent (the original returns it as `planQuery`).
    pub plan_query: String,
}

/// Options for [`connect_with`].
#[derive(Debug, Clone, Default)]
pub struct ConnectOptions {
    /// Open the session read-only where the engine supports it (Postgres:
    /// `default_transaction_read_only`, MySQL: `SESSION TRANSACTION READ
    /// ONLY`, SQLite: read-only open). Not a feature of the original; off by
    /// default.
    pub read_only: bool,
    /// Per-statement timeout where the engine supports it (Postgres
    /// `statement_timeout`, MySQL `max_execution_time` for SELECTs, SQLite
    /// interrupt). `None` = server default (the original sets none).
    pub statement_timeout: Option<Duration>,
}

/// Default row cap for SQL-console results.
pub const DEFAULT_ROW_LIMIT: usize = 10_000;

/// Which catalog browsers an engine supports — port of the support matrix
/// in `lib/db/connection-type.ts` plus the per-engine branches of
/// `security-actions.ts` / `db-engine/catalog.ts`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Capabilities {
    /// `isPostgresCatalogDbType`: enums, RLS, extensions, roles, sessions/locks.
    pub postgres_catalog: bool,
    /// `supportsRoutineCatalog`
    pub routines: bool,
    /// `supportsSequenceCatalog`
    pub sequences: bool,
    /// `supportsIndexCatalog`
    pub indexes: bool,
    /// `supportsOracleExtraCatalog`: packages, synonyms, database links.
    pub oracle_extras: bool,
    /// `supportsTriggerWrite`
    pub trigger_write: bool,
    /// `supportsRoutineWrite`
    pub routine_write: bool,
    /// Triggers can be listed (PG, MSSQL, MySQL, Oracle).
    pub triggers: bool,
    /// Query cancellation (`cancelRunningQuery`; PG in the original, MySQL here too).
    pub cancel: bool,
    /// Row update/delete from the grid.
    pub row_edit: bool,
    /// The engine speaks SQL (vs. Mongo JSON/shell or Redis commands).
    pub sql: bool,
    /// Engine has schemas/namespaces.
    pub namespaces: bool,
    /// Foreign keys are reported (`getDbTableForeignKeys` returns [] for
    /// ClickHouse/Trino/DuckDB/SpacetimeDB/Mongo/Redis).
    pub foreign_keys: bool,
}

/// The database family behind a connection — the original's
/// `ConnectionDbType` (`lib/db/connection-type.ts`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Kind {
    Postgres,
    MySql,
    Sqlite,
    MongoDb,
    ClickHouse,
    MsSql,
    Redis,
    Trino,
    DuckDb,
    Federated,
    SpacetimeDb,
    Jdbc,
    Oracle,
    SupabaseMgmt,
}

impl Kind {
    pub const ALL: [Kind; 14] = [
        Kind::Postgres,
        Kind::MongoDb,
        Kind::Sqlite,
        Kind::MySql,
        Kind::ClickHouse,
        Kind::MsSql,
        Kind::Redis,
        Kind::Trino,
        Kind::DuckDb,
        Kind::Federated,
        Kind::SpacetimeDb,
        Kind::Jdbc,
        Kind::Oracle,
        Kind::SupabaseMgmt,
    ];

    /// Map a RexaDB `connection_type` (+ connection string) to a driver —
    /// `detectConnectionDbType(connectionString, savedType)`. `None` only for
    /// a saved type the original doesn't know.
    pub fn detect(connection_type: &str, connection_string: &str) -> Option<Kind> {
        let saved = connection_type.trim();
        detect::detect_connection_db_type(connection_string, (!saved.is_empty()).then_some(saved))
    }

    /// The original's `ConnectionDbType` string.
    pub fn as_str(self) -> &'static str {
        match self {
            Kind::Postgres => "postgres",
            Kind::MySql => "mysql",
            Kind::Sqlite => "sqlite",
            Kind::MongoDb => "mongodb",
            Kind::ClickHouse => "clickhouse",
            Kind::MsSql => "mssql",
            Kind::Redis => "redis",
            Kind::Trino => "trino",
            Kind::DuckDb => "duckdb",
            Kind::Federated => "federated",
            Kind::SpacetimeDb => "spacetimedb",
            Kind::Jdbc => "jdbc",
            Kind::Oracle => "oracle",
            Kind::SupabaseMgmt => "supabase-mgmt",
        }
    }

    pub fn from_db_type(s: &str) -> Option<Kind> {
        Kind::ALL.into_iter().find(|k| k.as_str() == s)
    }

    pub fn dialect(self) -> Dialect {
        Dialect::for_kind(self)
    }

    /// `isPostgresCatalogDbType`
    pub fn is_postgres_catalog(self) -> bool {
        matches!(self, Kind::Postgres | Kind::SupabaseMgmt)
    }

    pub fn capabilities(self) -> Capabilities {
        let pg = self.is_postgres_catalog();
        Capabilities {
            postgres_catalog: pg,
            routines: pg || matches!(self, Kind::MsSql | Kind::MySql | Kind::Oracle),
            sequences: pg || self == Kind::Oracle,
            indexes: pg || self == Kind::Oracle,
            oracle_extras: self == Kind::Oracle,
            trigger_write: pg || self == Kind::MsSql,
            routine_write: pg || self == Kind::MsSql,
            triggers: pg || matches!(self, Kind::MsSql | Kind::MySql | Kind::Oracle),
            cancel: matches!(self, Kind::Postgres | Kind::MySql),
            row_edit: !matches!(self, Kind::Redis | Kind::Trino | Kind::Federated | Kind::ClickHouse | Kind::DuckDb),
            sql: !matches!(self, Kind::MongoDb | Kind::Redis),
            namespaces: !matches!(self, Kind::Redis | Kind::SpacetimeDb),
            foreign_keys: !matches!(
                self,
                Kind::ClickHouse | Kind::Trino | Kind::DuckDb | Kind::SpacetimeDb | Kind::MongoDb | Kind::Redis
            ),
        }
    }

    /// Default schema the studio opens (`useStudio#fallbackSchemaForDb`).
    pub fn default_schema(self, connection_string: &str) -> String {
        detect::fallback_schema(self, connection_string)
    }
}

impl std::fmt::Display for Kind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

pub(crate) fn unsupported<T>(kind: Kind, what: &str) -> Result<T> {
    bail!("{what} is not supported for {} connections.", kind.as_str())
}

/// One database connection. All methods are cancel-safe to drop.
///
/// Methods with default implementations are the original's per-engine
/// fallbacks (usually "empty list" for catalog objects the engine lacks);
/// engines override what they support.
#[async_trait]
pub trait Driver: Send + Sync {
    fn kind(&self) -> Kind;

    /// Quoting/literal rules for generated SQL.
    fn dialect(&self) -> Dialect {
        self.kind().dialect()
    }

    /// Identifier quoting for generated SQL.
    fn quote_ident(&self, ident: &str) -> String {
        format!("\"{}\"", ident.replace('"', "\"\""))
    }

    fn capabilities(&self) -> Capabilities {
        self.kind().capabilities()
    }

    // ── core ─────────────────────────────────────────────────────────────

    /// Schemas / namespaces (`fetchSchemas`).
    async fn schemas(&self) -> Result<Vec<String>>;
    /// Tables *and* views of a schema (views flagged), sorted by name.
    async fn tables(&self, schema: &str) -> Result<Vec<TableRef>>;
    /// Short column list (kept for existing callers).
    async fn columns(&self, table: &TableRef) -> Result<Vec<ColumnInfo>> {
        Ok(self
            .table_structure(table)
            .await?
            .into_iter()
            .map(|c| ColumnInfo { name: c.column_name, data_type: c.data_type, nullable: c.is_nullable, is_primary_key: c.is_primary_key })
            .collect())
    }
    /// Run one or more statements; the last statement's result set is returned.
    async fn execute(&self, sql: &str, row_limit: usize) -> Result<QueryResult>;

    /// Run a script and return every statement's result (stops at the first
    /// error, which is reported in [`ScriptResult::error`]).
    async fn execute_script(&self, sql: &str, row_limit: usize) -> Result<ScriptResult> {
        let started = std::time::Instant::now();
        let mut out = ScriptResult::default();
        for (i, stmt) in split::split_statements(sql, self.dialect()).into_iter().enumerate() {
            match self.execute(&stmt, row_limit).await {
                Ok(r) => out.results.push(r),
                Err(e) => {
                    out.error = Some(ScriptError { statement_index: i, statement: stmt, message: format!("{e:#}") });
                    break;
                }
            }
        }
        out.elapsed = started.elapsed();
        Ok(out)
    }

    /// Run `sql` with positional parameters. Placeholders are the engine's
    /// own (`$1` for Postgres/SQLite-style, `?` for MySQL/MSSQL/Oracle/…);
    /// see [`Dialect::placeholder`]. The default inlines the values as
    /// literals (what the original does for HTTP engines).
    async fn execute_params(&self, sql: &str, params: &[Value], row_limit: usize) -> Result<QueryResult> {
        let sql = value::inline_params(sql, params, self.dialect());
        self.execute(&sql, row_limit).await
    }

    /// Like [`Driver::execute`] but registers the run under `query_id` so
    /// [`Driver::cancel_query`] can stop it (`runQuery(…, { queryId })`).
    async fn execute_cancellable(&self, sql: &str, row_limit: usize, _query_id: &str) -> Result<QueryResult> {
        self.execute(sql, row_limit).await
    }

    /// Cancel a query started with [`Driver::execute_cancellable`]. `Ok(false)`
    /// when it already finished (`cancelRunningQuery`).
    async fn cancel_query(&self, _query_id: &str) -> Result<bool> {
        bail!("Query cancellation is currently supported for PostgreSQL only.")
    }

    /// Run statements atomically (BEGIN … COMMIT, ROLLBACK on error).
    async fn transaction(&self, statements: &[String]) -> Result<Vec<QueryResult>> {
        let mut out = Vec::new();
        for s in statements {
            out.push(self.execute(s, usize::MAX).await?);
        }
        Ok(out)
    }

    /// `SELECT 1`-style round trip (`testConnection`).
    async fn ping(&self) -> Result<()> {
        self.execute("SELECT 1", 1).await.map(|_| ())
    }

    fn select_preview_sql(&self, table: &TableRef, limit: usize) -> String {
        let qualified = if table.schema.is_empty() {
            self.quote_ident(&table.name)
        } else {
            format!("{}.{}", self.quote_ident(&table.schema), self.quote_ident(&table.name))
        };
        format!("SELECT * FROM {qualified} LIMIT {limit}")
    }

    // ── table data (grid) ───────────────────────────────────────────────

    /// One page of a table with the grid's filter/sort model. The default
    /// builds SQL with [`grid::build_select_sql`] like `refreshTableData`.
    async fn read_table(&self, query: &TableQuery) -> Result<TablePage> {
        let sql = grid::build_select_sql(self.kind(), query);
        let mut result = self.execute(&sql, usize::MAX).await?;
        if result.columns.is_empty() && result.rows.is_empty() {
            // SQLite & HTTP engines report no columns for empty results —
            // backfill headers from the structure (as refreshTableData does).
            if let Ok(structure) = self.table_structure(&query.table).await {
                result.columns = structure.iter().map(|c| c.column_name.clone()).collect();
                result.column_types = structure.iter().map(|c| ColumnMeta::new(&c.column_name, &c.data_type)).collect();
            }
        }
        let total_count = if query.with_count { self.count_rows(&query.table, &query.filter).await.ok() } else { None };
        Ok(TablePage { result, query: sql, total_count })
    }

    /// `SELECT COUNT(*) … WHERE filter`.
    async fn count_rows(&self, table: &TableRef, filter: &TableFilter) -> Result<u64> {
        let sql = grid::build_count_sql(self.kind(), table, filter);
        let r = self.execute(&sql, 1).await?;
        r.rows
            .first()
            .and_then(|row| row.first())
            .and_then(|c| c.as_str())
            .and_then(|s| s.trim().parse::<f64>().ok())
            .map(|n| n as u64)
            .ok_or_else(|| anyhow::anyhow!("count returned no rows"))
    }

    /// Apply edits in one transaction (`updateTableRows`).
    async fn update_rows(&self, table: &TableRef, updates: &[RowUpdate]) -> Result<()> {
        let stmts: Vec<String> = updates.iter().filter_map(|u| grid::build_update_sql(self.kind(), table, u)).collect();
        if stmts.is_empty() {
            return Ok(());
        }
        self.transaction(&stmts).await.map(|_| ())
    }

    /// Delete rows by primary key (`deleteTableRows`). `rows` are full row
    /// values (or at least the key columns); the table's primary key picks
    /// the columns to match. Errors like the original when there is no PK.
    async fn delete_rows(&self, table: &TableRef, rows: &[RowValues]) -> Result<u64> {
        let pk = self.primary_key(table).await?;
        if pk.is_empty() {
            bail!("No primary key found for this table. Deletion is only supported for tables with a primary key.");
        }
        let stmts: Vec<String> = rows.iter().filter_map(|r| grid::build_delete_sql(self.kind(), table, &pk, r)).collect();
        if stmts.is_empty() {
            return Ok(0);
        }
        let results = self.transaction(&stmts).await?;
        Ok(results.iter().filter_map(|r| r.affected).sum())
    }

    /// Insert rows (one INSERT per row, in one transaction).
    async fn insert_rows(&self, table: &TableRef, rows: &[RowValues]) -> Result<u64> {
        let stmts: Vec<String> = rows.iter().map(|r| grid::build_insert_sql(self.kind(), table, r)).collect();
        if stmts.is_empty() {
            return Ok(0);
        }
        let results = self.transaction(&stmts).await?;
        Ok(results.iter().filter_map(|r| r.affected).sum())
    }

    /// The row a foreign key points at (`fetchReferencedRecord`).
    async fn referenced_record(&self, table: &TableRef, key_values: &RowValues) -> Result<Option<Record>> {
        let Some(sql) = grid::build_select_by_keys_sql(self.kind(), table, key_values) else {
            bail!("Missing key values.");
        };
        let r = self.execute(&sql, 1).await?;
        Ok(r.records().into_iter().next())
    }

    /// `EXPLAIN` (`fetchExplainPlan`). `analyze = true` reproduces the
    /// original exactly (Postgres `EXPLAIN (ANALYZE, COSTS, VERBOSE, BUFFERS,
    /// FORMAT JSON)`, MySQL `EXPLAIN ANALYZE`) — note that ANALYZE executes the
    /// statement. `analyze = false` asks for the estimated plan only.
    async fn explain(&self, query: &str, analyze: bool) -> Result<ExplainResult> {
        let plan_query = explain_sql(self.kind(), query, analyze);
        let result = self.execute(&plan_query, usize::MAX).await?;
        Ok(ExplainResult { result, plan_query })
    }

    // ── catalog ─────────────────────────────────────────────────────────

    /// Databases on the server (`fetchDatabases`).
    async fn databases(&self) -> Result<Vec<String>> {
        Ok(Vec::new())
    }
    /// Tables of a schema with kind, row estimate and size (sidebar /
    /// database objects). Default: [`Driver::tables`] without stats.
    async fn table_infos(&self, schema: &str) -> Result<Vec<TableInfo>> {
        Ok(self
            .tables(schema)
            .await?
            .into_iter()
            .map(|t| TableInfo {
                schema: t.schema,
                name: t.name,
                kind: if t.is_view { TableKind::View } else { TableKind::Table },
                ..Default::default()
            })
            .collect())
    }
    /// View names (`fetchViews`).
    async fn views(&self, schema: &str) -> Result<Vec<String>> {
        Ok(self.tables(schema).await?.into_iter().filter(|t| t.is_view).map(|t| t.name).collect())
    }
    /// Full column descriptions (`fetchTableStructure`).
    async fn table_structure(&self, table: &TableRef) -> Result<Vec<ColumnDetail>>;
    /// Foreign keys of a table (`fetchTableForeignKeys`).
    async fn foreign_keys(&self, _table: &TableRef) -> Result<Vec<ForeignKey>> {
        Ok(Vec::new())
    }
    /// Primary-key columns in key order.
    async fn primary_key(&self, table: &TableRef) -> Result<Vec<String>> {
        Ok(self.table_structure(table).await?.into_iter().filter(|c| c.is_primary_key).map(|c| c.column_name).collect())
    }
    /// Every column of every table (`fetchAllTablesWithColumns`: ERD,
    /// autocomplete, schema graph). `schema = None` → all user schemas.
    async fn all_tables_with_columns(&self, _schema: Option<&str>) -> Result<Vec<SchemaColumn>> {
        Ok(Vec::new())
    }
    /// Indexes (`fetchIndexes`); `schema = None` → all schemas.
    async fn indexes(&self, _schema: Option<&str>) -> Result<Vec<IndexInfo>> {
        Ok(Vec::new())
    }
    /// Constraints of a table (PK/FK/UNIQUE/CHECK).
    async fn constraints(&self, _table: &TableRef) -> Result<Vec<ConstraintInfo>> {
        Ok(Vec::new())
    }
    /// Enum types (`fetchEnums`).
    async fn enums(&self) -> Result<Vec<EnumType>> {
        Ok(Vec::new())
    }
    /// Functions / procedures (`fetchFunctions`).
    async fn functions(&self, _schema: &str) -> Result<Vec<RoutineInfo>> {
        Ok(Vec::new())
    }
    /// Triggers (`fetchTriggers`); `schema = None` → all schemas.
    async fn triggers(&self, _schema: Option<&str>) -> Result<Vec<TriggerInfo>> {
        Ok(Vec::new())
    }
    /// Sequences (`fetchSequences`).
    async fn sequences(&self, _schema: &str) -> Result<Vec<SequenceInfo>> {
        Ok(Vec::new())
    }
    /// Extensions (`fetchExtensions`).
    async fn extensions(&self) -> Result<Vec<ExtensionInfo>> {
        Ok(Vec::new())
    }
    /// RLS policies (`fetchRlsPolicies`).
    async fn rls_policies(&self, _schema: Option<&str>, _table: Option<&str>) -> Result<Vec<RlsPolicy>> {
        Ok(Vec::new())
    }
    /// Per-table RLS flags (`fetchTableSecurityInfo`).
    async fn table_security(&self, _schema: &str) -> Result<Vec<TableSecurity>> {
        Ok(Vec::new())
    }
    /// Role names (`fetchPostgresRoles`).
    async fn roles(&self) -> Result<Vec<String>> {
        Ok(Vec::new())
    }
    /// Materialized views (`fetchMaterializedViews`).
    async fn materialized_views(&self, _schema: &str) -> Result<Vec<MaterializedViewInfo>> {
        Ok(Vec::new())
    }
    /// Oracle packages (`fetchPackages`).
    async fn packages(&self, _schema: &str) -> Result<Vec<PackageInfo>> {
        Ok(Vec::new())
    }
    /// Oracle synonyms (`fetchSynonyms`).
    async fn synonyms(&self, _schema: &str) -> Result<Vec<SynonymInfo>> {
        Ok(Vec::new())
    }
    /// Oracle database links (`fetchDbLinks`).
    async fn db_links(&self) -> Result<Vec<DbLinkInfo>> {
        Ok(Vec::new())
    }
    /// Server sessions (`fetchSessions`) as a generic table.
    async fn sessions(&self) -> Result<QueryResult> {
        Ok(QueryResult::default())
    }
    /// Locks (`fetchLocks`) as a generic table.
    async fn locks(&self) -> Result<QueryResult> {
        Ok(QueryResult::default())
    }
    /// `pg_terminate_backend` (`killSession`).
    async fn kill_session(&self, _pid: i64) -> Result<()> {
        bail!("Session management is supported only for PostgreSQL connections.")
    }
    /// `pg_cancel_backend` (`cancelSessionQuery`).
    async fn cancel_session_query(&self, _pid: i64) -> Result<()> {
        bail!("Session management is supported only for PostgreSQL connections.")
    }
    /// Supabase `auth.users` (`fetchSupabaseAuthUsers`, SQL path).
    async fn supabase_auth_users(&self) -> Result<Vec<AuthUser>> {
        Ok(Vec::new())
    }
    /// Redis keys with type/TTL/size (`fetchRedisKeys`).
    async fn redis_keys(&self, _pattern: &str, _limit: usize, _db: Option<&str>) -> Result<Vec<RedisKeyInfo>> {
        unsupported(self.kind(), "Redis key browsing")
    }
}

/// The plan statement `fetchExplainPlan` sends for each engine.
pub fn explain_sql(kind: Kind, query: &str, analyze: bool) -> String {
    let trimmed = query.trim();
    let starts_with_explain = trimmed.len() >= 7 && trimmed[..7].eq_ignore_ascii_case("explain");
    match kind {
        Kind::Postgres | Kind::SupabaseMgmt => {
            if starts_with_explain {
                trimmed.to_string()
            } else if analyze {
                format!("EXPLAIN (ANALYZE, COSTS, VERBOSE, BUFFERS, FORMAT JSON)\n{trimmed}")
            } else {
                format!("EXPLAIN (COSTS, VERBOSE, FORMAT JSON)\n{trimmed}")
            }
        }
        Kind::MySql => {
            if analyze {
                format!("EXPLAIN ANALYZE\n{query}")
            } else {
                format!("EXPLAIN FORMAT=TREE\n{query}")
            }
        }
        Kind::Sqlite => format!("EXPLAIN QUERY PLAN\n{query}"),
        Kind::MsSql => format!("SET SHOWPLAN_XML ON;\n{query}"),
        Kind::Oracle => format!("EXPLAIN PLAN FOR\n{query}"),
        _ => format!("EXPLAIN\n{query}"),
    }
}

/// Connect to `connection_string` with a known engine.
pub async fn connect(kind: Kind, connection_string: &str) -> Result<Arc<dyn Driver>> {
    connect_with(kind, connection_string, &ConnectOptions::default()).await
}

/// Connect with [`ConnectOptions`].
pub async fn connect_with(kind: Kind, connection_string: &str, opts: &ConnectOptions) -> Result<Arc<dyn Driver>> {
    if detect::is_internal_placeholder(connection_string) {
        bail!("This is an internal placeholder, not a database connection. Return to Connections and reopen a saved connection.");
    }
    Ok(match kind {
        Kind::Postgres => Arc::new(postgres::PostgresDriver::connect(connection_string, opts).await?),
        Kind::MySql => Arc::new(mysql::MySqlDriver::connect(connection_string, opts).await?),
        Kind::Sqlite => sqlite::open_any(connection_string, opts).await?,
        Kind::ClickHouse => Arc::new(clickhouse::ClickHouseDriver::connect(connection_string).await?),
        Kind::Trino => Arc::new(trino::TrinoDriver::connect(connection_string).await?),
        Kind::SpacetimeDb => Arc::new(spacetimedb::SpacetimeDriver::connect(connection_string).await?),
        Kind::SupabaseMgmt => Arc::new(supabase_mgmt::SupabaseMgmtDriver::connect(connection_string).await?),
        other => bail!("`{}` connections are not supported by the native app yet.", other.as_str()),
    })
}

/// Detect the engine from the saved `connection_type` and string, then connect.
pub async fn connect_detect(connection_type: &str, connection_string: &str) -> Result<Arc<dyn Driver>> {
    match Kind::detect(connection_type, connection_string) {
        Some(kind) => connect(kind, connection_string).await,
        None => bail!("`{connection_type}` connections are not supported by the native app yet."),
    }
}

/// `testConnection`: connect and run a trivial round trip, then drop.
pub async fn test_connection(connection_type: &str, connection_string: &str) -> Result<()> {
    let driver = connect_detect(connection_type, connection_string).await?;
    driver.ping().await
}
