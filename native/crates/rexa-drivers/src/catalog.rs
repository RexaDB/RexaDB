//! Catalog object types returned by [`crate::Driver`]'s metadata methods.
//!
//! Field names follow the row shapes of the original (`security-actions.ts`,
//! `schema-introspection-actions.ts`, `*-client.ts#getTableStructure` …) so
//! the UI ports can read them 1:1. Optional extras the original didn't have
//! (identity, comments, sizes) are `Option`/`Default` and only filled when
//! the engine reports them.

/// Relation kind of a table-like object.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash)]
pub enum TableKind {
    #[default]
    Table,
    View,
    MaterializedView,
    Foreign,
    Partitioned,
    /// MongoDB collection.
    Collection,
}

impl TableKind {
    pub fn is_view(self) -> bool {
        matches!(self, TableKind::View | TableKind::MaterializedView)
    }
}

/// A table/view with optional statistics ([`crate::Driver::table_infos`]).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct TableInfo {
    pub schema: String,
    pub name: String,
    pub kind: TableKind,
    /// Planner row estimate (`pg_class.reltuples`, `information_schema.tables.table_rows`, …).
    pub row_estimate: Option<i64>,
    /// Total on-disk size including indexes/toast, bytes.
    pub total_bytes: Option<i64>,
    /// Heap/data size only, bytes.
    pub data_bytes: Option<i64>,
    pub comment: Option<String>,
    /// Postgres: `relrowsecurity`.
    pub rls_enabled: Option<bool>,
}

impl TableInfo {
    pub fn table_ref(&self) -> crate::TableRef {
        crate::TableRef { schema: self.schema.clone(), name: self.name.clone(), is_view: self.kind.is_view() }
    }
}

/// One column (`fetchTableStructure` row).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ColumnDetail {
    pub column_name: String,
    /// Type as the original reports it (Postgres: `information_schema` style
    /// — `character varying`, `USER-DEFINED`, `ARRAY`; MySQL `data_type`).
    pub data_type: String,
    /// Full declared type with modifiers (`character varying(255)`,
    /// `varchar(255)`, `Nullable(String)`) — what to show in the grid header.
    pub full_type: String,
    /// Postgres `udt_schema` / `udt_name` (enum/domain/array element type).
    pub udt_schema: Option<String>,
    pub udt_name: Option<String>,
    pub is_nullable: bool,
    pub column_default: Option<String>,
    pub character_maximum_length: Option<i64>,
    pub numeric_precision: Option<i64>,
    pub numeric_scale: Option<i64>,
    pub is_primary_key: bool,
    pub is_foreign_key: bool,
    pub is_unique: bool,
    /// `GENERATED … AS IDENTITY` / `AUTO_INCREMENT` / `IDENTITY(1,1)`.
    pub is_identity: bool,
    /// `ALWAYS` / `BY DEFAULT` for Postgres identity columns.
    pub identity_generation: Option<String>,
    /// Generated (computed) column expression.
    pub generation_expression: Option<String>,
    /// MySQL `extra` (`auto_increment`, `on update CURRENT_TIMESTAMP`, …).
    pub extra: Option<String>,
    pub comment: Option<String>,
    /// The column's type is an enum (Postgres `typtype = 'e'`, MySQL `enum(...)`).
    pub is_enum: bool,
    pub ordinal_position: i64,
}

impl ColumnDetail {
    /// Type to show/edit by: `full_type` when present, else `data_type`.
    pub fn display_type(&self) -> &str {
        if self.full_type.is_empty() {
            &self.data_type
        } else {
            &self.full_type
        }
    }

    pub fn category(&self) -> crate::TypeCategory {
        crate::TypeCategory::classify(self.display_type())
    }
}

/// One column of [`crate::Driver::all_tables_with_columns`] (the original's
/// `CachedColumnRow`).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct SchemaColumn {
    pub table_schema: String,
    pub table_name: String,
    pub column_name: String,
    pub data_type: String,
    pub is_nullable: bool,
    pub column_default: Option<String>,
    pub is_primary: bool,
    pub referenced_table_schema: Option<String>,
    pub referenced_table_name: Option<String>,
    pub referenced_column_name: Option<String>,
}

