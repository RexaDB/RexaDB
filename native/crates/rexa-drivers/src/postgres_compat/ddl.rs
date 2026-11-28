//! DDL renderers for Postgres → SQLite/MySQL. Port of
//! `ddl-compile.ts`, `ddl-create-table.ts`, `ddl-alter-table.ts`,
//! `ddl-alter-column.ts`, `ddl-constraints.ts`, `ddl-default.ts`,
//! `ddl-shared.ts`, `ddl-generic.ts`.

use super::PgCompatTarget;
use anyhow::{bail, Result};
use sqlparser::ast::{
    AlterColumnOperation, AlterTable, AlterTableOperation, CheckConstraint, ColumnDef, ColumnOption, CreateTable,
    DataType, Expr, ForeignKeyConstraint, FunctionArguments, Ident, ObjectName, ObjectNamePart, ObjectType,
    PrimaryKeyConstraint, ReferentialAction, RenameTableNameKind, Statement, TableConstraint, TimezoneInfo,
    UniqueConstraint,
};

pub(super) fn compile_ddl_statement(target: PgCompatTarget, statement: &Statement) -> Result<String> {
    match statement {
        Statement::CreateTable(stmt) => render_create_table(target, stmt),
        Statement::AlterTable(stmt) => render_alter_table(target, stmt),
        Statement::CreateIndex(_) => Ok(render_generic_ddl(target, statement)),
        Statement::Drop {
            object_type: ObjectType::Table | ObjectType::Index,
            ..
        } => Ok(render_generic_ddl(target, statement)),
        Statement::CreateSchema { .. } => {
            bail!("CREATE SCHEMA is not supported for {}.", target_name(target));
        }
        _ => bail!("Unsupported DDL statement type."),
    }
}

fn target_name(target: PgCompatTarget) -> &'static str {
    match target {
        PgCompatTarget::Postgres => "postgres",
        PgCompatTarget::Sqlite => "sqlite",
        PgCompatTarget::Mysql => "mysql",
    }
}

fn quote_ident(target: PgCompatTarget, name: &str) -> String {
    if target == PgCompatTarget::Mysql {
        format!("`{}`", name.replace('`', "``"))
    } else {
        format!("\"{}\"", name.replace('"', "\"\""))
    }
}

fn quote_ident_obj(target: PgCompatTarget, ident: &Ident) -> String {
    quote_ident(target, &ident.value)
}

fn quote_object_name(target: PgCompatTarget, name: &ObjectName) -> String {
    name.0
        .iter()
        .map(|part| match part {
            ObjectNamePart::Identifier(ident) => quote_ident_obj(target, ident),
            other => {
                let s = other.to_string();
                quote_ident(target, s.trim_matches(|c| c == '"' || c == '`'))
            }
        })
        .collect::<Vec<_>>()
        .join(".")
}

fn map_type_name(target: PgCompatTarget, type_name: &str) -> String {
    let t = type_name.trim().to_ascii_lowercase();
    match target {
        PgCompatTarget::Mysql => match t.as_str() {
            "timestamptz" | "timestamp with time zone" => "DATETIME".into(),
            "jsonb" => "JSON".into(),
            "boolean" => "BOOLEAN".into(),
            "serial" => "INTEGER".into(),
            "bigserial" => "BIGINT".into(),
            _ => type_name.to_ascii_uppercase(),
        },
        PgCompatTarget::Sqlite => match t.as_str() {
            "boolean" => "INTEGER".into(),
            "jsonb" | "json" => "TEXT".into(),
            "timestamptz" | "timestamp with time zone" => "DATETIME".into(),
            "serial" | "bigserial" => "INTEGER".into(),
            _ => type_name.to_ascii_uppercase(),
        },
        PgCompatTarget::Postgres => type_name.to_string(),
    }
}

fn data_type_raw_name(dt: &DataType) -> String {
    match dt {
        DataType::Boolean => "boolean".into(),
        DataType::JSON => "json".into(),
        DataType::JSONB => "jsonb".into(),
        DataType::Text => "text".into(),
        DataType::Integer(_) | DataType::Int(_) => "integer".into(),
        DataType::BigInt(_) => "bigint".into(),
        DataType::SmallInt(_) => "smallint".into(),
        DataType::Timestamp(_, tz) if matches!(tz, TimezoneInfo::Tz | TimezoneInfo::WithTimeZone) => "timestamptz".into(),
        DataType::Timestamp(_, _) => "timestamp".into(),
        DataType::Datetime(_) => "datetime".into(),
        DataType::Custom(name, _) => name
            .0
            .iter()
            .map(|p| match p {
                ObjectNamePart::Identifier(i) => i.value.clone(),
                other => other.to_string(),
            })
            .collect::<Vec<_>>()
            .join("."),
        other => other.to_string(),
    }
}

