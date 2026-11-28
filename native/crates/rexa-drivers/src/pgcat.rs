//! Postgres catalog queries shared by the native Postgres driver and the
//! Supabase Management API driver (both speak pg_catalog). Ports of
//! `pg-client.ts` (tables, views, schemas, databases, structure, keys),
//! `sql-engine/all-columns.ts`, `security-actions.ts` and
//! `schema-introspection-actions.ts#fetchFunctions`.

use crate::catalog::*;
use crate::{Driver, QueryResult, Record, TableRef};
use anyhow::Result;

pub(crate) fn lit(s: &str) -> String {
    format!("'{}'", s.replace('\'', "''"))
}

async fn rows(d: &dyn Driver, sql: &str) -> Result<Vec<Record>> {
    Ok(d.execute(sql, usize::MAX).await?.records())
}

pub(crate) async fn schemas(d: &dyn Driver) -> Result<Vec<String>> {
    let r = d
        .execute(
            "SELECT schema_name FROM information_schema.schemata
             WHERE schema_name NOT IN ('information_schema', 'pg_catalog')
             AND schema_name NOT LIKE 'pg_toast%'
             ORDER BY schema_name",
            usize::MAX,
        )
        .await?;
    Ok(r.first_column())
}

pub(crate) async fn databases(d: &dyn Driver) -> Result<Vec<String>> {
    Ok(d.execute("SELECT datname AS name FROM pg_database WHERE datistemplate = false ORDER BY datname", usize::MAX).await?.first_column())
}

fn relkind(k: &str) -> TableKind {
    match k {
        "v" => TableKind::View,
        "m" => TableKind::MaterializedView,
        "f" => TableKind::Foreign,
        "p" => TableKind::Partitioned,
        _ => TableKind::Table,
    }
}

pub(crate) async fn table_infos(d: &dyn Driver, schema: &str) -> Result<Vec<TableInfo>> {
    let sql = format!(
        "SELECT c.relname AS name, c.relkind AS kind,
                CASE WHEN c.reltuples < 0 THEN NULL ELSE c.reltuples::bigint END AS row_estimate,
                CASE WHEN c.relkind IN ('r','p','m','t') THEN pg_total_relation_size(c.oid) END AS total_bytes,
                CASE WHEN c.relkind IN ('r','p','m','t') THEN pg_relation_size(c.oid) END AS data_bytes,
                obj_description(c.oid, 'pg_class') AS comment,
                c.relrowsecurity AS rls_enabled
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = {} AND c.relkind IN ('r','p','v','m','f')
         ORDER BY c.relname",
        lit(schema)
    );
    Ok(rows(d, &sql)
        .await?
        .into_iter()
        .map(|r| TableInfo {
            schema: schema.to_string(),
            name: r.string("name"),
            kind: relkind(r.get("kind").unwrap_or("r")),
            row_estimate: r.i64("row_estimate"),
            total_bytes: r.i64("total_bytes"),
            data_bytes: r.i64("data_bytes"),
            comment: r.opt("comment"),
            rls_enabled: r.opt_bool("rls_enabled"),
        })
        .collect())
}

/// Tables + views (+ matviews, foreign tables) of a schema.
pub(crate) async fn tables(d: &dyn Driver, schema: &str) -> Result<Vec<TableRef>> {
    let sql = format!(
        "SELECT c.relname, c.relkind IN ('v','m') FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = {} AND c.relkind IN ('r','p','v','m','f')
         ORDER BY c.relname",
        lit(schema)
    );
    Ok(d.execute(&sql, usize::MAX)
        .await?
        .rows
        .into_iter()
        .map(|r| TableRef { schema: schema.to_string(), name: r[0].display().to_string(), is_view: r[1].display() == "t" || r[1].display() == "true" })
        .collect())
}

/// `getViews`: views + materialized views.
pub(crate) async fn views(d: &dyn Driver, schema: &str) -> Result<Vec<String>> {
    let s = lit(schema);
    let sql = format!(
        "SELECT table_name AS name FROM information_schema.views WHERE table_schema = {s}
         UNION SELECT matviewname AS name FROM pg_matviews WHERE schemaname = {s} ORDER BY name"
    );
    Ok(d.execute(&sql, usize::MAX).await?.first_column())
}

