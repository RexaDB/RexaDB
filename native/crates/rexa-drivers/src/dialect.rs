//! Per-engine SQL syntax: identifier quoting (`lib/db/quote-identifier.ts`,
//! `useStudio#quoteIdentifier`/`quoteTableRef`), literals, placeholders.

use crate::{Kind, Value};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Dialect {
    Postgres,
    MySql,
    Sqlite,
    MsSql,
    ClickHouse,
    DuckDb,
    Oracle,
    Trino,
    SpacetimeDb,
    /// Not SQL: MongoDB JSON / shell commands.
    Mongo,
    /// Not SQL: Redis commands.
    Redis,
}

impl Dialect {
    pub fn for_kind(kind: Kind) -> Dialect {
        match kind {
            Kind::Postgres | Kind::SupabaseMgmt | Kind::Federated | Kind::Jdbc => Dialect::Postgres,
            Kind::MySql => Dialect::MySql,
            Kind::Sqlite => Dialect::Sqlite,
            Kind::MsSql => Dialect::MsSql,
            Kind::ClickHouse => Dialect::ClickHouse,
            Kind::DuckDb => Dialect::DuckDb,
            Kind::Oracle => Dialect::Oracle,
            Kind::Trino => Dialect::Trino,
            Kind::SpacetimeDb => Dialect::SpacetimeDb,
            Kind::MongoDb => Dialect::Mongo,
            Kind::Redis => Dialect::Redis,
        }
    }

    /// `"x"` (PG/SQLite/DuckDB/Oracle/…), `` `x` `` (MySQL/ClickHouse), `[x]` (MSSQL).
    pub fn quote_ident(self, ident: &str) -> String {
        match self {
            Dialect::MySql | Dialect::ClickHouse => format!("`{}`", ident.replace('`', "``")),
            Dialect::MsSql => format!("[{}]", ident.replace(']', "]]")),
            _ => format!("\"{}\"", ident.replace('"', "\"\"")),
        }
    }

    /// Qualified table reference exactly like `useStudio#quoteTableRef`:
    /// Trino `catalog.schema` schemas split into three parts, SpacetimeDB
    /// uses the bare table, empty schema → bare table.
    pub fn table_ref(self, schema: &str, table: &str) -> String {
        if self == Dialect::Trino {
            let parts: Vec<&str> = schema.split('.').filter(|p| !p.is_empty()).collect();
            if parts.len() >= 2 {
                return format!("{}.{}.{}", self.quote_ident(parts[0]), self.quote_ident(parts[1]), self.quote_ident(table));
            }
        }
        if self == Dialect::SpacetimeDb || schema.is_empty() {
            return self.quote_ident(table);
        }
        format!("{}.{}", self.quote_ident(schema), self.quote_ident(table))
    }

    /// String literal. MySQL also escapes backslashes; MSSQL uses `N'…'`.
    pub fn quote_str(self, s: &str) -> String {
        match self {
            Dialect::MySql => format!("'{}'", s.replace('\\', "\\\\").replace('\'', "''")),
            Dialect::ClickHouse => format!("'{}'", s.replace('\\', "\\\\").replace('\'', "\\'")),
            Dialect::MsSql => format!("N'{}'", s.replace('\'', "''")),
            _ => format!("'{}'", s.replace('\'', "''")),
        }
    }

    pub fn literal(self, v: &Value) -> String {
        match v {
            Value::Null => "NULL".into(),
            Value::Bool(b) => match self {
                Dialect::MsSql | Dialect::ClickHouse | Dialect::Sqlite | Dialect::Oracle => (if *b { "1" } else { "0" }).into(),
                _ => (if *b { "TRUE" } else { "FALSE" }).into(),
            },
            Value::Int(i) => i.to_string(),
            Value::Float(f) if f.is_finite() => f.to_string(),
            Value::Float(_) => "NULL".into(),
            Value::Text(s) => self.quote_str(s),
            Value::Json(j) => self.quote_str(&j.to_string()),
            Value::Raw(r) => r.clone(),
            Value::Bytes(b) => {
                let hex: String = b.iter().map(|x| format!("{x:02x}")).collect();
                match self {
                    Dialect::Postgres => format!("'\\x{hex}'"),
                    Dialect::MySql | Dialect::Sqlite | Dialect::DuckDb => format!("X'{hex}'"),
                    Dialect::MsSql => format!("0x{hex}"),
                    Dialect::Oracle => format!("HEXTORAW('{hex}')"),
                    _ => format!("'{hex}'"),
                }
            }
        }
    }

    /// Positional placeholder `i` (1-based), as `useStudio#buildPlaceholders`.
    pub fn placeholder(self, i: usize) -> String {
        match self {
            Dialect::MySql | Dialect::ClickHouse | Dialect::MsSql | Dialect::Oracle => "?".into(),
            _ => format!("${i}"),
        }
    }

    /// CAST target for the contains/starts/ends filters (`containsCastTarget`).
    pub fn text_cast_target(self) -> &'static str {
        match self {
            Dialect::MsSql => "NVARCHAR(MAX)",
            Dialect::MySql => "CHAR",
            Dialect::ClickHouse => "String",
            _ => "TEXT",
        }
    }

    pub fn is_sql(self) -> bool {
        !matches!(self, Dialect::Mongo | Dialect::Redis)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quoting_matches_original() {
        assert_eq!(Dialect::Postgres.quote_ident("a\"b"), "\"a\"\"b\"");
        assert_eq!(Dialect::MySql.quote_ident("a`b"), "`a``b`");
        assert_eq!(Dialect::MsSql.quote_ident("a]b"), "[a]]b]");
        assert_eq!(Dialect::Trino.table_ref("hive.default", "t"), "\"hive\".\"default\".\"t\"");
        assert_eq!(Dialect::SpacetimeDb.table_ref("db", "t"), "\"t\"");
        assert_eq!(Dialect::MySql.literal(&Value::Text("a\\'".into())), "'a\\\\'''");
        assert_eq!(Dialect::MsSql.literal(&Value::Bool(true)), "1");
    }
}