fn is_serial_type(dt: &DataType) -> bool {
    matches!(data_type_raw_name(dt).to_ascii_lowercase().as_str(), "serial" | "bigserial")
}

fn column_has_primary_key(column: &ColumnDef) -> bool {
    column.options.iter().any(|o| matches!(o.option, ColumnOption::PrimaryKey(_)))
}

fn column_has_not_null(column: &ColumnDef) -> bool {
    column.options.iter().any(|o| matches!(o.option, ColumnOption::NotNull))
}

fn column_has_unique(column: &ColumnDef) -> bool {
    column.options.iter().any(|o| matches!(o.option, ColumnOption::Unique(_)))
}

fn column_default(column: &ColumnDef) -> Option<&Expr> {
    column.options.iter().find_map(|o| match &o.option {
        ColumnOption::Default(expr) => Some(expr),
        _ => None,
    })
}

fn column_foreign_key(column: &ColumnDef) -> Option<&ForeignKeyConstraint> {
    column.options.iter().find_map(|o| match &o.option {
        ColumnOption::ForeignKey(fk) => Some(fk),
        _ => None,
    })
}

fn render_default_expr(target: PgCompatTarget, expr: &Expr) -> String {
    if let Expr::Function(func) = expr {
        let name = func
            .name
            .0
            .iter()
            .find_map(|p| p.as_ident().map(|i| i.value.to_ascii_lowercase()))
            .unwrap_or_default();
        let empty_args = match &func.args {
            FunctionArguments::None => true,
            FunctionArguments::List(list) => list.args.is_empty(),
            FunctionArguments::Subquery(_) => false,
        };
        if name == "now" && empty_args {
            return "CURRENT_TIMESTAMP".into();
        }
    }
    let sql = expr.to_string();
    if target == PgCompatTarget::Mysql {
        sql.replace('"', "`")
    } else {
        sql
    }
}

fn render_column(target: PgCompatTarget, column: &ColumnDef) -> String {
    let name = quote_ident_obj(target, &column.name);
    let data_type_name = data_type_raw_name(&column.data_type);
    let is_primary = column_has_primary_key(column);

    if target == PgCompatTarget::Sqlite && is_primary && is_serial_type(&column.data_type) {
        return format!("{name} INTEGER PRIMARY KEY AUTOINCREMENT");
    }

    let mut parts = vec![format!("{name} {}", map_type_name(target, &data_type_name))];
    if is_primary {
        parts.push("PRIMARY KEY".into());
    }
    if target == PgCompatTarget::Mysql && is_primary && is_serial_type(&column.data_type) {
        parts.push("AUTO_INCREMENT".into());
    }
    if column_has_not_null(column) {
        parts.push("NOT NULL".into());
    }
    if column_has_unique(column) {
        parts.push("UNIQUE".into());
    }
    if let Some(default) = column_default(column) {
        parts.push(format!("DEFAULT {}", render_default_expr(target, default)));
    }
    if let Some(fk) = column_foreign_key(column) {
        let foreign_table = quote_object_name(target, &fk.foreign_table);
        let foreign_columns = fk
            .referred_columns
            .iter()
            .map(|c| quote_ident_obj(target, c))
            .collect::<Vec<_>>()
            .join(", ");
        let mut clause = if foreign_columns.is_empty() {
            format!("REFERENCES {foreign_table}")
        } else {
            format!("REFERENCES {foreign_table}({foreign_columns})")
        };
        clause.push_str(&referential_actions(fk.on_delete, fk.on_update));
        parts.push(clause);
    }
    parts.join(" ")
}

fn referential_actions(on_delete: Option<ReferentialAction>, on_update: Option<ReferentialAction>) -> String {
    let mut out = String::new();
    if let Some(action) = on_delete {
        out.push_str(&format!(" ON DELETE {action}"));
    }
    if let Some(action) = on_update {
        out.push_str(&format!(" ON UPDATE {action}"));
    }
    out
}

fn render_create_table(target: PgCompatTarget, stmt: &CreateTable) -> Result<String> {
    let table_name = quote_object_name(target, &stmt.name);
    let mut rendered: Vec<String> = stmt.columns.iter().map(|c| render_column(target, c)).collect();
    for constraint in &stmt.constraints {
        rendered.push(render_table_constraint(target, constraint)?);
    }
    Ok(format!("CREATE TABLE {table_name} ({})", rendered.join(", ")))
}