fn column_from(r: &Record) -> ColumnDetail {
    let full = r.non_empty("full_type").unwrap_or_else(|| r.string("data_type"));
    ColumnDetail {
        column_name: r.string("column_name"),
        data_type: r.string("data_type"),
        full_type: full,
        udt_schema: r.opt("udt_schema"),
        udt_name: r.opt("udt_name"),
        is_nullable: r.get("is_nullable").is_some_and(|v| v.eq_ignore_ascii_case("YES") || crate::records::parse_bool(v)),
        column_default: r.opt("column_default"),
        character_maximum_length: r.i64("character_maximum_length"),
        numeric_precision: r.i64("numeric_precision"),
        numeric_scale: r.i64("numeric_scale"),
        is_primary_key: r.bool("is_primary_key"),
        is_foreign_key: r.bool("is_foreign_key"),
        is_unique: r.bool("is_unique"),
        is_identity: r.get("is_identity").is_some_and(|v| v.eq_ignore_ascii_case("YES"))
            || r.get("column_default").is_some_and(|d| d.starts_with("nextval(")),
        identity_generation: r.non_empty("identity_generation"),
        generation_expression: r.non_empty("generation_expression"),
        extra: None,
        comment: r.opt("comment"),
        is_enum: r.bool("is_enum"),
        ordinal_position: r.i64("ordinal_position").unwrap_or(0),
    }
}

/// `getTableStructure` with identity/comment/unique/enum extras. Falls back
/// to the original information_schema query on engines lacking pg_catalog
/// pieces (CockroachDB, Redshift).
pub(crate) async fn table_structure(d: &dyn Driver, t: &TableRef) -> Result<Vec<ColumnDetail>> {
    let (s, n) = (lit(&t.schema), lit(&t.name));
    let rich = format!(
        "SELECT c.column_name, c.data_type, c.udt_schema, c.udt_name, c.is_nullable, c.column_default,
                c.character_maximum_length, c.numeric_precision, c.numeric_scale, c.is_identity,
                c.identity_generation, c.generation_expression, c.ordinal_position,
                format_type(a.atttypid, a.atttypmod) AS full_type,
                col_description(a.attrelid, a.attnum) AS comment,
                COALESCE(a.attnum = ANY(pk.conkey), false) AS is_primary_key,
                EXISTS (SELECT 1 FROM pg_constraint f WHERE f.conrelid = a.attrelid AND f.contype = 'f' AND a.attnum = ANY(f.conkey)) AS is_foreign_key,
                EXISTS (SELECT 1 FROM pg_constraint u WHERE u.conrelid = a.attrelid AND u.contype = 'u' AND u.conkey = ARRAY[a.attnum]) AS is_unique,
                (ty.typtype = 'e') AS is_enum
         FROM information_schema.columns c
         JOIN pg_namespace ns ON ns.nspname = c.table_schema
         JOIN pg_class cl ON cl.relnamespace = ns.oid AND cl.relname = c.table_name
         JOIN pg_attribute a ON a.attrelid = cl.oid AND a.attname = c.column_name AND NOT a.attisdropped
         LEFT JOIN pg_type ty ON ty.oid = a.atttypid
         LEFT JOIN pg_constraint pk ON pk.conrelid = cl.oid AND pk.contype = 'p'
         WHERE c.table_schema = {s} AND c.table_name = {n}
         ORDER BY c.ordinal_position"
    );
    match rows(d, &rich).await {
        Ok(r) => Ok(r.iter().map(column_from).collect()),
        Err(_) => {
            let basic = format!(
                "SELECT c.column_name, c.data_type, c.udt_schema, c.udt_name, c.is_nullable, c.column_default,
                        c.character_maximum_length, c.ordinal_position,
                        EXISTS (SELECT 1 FROM information_schema.table_constraints tc
                          JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
                          WHERE tc.table_schema = c.table_schema AND tc.table_name = c.table_name
                            AND kcu.column_name = c.column_name AND tc.constraint_type = 'PRIMARY KEY') AS is_primary_key,
                        EXISTS (SELECT 1 FROM information_schema.table_constraints tc
                          JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
                          WHERE tc.table_schema = c.table_schema AND tc.table_name = c.table_name
                            AND kcu.column_name = c.column_name AND tc.constraint_type = 'FOREIGN KEY') AS is_foreign_key
                 FROM information_schema.columns c
                 WHERE c.table_schema = {s} AND c.table_name = {n}
                 ORDER BY c.ordinal_position"
            );
            Ok(rows(d, &basic).await?.iter().map(column_from).collect())
        }
    }
}

