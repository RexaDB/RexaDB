//! Sidebar catalog loading: hooks/use-sidebar-database-objects.ts and the
//! schema/table loaders of hooks/use-studio.ts, plus
//! lib/studio/database-objects.ts (`buildDatabaseObjectSections`). Runs the
//! dialect's catalog SQL through `driver.execute()`.

use anyhow::Result;
use rexa_drivers::{Cell, Driver, Kind, QueryResult};
use std::sync::Arc;

/// detectConnectionDbType, reduced to what the native drivers speak.
pub fn db_type(connection_type: &str, kind: Kind) -> &'static str {
    match connection_type {
        "supabase-mgmt" => "supabase-mgmt",
        _ => match kind {
            Kind::Postgres => "postgres",
            Kind::MySql => "mysql",
            Kind::Sqlite => "sqlite",
            other => other.as_str(),
        },
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum ObjectKind {
    Function,
    Procedure,
    Trigger,
    Sequence,
    Enum,
    Index,
}

impl ObjectKind {
    pub fn section_label(self) -> &'static str {
        match self {
            ObjectKind::Function => "Functions",
            ObjectKind::Procedure => "Procedures",
            ObjectKind::Trigger => "Triggers",
            ObjectKind::Sequence => "Sequences",
            ObjectKind::Enum => "Enums",
            ObjectKind::Index => "Indexes",
        }
    }
    pub fn key(self) -> &'static str {
        match self {
            ObjectKind::Function => "function",
            ObjectKind::Procedure => "procedure",
            ObjectKind::Trigger => "trigger",
            ObjectKind::Sequence => "sequence",
            ObjectKind::Enum => "enum",
            ObjectKind::Index => "index",
        }
    }
    /// DATABASE_OBJECT_ICONS (lucide)
    pub fn icon(self) -> &'static str {
        match self {
            ObjectKind::Function | ObjectKind::Procedure => "square-function",
            ObjectKind::Trigger => "workflow",
            ObjectKind::Sequence => "hash",
            ObjectKind::Enum => "braces",
            ObjectKind::Index => "gauge",
        }
    }
}

/// DatabaseObjectDetail (subset the sidebar shows; the object tab gets it as params).
#[derive(Clone, Debug, PartialEq)]
pub struct DbObject {
    pub kind: ObjectKind,
    pub schema: String,
    pub name: String,
    pub parent: Option<String>,
    pub signature: Option<String>,
    pub definition: String,
    pub metadata: Vec<(String, String)>,
}

impl DbObject {
    /// The `databaseObject` payload of a `database-object` tab.
    pub fn to_json(&self) -> serde_json::Value {
        let mut v = serde_json::json!({
            "kind": self.kind.key(),
            "schema": self.schema,
            "name": self.name,
            "definition": self.definition,
            "metadata": self.metadata.iter().map(|(l, v)| serde_json::json!({"label": l, "value": v})).collect::<Vec<_>>(),
        });
        if let Some(p) = &self.parent {
            v["parent"] = p.clone().into();
        }
        if let Some(s) = &self.signature {
            v["signature"] = s.clone().into();
        }
        v
    }
    /// databaseObjectKey
    pub fn key(&self) -> String {
        serde_json::json!([self.kind.key(), self.schema, self.parent.clone().unwrap_or_default(), self.name, self.signature.clone().unwrap_or_default()]).to_string()
    }
    /// databaseObjectTabId
    pub fn tab_id(&self) -> String {
        format!("object-{}", url::form_urlencoded::byte_serialize(self.key().as_bytes()).collect::<String>().replace('+', "%20"))
    }
}

pub struct Section {
    pub kind: ObjectKind,
    pub items: Vec<DbObject>,
}