fn index_column_ident(col: &sqlparser::ast::IndexColumn) -> Ident {
    match &col.column.expr {
        Expr::Identifier(ident) => ident.clone(),
        other => Ident::new(other.to_string()),
    }
}

fn constraint_name_prefix(target: PgCompatTarget, name: &Option<Ident>) -> String {
    name.as_ref()
        .map(|n| format!("CONSTRAINT {} ", quote_ident_obj(target, n)))
        .unwrap_or_default()
}

fn render_table_constraint(target: PgCompatTarget, constraint: &TableConstraint) -> Result<String> {
    match constraint {
        TableConstraint::Unique(UniqueConstraint { name, columns, .. }) => {
            let cols = columns
                .iter()
                .map(|c| quote_ident_obj(target, &index_column_ident(c)))
                .collect::<Vec<_>>()
                .join(", ");
            Ok(format!("{}UNIQUE ({cols})", constraint_name_prefix(target, name)))
        }
        TableConstraint::PrimaryKey(PrimaryKeyConstraint { name, columns, .. }) => {
            let cols = columns
                .iter()
                .map(|c| quote_ident_obj(target, &index_column_ident(c)))
                .collect::<Vec<_>>()
                .join(", ");
            Ok(format!("{}PRIMARY KEY ({cols})", constraint_name_prefix(target, name)))
        }
        TableConstraint::ForeignKey(ForeignKeyConstraint {
            name,
            columns,
            foreign_table,
            referred_columns,
            on_delete,
            on_update,
            ..
        }) => {
            let local = columns.iter().map(|c| quote_ident_obj(target, c)).collect::<Vec<_>>().join(", ");
            let foreign = referred_columns
                .iter()
                .map(|c| quote_ident_obj(target, c))
                .collect::<Vec<_>>()
                .join(", ");
            let table = quote_object_name(target, foreign_table);
            Ok(format!(
                "{}FOREIGN KEY ({local}) REFERENCES {table} ({foreign}){}",
                constraint_name_prefix(target, name),
                referential_actions(*on_delete, *on_update)
            ))
        }
        TableConstraint::Check(CheckConstraint { name, expr, .. }) => {
            let e = if target == PgCompatTarget::Mysql {
                expr.to_string().replace('"', "`")
            } else {
                expr.to_string()
            };
            Ok(format!("{}CHECK ({e})", constraint_name_prefix(target, name)))
        }
        other => bail!("Unsupported table constraint: {other}"),
    }
}

fn render_added_column(target: PgCompatTarget, column: &ColumnDef) -> String {
    let name = quote_ident_obj(target, &column.name);
    let data_type = map_type_name(target, &data_type_raw_name(&column.data_type));
    let mut parts = vec![format!("{name} {data_type}")];
    if column_has_not_null(column) {
        parts.push("NOT NULL".into());
    }
    if let Some(default) = column_default(column) {
        parts.push(format!("DEFAULT {}", render_default_expr(target, default)));
    }
    parts.join(" ")
}

fn render_alter_table(target: PgCompatTarget, stmt: &AlterTable) -> Result<String> {
    let table_name = quote_object_name(target, &stmt.name);
    if stmt.operations.len() != 1 {
        bail!("ALTER TABLE compatibility currently supports one change per statement.");
    }
    let op = &stmt.operations[0];
    match op {
        AlterTableOperation::AddColumn { column_def, .. } => Ok(format!(
            "ALTER TABLE {table_name} ADD COLUMN {}",
            render_added_column(target, column_def)
        )),
        AlterTableOperation::DropColumn { column_names, .. } => {
            if column_names.len() != 1 {
                bail!("ALTER TABLE DROP COLUMN currently supports one column.");
            }
            Ok(format!(
                "ALTER TABLE {table_name} DROP COLUMN {}",
                quote_ident_obj(target, &column_names[0])
            ))
        }
        AlterTableOperation::RenameColumn {
            old_column_name,
            new_column_name,
        } => Ok(format!(
            "ALTER TABLE {table_name} RENAME COLUMN {} TO {}",
            quote_ident_obj(target, old_column_name),
            quote_ident_obj(target, new_column_name)
        )),
        AlterTableOperation::RenameTable { table_name: to } => {
            let to_name = match to {
                RenameTableNameKind::To(name) | RenameTableNameKind::As(name) => quote_object_name(target, name),
            };
            Ok(format!("ALTER TABLE {table_name} RENAME TO {to_name}"))
        }
        AlterTableOperation::AlterColumn { column_name, op } => Ok(format!(
            "ALTER TABLE {table_name} {}",
            render_alter_column(target, column_name, op)?
        )),
        AlterTableOperation::AddConstraint { constraint, .. } => {
            if target == PgCompatTarget::Sqlite {
                bail!("SQLite does not safely support ALTER TABLE ADD CONSTRAINT.");
            }
            Ok(format!(
                "ALTER TABLE {table_name} {}",
                render_added_constraint(target, constraint)?
            ))
        }
        AlterTableOperation::DropConstraint { .. } => {
            bail!(
                "ALTER TABLE DROP CONSTRAINT is not safely supported for {} yet.",
                target_name(target)
            );
        }
        AlterTableOperation::RenameConstraint { .. } => {
            bail!(
                "ALTER TABLE RENAME CONSTRAINT is not safely supported for {} yet.",
                target_name(target)
            );
        }
        other => bail!("Unsupported ALTER TABLE change: {other}"),
    }
}