pub(crate) async fn primary_key(d: &dyn Driver, t: &TableRef) -> Result<Vec<String>> {
    let sql = format!(
        "SELECT a.attname FROM pg_constraint c
         JOIN pg_class cl ON cl.oid = c.conrelid JOIN pg_namespace n ON n.oid = cl.relnamespace
         JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
         JOIN pg_attribute a ON a.attrelid = cl.oid AND a.attnum = k.attnum
         WHERE c.contype = 'p' AND n.nspname = {} AND cl.relname = {} ORDER BY k.ord",
        lit(&t.schema),
        lit(&t.name)
    );
    match d.execute(&sql, usize::MAX).await {
        Ok(r) => Ok(r.first_column()),
        Err(_) => Ok(table_structure(d, t).await?.into_iter().filter(|c| c.is_primary_key).map(|c| c.column_name).collect()),
    }
}

fn fk_action(c: Option<&str>) -> Option<String> {
    Some(
        match c? {
            "a" => "NO ACTION",
            "r" => "RESTRICT",
            "c" => "CASCADE",
            "n" => "SET NULL",
            "d" => "SET DEFAULT",
            _ => return None,
        }
        .to_string(),
    )
}

pub(crate) async fn foreign_keys(d: &dyn Driver, t: &TableRef) -> Result<Vec<ForeignKey>> {
    let sql = format!(
        "SELECT src_att.attname AS column_name, tgt_ns.nspname AS foreign_table_schema,
                tgt_tbl.relname AS foreign_table_name, tgt_att.attname AS foreign_column_name,
                con.conname AS constraint_name, con.confupdtype AS on_update, con.confdeltype AS on_delete
         FROM pg_constraint con
         JOIN pg_class src_tbl ON src_tbl.oid = con.conrelid
         JOIN pg_namespace src_ns ON src_ns.oid = src_tbl.relnamespace
         JOIN pg_class tgt_tbl ON tgt_tbl.oid = con.confrelid
         JOIN pg_namespace tgt_ns ON tgt_ns.oid = tgt_tbl.relnamespace
         JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS src_col(attnum, ord) ON true
         JOIN LATERAL unnest(con.confkey) WITH ORDINALITY AS tgt_col(attnum, ord) ON tgt_col.ord = src_col.ord
         JOIN pg_attribute src_att ON src_att.attrelid = src_tbl.oid AND src_att.attnum = src_col.attnum
         JOIN pg_attribute tgt_att ON tgt_att.attrelid = tgt_tbl.oid AND tgt_att.attnum = tgt_col.attnum
         WHERE con.contype = 'f' AND src_ns.nspname = {} AND src_tbl.relname = {}
         ORDER BY con.conname, src_col.ord",
        lit(&t.schema),
        lit(&t.name)
    );
    // The original swallows FK errors and returns [].
    let Ok(r) = rows(d, &sql).await else { return Ok(Vec::new()) };
    Ok(r.into_iter()
        .map(|r| ForeignKey {
            column_name: r.string("column_name"),
            foreign_table_schema: r.string("foreign_table_schema"),
            foreign_table_name: r.string("foreign_table_name"),
            foreign_column_name: r.string("foreign_column_name"),
            constraint_name: r.opt("constraint_name"),
            on_update: fk_action(r.get("on_update")),
            on_delete: fk_action(r.get("on_delete")),
        })
        .collect())
}