/// buildDatabaseObjectSections: non-empty groups in sidebar order, filtered by name.
pub fn sections(objects: &[DbObject], query: &str) -> Vec<Section> {
    let needle = query.trim().to_lowercase();
    [
        ObjectKind::Function,
        ObjectKind::Procedure,
        ObjectKind::Trigger,
        ObjectKind::Sequence,
        ObjectKind::Enum,
        ObjectKind::Index,
    ]
    .into_iter()
    .map(|kind| Section {
        kind,
        items: objects
            .iter()
            .filter(|o| o.kind == kind && (needle.is_empty() || o.name.to_lowercase().contains(&needle)))
            .cloned()
            .collect(),
    })
    .filter(|s| !s.items.is_empty())
    .collect()
}

fn text(c: &Cell) -> String {
    match c {
        Cell::Null => String::new(),
        Cell::Text(s) => s.clone(),
    }
}

fn rows(r: &QueryResult) -> impl Iterator<Item = Vec<String>> + '_ {
    r.rows.iter().map(|row| row.iter().map(text).collect())
}

fn lit(s: &str) -> String {
    format!("'{}'", s.replace('\'', "''"))
}

/// Non-table objects of one schema (Schema Explorer only).
pub async fn load_objects(driver: Arc<dyn Driver>, schema: String) -> Result<Vec<DbObject>> {
    let mut out = Vec::new();
    let mk = |kind, name: String, schema: &str| DbObject {
        kind,
        schema: schema.to_string(),
        name,
        parent: None,
        signature: None,
        definition: String::new(),
        metadata: Vec::new(),
    };
    match driver.kind() {
        Kind::Postgres => {
            let s = lit(&schema);
            if let Ok(r) = driver
                .execute(
                    &format!(
                        "SELECT p.proname, pg_get_function_identity_arguments(p.oid), CASE p.prokind WHEN 'p' THEN 'PROCEDURE' ELSE 'FUNCTION' END,
                                l.lanname, pg_get_function_result(p.oid), pg_get_functiondef(p.oid)
                         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_language l ON l.oid = p.prolang
                         WHERE n.nspname = {s} AND p.prokind IN ('f','p') ORDER BY 1"
                    ),
                    5000,
                )
                .await
            {
                for r in rows(&r) {
                    let kind = if r[2] == "PROCEDURE" { ObjectKind::Procedure } else { ObjectKind::Function };
                    let mut o = mk(kind, r[0].clone(), &schema);
                    o.signature = Some(r[1].clone());
                    o.definition = r[5].clone();
                    o.metadata = vec![("Language".into(), r[3].clone()), ("Returns".into(), r[4].clone())];
                    out.push(o);
                }
            }
            if let Ok(r) = driver
                .execute(
                    &format!(
                        "SELECT t.tgname, c.relname, pg_get_triggerdef(t.oid) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
                         JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = {s} AND NOT t.tgisinternal ORDER BY 1"
                    ),
                    5000,
                )
                .await
            {
                for r in rows(&r) {
                    let mut o = mk(ObjectKind::Trigger, r[0].clone(), &schema);
                    o.parent = Some(r[1].clone());
                    o.definition = r[2].clone();
                    o.metadata = vec![("Table".into(), r[1].clone())];
                    out.push(o);
                }
            }
            if let Ok(r) = driver
                .execute(&format!("SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema = {s} ORDER BY 1"), 5000)
                .await
            {
                for r in rows(&r) {
                    out.push(mk(ObjectKind::Sequence, r[0].clone(), &schema));
                }
            }
            if let Ok(r) = driver
                .execute(
                    &format!(
                        "SELECT t.typname, string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
                         JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = {s} GROUP BY t.typname ORDER BY 1"
                    ),
                    5000,
                )
                .await
            {
                for r in rows(&r) {
                    let values: Vec<&str> = r[1].split(',').filter(|v| !v.is_empty()).collect();
                    let mut o = mk(ObjectKind::Enum, r[0].clone(), &schema);
                    o.definition = format!(
                        "CREATE TYPE \"{}\".\"{}\" AS ENUM (\n{}\n);",
                        schema,
                        r[0],
                        values.iter().map(|v| format!("  '{}'", v.replace('\'', "''"))).collect::<Vec<_>>().join(",\n")
                    );
                    o.metadata = vec![("Values".into(), values.len().to_string())];
                    out.push(o);
                }
            }
            if let Ok(r) = driver
                .execute(&format!("SELECT indexname, tablename, indexdef FROM pg_indexes WHERE schemaname = {s} ORDER BY 1"), 5000)
                .await
            {
                for r in rows(&r) {
                    let mut o = mk(ObjectKind::Index, r[0].clone(), &schema);
                    o.definition = r[2].clone();
                    o.metadata = vec![("Table".into(), r[1].clone())];
                    out.push(o);
                }
            }
        }
        Kind::MySql => {
            let s = lit(&schema);
            if let Ok(r) = driver
                .execute(&format!("SELECT ROUTINE_NAME, ROUTINE_TYPE FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = {s} ORDER BY 1"), 5000)
                .await
            {
                for r in rows(&r) {
                    let kind = if r[1] == "PROCEDURE" { ObjectKind::Procedure } else { ObjectKind::Function };
                    out.push(mk(kind, r[0].clone(), &schema));
                }
            }
            if let Ok(r) = driver
                .execute(&format!("SELECT TRIGGER_NAME, EVENT_OBJECT_TABLE FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = {s} ORDER BY 1"), 5000)
                .await
            {
                for r in rows(&r) {
                    let mut o = mk(ObjectKind::Trigger, r[0].clone(), &schema);
                    o.parent = Some(r[1].clone());
                    out.push(o);
                }
            }
        }
        Kind::Sqlite => {
            if let Ok(r) = driver
                .execute("SELECT type, name, tbl_name, COALESCE(sql, '') FROM sqlite_master WHERE type IN ('trigger','index') AND name NOT LIKE 'sqlite_%' ORDER BY name", 5000)
                .await
            {
                for r in rows(&r) {
                    let kind = if r[0] == "trigger" { ObjectKind::Trigger } else { ObjectKind::Index };
                    let mut o = mk(kind, r[1].clone(), &schema);
                    o.parent = Some(r[2].clone());
                    o.definition = r[3].clone();
                    o.metadata = vec![("Table".into(), r[2].clone())];
                    out.push(o);
                }
            }
        }
        _ => {}
    }
    Ok(out)
}