fn render_alter_column(target: PgCompatTarget, column: &Ident, op: &AlterColumnOperation) -> Result<String> {
    let column = quote_ident_obj(target, column);
    match op {
        AlterColumnOperation::SetDefault { value } => {
            if target == PgCompatTarget::Sqlite {
                bail!("SQLite does not safely support ALTER COLUMN SET DEFAULT.");
            }
            Ok(format!(
                "ALTER COLUMN {column} SET DEFAULT {}",
                render_default_expr(target, value)
            ))
        }
        AlterColumnOperation::DropDefault => {
            if target == PgCompatTarget::Sqlite {
                bail!("SQLite does not safely support ALTER COLUMN DROP DEFAULT.");
            }
            Ok(format!("ALTER COLUMN {column} DROP DEFAULT"))
        }
        AlterColumnOperation::SetDataType { .. } => {
            bail!(
                "ALTER COLUMN TYPE is not safely supported for {} yet.",
                target_name(target)
            );
        }
        AlterColumnOperation::SetNotNull | AlterColumnOperation::DropNotNull => {
            let label = match op {
                AlterColumnOperation::SetNotNull => "SET NOT NULL",
                _ => "DROP NOT NULL",
            };
            bail!("ALTER COLUMN {label} requires live column metadata and is not supported yet.");
        }
        other => bail!("Unsupported ALTER COLUMN change: {other}"),
    }
}

fn render_added_constraint(target: PgCompatTarget, constraint: &TableConstraint) -> Result<String> {
    match constraint {
        TableConstraint::Unique(UniqueConstraint { name, columns, .. }) => {
            let cols = columns
                .iter()
                .map(|c| quote_ident_obj(target, &index_column_ident(c)))
                .collect::<Vec<_>>()
                .join(", ");
            Ok(format!("ADD {}UNIQUE ({cols})", constraint_name_prefix(target, name)))
        }
        TableConstraint::PrimaryKey(PrimaryKeyConstraint { name, columns, .. }) => {
            let cols = columns
                .iter()
                .map(|c| quote_ident_obj(target, &index_column_ident(c)))
                .collect::<Vec<_>>()
                .join(", ");
            Ok(format!("ADD {}PRIMARY KEY ({cols})", constraint_name_prefix(target, name)))
        }
        TableConstraint::ForeignKey(ForeignKeyConstraint {
            name,
            columns,
            foreign_table,
            referred_columns,
            on_delete,
            on_update,
            ..
        }) => {
            let local = columns.iter().map(|c| quote_ident_obj(target, c)).collect::<Vec<_>>().join(", ");
            let foreign = referred_columns
                .iter()
                .map(|c| quote_ident_obj(target, c))
                .collect::<Vec<_>>()
                .join(", ");
            let table = quote_object_name(target, foreign_table);
            Ok(format!(
                "ADD {}FOREIGN KEY ({local}) REFERENCES {table} ({foreign}){}",
                constraint_name_prefix(target, name),
                referential_actions(*on_delete, *on_update)
            ))
        }
        TableConstraint::Check(CheckConstraint { name, expr, .. }) => {
            let e = if target == PgCompatTarget::Mysql {
                expr.to_string().replace('"', "`")
            } else {
                expr.to_string()
            };
            Ok(format!("ADD {}CHECK ({e})", constraint_name_prefix(target, name)))
        }
        other => bail!("Unsupported constraint type: {other}"),
    }
}

/// Re-emit CREATE INDEX / DROP TABLE / DROP INDEX with target quoting.
fn render_generic_ddl(target: PgCompatTarget, statement: &Statement) -> String {
    let sql = statement.to_string();
    if target == PgCompatTarget::Mysql {
        rewrite_double_quotes_to_backticks(&sql)
    } else {
        sql
    }
}

fn rewrite_double_quotes_to_backticks(sql: &str) -> String {
    let b = sql.as_bytes();
    let mut out = String::with_capacity(sql.len());
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
