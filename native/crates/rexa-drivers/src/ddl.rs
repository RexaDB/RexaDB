//! DDL builders used by create-table / add-column / index / enum / trigger /
//! extension flows. Ports of `security-actions.ts` (`createEnum`,
//! `deleteEnum`, `toggleExtension`, `createIndex`, `deleteIndex`,
//! `createTrigger`), `schema-introspection-actions.ts` (`createDatabase`,
//! `createSchema`) and the table-structure edits in `hooks/use-studio.ts`.
//! Every function returns SQL to run with [`crate::Driver::execute`] (or
//! show in the review dialog first, as the original's "review" mode does).

use crate::{Kind, TableRef};
use anyhow::{bail, Result};

fn q(kind: Kind, s: &str) -> String {
    kind.dialect().quote_ident(s)
}

fn t(kind: Kind, table: &TableRef) -> String {
    kind.dialect().table_ref(&table.schema, &table.name)
}

/// `createSchema` (Postgres-style schemas only).
pub fn create_schema(kind: Kind, name: &str) -> Result<String> {
    match kind {
        Kind::MongoDb => bail!("MongoDB does not support SQL schemas."),
        Kind::Sqlite => bail!("SQLite does not support PostgreSQL-style schemas."),
        Kind::MySql => Ok(format!("CREATE DATABASE {};", q(kind, name))),
        _ => Ok(format!("CREATE SCHEMA {};", q(kind, name))),
    }
}

/// `createDatabase`.
pub fn create_database(kind: Kind, name: &str) -> Result<String> {
    match kind {
        Kind::Sqlite => bail!("SQLite uses a single database file. Create a new SQLite connection instead."),
        _ => Ok(format!("CREATE DATABASE {}", q(kind, name))),
    }
}

/// `createEnum`.
pub fn create_enum(schema: &str, name: &str, values: &[String]) -> String {
    let d = Kind::Postgres.dialect();
    let vals: Vec<String> = values.iter().map(|v| d.quote_str(v)).collect();
    format!("CREATE TYPE {} AS ENUM ({});", d.table_ref(schema, name), vals.join(", "))
}

/// `deleteEnum`.
pub fn drop_enum(schema: &str, name: &str) -> String {
    format!("DROP TYPE {};", Kind::Postgres.dialect().table_ref(schema, name))
}

/// `toggleExtension`.
pub fn toggle_extension(name: &str, install: bool) -> String {
    let n = Kind::Postgres.dialect().quote_ident(name);
    if install {
        format!("CREATE EXTENSION IF NOT EXISTS {n} CASCADE;")
    } else {
        format!("DROP EXTENSION IF EXISTS {n} CASCADE;")
    }
}

/// `createIndex` (methods outside the allow-list fall back to btree).
pub fn create_index(kind: Kind, table: &TableRef, name: &str, columns: &[String], unique: bool, method: Option<&str>) -> String {
    const ALLOWED: [&str; 8] = ["btree", "hash", "gin", "gist", "spgist", "brin", "bloom", "hypopg"];
    let cols: Vec<String> = columns.iter().map(|c| q(kind, c)).collect();
    let uniq = if unique { "UNIQUE " } else { "" };
    match kind {
        Kind::Postgres | Kind::SupabaseMgmt => {
            let m = method.map(str::to_ascii_lowercase).filter(|m| ALLOWED.contains(&m.as_str())).unwrap_or_else(|| "btree".into());
            format!("CREATE {uniq}INDEX {} ON {} USING {m} ({});", q(kind, name), t(kind, table), cols.join(", "))
        }
        _ => format!("CREATE {uniq}INDEX {} ON {} ({});", q(kind, name), t(kind, table), cols.join(", ")),
    }
}

/// `deleteIndex`. MySQL/MSSQL need the table.
pub fn drop_index(kind: Kind, schema: &str, name: &str, table: Option<&str>) -> String {
    match (kind, table) {
        (Kind::MySql, Some(tb)) => format!("DROP INDEX {} ON {};", q(kind, name), kind.dialect().table_ref(schema, tb)),
        (Kind::MsSql, Some(tb)) => format!("DROP INDEX {} ON {};", q(kind, name), kind.dialect().table_ref(schema, tb)),
        (Kind::Sqlite, _) => format!("DROP INDEX {};", kind.dialect().table_ref(schema, name)),
        _ => format!("DROP INDEX {};", kind.dialect().table_ref(schema, name)),
    }
}

