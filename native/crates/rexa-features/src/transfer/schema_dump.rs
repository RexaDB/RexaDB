//! Port of lib/transfer/schema-dump-sql.ts.
//!
//! SQL-native schema dump for connections pg_dump cannot dial
//! (supabase-mgmt:// pointers, Neon serverless hosts, SSH-tunnelled
//! connections): DDL is read out of pg_catalog / information_schema and
//! re-emitted in a dependency-safe order. Also the statement-by-statement
//! apply path for destinations without a pinned session, and the extension
//! probe that runs before every import.

use super::sql::*;
use anyhow::{anyhow, bail, Result};
use regex::Regex;
use rexa_drivers::Record;
use std::collections::{HashMap, HashSet};
use std::sync::LazyLock;

fn ident(v: &str) -> String {
    escape_ident(v)
}

/// `parsePgArrayLiteral`
pub fn parse_pg_array_literal(value: Option<&str>) -> Vec<String> {
    let Some(s) = value.map(str::trim) else { return Vec::new() };
    if s.starts_with('[') {
        if let Ok(serde_json::Value::Array(items)) = serde_json::from_str::<serde_json::Value>(s) {
            return items.iter().map(|v| v.as_str().map(str::to_string).unwrap_or_else(|| v.to_string())).collect();
        }
    }
    if !(s.starts_with('{') && s.ends_with('}')) {
        return if s.is_empty() { Vec::new() } else { vec![s.to_string()] };
    }
    let inner = &s[1..s.len() - 1];
    if inner.trim().is_empty() {
        return Vec::new();
    }
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut in_quotes = false;
    let mut chars = inner.chars().peekable();
    while let Some(ch) = chars.next() {
        if in_quotes {
            if ch == '\\' {
                if let Some(n) = chars.next() {
                    cur.push(n);
                }
                continue;
            }
            if ch == '"' {
                in_quotes = false;
                continue;
            }
            cur.push(ch);
        } else if ch == '"' {
            in_quotes = true;
        } else if ch == ',' {
            out.push(std::mem::take(&mut cur));
        } else {
            cur.push(ch);
        }
    }
    out.push(cur);
    out
}

async fn q(db: &Db, sql: &str) -> Result<Vec<Record>> {
    select(db, sql).await
}

fn terminated(sql: &str) -> Option<String> {
    let t = sql.trim();
    if t.is_empty() {
        None
    } else if t.ends_with(';') {
        Some(t.to_string())
    } else {
        Some(format!("{t};"))
    }
}

struct PendingPartition {
    schema: String,
    table: String,
    parent_schema: String,
    parent_table: String,
    bound: String,
    partkey: String,
}