pub(crate) async fn all_tables_with_columns(d: &dyn Driver, schema: Option<&str>) -> Result<Vec<SchemaColumn>> {
    let filter = match schema {
        Some(s) => format!("n.nspname = {}", lit(s)),
        None => "n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp%'".into(),
    };
    let sql = format!(
        "SELECT n.nspname AS table_schema, c.relname AS table_name, a.attname AS column_name,
                format_type(a.atttypid, a.atttypmod) AS data_type,
                COALESCE(a.attnum = ANY(pk.conkey), false) AS is_primary,
                CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END AS is_nullable,
                pg_get_expr(def.adbin, def.adrelid) AS column_default,
                ref_n.nspname AS referenced_table_schema, ref_c.relname AS referenced_table_name,
                ref_a.attname AS referenced_column_name
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
         LEFT JOIN pg_attrdef def ON def.adrelid = c.oid AND def.adnum = a.attnum
         LEFT JOIN pg_constraint pk ON pk.conrelid = c.oid AND pk.contype = 'p'
         LEFT JOIN LATERAL (
           SELECT con.confrelid, con.confkey[array_position(con.conkey, a.attnum)] AS confkey
           FROM pg_constraint con
           WHERE con.conrelid = c.oid AND con.contype = 'f' AND a.attnum = ANY(con.conkey)
           LIMIT 1
         ) fk ON true
         LEFT JOIN pg_class ref_c ON ref_c.oid = fk.confrelid
         LEFT JOIN pg_namespace ref_n ON ref_n.oid = ref_c.relnamespace
         LEFT JOIN pg_attribute ref_a ON ref_a.attrelid = fk.confrelid AND ref_a.attnum = fk.confkey
         WHERE {filter} AND c.relkind IN ('r','p','v','m','f')
         ORDER BY n.nspname, c.relname, a.attnum"
    );
    Ok(rows(d, &sql)
        .await?
        .into_iter()
        .map(|r| SchemaColumn {
            table_schema: r.string("table_schema"),
            table_name: r.string("table_name"),
            column_name: r.string("column_name"),
            data_type: r.string("data_type"),
            is_nullable: r.get("is_nullable") == Some("YES"),
            column_default: r.opt("column_default"),
            is_primary: r.bool("is_primary"),
            referenced_table_schema: r.opt("referenced_table_schema"),
            referenced_table_name: r.opt("referenced_table_name"),
            referenced_column_name: r.opt("referenced_column_name"),
        })
        .collect())
}

pub(crate) async fn indexes(d: &dyn Driver, schema: Option<&str>) -> Result<Vec<IndexInfo>> {
    let filter = schema.map(|s| format!("AND n.nspname = {}", lit(s))).unwrap_or_default();
    let sql = format!(
        "SELECT n.nspname AS schema, t.relname AS table_name, i.relname AS name,
                pg_get_indexdef(i.oid) AS definition, ix.indisunique AS is_unique,
                ix.indisprimary AS is_primary, am.amname AS method
         FROM pg_index ix
         JOIN pg_class i ON i.oid = ix.indexrelid
         JOIN pg_class t ON t.oid = ix.indrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
         LEFT JOIN pg_am am ON am.oid = i.relam
         WHERE n.nspname NOT IN ('information_schema', 'pg_catalog') AND n.nspname NOT LIKE 'pg_toast%' {filter}
         ORDER BY n.nspname, t.relname, i.relname"
    );
    let rows = match rows(d, &sql).await {
        Ok(r) => r,
        Err(_) => {
            // Original: pg_indexes view.
            let filter = schema.map(|s| format!("AND schemaname = {}", lit(s))).unwrap_or_default();
            let sql = format!(
                "SELECT schemaname AS schema, tablename AS table_name, indexname AS name, indexdef AS definition,
                        CASE WHEN indexdef LIKE 'CREATE UNIQUE INDEX%' THEN true ELSE false END AS is_unique
                 FROM pg_indexes WHERE schemaname NOT IN ('information_schema', 'pg_catalog') {filter}
                 ORDER BY schemaname, tablename, indexname"
            );
            self::rows(d, &sql).await?
        }
    };
    Ok(rows
        .into_iter()
        .map(|r| {
            let definition = r.string("definition");
            IndexInfo {
                schema: r.string("schema"),
                table_name: r.string("table_name"),
                name: r.string("name"),
                columns: extract_index_columns(&definition),
                definition,
                is_unique: r.bool("is_unique"),
                is_primary: r.bool("is_primary"),
                method: r.opt("method"),
            }
        })
        .collect())
}