/// `createTrigger` (Postgres). Invalid events are dropped; at least one required.
pub fn create_trigger(
    table: &TableRef,
    name: &str,
    events: &[String],
    timing: &str,
    for_each_row: bool,
    function_name: &str,
) -> Result<String> {
    let valid: Vec<String> = events
        .iter()
        .map(|e| e.to_ascii_uppercase())
        .filter(|e| ["INSERT", "UPDATE", "DELETE", "TRUNCATE"].contains(&e.as_str()))
        .collect();
    if valid.is_empty() {
        bail!("At least one valid trigger event (INSERT, UPDATE, DELETE, TRUNCATE) is required.");
    }
    let timing = timing.to_ascii_uppercase();
    let timing = if ["BEFORE", "AFTER", "INSTEAD OF"].contains(&timing.as_str()) { timing } else { "AFTER".into() };
    let d = Kind::Postgres.dialect();
    Ok(format!(
        "CREATE TRIGGER {}\n{} {}\nON {}\n{}\nEXECUTE FUNCTION {}();",
        d.quote_ident(name),
        timing,
        valid.join(" OR "),
        d.table_ref(&table.schema, &table.name),
        if for_each_row { "FOR EACH ROW" } else { "FOR EACH STATEMENT" },
        d.table_ref(&table.schema, function_name),
    ))
}

/// `DROP TRIGGER` (PG needs `ON table`; MSSQL uses the schema-qualified name).
pub fn drop_trigger(kind: Kind, schema: &str, name: &str, table: &str) -> String {
    match kind {
        Kind::MsSql => format!("DROP TRIGGER {};", kind.dialect().table_ref(schema, name)),
        Kind::MySql | Kind::Sqlite => format!("DROP TRIGGER {};", kind.dialect().table_ref(schema, name)),
        _ => format!("DROP TRIGGER {} ON {};", q(kind, name), kind.dialect().table_ref(schema, table)),
    }
}

/// Column definition for [`create_table`] / [`add_column`].
#[derive(Debug, Clone, Default)]
pub struct ColumnDef {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub default: Option<String>,
    pub primary_key: bool,
    pub unique: bool,
    /// `REFERENCES schema.table(column)` with optional ON DELETE/UPDATE.
    pub references: Option<(TableRef, String)>,
    pub on_delete: Option<String>,
    pub on_update: Option<String>,
}

fn column_sql(kind: Kind, c: &ColumnDef, inline_pk: bool) -> String {
    let mut s = format!("{} {}", q(kind, &c.name), c.data_type);
    if inline_pk && c.primary_key {
        s.push_str(" PRIMARY KEY");
    }
    if !c.nullable && !c.primary_key {
        s.push_str(" NOT NULL");
    }
    if let Some(d) = c.default.as_deref().filter(|d| !d.trim().is_empty()) {
        s.push_str(&format!(" DEFAULT {d}"));
    }
    if c.unique && !c.primary_key {
        s.push_str(" UNIQUE");
    }
    if let Some((rt, rc)) = &c.references {
        s.push_str(&format!(" REFERENCES {}({})", t(kind, rt), q(kind, rc)));
        if let Some(a) = c.on_delete.as_deref().filter(|a| crate::ddl::is_fk_action(a)) {
            s.push_str(&format!(" ON DELETE {a}"));
        }
        if let Some(a) = c.on_update.as_deref().filter(|a| crate::ddl::is_fk_action(a)) {
            s.push_str(&format!(" ON UPDATE {a}"));
        }
    }
    s
}

/// `FK_ACTIONS` (`lib/db/column-types.ts`).
pub const FK_ACTIONS: [&str; 5] = ["NO ACTION", "RESTRICT", "CASCADE", "SET NULL", "SET DEFAULT"];

pub fn is_fk_action(a: &str) -> bool {
    FK_ACTIONS.iter().any(|x| x.eq_ignore_ascii_case(a))
}

/// `CREATE TABLE` with a table-level composite primary key when more than
/// one column is marked.
pub fn create_table(kind: Kind, table: &TableRef, columns: &[ColumnDef]) -> String {
    let pk: Vec<&ColumnDef> = columns.iter().filter(|c| c.primary_key).collect();
    let inline = pk.len() == 1;
    let mut lines: Vec<String> = columns.iter().map(|c| format!("  {}", column_sql(kind, c, inline))).collect();
    if pk.len() > 1 {
        lines.push(format!("  PRIMARY KEY ({})", pk.iter().map(|c| q(kind, &c.name)).collect::<Vec<_>>().join(", ")));
    }
    let mut sql = format!("CREATE TABLE {} (\n{}\n)", t(kind, table), lines.join(",\n"));
    if kind == Kind::ClickHouse {
        let order = if pk.is_empty() { "tuple()".to_string() } else { pk.iter().map(|c| q(kind, &c.name)).collect::<Vec<_>>().join(", ") };
        sql.push_str(&format!(" ENGINE = MergeTree ORDER BY ({order})"));
    }
    sql.push(';');
    sql
}

pub fn add_column(kind: Kind, table: &TableRef, c: &ColumnDef) -> String {
    match kind {
        Kind::MsSql => format!("ALTER TABLE {} ADD {};", t(kind, table), column_sql(kind, c, true)),
        _ => format!("ALTER TABLE {} ADD COLUMN {};", t(kind, table), column_sql(kind, c, true)),
    }
}