/// Databases on the server (Database Explorer picker; Postgres only).
pub async fn load_databases(driver: Arc<dyn Driver>) -> Result<(Vec<String>, String)> {
    if driver.kind() != Kind::Postgres {
        return Ok((Vec::new(), String::new()));
    }
    let r = driver
        .execute("SELECT datname, current_database() FROM pg_database WHERE NOT datistemplate ORDER BY 1", 1000)
        .await?;
    let all: Vec<Vec<String>> = rows(&r).collect();
    let current = all.first().map(|r| r[1].clone()).unwrap_or_default();
    Ok((all.into_iter().map(|r| r[0].clone()).collect(), current))
}

/// Name of the current database (status bar).
pub async fn current_database(driver: Arc<dyn Driver>) -> String {
    let sql = match driver.kind() {
        Kind::Postgres => "SELECT current_database()",
        Kind::MySql => "SELECT DATABASE()",
        Kind::Sqlite => return "main".into(),
        _ => return String::new(),
    };
    driver
        .execute(sql, 1)
        .await
        .ok()
        .and_then(|r| r.rows.first().and_then(|row| row.first()).map(text))
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn object_tab_id_matches_js_encoding() {
        let o = DbObject {
            kind: ObjectKind::Function,
            schema: "public".into(),
            name: "f".into(),
            parent: None,
            signature: Some("a integer".into()),
            definition: String::new(),
            metadata: vec![],
        };
        // encodeURIComponent('["function","public","","f","a integer"]')
        assert_eq!(o.tab_id(), "object-%5B%22function%22%2C%22public%22%2C%22%22%2C%22f%22%2C%22a%20integer%22%5D");
        assert_eq!(sections(&[o], "x").len(), 0);
    }
}