pub(crate) async fn constraints(d: &dyn Driver, t: &TableRef) -> Result<Vec<ConstraintInfo>> {
    let sql = format!(
        "SELECT con.conname AS name, con.contype AS type, pg_get_constraintdef(con.oid) AS definition,
                ARRAY(SELECT a.attname FROM unnest(con.conkey) WITH ORDINALITY k(n, ord)
                      JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.n ORDER BY k.ord) AS columns
         FROM pg_constraint con
         JOIN pg_class c ON c.oid = con.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = {} AND c.relname = {}
         ORDER BY CASE con.contype WHEN 'p' THEN 0 WHEN 'f' THEN 1 WHEN 'u' THEN 2 ELSE 3 END, con.conname",
        lit(&t.schema),
        lit(&t.name)
    );
    Ok(rows(d, &sql)
        .await?
        .into_iter()
        .map(|r| ConstraintInfo {
            name: r.string("name"),
            constraint_type: ConstraintType::parse(r.get("type").unwrap_or("")),
            columns: r.list("columns"),
            definition: r.opt("definition"),
        })
        .collect())
}

pub(crate) async fn enums(d: &dyn Driver) -> Result<Vec<EnumType>> {
    let sql = "SELECT n.nspname AS schema, t.typname AS name, e.enumlabel AS value, e.enumsortorder AS sort_order
               FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid
               JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
               WHERE n.nspname NOT IN ('information_schema', 'pg_catalog')
               ORDER BY n.nspname, t.typname, e.enumsortorder";
    let mut out: Vec<EnumType> = Vec::new();
    for r in rows(d, sql).await? {
        let (schema, name) = (r.string("schema"), r.string("name"));
        match out.last_mut() {
            Some(e) if e.schema == schema && e.name == name => e.values.push(r.string("value")),
            _ => out.push(EnumType { schema, name, values: vec![r.string("value")] }),
        }
    }
    Ok(out)
}

pub(crate) async fn functions(d: &dyn Driver, schema: &str) -> Result<Vec<RoutineInfo>> {
    let s = lit(schema);
    let detailed = format!(
        "SELECT n.nspname as schema, p.proname as name, pg_get_function_arguments(p.oid) as arguments,
                t.typname as return_type, l.lanname as language,
                CASE WHEN p.prokind = 'a' THEN '' ELSE pg_get_functiondef(p.oid) END as definition,
                CASE WHEN p.prokind = 'p' THEN 'PROCEDURE' ELSE 'FUNCTION' END as type,
                CASE p.provolatile WHEN 'i' THEN 'IMMUTABLE' WHEN 's' THEN 'STABLE' ELSE 'VOLATILE' END as volatility,
                p.prosecdef as security_definer, pg_get_userbyid(p.proowner) as owner
         FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
         JOIN pg_type t ON p.prorettype = t.oid JOIN pg_language l ON p.prolang = l.oid
         WHERE n.nspname = {s} AND n.nspname NOT IN ('pg_catalog', 'information_schema')
         ORDER BY p.proname"
    );
    let r = match rows(d, &detailed).await {
        Ok(r) => r,
        Err(_) => {
            let basic = format!(
                "SELECT n.nspname as schema, p.proname as name, pg_get_function_arguments(p.oid) as arguments,
                        t.typname as return_type, l.lanname as language, p.prosrc as definition,
                        CASE WHEN p.prokind = 'p' THEN 'PROCEDURE' ELSE 'FUNCTION' END as type
                 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
                 JOIN pg_type t ON p.prorettype = t.oid JOIN pg_language l ON p.prolang = l.oid
                 WHERE n.nspname = {s} AND n.nspname NOT IN ('pg_catalog', 'information_schema')
                 ORDER BY p.proname"
            );
            rows(d, &basic).await?
        }
    };
    Ok(r.into_iter()
        .map(|r| RoutineInfo {
            schema: r.string("schema"),
            name: r.string("name"),
            arguments: r.string("arguments"),
            return_type: r.string("return_type"),
            language: r.string("language"),
            definition: r.opt("definition"),
            r#type: r.string("type"),
            volatility: r.opt("volatility"),
            security_definer: r.opt_bool("security_definer"),
            owner: r.opt("owner"),
            package_name: None,
        })
        .collect())
}