/// `fetchTableForeignKeys` row (`StudioForeignKey`).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ForeignKey {
    pub column_name: String,
    pub foreign_table_schema: String,
    pub foreign_table_name: String,
    pub foreign_column_name: String,
    pub constraint_name: Option<String>,
    /// `CASCADE`, `SET NULL`, `NO ACTION`, …
    pub on_update: Option<String>,
    pub on_delete: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct IndexInfo {
    pub schema: String,
    pub table_name: String,
    pub name: String,
    /// `CREATE [UNIQUE] INDEX …` (Postgres `pg_get_indexdef`).
    pub definition: String,
    pub is_unique: bool,
    pub is_primary: bool,
    pub columns: Vec<String>,
    /// btree, hash, gin, …
    pub method: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConstraintType {
    PrimaryKey,
    ForeignKey,
    Unique,
    Check,
    Exclude,
    Other,
}

impl ConstraintType {
    pub fn label(self) -> &'static str {
        match self {
            ConstraintType::PrimaryKey => "PRIMARY KEY",
            ConstraintType::ForeignKey => "FOREIGN KEY",
            ConstraintType::Unique => "UNIQUE",
            ConstraintType::Check => "CHECK",
            ConstraintType::Exclude => "EXCLUDE",
            ConstraintType::Other => "OTHER",
        }
    }

    pub fn parse(s: &str) -> Self {
        match s.trim().to_ascii_uppercase().as_str() {
            "P" | "PRIMARY KEY" | "PRIMARY" => ConstraintType::PrimaryKey,
            "F" | "FOREIGN KEY" | "R" => ConstraintType::ForeignKey,
            "U" | "UNIQUE" => ConstraintType::Unique,
            "C" | "CHECK" => ConstraintType::Check,
            "X" | "EXCLUDE" => ConstraintType::Exclude,
            _ => ConstraintType::Other,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConstraintInfo {
    pub name: String,
    pub constraint_type: ConstraintType,
    pub columns: Vec<String>,
    /// `pg_get_constraintdef` / check clause.
    pub definition: Option<String>,
}

/// `fetchEnums` entry.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct EnumType {
    pub schema: String,
    pub name: String,
    pub values: Vec<String>,
}

/// `fetchFunctions` row (PG/MySQL/MSSQL/Oracle shapes unified).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RoutineInfo {
    pub schema: String,
    pub name: String,
    pub arguments: String,
    pub return_type: String,
    pub language: String,
    pub definition: Option<String>,
    /// `FUNCTION` or `PROCEDURE`.
    pub r#type: String,
    /// `IMMUTABLE`/`STABLE`/`VOLATILE` (PG), `DETERMINISTIC`/… (MySQL).
    pub volatility: Option<String>,
    pub security_definer: Option<bool>,
    pub owner: Option<String>,
    /// Oracle package member: the package name.
    pub package_name: Option<String>,
}

/// `fetchTriggers` row (legacy pg shape + TriggersList shape).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct TriggerInfo {
    pub schema: String,
    pub name: String,
    pub table_schema: Option<String>,
    pub table_name: Option<String>,
    /// BEFORE / AFTER / INSTEAD OF (`activation`).
    pub timing: String,
    /// Comma-joined events (`INSERT, UPDATE`).
    pub event: String,
    pub events: Vec<String>,
    /// ROW / STATEMENT.
    pub orientation: String,
    pub function_name: String,
    pub enabled_mode: String,
    /// Action statement / body.
    pub definition: Option<String>,
    /// Postgres `pg_get_triggerdef` (`full_definition`).
    pub full_definition: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SequenceInfo {
    pub schema: String,
    pub name: String,
    pub owner: Option<String>,
    pub data_type: Option<String>,
    pub start_value: Option<String>,
    pub min_value: Option<String>,
    pub max_value: Option<String>,
    pub increment_by: Option<String>,
    pub cycle_flag: bool,
    pub cache_size: Option<String>,
    pub last_number: Option<String>,
}

/// `fetchExtensions` row.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ExtensionInfo {
    pub name: String,
    pub default_version: Option<String>,
    pub installed_version: Option<String>,
    pub comment: Option<String>,
    pub installed_schema: Option<String>,
    pub default_schema: Option<String>,
    pub requires: Option<String>,
    pub trusted: Option<bool>,
    pub relocatable: Option<bool>,
    pub superuser: Option<bool>,
    pub available_versions: Option<String>,
}

impl ExtensionInfo {
    pub fn is_installed(&self) -> bool {
        self.installed_version.is_some()
    }
}

/// `fetchRlsPolicies` row.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RlsPolicy {
    pub schema: String,
    pub table_name: String,
    pub name: String,
    /// `PERMISSIVE` / `RESTRICTIVE`.
    pub permissive: String,
    pub roles: Vec<String>,
    /// ALL / SELECT / INSERT / UPDATE / DELETE.
    pub command: String,
    pub using_expression: Option<String>,
    pub with_check_expression: Option<String>,
    pub rls_enabled: bool,
    pub rls_forced: bool,
}

/// `fetchTableSecurityInfo` row.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct TableSecurity {
    pub table_name: String,
    pub rls_enabled: bool,
    pub rls_forced: bool,
    pub policy_count: i64,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct MaterializedViewInfo {
    pub schema: String,
    pub name: String,
    pub refresh_mode: Option<String>,
    pub refresh_method: Option<String>,
    pub build_mode: Option<String>,
    pub last_refresh_date: Option<String>,
    pub staleness: Option<String>,
    pub compile_state: Option<String>,
    pub query: Option<String>,
    /// Postgres `ispopulated`.
    pub is_populated: Option<bool>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PackageInfo {
    pub schema: String,
    pub name: String,
    pub status: String,
    pub definition: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SynonymInfo {
    pub schema: String,
    pub name: String,
    pub table_owner: String,
    pub table_name: String,
    pub db_link: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DbLinkInfo {
    pub owner: String,
    pub name: String,
    pub username: Option<String>,
    pub host: Option<String>,
}

/// `SupabaseAuthUserOption`.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct AuthUser {
    pub id: String,
    pub display_name: String,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub role: String,
    pub providers: Vec<String>,
    pub created_at: Option<String>,
    pub raw_app_meta_data: serde_json::Value,
    pub raw_user_meta_data: serde_json::Value,
}

/// `RedisKeyInfo` (`types/redis.ts`).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RedisKeyInfo {
    pub key: String,
    pub r#type: String,
    pub ttl_seconds: Option<i64>,
    pub size: Option<i64>,
}

/// `extractIndexColumns` (`lib/db/pg-utils.ts`): the parenthesised list of a
/// `CREATE INDEX` definition, unquoted.
pub fn extract_index_columns(definition: &str) -> Vec<String> {
    let (Some(start), Some(end)) = (definition.find('('), definition.rfind(')')) else { return Vec::new() };
    if end <= start {
        return Vec::new();
    }
    definition[start + 1..end].split(',').map(|c| c.trim().replace('"', "")).collect()
}

#[cfg(test)]
mod tests {
    #[test]
    fn index_columns() {
        assert_eq!(
            super::extract_index_columns(r#"CREATE UNIQUE INDEX a ON public.t USING btree ("Id", name)"#),
            vec!["Id", "name"]
        );
        assert!(super::extract_index_columns("x").is_empty());
    }
}