pub fn drop_column(kind: Kind, table: &TableRef, column: &str) -> String {
    format!("ALTER TABLE {} DROP COLUMN {};", t(kind, table), q(kind, column))
}

pub fn rename_column(kind: Kind, table: &TableRef, from: &str, to: &str) -> String {
    match kind {
        Kind::MsSql => format!(
            "EXEC sp_rename '{}.{}', '{}', 'COLUMN';",
            kind.dialect().table_ref(&table.schema, &table.name).replace('\'', "''"),
            from.replace('\'', "''"),
            to.replace('\'', "''")
        ),
        _ => format!("ALTER TABLE {} RENAME COLUMN {} TO {};", t(kind, table), q(kind, from), q(kind, to)),
    }
}

/// Change a column's type (and nullability where the syntax allows).
pub fn alter_column_type(kind: Kind, table: &TableRef, column: &str, new_type: &str, nullable: bool) -> Result<String> {
    let tb = t(kind, table);
    let c = q(kind, column);
    Ok(match kind {
        Kind::Postgres | Kind::SupabaseMgmt => format!(
            "ALTER TABLE {tb} ALTER COLUMN {c} TYPE {new_type} USING {c}::{new_type}, ALTER COLUMN {c} {} NOT NULL;",
            if nullable { "DROP" } else { "SET" }
        ),
        Kind::MySql => format!("ALTER TABLE {tb} MODIFY COLUMN {c} {new_type}{};", if nullable { " NULL" } else { " NOT NULL" }),
        Kind::MsSql => format!("ALTER TABLE {tb} ALTER COLUMN {c} {new_type}{};", if nullable { " NULL" } else { " NOT NULL" }),
        Kind::ClickHouse => format!("ALTER TABLE {tb} MODIFY COLUMN {c} {new_type};"),
        Kind::Oracle => format!("ALTER TABLE {tb} MODIFY ({c} {new_type}{});", if nullable { " NULL" } else { " NOT NULL" }),
        Kind::DuckDb => format!("ALTER TABLE {tb} ALTER COLUMN {c} TYPE {new_type};"),
        _ => bail!("Changing column types is not supported for {} connections.", kind.as_str()),
    })
}

pub fn rename_table(kind: Kind, table: &TableRef, to: &str) -> String {
    match kind {
        Kind::MySql => format!("RENAME TABLE {} TO {};", t(kind, table), kind.dialect().table_ref(&table.schema, to)),
        Kind::MsSql => format!("EXEC sp_rename '{}', '{}';", t(kind, table).replace('\'', "''"), to.replace('\'', "''")),
        _ => format!("ALTER TABLE {} RENAME TO {};", t(kind, table), q(kind, to)),
    }
}

pub fn drop_table(kind: Kind, table: &TableRef, cascade: bool) -> String {
    let kw = if table.is_view { "VIEW" } else { "TABLE" };
    let cascade = cascade && matches!(kind, Kind::Postgres | Kind::SupabaseMgmt);
    format!("DROP {kw} {}{};", t(kind, table), if cascade { " CASCADE" } else { "" })
}

/// Empty a table (`clearTable`). SQLite has no TRUNCATE.
pub fn truncate_table(kind: Kind, table: &TableRef) -> String {
    match kind {
        Kind::Sqlite => format!("DELETE FROM {};", t(kind, table)),
        _ => format!("TRUNCATE TABLE {};", t(kind, table)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_ddl() {
        let tb = TableRef::new("public", "t");
        assert_eq!(create_enum("public", "mood", &["ok".into(), "it's".into()]), "CREATE TYPE \"public\".\"mood\" AS ENUM ('ok', 'it''s');");
        assert_eq!(toggle_extension("pgcrypto", true), "CREATE EXTENSION IF NOT EXISTS \"pgcrypto\" CASCADE;");
        assert_eq!(
            create_index(Kind::Postgres, &tb, "i", &["a".into()], true, Some("evil; drop")),
            "CREATE UNIQUE INDEX \"i\" ON \"public\".\"t\" USING btree (\"a\");"
        );
        let cols = vec![
            ColumnDef { name: "id".into(), data_type: "SERIAL".into(), primary_key: true, ..Default::default() },
            ColumnDef { name: "n".into(), data_type: "TEXT".into(), nullable: false, default: Some("'x'".into()), ..Default::default() },
        ];
        assert_eq!(
            create_table(Kind::Postgres, &tb, &cols),
            "CREATE TABLE \"public\".\"t\" (\n  \"id\" SERIAL PRIMARY KEY,\n  \"n\" TEXT NOT NULL DEFAULT 'x'\n);"
        );
        assert!(create_trigger(&tb, "tr", &["bogus".into()], "AFTER", true, "f").is_err());
        assert!(create_trigger(&tb, "tr", &["insert".into()], "before", true, "f").unwrap().contains("BEFORE INSERT"));
    }
}