pub(crate) async fn triggers(d: &dyn Driver, schema: Option<&str>) -> Result<Vec<TriggerInfo>> {
    let filter = schema.map(|s| format!("AND trigger_schema = {}", lit(s))).unwrap_or_default();
    let build = |extra: &str| {
        format!(
            "SELECT trigger_schema as schema, trigger_name as name, event_object_schema as table_schema,
                    event_object_table as table_name, action_timing as timing, event_manipulation as event,
                    action_orientation as orientation, action_statement as definition{extra}
             FROM information_schema.triggers
             WHERE trigger_schema NOT IN ('information_schema', 'pg_catalog') {filter}
             ORDER BY trigger_schema, trigger_name"
        )
    };
    let full = build(
        ", (SELECT pg_get_triggerdef(t.oid, true) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE t.tgname = trigger_name AND c.relname = event_object_table AND n.nspname = event_object_schema
              AND NOT t.tgisinternal LIMIT 1) as full_definition,
           (SELECT CASE t.tgenabled WHEN 'D' THEN 'DISABLED' WHEN 'R' THEN 'REPLICA' WHEN 'A' THEN 'ALWAYS' ELSE 'ENABLED' END
            FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE t.tgname = trigger_name AND c.relname = event_object_table AND n.nspname = event_object_schema
              AND NOT t.tgisinternal LIMIT 1) as enabled_mode",
    );
    let r = match rows(d, &full).await {
        Ok(r) => r,
        Err(_) => rows(d, &build("")).await?,
    };
    // information_schema.triggers has one row per event — merge them.
    let mut out: Vec<TriggerInfo> = Vec::new();
    for r in r {
        let (schema, name, table) = (r.string("schema"), r.string("name"), r.opt("table_name"));
        let event = r.string("event");
        if let Some(t) = out.iter_mut().find(|t| t.schema == schema && t.name == name && t.table_name == table) {
            if !event.is_empty() && !t.events.contains(&event) {
                t.events.push(event);
                t.event = t.events.join(", ");
            }
            continue;
        }
        let definition = r.opt("definition");
        let function_name = definition
            .as_deref()
            .and_then(|d| d.strip_prefix("EXECUTE FUNCTION ").or_else(|| d.strip_prefix("EXECUTE PROCEDURE ")))
            .map(|f| f.split('(').next().unwrap_or(f).trim().to_string())
            .unwrap_or_default();
        out.push(TriggerInfo {
            schema,
            name,
            table_schema: r.opt("table_schema"),
            table_name: table,
            timing: r.non_empty("timing").unwrap_or_else(|| "AFTER".into()),
            events: if event.is_empty() { vec![] } else { vec![event.clone()] },
            event,
            orientation: r.non_empty("orientation").unwrap_or_else(|| "ROW".into()),
            function_name,
            enabled_mode: r.non_empty("enabled_mode").unwrap_or_else(|| "ENABLED".into()),
            definition,
            full_definition: r.opt("full_definition"),
        });
    }
    Ok(out)
}

pub(crate) async fn sequences(d: &dyn Driver, schema: &str) -> Result<Vec<SequenceInfo>> {
    let sql = format!(
        "SELECT schemaname as schema, sequencename as name, sequenceowner as owner, data_type, start_value,
                min_value, max_value, increment_by, cycle as cycle_flag, cache_size, last_value as last_number
         FROM pg_sequences WHERE schemaname = {} ORDER BY sequencename",
        lit(schema)
    );
    Ok(rows(d, &sql)
        .await?
        .into_iter()
        .map(|r| SequenceInfo {
            schema: r.string("schema"),
            name: r.string("name"),
            owner: r.opt("owner"),
            data_type: r.opt("data_type"),
            start_value: r.opt("start_value"),
            min_value: r.opt("min_value"),
            max_value: r.opt("max_value"),
            increment_by: r.opt("increment_by"),
            cycle_flag: r.bool("cycle_flag"),
            cache_size: r.opt("cache_size"),
            last_number: r.opt("last_number"),
        })
        .collect())
}

