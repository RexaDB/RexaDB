//! Port of lib/db/column-types.ts and `getDefaultNewTableColumns`
//! (lib/studio/db-utils.ts).

pub const POSTGRES: &[&str] = &[
    "SERIAL", "BIGSERIAL", "INTEGER", "BIGINT", "SMALLINT", "TEXT", "VARCHAR", "BOOLEAN", "TIMESTAMPTZ", "TIMESTAMP", "DATE", "JSONB", "UUID", "NUMERIC", "REAL", "DOUBLE PRECISION",
];
pub const SQLITE: &[&str] = &["INTEGER", "TEXT", "REAL", "NUMERIC", "BLOB", "BOOLEAN", "DATE", "DATETIME"];
pub const MYSQL: &[&str] = &["INT", "BIGINT", "SMALLINT", "TINYINT", "VARCHAR", "TEXT", "BOOLEAN", "DATETIME", "TIMESTAMP", "DATE", "DECIMAL", "FLOAT", "DOUBLE", "JSON", "BLOB"];
pub const MSSQL: &[&str] = &[
    "INT", "BIGINT", "SMALLINT", "TINYINT", "BIT", "VARCHAR(255)", "NVARCHAR(255)", "TEXT", "NTEXT", "DATETIME2", "DATETIME", "DATE", "TIME", "DECIMAL(18,2)", "FLOAT", "REAL", "UNIQUEIDENTIFIER",
];
pub const CLICKHOUSE: &[&str] = &[
    "UInt8", "UInt16", "UInt32", "UInt64", "Int8", "Int16", "Int32", "Int64", "Float32", "Float64", "String", "FixedString(16)", "Date", "DateTime", "DateTime64(3)", "UUID", "IPv4", "IPv6",
];
pub const POSTGRES_EDIT: &[&str] = &[
    "TEXT", "VARCHAR", "INTEGER", "BIGINT", "SMALLINT", "NUMERIC", "DECIMAL", "REAL", "DOUBLE PRECISION", "BOOLEAN", "DATE", "TIME", "TIMESTAMPTZ", "TIMESTAMP", "UUID", "JSONB",
];
pub const SPACETIMEDB: &[&str] = &[
    "String", "Bool", "U8", "U16", "U32", "U64", "U128", "U256", "I8", "I16", "I32", "I64", "I128", "I256", "F32", "F64", "Identity", "ConnectionId", "Timestamp", "TimeDuration", "Bytes",
];

/// The create-table type list for a `dbType`.
pub fn for_db(db_type: &str) -> &'static [&'static str] {
    match db_type {
        "spacetimedb" => SPACETIMEDB,
        "sqlite" => SQLITE,
        "mysql" => MYSQL,
        "mssql" => MSSQL,
        "clickhouse" => CLICKHOUSE,
        _ => POSTGRES,
    }
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct NewColumn {
    pub name: String,
    pub r#type: String,
    pub is_primary: bool,
    pub is_nullable: bool,
    pub is_unique: bool,
    pub default: String,
    /// (table, column)
    pub references: Option<(String, String)>,
}

fn col(name: &str, ty: &str, pk: bool, default: &str) -> NewColumn {
    NewColumn { name: name.into(), r#type: ty.into(), is_primary: pk, is_nullable: false, is_unique: false, default: default.into(), references: None }
}

/// `getDefaultNewTableColumns`.
pub fn default_new_table_columns(db_type: &str) -> Vec<NewColumn> {
    match db_type {
        "redis" | "jdbc" | "federated" => vec![],
        "sqlite" => vec![col("id", "INTEGER", true, ""), col("created_at", "TEXT", false, "CURRENT_TIMESTAMP")],
        "mssql" => vec![col("id", "INT", true, "IDENTITY(1,1)"), col("created_at", "DATETIME2", false, "SYSUTCDATETIME()")],
        "mysql" => vec![col("id", "INT", true, "AUTO_INCREMENT"), col("created_at", "TIMESTAMP", false, "CURRENT_TIMESTAMP")],
        "clickhouse" => vec![col("id", "UInt64", false, ""), col("created_at", "DateTime", false, "now()")],
        "spacetimedb" => vec![col("id", "U64", true, ""), col("name", "String", false, ""), col("created_at", "Timestamp", false, "")],
        _ => vec![col("id", "SERIAL", true, ""), col("created_at", "TIMESTAMPTZ", false, "NOW()")],
    }
}