/// `buildSchemaDumpViaSql`
pub async fn build_schema_dump_via_sql(db: &Db, schemas: &[String]) -> (String, Vec<String>) {
    let mut parts: Vec<String> = Vec::new();
    let mut warnings: Vec<String> = Vec::new();
    let mut pending_fk = Vec::new();
    let mut pending_partitions: Vec<PendingPartition> = Vec::new();
    let mut pending_dependents = Vec::new();
    let mut pending_tables = Vec::new();
    let mut pending_functions = Vec::new();
    macro_rules! emit { ($v:expr) => { if let Some(s) = terminated(&$v) { parts.push(s); } } }
    macro_rules! defer { ($v:expr) => { if let Some(s) = terminated(&$v) { pending_dependents.push(s); } } }
    let e = |e: anyhow::Error| err_text(&e);

    match q(db, "SELECT extname FROM pg_extension WHERE extname <> 'plpgsql' ORDER BY 1").await {
        Ok(rows) => {
            for r in rows {
                emit!(format!("CREATE EXTENSION IF NOT EXISTS {}", ident(&r.string("extname"))));
            }
        }
        Err(err) => warnings.push(format!("Extension list unreadable: {}", e(err))),
    }

    for schema in schemas {
        let lit = escape_literal(schema);
        let s = ident(schema);
        emit!(format!("CREATE SCHEMA IF NOT EXISTS {s}"));

        let types: Result<()> = async {
            let enums = q(db, &format!(
                "SELECT t.typname AS name, array_agg(e.enumlabel ORDER BY e.enumsortorder) AS labels
         FROM pg_type t
         JOIN pg_namespace n ON n.oid = t.typnamespace
         JOIN pg_enum e ON e.enumtypid = t.oid
         WHERE n.nspname = {lit} AND t.typtype = 'e'
         GROUP BY t.typname ORDER BY 1")).await?;
            for r in enums {
                let labels = parse_pg_array_literal(r.get("labels"));
                if labels.is_empty() {
                    warnings.push(format!("Enum {schema}.{} has no labels; skipped.", r.string("name")));
                    continue;
                }
                let labels: Vec<String> = labels.iter().map(|l| escape_literal(l)).collect();
                emit!(format!("CREATE TYPE {s}.{} AS ENUM ({})", ident(&r.string("name")), labels.join(", ")));
            }
            let domains = q(db, &format!(
                "SELECT t.typname AS name, format_type(t.typbasetype, t.typtypmod) AS base,
                t.typnotnull AS not_null,
                pg_get_expr(t.typdefaultbin, 0) AS default_expr,
                CASE WHEN t.typcollation <> 0 AND c.collname <> 'default'
                     THEN quote_ident(c.collname) END AS collate
         FROM pg_type t
         JOIN pg_namespace n ON n.oid = t.typnamespace
         LEFT JOIN pg_collation c ON c.oid = t.typcollation
         WHERE n.nspname = {lit} AND t.typtype = 'd' ORDER BY 1")).await?;
            for r in domains {
                let mut def = format!("CREATE DOMAIN {s}.{} AS {}", ident(&r.string("name")), r.string("base"));
                if let Some(c) = r.non_empty("collate") {
                    def.push_str(&format!(" COLLATE {c}"));
                }
                if r.bool("not_null") {
                    def.push_str(" NOT NULL");
                }
                emit!(def);
                if let Some(d) = r.non_empty("default_expr") {
                    defer!(format!("ALTER DOMAIN {s}.{} SET DEFAULT {d}", ident(&r.string("name"))));
                }
            }
            let checks = q(db, &format!(
                "SELECT t.typname AS domain_name, pg_get_constraintdef(con.oid) AS definition
         FROM pg_constraint con
         JOIN pg_type t ON t.oid = con.contypid
         JOIN pg_namespace n ON n.oid = t.typnamespace
         WHERE n.nspname = {lit}
         ORDER BY t.typname, con.oid")).await?;
            for r in checks {
                emit!(format!("ALTER DOMAIN {s}.{} ADD {}", ident(&r.string("domain_name")), r.string("definition")));
            }
            let comps = q(db, &format!(
                "SELECT t.typname AS name, a.attname AS col, format_type(a.atttypid, a.atttypmod) AS type
         FROM pg_type t
         JOIN pg_class c ON c.oid = t.typrelid
         JOIN pg_namespace n ON n.oid = t.typnamespace
         JOIN pg_attribute a ON a.attrelid = c.oid
         WHERE n.nspname = {lit} AND t.typtype = 'c' AND c.relkind = 'c' AND a.attnum > 0 AND NOT a.attisdropped
         ORDER BY t.typname, a.attnum")).await?;
            let mut order: Vec<String> = Vec::new();
            let mut by: HashMap<String, Vec<String>> = HashMap::new();
            for r in comps {
                let t = r.string("name");
                if !by.contains_key(&t) {
                    order.push(t.clone());
                }
                by.entry(t).or_default().push(format!("{} {}", ident(&r.string("col")), r.string("type")));
            }
            for name in order {
                emit!(format!("CREATE TYPE {s}.{} AS ({})", ident(&name), by[&name].join(", ")));
            }
            Ok(())
        }
        .await;
        if let Err(err) = types {
            warnings.push(format!("Custom types unreadable in {schema}: {}", e(err)));
        }

        match q(db, &format!("SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema = {lit} ORDER BY 1")).await {
            Ok(seqs) => {
                for r in seqs {
                    let seq = r.string("sequence_name");
                    emit!(format!("CREATE SEQUENCE IF NOT EXISTS {s}.{}", ident(&seq)));
                    if let Ok(last) = q(db, &format!("SELECT last_value FROM {s}.{}", ident(&seq))).await {
                        if let Some(v) = last.first().and_then(|r| r.get("last_value")).and_then(|v| v.trim().parse::<f64>().ok()) {
                            emit!(format!(
                                "SELECT pg_catalog.setval('{}.{}'::regclass, {}, true)",
                                schema.replace('\'', "''"),
                                seq.replace('\'', "''"),
                                v as i64
                            ));
                        }
                    }
                }
            }
            Err(err) => warnings.push(format!("Sequences unreadable in {schema}: {}", e(err))),
        }

        let tables: Result<()> = async {
            let cols = q(db, &format!(
                "SELECT c.relname AS table_name, c.relkind AS kind,
                pg_get_partkeydef(c.oid) AS partkey,
                a.attname AS column_name,
                format_type(a.atttypid, a.atttypmod) AS data_type,
                a.attnotnull AS not_null,
                a.attidentity AS identity,
                a.attgenerated AS generated,
                pg_get_expr(d.adbin, d.adrelid) AS default_value
         FROM pg_attribute a
         JOIN pg_class c ON c.oid = a.attrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
         WHERE n.nspname = {lit} AND c.relkind IN ('r', 'p')
           AND a.attnum > 0 AND NOT a.attisdropped AND NOT c.relispartition
         ORDER BY c.relname, a.attnum")).await?;
            let mut order: Vec<String> = Vec::new();
            let mut by: HashMap<String, Vec<Record>> = HashMap::new();
            for r in cols {
                let t = r.string("table_name");
                if !by.contains_key(&t) {
                    order.push(t.clone());
                }
                by.entry(t).or_default().push(r);
            }
            for table in order {
                let columns = &by[&table];
                let defs: Vec<String> = columns
                    .iter()
                    .map(|c| {
                        let mut def = format!("{} {}", ident(&c.string("column_name")), c.string("data_type"));
                        let identity = c.string("identity");
                        let generated = c.string("generated");
                        let default = c.string("default_value");
                        if generated == "s" && !default.is_empty() {
                            def.push_str(&format!(" GENERATED ALWAYS AS ({default}) STORED"));
                        } else if identity == "a" {
                            def.push_str(" GENERATED ALWAYS AS IDENTITY");
                        } else if identity == "d" {
                            def.push_str(" GENERATED BY DEFAULT AS IDENTITY");
                        } else if !default.is_empty() {
                            def.push_str(&format!(" DEFAULT {default}"));
                        }
                        if c.bool("not_null") {
                            def.push_str(" NOT NULL");
                        }
                        def
                    })
                    .collect();
                let first = &columns[0];
                let partkey = first.string("partkey");
                let partitioned = first.string("kind") == "p" && !partkey.is_empty();
                let tail = if partitioned { format!(" PARTITION BY {partkey}") } else { String::new() };
                if let Some(t) = terminated(&format!("CREATE TABLE IF NOT EXISTS {s}.{} (\n  {}\n){tail}", ident(&table), defs.join(",\n  "))) {
                    pending_tables.push(t);
                }
            }
            match q(db, &format!(
                "SELECT c.relname AS table_name, c.relkind AS kind,
                  pg_get_partkeydef(c.oid) AS partkey,
                  pn.nspname AS parent_schema, pc.relname AS parent_table,
                  pg_get_expr(c.relpartbound, c.oid) AS bound
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
           JOIN pg_inherits i ON i.inhrelid = c.oid
           JOIN pg_class pc ON pc.oid = i.inhparent
           JOIN pg_namespace pn ON pn.oid = pc.relnamespace
           WHERE n.nspname = {lit} AND c.relispartition
           ORDER BY c.relname")).await {
                Ok(rows) => {
                    for p in rows {
                        let parent_schema = p.string("parent_schema");
                        if !parent_schema.is_empty() && !schemas.contains(&parent_schema) {
                            warnings.push(format!(
                                "Partition {schema}.{} belongs to excluded parent \"{parent_schema}.{}\" — skipped.",
                                p.string("table_name"),
                                p.string("parent_table")
                            ));
                            continue;
                        }
                        pending_partitions.push(PendingPartition {
                            schema: schema.clone(),
                            table: p.string("table_name"),
                            parent_schema: if parent_schema.is_empty() { schema.clone() } else { parent_schema },
                            parent_table: p.string("parent_table"),
                            bound: p.string("bound"),
                            partkey: p.string("partkey"),
                        });
                    }
                }
                Err(err) => warnings.push(format!("Partitions unreadable in {schema}: {}", e(err))),
            }
            Ok(())
        }
        .await;
        if let Err(err) = tables {
            warnings.push(format!("Tables unreadable in {schema}: {}", e(err)));
            continue;
        }

        match q(db, &format!(
            "SELECT tc.table_name, tc.constraint_name, kcu.column_name, kcu.ordinal_position
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
         WHERE tc.table_schema = {lit} AND tc.constraint_type = 'PRIMARY KEY'
         ORDER BY tc.table_name, kcu.ordinal_position")).await {
            Ok(rows) => {
                let mut order: Vec<String> = Vec::new();
                let mut by: HashMap<String, (String, Vec<String>)> = HashMap::new();
                for r in rows {
                    let t = r.string("table_name");
                    if !by.contains_key(&t) {
                        order.push(t.clone());
                    }
                    by.entry(t).or_insert_with(|| (r.string("constraint_name"), Vec::new())).1.push(ident(&r.string("column_name")));
                }
                for t in order {
                    let (name, cols) = &by[&t];
                    defer!(format!("ALTER TABLE {s}.{} ADD CONSTRAINT {} PRIMARY KEY ({})", ident(&t), ident(name), cols.join(", ")));
                }
            }
            Err(err) => warnings.push(format!("Primary keys unreadable in {schema}: {}", e(err))),
        }

        for contype in ["u", "c", "f"] {
            match q(db, &format!(
                "SELECT c.relname AS table_name, con.conname AS name, pg_get_constraintdef(con.oid) AS def,
                  (SELECT n2.nspname FROM pg_class c2 JOIN pg_namespace n2 ON n2.oid = c2.relnamespace WHERE c2.oid = con.confrelid) AS ref_schema
           FROM pg_constraint con
           JOIN pg_class c ON c.oid = con.conrelid
           JOIN pg_namespace n ON n.oid = con.connamespace
           WHERE n.nspname = {lit} AND con.contype = '{contype}'")).await {
                Ok(rows) => {
                    for r in rows {
                        if let Some(rs) = r.non_empty("ref_schema") {
                            if !schemas.contains(&rs) {
                                warnings.push(format!(
                                    "Constraint {schema}.{}.{} references excluded schema \"{rs}\" — skipped; enforce it manually if needed.",
                                    r.string("table_name"),
                                    r.string("name")
                                ));
                                continue;
                            }
                        }
                        let alter = format!("ALTER TABLE {s}.{} ADD CONSTRAINT {} {}", ident(&r.string("table_name")), ident(&r.string("name")), r.string("def"));
                        if contype == "f" {
                            pending_fk.push(alter);
                        } else {
                            defer!(alter);
                        }
                    }
                }
                Err(err) => warnings.push(format!("Constraints unreadable in {schema}: {}", e(err))),
            }
        }

        match q(db, &format!(
            "SELECT pg_get_indexdef(i.indexrelid) AS def
         FROM pg_index i
         JOIN pg_class c ON c.oid = i.indrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = {lit} AND NOT i.indisprimary
           AND i.indexrelid NOT IN (SELECT conindid FROM pg_constraint WHERE conindid <> 0)")).await {
            Ok(rows) => {
                static PREFIX: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^(\s*CREATE\s+(?:UNIQUE\s+)?INDEX\s+)").unwrap());
                static INE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)\bIF\s+NOT\s+EXISTS\b").unwrap());
                for r in rows {
                    let def = r.string("def");
                    let out = if INE.is_match(&def) { def.clone() } else { PREFIX.replace(&def, "${1}IF NOT EXISTS ").into_owned() };
                    defer!(out);
                }
            }
            Err(err) => warnings.push(format!("Indexes unreadable in {schema}: {}", e(err))),
        }

        let views: Result<()> = async {
            for r in q(db, &format!("SELECT viewname, definition FROM pg_views WHERE schemaname = {lit}")).await? {
                defer!(format!("CREATE OR REPLACE VIEW {s}.{} AS {}", ident(&r.string("viewname")), r.string("definition")));
            }
            for r in q(db, &format!("SELECT matviewname, definition FROM pg_matviews WHERE schemaname = {lit}")).await? {
                let def = r.string("definition");
                let def = def.trim().trim_end_matches(';');
                defer!(format!("CREATE MATERIALIZED VIEW {s}.{} AS {def} WITH NO DATA", ident(&r.string("matviewname"))));
                warnings.push(format!("Materialized view {schema}.{} migrates WITHOUT data.", r.string("matviewname")));
            }
            Ok(())
        }
        .await;
        if let Err(err) = views {
            warnings.push(format!("Views unreadable in {schema}: {}", e(err)));
        }

        match q(db, &format!(
            "SELECT pg_get_functiondef(p.oid) AS def
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = {lit} AND p.prokind IN ('f', 'p', 'w')")).await {
            Ok(rows) => pending_functions.extend(rows.iter().filter_map(|r| terminated(&r.string("def")))),
            Err(err) => warnings.push(format!("Functions unreadable in {schema}: {}", e(err))),
        }

        match q(db, &format!(
            "SELECT pg_get_triggerdef(t.oid) AS def
         FROM pg_trigger t
         JOIN pg_class c ON c.oid = t.tgrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = {lit} AND NOT t.tgisinternal")).await {
            Ok(rows) => {
                for r in rows {
                    defer!(r.string("def"));
                }
            }
            Err(err) => warnings.push(format!("Triggers unreadable in {schema}: {}", e(err))),
        }

        let rls: Result<()> = async {
            for r in q(db, &format!(
                "SELECT c.relname AS table_name FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = {lit} AND c.relkind = 'r' AND c.relrowsecurity")).await? {
                defer!(format!("ALTER TABLE {s}.{} ENABLE ROW LEVEL SECURITY", ident(&r.string("table_name"))));
            }
            let policies = q(db, &format!(
                "SELECT c.relname AS table_name, p.polname AS name, p.polcmd AS cmd,
                p.polpermissive AS permissive,
                COALESCE((SELECT array_agg(r.rolname) FROM pg_roles r WHERE r.oid = ANY (p.polroles)), ARRAY[]::name[]) AS roles,
                pg_get_expr(p.polqual, p.polrelid) AS qual,
                pg_get_expr(p.polwithcheck, p.polrelid) AS with_check
         FROM pg_policy p
         JOIN pg_class c ON c.oid = p.polrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = {lit}")).await?;
            for r in policies {
                let roles = parse_pg_array_literal(r.get("roles"));
                let to = if roles.is_empty() {
                    "PUBLIC".to_string()
                } else {
                    roles.iter().map(|x| if x == "public" { "PUBLIC".to_string() } else { ident(x) }).collect::<Vec<_>>().join(", ")
                };
                let mut stmt = format!("CREATE POLICY {} ON {s}.{}", ident(&r.string("name")), ident(&r.string("table_name")));
                if r.opt_bool("permissive") == Some(false) {
                    stmt.push_str(" AS RESTRICTIVE");
                }
                let cmd = match r.string("cmd").as_str() {
                    "r" => "SELECT",
                    "a" => "INSERT",
                    "w" => "UPDATE",
                    "d" => "DELETE",
                    _ => "ALL",
                };
                stmt.push_str(&format!(" FOR {cmd} TO {to}"));
                if let Some(qual) = r.opt("qual") {
                    stmt.push_str(&format!(" USING ({qual})"));
                }
                if let Some(wc) = r.opt("with_check") {
                    stmt.push_str(&format!(" WITH CHECK ({wc})"));
                }
                defer!(stmt);
            }
            Ok(())
        }
        .await;
        if let Err(err) = rls {
            warnings.push(format!("RLS unreadable in {schema}: {}", e(err)));
        }
    }

    parts.extend(pending_functions);
    parts.extend(pending_tables);
    {
        let key = |s: &str, t: &str| format!("{s}.{t}");
        let pending_keys: HashSet<String> = pending_partitions.iter().map(|p| key(&p.schema, &p.table)).collect();
        let mut emitted = HashSet::new();
        let partition_sql = |p: &PendingPartition| {
            let sub = if !p.partkey.is_empty() && !p.bound.is_empty() { format!(" PARTITION BY {}", p.partkey) } else { String::new() };
            format!(
                "CREATE TABLE IF NOT EXISTS {}.{} PARTITION OF {}.{} FOR VALUES {}{sub};",
                ident(&p.schema),
                ident(&p.table),
                ident(&p.parent_schema),
                ident(&p.parent_table),
                p.bound
            )
        };
        let mut remaining: Vec<&PendingPartition> = pending_partitions.iter().collect();
        while !remaining.is_empty() {
            let mut progressed = false;
            let mut next = Vec::new();
            for p in remaining {
                let pk = key(&p.parent_schema, &p.parent_table);
                if !pending_keys.contains(&pk) || emitted.contains(&pk) {
                    parts.push(partition_sql(p));
                    emitted.insert(key(&p.schema, &p.table));
                    progressed = true;
                } else {
                    next.push(p);
                }
            }
            if !progressed {
                for p in next {
                    warnings.push(format!(
                        "Partition {}.{} emitted without confirmed parent {}.{} — verify it manually if the import fails.",
                        p.schema, p.table, p.parent_schema, p.parent_table
                    ));
                    parts.push(partition_sql(p));
                }
                break;
            }
            remaining = next;
        }
    }
    parts.extend(pending_dependents);
    parts.extend(pending_fk.iter().filter_map(|s| terminated(s)));
    (parts.join("\n"), warnings)
}

/// `bareFunctionName`
pub fn bare_function_name(def: &str) -> Option<String> {
    static RE: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"(?i)CREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE)\s+([^(\s][^(]*?)\s*\(").unwrap());
    static PARTS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#""[^"]*"|[^.]+"#).unwrap());
    let m = RE.captures(def)?;
    let last = PARTS.find_iter(&m[1]).last()?.as_str();
    let bare = last.trim_start_matches('"').trim_end_matches('"').to_lowercase();
    (!bare.is_empty()).then_some(bare)
}

pub type PhaseHook<'a> = &'a (dyn Fn(&str, usize, usize, &str) + Send + Sync);

/// Statement runner over an unpinned connection (each call independent).
struct Bare<'a>(&'a Db);
impl Exec for Bare<'_> {
    fn run(&mut self, sql: &str) -> impl std::future::Future<Output = Result<()>> + Send {
        let db = self.0.clone();
        let sql = sql.to_string();
        async move { exec(&db, &sql).await }
    }
}

/// `applyTransferViaQuery`: no cross-statement transaction; mid-apply
/// failures can leave a partial destination (errors say so).
pub async fn apply_transfer_via_query(
    db: &Db,
    drop_statements: &[String],
    schema_sql: &str,
    data_sql: Option<&str>,
    on_phase: PhaseHook<'_>,
) -> Result<(Vec<String>, i64)> {
    let mut warnings = Vec::new();
    let mut skipped_rows = 0i64;
    for stmt in drop_statements {
        exec(db, stmt).await.map_err(|e| anyhow!("Drop failed, aborting before apply: {}", err_text(&e)))?;
    }
    let statements: Vec<String> =
        split_sql_statements(schema_sql).iter().map(|s| strip_comment_lines(s)).filter(|s| !s.is_empty()).collect();
    let total = statements.len();
    let mut done = 0usize;
    let mut note = |stmt: &str| {
        done += 1;
        if done % 25 == 0 || done == total {
            on_phase("schema", done, total, &short_statement(stmt, 120));
        }
    };
    let defined: HashSet<String> =
        statements.iter().filter(|s| is_programmable_statement(s)).filter_map(|s| bare_function_name(s)).collect();
    let names_in = |stmt: &str| -> Vec<String> {
        defined
            .iter()
            .filter(|n| Regex::new(&format!(r"(?i)\b{}\s*\(", regex::escape(n))).is_ok_and(|r| r.is_match(stmt)))
            .cloned()
            .collect()
    };
    static DEF: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)CREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE)\s+").unwrap());
    let mut applied_fns: HashSet<String> = HashSet::new();
    let mark = |stmt: &str, applied_fns: &mut HashSet<String>| {
        if DEF.is_match(stmt) {
            applied_fns.extend(names_in(stmt));
        }
    };
    let mut deferred = Vec::new();
    let mut failed_structural = Vec::new();
    for stmt in &statements {
        if !is_programmable_statement(stmt) {
            if let Err(err) = exec(db, stmt).await {
                if names_in(stmt).iter().any(|n| !applied_fns.contains(n)) {
                    failed_structural.push(stmt.clone());
                } else {
                    bail!(
                        "Schema apply failed (destination may be PARTIALLY modified — no transaction support over this connection): {}",
                        err_text(&err)
                    );
                }
            }
            note(stmt);
            continue;
        }
        let mut res = exec(db, stmt).await;
        if res.is_err() {
            res = exec(db, stmt).await;
        }
        match res {
            Ok(()) => mark(stmt, &mut applied_fns),
            Err(_) => deferred.push(stmt.clone()),
        }
        note(stmt);
    }
    let mut last_error: HashMap<String, String> = HashMap::new();
    let (mut rem_prog, mut rem_struct) = (deferred, failed_structural);
    while !rem_prog.is_empty() || !rem_struct.is_empty() {
        let mut progressed = false;
        let mut next_prog = Vec::new();
        for stmt in rem_prog {
            match exec(db, &stmt).await {
                Ok(()) => {
                    mark(&stmt, &mut applied_fns);
                    progressed = true;
                }
                Err(e) => {
                    last_error.insert(stmt.clone(), err_text(&e));
                    next_prog.push(stmt);
                }
            }
        }
        let mut next_struct = Vec::new();
        for stmt in rem_struct {
            match exec(db, &stmt).await {
                Ok(()) => progressed = true,
                Err(e) => {
                    last_error.insert(stmt.clone(), err_text(&e));
                    next_struct.push(stmt);
                }
            }
        }
        rem_prog = next_prog;
        rem_struct = next_struct;
        if !progressed {
            break;
        }
    }
    let detail = |s: &str| last_error.get(s).cloned().unwrap_or_else(|| "unknown error".into()).chars().take(200).collect::<String>();
    for stmt in &rem_prog {
        if is_security_critical_programmable(stmt) {
            bail!(
                "Security-critical object failed to apply ({}): {} — transfer aborted instead of leaving the destination without it.",
                detail(stmt),
                short_statement(stmt, 160)
            );
        }
        warnings.push(format!("Skipped programmable object ({}): {}", detail(stmt), short_statement(stmt, 160)));
    }
    if let Some(stmt) = rem_struct.first() {
        bail!(
            "Schema apply failed (destination may be PARTIALLY modified — no transaction support over this connection): {}",
            detail(stmt)
        );
    }

    if let Some(data_sql) = data_sql {
        let chunks = parse_data_chunks(data_sql);
        let deps = match select(db, FK_EDGES_SQL).await {
            Ok(rows) => fk_edges(&rows),
            Err(e) => {
                warnings.push(format!("FK ordering unavailable ({}); data loads in export order.", err_text(&e)));
                Vec::new()
            }
        };
        let ordered = order_chunks_by_dependency(&chunks, &deps);
        let mut seen = HashSet::new();
        let trigger_tables: Vec<(String, String)> = ordered
            .iter()
            .filter(|c| !c.schema.is_empty() && !c.table.is_empty())
            .filter(|c| seen.insert(format!("{}.{}", c.schema, c.table)))
            .map(|c| (c.schema.clone(), c.table.clone()))
            .collect();
        let alter = |enable: bool| {
            let tables = trigger_tables.clone();
            let db = db.clone();
            async move {
                let mut errors = Vec::new();
                let mut warns = Vec::new();
                for (s, t) in &tables {
                    let sql = format!("ALTER TABLE {} {} TRIGGER USER", qualified_table(s, t), if enable { "ENABLE" } else { "DISABLE" });
                    if let Err(e) = exec(&db, &sql).await {
                        let msg = format!("Could not {} triggers on {s}.{t}: {}", if enable { "re-enable" } else { "disable" }, err_text(&e));
                        if enable {
                            errors.push(msg);
                        } else {
                            warns.push(format!("{msg}; row triggers stay live during import."));
                        }
                    }
                }
                (errors, warns)
            }
        };
        let (_, w) = alter(false).await;
        warnings.extend(w);
        let mut data_error: Option<anyhow::Error> = None;
        let total = ordered.len();
        for (i, chunk) in ordered.iter().enumerate() {
            let place = if chunk.table.is_empty() { "unmarked statements".to_string() } else { format!("{}.{}", chunk.schema, chunk.table) };
            on_phase("data", i + 1, total, &place);
            if exec(db, &chunk.sql).await.is_ok() {
                continue;
            }
            match apply_chunk_resiliently(&mut Bare(db), &chunk.sql).await {
                Ok((_, failed)) => {
                    skipped_rows += failed.len() as i64;
                    for f in failed.iter().take(20) {
                        warnings.push(format!(
                            "Row skipped in {place} ({}): {}",
                            f.error.chars().take(200).collect::<String>(),
                            short_statement(&f.statement, 160)
                        ));
                    }
                    if failed.len() > 20 {
                        warnings.push(format!("…and {} more skipped rows in {place}.", failed.len() - 20));
                    }
                }
                Err(e) => {
                    data_error = Some(e);
                    break;
                }
            }
        }
        if data_error.is_none() && skipped_rows > 0 {
            warnings.push(format!("{skipped_rows} row(s) could not be imported and were skipped — see warnings above."));
        }
        let (enable_errors, _) = alter(true).await;
        if !enable_errors.is_empty() {
            bail!(
                "Transfer aborted: {} — some triggers may still be disabled; re-enable them manually.{}",
                enable_errors.join("; "),
                data_error.map(|e| format!(" Data phase also failed: {}", err_text(&e))).unwrap_or_default()
            );
        }
        if let Some(e) = data_error {
            return Err(e);
        }
        if !trigger_tables.is_empty() {
            warnings.push(
                "Row triggers were disabled during data import and re-enabled after; derived rows come from migrated data, not trigger side effects."
                    .into(),
            );
        }
    }
    Ok((warnings, skipped_rows))
}

/// `sanitizeExtensionsForDestination`. `pinned` = statements run on one
/// session (BEGIN/probe/ROLLBACK as separate calls); otherwise the dry run
/// is sent as one script so it can never commit outside its transaction.
pub async fn sanitize_extensions_for_destination(
    db: &Db,
    schema_sql: &str,
    skip_without_probing: Option<&(dyn Fn(&str) -> Option<String> + Send + Sync)>,
) -> (String, Vec<String>) {
    let mut warnings = Vec::new();
    let mut kept: Vec<String> = Vec::new();
    let reterminate = |chunk: &str| {
        if strip_comment_lines(chunk).is_empty() || chunk.trim_end().ends_with(';') {
            chunk.to_string()
        } else {
            format!("{chunk};")
        }
    };
    let available: Option<HashSet<String>> =
        select(db, "SELECT name FROM pg_available_extensions").await.ok().map(|rows| rows.iter().map(|r| r.string("name")).collect());
    static EXT: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r#"(?i)^\s*CREATE\s+EXTENSION\s+(?:IF\s+NOT\s+EXISTS\s+)?("?(?:[^"\s;]+)"?)"#).unwrap());
    let commented = |exe: &str| format!("-- {}", exe.split('\n').collect::<Vec<_>>().join("\n-- "));
    for stmt in split_sql_statements(schema_sql) {
        let exe = strip_comment_lines(&stmt);
        if exe.is_empty() {
            kept.push(stmt);
            continue;
        }
        let Some(m) = EXT.captures(&exe) else {
            kept.push(reterminate(&stmt));
            continue;
        };
        let ext = m[1].trim_matches('"').to_string();
        if let Some(reason) = skip_without_probing.and_then(|f| f(&ext)) {
            warnings.push(format!("Extension \"{ext}\" skipped: {reason}"));
            kept.push(format!("-- SKIPPED EXTENSION ({reason}):\n{}", commented(&exe)));
            continue;
        }
        if available.as_ref().is_some_and(|a| !a.contains(&ext)) {
            let reason = format!("extension \"{ext}\" is not available on the destination");
            warnings.push(format!(
                "Extension \"{ext}\" skipped: {reason}. Objects depending on it may fail — enable it manually if needed."
            ));
            kept.push(format!("-- SKIPPED EXTENSION ({reason}):\n{}", commented(&exe)));
            continue;
        }
        // Dry run: one script so the probe can't commit on its own.
        let probe = db.execute(&format!("BEGIN; {exe}; ROLLBACK;"), 1).await;
        if probe.is_err() {
            // Leave no aborted transaction behind on a pooled connection.
            let _ = db.execute("ROLLBACK", 1).await;
        }
        match probe {
            Ok(_) => kept.push(reterminate(&stmt)),
            Err(e) => {
                let reason: String = err_text(&e).chars().take(200).collect();
                warnings.push(format!(
                    "Extension \"{ext}\" skipped: destination rejected it ({reason}). Objects depending on it may fail — enable it manually if needed."
                ));
                kept.push(format!("-- SKIPPED EXTENSION (destination rejected: {reason}):\n{}", commented(&exe)));
            }
        }
    }
    (kept.join("\n"), warnings)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pg_arrays() {
        assert_eq!(parse_pg_array_literal(Some("{public,\"a,b\"}")), vec!["public", "a,b"]);
        assert_eq!(parse_pg_array_literal(Some("{}")), Vec::<String>::new());
        assert_eq!(parse_pg_array_literal(Some("[\"x\",\"y\"]")), vec!["x", "y"]);
    }

    #[test]
    fn function_names() {
        assert_eq!(bare_function_name("CREATE OR REPLACE FUNCTION \"my schema\".my_func(a int)").as_deref(), Some("my_func"));
        assert_eq!(bare_function_name("CREATE FUNCTION public.\"Camel\"()").as_deref(), Some("camel"));
        assert_eq!(bare_function_name("CREATE TABLE x()"), None);
    }
}