pub(crate) async fn extensions(d: &dyn Driver) -> Result<Vec<ExtensionInfo>> {
    let sql = "SELECT ext.name, ext.default_version, ext.installed_version, ext.comment,
                      ns.nspname AS installed_schema, details.schema AS default_schema,
                      array_to_string(details.requires, ', ') AS requires, details.trusted, details.relocatable,
                      details.superuser,
                      array_to_string(ARRAY(SELECT v.version FROM pg_available_extension_versions v
                                            WHERE v.name = ext.name ORDER BY v.version DESC), ', ') AS available_versions
               FROM pg_available_extensions AS ext
               LEFT JOIN pg_extension AS installed_ext ON installed_ext.extname = ext.name
               LEFT JOIN pg_namespace AS ns ON ns.oid = installed_ext.extnamespace
               LEFT JOIN pg_available_extension_versions AS details
                 ON details.name = ext.name AND details.version = COALESCE(ext.installed_version, ext.default_version)
               ORDER BY ext.name";
    Ok(rows(d, sql)
        .await?
        .into_iter()
        .map(|r| ExtensionInfo {
            name: r.string("name"),
            default_version: r.opt("default_version"),
            installed_version: r.opt("installed_version"),
            comment: r.opt("comment"),
            installed_schema: r.opt("installed_schema"),
            default_schema: r.opt("default_schema"),
            requires: r.opt("requires"),
            trusted: r.opt_bool("trusted"),
            relocatable: r.opt_bool("relocatable"),
            superuser: r.opt_bool("superuser"),
            available_versions: r.opt("available_versions"),
        })
        .collect())
}

pub(crate) async fn rls_policies(d: &dyn Driver, schema: Option<&str>, table: Option<&str>) -> Result<Vec<RlsPolicy>> {
    let mut filter = String::new();
    if let Some(s) = schema.filter(|s| !s.is_empty()) {
        filter.push_str(&format!(" AND p.schemaname = {}", lit(s)));
    }
    if let Some(t) = table.filter(|t| !t.is_empty()) {
        filter.push_str(&format!(" AND p.tablename = {}", lit(t)));
    }
    let sql = format!(
        "SELECT p.schemaname as schema, p.tablename as table_name, p.policyname as name, p.permissive as permissive,
                p.roles as roles, p.cmd as command, p.qual as using_expression, p.with_check as with_check_expression,
                c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced
         FROM pg_policies p
         JOIN pg_namespace n ON n.nspname = p.schemaname
         JOIN pg_class c ON c.relname = p.tablename AND c.relnamespace = n.oid
         WHERE p.schemaname NOT IN ('information_schema', 'pg_catalog'){filter}
         ORDER BY p.schemaname, p.tablename, p.policyname"
    );
    Ok(rows(d, &sql)
        .await?
        .into_iter()
        .map(|r| RlsPolicy {
            schema: r.string("schema"),
            table_name: r.string("table_name"),
            name: r.string("name"),
            permissive: r.string("permissive"),
            roles: r.list("roles"),
            command: r.string("command"),
            using_expression: r.opt("using_expression"),
            with_check_expression: r.opt("with_check_expression"),
            rls_enabled: r.bool("rls_enabled"),
            rls_forced: r.bool("rls_forced"),
        })
        .collect())
}

pub(crate) async fn table_security(d: &dyn Driver, schema: &str) -> Result<Vec<TableSecurity>> {
    let sql = format!(
        "SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced,
                COUNT(p.policyname) AS policy_count
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         LEFT JOIN pg_policies p ON p.schemaname = n.nspname AND p.tablename = c.relname
         WHERE n.nspname = {} AND c.relkind IN ('r', 'p')
         GROUP BY c.relname, c.relrowsecurity, c.relforcerowsecurity ORDER BY c.relname",
        lit(schema)
    );
    Ok(rows(d, &sql)
        .await?
        .into_iter()
        .map(|r| TableSecurity {
            table_name: r.string("table_name"),
            rls_enabled: r.bool("rls_enabled"),
            rls_forced: r.bool("rls_forced"),
            policy_count: r.i64("policy_count").unwrap_or(0),
        })
        .collect())
}

pub(crate) async fn roles(d: &dyn Driver) -> Result<Vec<String>> {
    Ok(d.execute("SELECT rolname AS name FROM pg_roles WHERE rolname !~ '^pg_' ORDER BY rolname", usize::MAX)
        .await?
        .first_column()
        .into_iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect())
}

