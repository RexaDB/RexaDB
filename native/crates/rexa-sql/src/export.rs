//! Port of `formatResultsContent` (components/studio/sql-editor.tsx) and
//! lib/studio/clipboard-utils.ts: results as CSV / JSON / SQL INSERTs, plus a
//! Markdown table.
//!
//! The original's rows are node-pg / driver JS values; ours are text cells,
//! so values are re-typed from the column type the way node-pg would hand
//! them over (int2/int4/float → numbers, bool → booleans, json → objects;
//! int8/numeric stay strings).

use rexa_drivers::{Cell, ColumnMeta, QueryResult, TypeCategory};
use serde_json::{Map, Value};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ExportFormat {
    Csv,
    Json,
    Sql,
    Markdown,
}

impl ExportFormat {
    pub fn extension(self) -> &'static str {
        match self {
            ExportFormat::Csv => ".csv",
            ExportFormat::Json => ".json",
            ExportFormat::Sql => ".sql",
            ExportFormat::Markdown => ".md",
        }
    }
}

/// The JS value a driver would return for this cell.
pub fn cell_value(cell: &Cell, meta: &ColumnMeta) -> Value {
    let Cell::Text(s) = cell else { return Value::Null };
    let t = meta.type_name.to_ascii_lowercase();
    match meta.category {
        TypeCategory::Integer if !(t.contains("int8") || t.contains("bigint") || t.contains("int64")) => {
            s.parse::<i64>().map(Value::from).unwrap_or_else(|_| Value::String(s.clone()))
        }
        TypeCategory::Decimal if t.contains("float") || t.contains("double") || t.contains("real") => {
            s.parse::<f64>().ok().and_then(serde_json::Number::from_f64).map(Value::Number).unwrap_or_else(|| Value::String(s.clone()))
        }
        TypeCategory::Boolean => match s.as_str() {
            "t" | "true" | "1" | "TRUE" => Value::Bool(true),
            "f" | "false" | "0" | "FALSE" => Value::Bool(false),
            _ => Value::String(s.clone()),
        },
        TypeCategory::Json => serde_json::from_str(s).unwrap_or_else(|_| Value::String(s.clone())),
        _ => Value::String(s.clone()),
    }
}

/// `stableStringify`
fn stable_stringify(v: &Value) -> String {
    match v {
        Value::Null => String::new(),
        Value::String(s) => s.clone(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => n.to_string(),
        other => other.to_string(),
    }
}

/// `formatDelimitedValue`
pub fn format_delimited_value(v: &Value, delimiter: &str) -> String {
    let raw = stable_stringify(v);
    if raw.is_empty() {
        return raw;
    }
    if raw.contains(['"', '\n', '\r']) || raw.contains(delimiter) {
        format!("\"{}\"", raw.replace('"', "\"\""))
    } else {
        raw
    }
}

/// `formatSqlLiteral`
pub fn format_sql_literal(v: &Value) -> String {
    match v {
        Value::Null => "NULL".into(),
        Value::Number(n) => n.to_string(),
        Value::Bool(b) => if *b { "TRUE".into() } else { "FALSE".into() },
        other => format!("'{}'", stable_stringify(other).replace('\'', "''")),
    }
}

fn rows_as_values(r: &QueryResult) -> Vec<Vec<Value>> {
    let metas: Vec<ColumnMeta> = (0..r.columns.len()).map(|i| r.column_type(i)).collect();
    r.rows.iter().map(|row| row.iter().zip(&metas).map(|(c, m)| cell_value(c, m)).collect()).collect()
}

pub fn format_results(format: ExportFormat, r: &QueryResult) -> String {
    let rows = rows_as_values(r);
    match format {
        ExportFormat::Json => {
            let objects: Vec<Value> = rows
                .into_iter()
                .map(|row| {
                    let mut m = Map::new();
                    for (k, v) in r.columns.iter().zip(row) {
                        m.insert(k.clone(), v);
                    }
                    Value::Object(m)
                })
                .collect();
            // JSON.stringify(rows, null, 2)
            serde_json::to_string_pretty(&objects).unwrap_or_default()
        }
        ExportFormat::Csv => {
            let header = r.columns.iter().map(|c| format_delimited_value(&Value::String(c.clone()), ",")).collect::<Vec<_>>().join(",");
            let body = rows
                .iter()
                .map(|row| row.iter().map(|v| format_delimited_value(v, ",")).collect::<Vec<_>>().join(","))
                .collect::<Vec<_>>()
                .join("\n");
            format!("{header}\n{body}")
        }
        ExportFormat::Sql => {
            let cols = r.columns.iter().map(|c| format!("\"{c}\"")).collect::<Vec<_>>().join(", ");
            rows.iter()
                .map(|row| {
                    let vals = row.iter().map(format_sql_literal).collect::<Vec<_>>().join(", ");
                    format!("INSERT INTO exported_results ({cols}) VALUES ({vals});")
                })
                .collect::<Vec<_>>()
                .join("\n")
        }
        ExportFormat::Markdown => {
            let esc = |s: String| s.replace('|', "\\|").replace('\n', " ");
            let mut out = format!("| {} |\n", r.columns.iter().map(|c| esc(c.clone())).collect::<Vec<_>>().join(" | "));
            out.push_str(&format!("| {} |\n", r.columns.iter().map(|_| "---").collect::<Vec<_>>().join(" | ")));
            for row in &rows {
                let cells: Vec<String> =
                    row.iter().map(|v| if v.is_null() { "NULL".into() } else { esc(stable_stringify(v)) }).collect();
                out.push_str(&format!("| {} |\n", cells.join(" | ")));
            }
            out
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn result() -> QueryResult {
        QueryResult {
            columns: vec!["id".into(), "name".into()],
            rows: vec![
                vec![Cell::Text("1".into()), Cell::Text("a,b".into())],
                vec![Cell::Text("2".into()), Cell::Null],
            ],
            column_types: vec![ColumnMeta::new("id", "int4"), ColumnMeta::new("name", "text")],
            ..Default::default()
        }
    }

    #[test]
    fn formats() {
        let r = result();
        assert_eq!(format_results(ExportFormat::Csv, &r), "id,name\n1,\"a,b\"\n2,");
        assert!(format_results(ExportFormat::Json, &r).contains("\"id\": 1"));
        assert_eq!(
            format_results(ExportFormat::Sql, &r).lines().next().unwrap(),
            "INSERT INTO exported_results (\"id\", \"name\") VALUES (1, 'a,b');"
        );
        assert!(format_results(ExportFormat::Markdown, &r).contains("| 2 | NULL |"));
    }
}