pub(crate) async fn materialized_views(d: &dyn Driver, schema: &str) -> Result<Vec<MaterializedViewInfo>> {
    let sql = format!(
        "SELECT schemaname AS schema, matviewname AS name, definition AS query, ispopulated
         FROM pg_matviews WHERE schemaname = {} ORDER BY matviewname",
        lit(schema)
    );
    Ok(rows(d, &sql)
        .await?
        .into_iter()
        .map(|r| MaterializedViewInfo {
            schema: r.string("schema"),
            name: r.string("name"),
            query: r.opt("query"),
            is_populated: r.opt_bool("ispopulated"),
            ..Default::default()
        })
        .collect())
}

pub(crate) async fn sessions(d: &dyn Driver) -> Result<QueryResult> {
    d.execute(
        "SELECT pid, datname AS database, usename AS username, application_name, client_addr, client_port, state,
                query, query_start, wait_event_type, wait_event, backend_type, state_change
         FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND datname IS NOT NULL
         ORDER BY query_start DESC NULLS LAST",
        usize::MAX,
    )
    .await
}

pub(crate) async fn locks(d: &dyn Driver) -> Result<QueryResult> {
    d.execute(
        "SELECT l.locktype, l.database, l.relation::regclass AS relation_name, l.pid, l.mode, l.granted, l.fastpath,
                l.virtualtransaction, l.transactionid, l.classid, l.objid, l.objsubid, l.virtualxid, l.page, l.tuple,
                a.query, a.state, a.query_start, a.application_name, a.usename, a.client_addr
         FROM pg_locks l LEFT JOIN pg_stat_activity a ON a.pid = l.pid
         WHERE a.pid <> pg_backend_pid() ORDER BY l.pid, l.locktype, l.relation",
        usize::MAX,
    )
    .await
}

fn json_obj(s: Option<&str>) -> serde_json::Value {
    s.and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok())
        .filter(|v| v.is_object())
        .unwrap_or_else(|| serde_json::Value::Object(Default::default()))
}

/// `fetchSupabaseAuthUsers` (SQL path) + `mapSupabaseAuthUserOption`.
pub(crate) async fn auth_users(d: &dyn Driver) -> Result<Vec<AuthUser>> {
    let users = rows(
        d,
        "SELECT u.id::text AS id, u.email, u.phone, u.role, u.created_at, u.raw_app_meta_data, u.raw_user_meta_data,
                (u.encrypted_password IS NOT NULL) AS has_pwd
         FROM auth.users u ORDER BY u.created_at DESC LIMIT 500",
    )
    .await?;
    let mut providers: std::collections::HashMap<String, Vec<String>> = Default::default();
    if let Ok(ids) = rows(d, "SELECT user_id::text AS user_id, provider FROM auth.identities").await {
        for r in ids {
            let (uid, p) = (r.string("user_id"), r.string("provider"));
            if uid.is_empty() || p.is_empty() {
                continue;
            }
            let e = providers.entry(uid).or_default();
            if !e.contains(&p) {
                e.push(p);
            }
        }
    }
    Ok(users
        .into_iter()
        .filter_map(|r| {
            let id = r.string("id").trim().to_string();
            if id.is_empty() {
                return None;
            }
            let user_meta = json_obj(r.get("raw_user_meta_data"));
            let pick = |k: &str| user_meta.get(k).and_then(|v| v.as_str()).map(str::trim).filter(|s| !s.is_empty()).map(str::to_string);
            let email = r.opt("email");
            let display_name = pick("full_name")
                .or_else(|| pick("name"))
                .or_else(|| pick("display_name"))
                .or_else(|| email.as_deref().map(|e| e.split('@').next().unwrap_or(e).to_string()).filter(|s| !s.is_empty()))
                .unwrap_or_else(|| id.clone());
            let mut provs = providers.get(&id).cloned().unwrap_or_default();
            if provs.is_empty() && r.bool("has_pwd") {
                provs.push("email".into());
            }
            Some(AuthUser {
                display_name,
                email,
                phone: r.opt("phone"),
                role: r.non_empty("role").unwrap_or_else(|| "authenticated".into()),
                providers: provs,
                created_at: r.opt("created_at"),
                raw_app_meta_data: json_obj(r.get("raw_app_meta_data")),
                raw_user_meta_data: user_meta,
                id,
            })
        })
        .collect())
}
