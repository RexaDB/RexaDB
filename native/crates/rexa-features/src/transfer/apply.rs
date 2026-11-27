//! Port of the transfer half of lib/db/export-helpers.ts
//! (`runPgDumpSchemaOnly`, `applySupabaseDumpTransforms`, `resetAndApplySql`),
//! lib/db/pg-dump.ts (`resolvePgDumpBinary`) and lib/db/supabase-helpers.ts.
//!
//! Transactional apply: the original opens its own `pg.Client`. Here the
//! transfer connects a dedicated destination driver (not the studio's shared
//! session) and drives it strictly sequentially, so every statement lands on
//! the same pooled connection; `pg_backend_pid()` is checked at BEGIN and
//! before COMMIT so a dropped/replaced connection aborts instead of
//! committing half a transfer.

use super::schema_dump::*;
use super::sql::*;
use anyhow::{anyhow, bail, Result};
use regex::Regex;
use rexa_drivers::Kind;

pub const SUPABASE_DUMP_EXCLUDED_SCHEMA_PATTERNS: &[&str] = &[
    "information_schema",
    "pg_*",
    "_analytics",
    "_realtime",
    "_supavisor",
    "auth",
    "extensions",
    "pgbouncer",
    "realtime",
    "storage",
    "supabase_functions",
    "supabase_migrations",
    "cron",
    "dbdev",
    "graphql",
    "graphql_public",
    "net",
    "pgmq",
    "pgsodium",
    "pgsodium_masks",
    "pgtle",
    "repack",
    "tiger",
    "tiger_data",
    "timescaledb_*",
    "_timescaledb_*",
    "topology",
    "vault",
];

/// `schemaMatchesPattern`
pub fn schema_matches_pattern(name: &str, pattern: &str) -> bool {
    match pattern.strip_suffix('*') {
        Some(prefix) if !prefix.contains('*') => name.starts_with(prefix),
        _ if pattern.contains('*') => {
            let re = format!("^{}$", regex::escape(pattern).replace("\\*", ".*"));
            Regex::new(&re).is_ok_and(|r| r.is_match(name))
        }
        _ => name == pattern,
    }
}

/// `isSupabaseExcludedSchema`
pub fn is_supabase_excluded_schema(name: &str) -> bool {
    SUPABASE_DUMP_EXCLUDED_SCHEMA_PATTERNS.iter().any(|p| schema_matches_pattern(name, p))
}

fn host_of(cs: &str) -> String {
    url::Url::parse(cs.trim()).ok().and_then(|u| u.host_str().map(str::to_lowercase)).unwrap_or_default()
}

/// `isLikelySupabaseConnection`
pub fn is_likely_supabase_connection(cs: &str) -> bool {
    if cs.trim().to_ascii_lowercase().starts_with("supabase-mgmt://") {
        return true;
    }
    let h = host_of(cs);
    h.contains("supabase.co") || h.contains("supabase.in")
}

/// `isNeonServerlessHost`
pub fn is_neon_serverless_host(cs: &str) -> bool {
    let h = host_of(cs);
    h.ends_with(".neon.tech") || h.ends_with(".neon.build")
}

/// `stripRexaDbParams` (drops every `rexadb_*` query param).
pub fn strip_rexadb_params(cs: &str) -> String {
    let Ok(mut url) = url::Url::parse(cs.trim()) else { return cs.to_string() };
    let kept: Vec<(String, String)> =
        url.query_pairs().filter(|(k, _)| !k.starts_with("rexadb_")).map(|(k, v)| (k.into_owned(), v.into_owned())).collect();
    if kept.is_empty() {
        url.set_query(None);
    } else {
        url.query_pairs_mut().clear().extend_pairs(kept);
    }
    url.to_string()
}

/// `isDirectDialablePostgres`. Also false for SSH-tunnelled connections:
/// pg_dump can't use the app's tunnel (they take the SQL dump path).
pub fn is_direct_dialable_postgres(cs: &str) -> bool {
    let lower = cs.trim().to_ascii_lowercase();
    (lower.starts_with("postgres://") || lower.starts_with("postgresql://")) && !lower.contains("rexadb_ssh_")
}

/// `resolvePgDumpBinary` (macOS candidates + PATH + Homebrew kegs).
pub fn resolve_pg_dump_binary() -> Option<String> {
    for var in ["REXADB_PG_DUMP_PATH", "PG_DUMP_PATH"] {
        if let Ok(v) = std::env::var(var) {
            if !v.trim().is_empty() {
                return Some(v.trim().to_string());
            }
        }
    }
    let mut c: Vec<String> = vec!["/opt/homebrew/bin/pg_dump".into(), "/usr/local/bin/pg_dump".into(), "/usr/bin/pg_dump".into()];
    let app_root = "/Applications/Postgres.app/Contents/Versions";
    if let Ok(rd) = std::fs::read_dir(app_root) {
        let mut versions: Vec<String> = rd.flatten().map(|e| e.file_name().to_string_lossy().into_owned()).filter(|v| !v.starts_with('.')).collect();
        versions.sort_by_key(|v| v.split('.').map(|p| p.parse::<u32>().unwrap_or(0)).collect::<Vec<_>>());
        if let Some(latest) = versions.last() {
            c.push(format!("{app_root}/{latest}/bin/pg_dump"));
        }
    }
    if let Ok(rd) = std::fs::read_dir("/opt/homebrew/opt") {
        for e in rd.flatten() {
            if e.file_name().to_string_lossy().starts_with("postgresql") {
                c.push(format!("{}/bin/pg_dump", e.path().display()));
            }
        }
    }
    if let Ok(path) = std::env::var("PATH") {
        c.extend(path.split(':').map(|d| format!("{d}/pg_dump")));
    }
    c.into_iter().find(|p| std::path::Path::new(p).is_file())
}

/// `applySupabaseDumpTransforms`
pub fn apply_supabase_dump_transforms(input: &str, excluded: &str) -> String {
    let rules: Vec<(String, &str)> = vec![
        (r"(?im)^\\(un)?restrict .*$".into(), "-- $0"),
        (r#"(?im)^CREATE SCHEMA ""#.into(), "CREATE SCHEMA IF NOT EXISTS \""),
        (r#"(?im)^CREATE TABLE ""#.into(), "CREATE TABLE IF NOT EXISTS \""),
        (r#"(?im)^CREATE SEQUENCE ""#.into(), "CREATE SEQUENCE IF NOT EXISTS \""),
        (r#"(?im)^CREATE VIEW ""#.into(), "CREATE OR REPLACE VIEW \""),
        (r#"(?im)^CREATE FUNCTION ""#.into(), "CREATE OR REPLACE FUNCTION \""),
        (r#"(?im)^CREATE PUBLICATION "supabase_realtime.*$"#.into(), "-- $0"),
        (r"(?im)^CREATE EVENT TRIGGER .*$".into(), "-- $0"),
        (r"(?im)^\s*WHEN TAG IN .*$".into(), "-- $0"),
        (r"(?im)^\s*EXECUTE FUNCTION .*$".into(), "-- $0"),
        (r"(?im)^ALTER EVENT TRIGGER .*$".into(), "-- $0"),
        (r#"(?im)^ALTER PUBLICATION "supabase_realtime_.*$"#.into(), "-- $0"),
        (r"(?im)^ALTER FOREIGN DATA WRAPPER (.+) OWNER TO .*$".into(), "-- $0"),
        (r#"(?im)^ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin".*$"#.into(), "-- $0"),
        (r#"(?im)^GRANT ALL ON FOREIGN DATA WRAPPER (.+) TO "postgres" WITH GRANT OPTION.*$"#.into(), "-- $0"),
        (format!(r#"(?im)^GRANT (.+) ON (.+) "({excluded}).*$"#), "-- $0"),
        (format!(r#"(?im)^REVOKE (.+) ON (.+) "({excluded}).*$"#), "-- $0"),
        (r#"(?im)^(CREATE EXTENSION IF NOT EXISTS "pg_tle").+$"#.into(), "$1;"),
        (r#"(?im)^(CREATE EXTENSION IF NOT EXISTS "pgsodium").+$"#.into(), "$1;"),
        (r#"(?im)^(CREATE EXTENSION IF NOT EXISTS "pgmq").+$"#.into(), "$1;"),
        (r"(?im)^COMMENT ON EXTENSION (.+)$".into(), "-- $0"),
        (r#"(?im)^CREATE POLICY "cron_job_.*$"#.into(), "-- $0"),
        (r#"(?im)^ALTER TABLE "cron".*$"#.into(), "-- $0"),
        (r"(?im)^SET transaction_timeout = 0;.*$".into(), "-- $0"),
    ];
    let mut out = input.to_string();
    for (re, rep) in rules {
        if let Ok(re) = Regex::new(&re) {
            out = re.replace_all(&out, rep).into_owned();
        }
    }
    out
}

/// `getAllowedSchemasForDump`
async fn allowed_schemas_for_dump(db: &Db, cs: &str) -> Vec<String> {
    let rows = select(
        db,
        "SELECT schema_name
     FROM information_schema.schemata
     WHERE schema_name NOT IN ('pg_catalog','information_schema')
       AND schema_name NOT LIKE 'pg_%'
       AND has_schema_privilege(schema_name, 'USAGE')
     ORDER BY schema_name;",
    )
    .await
    .unwrap_or_default();
    let supabase = is_likely_supabase_connection(cs);
    rows.iter()
        .map(|r| r.string("schema_name").trim().to_string())
        .filter(|s| !s.is_empty())
        .filter(|s| !supabase || !is_supabase_excluded_schema(s))
        .collect()
}

/// `runPgDumpSchemaOnly`
pub async fn run_pg_dump_schema_only(db: &Db, cs: &str) -> Result<String> {
    let schemas = allowed_schemas_for_dump(db, cs).await;
    if schemas.is_empty() {
        bail!("No accessible schemas found to export.");
    }
    let pg_dump = resolve_pg_dump_binary();
    if db.kind() != Kind::Postgres || !is_direct_dialable_postgres(cs) || is_neon_serverless_host(cs) || pg_dump.is_none() {
        let (sql, warnings) = build_schema_dump_via_sql(db, &schemas).await;
        let mut header = vec!["-- Schema dump generated via SQL introspection (pg_dump is not used for this connection type).".to_string()];
        header.extend(warnings.iter().map(|w| format!("-- NOTE: {w}")));
        if sql.trim().is_empty() {
            bail!("SQL schema dump produced no statements. {}", warnings.join(" "));
        }
        return Ok(format!("{}\n{sql}", header.join("\n")));
    }
    let binary = pg_dump.unwrap_or_default();
    let supabase = is_likely_supabase_connection(cs);
    let excluded = if supabase {
        "information_schema|pg_*|_analytics|_realtime|_supavisor|auth|extensions|pgbouncer|realtime|storage|supabase_functions|supabase_migrations|cron|dbdev|graphql|graphql_public|net|pgmq|pgsodium|pgsodium_masks|pgtle|repack|tiger|tiger_data|timescaledb_*|_timescaledb_*|topology|vault"
    } else {
        "information_schema|pg_*"
    };
    let mut args: Vec<String> = vec![
        "--schema-only".into(),
        "--no-owner".into(),
        "--no-privileges".into(),
        "--quote-all-identifiers".into(),
        format!("--exclude-schema={excluded}"),
    ];
    args.extend(schemas.iter().map(|s| format!("--schema={s}")));
    args.push(format!("--dbname={}", strip_rexadb_params(cs)));
    let out = tokio::process::Command::new(&binary).args(&args).output().await.map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            anyhow!("pg_dump not found (ENOENT). resolved={binary}")
        } else {
            anyhow!("{e} | resolved={binary}")
        }
    })?;
    if !out.status.success() {
        bail!("{} | resolved={binary}", String::from_utf8_lossy(&out.stderr).trim());
    }
    let raw = String::from_utf8_lossy(&out.stdout).into_owned();
    if supabase {
        return Ok(apply_supabase_dump_transforms(&raw, excluded));
    }
    // pg_dump ≥ 17.6 emits psql-only `\restrict` / `\unrestrict` meta
    // commands; they are not SQL and would abort the apply (the original
    // only comments them out for Supabase dumps). Explicit `--schema=public`
    // also makes newer pg_dump emit `CREATE SCHEMA "public"`, which collides
    // with the `CREATE SCHEMA public` of the reset step.
    static META: std::sync::LazyLock<Regex> = std::sync::LazyLock::new(|| Regex::new(r"(?m)^\\(un)?restrict .*$").unwrap());
    static SCHEMA: std::sync::LazyLock<Regex> = std::sync::LazyLock::new(|| Regex::new(r#"(?m)^CREATE SCHEMA ""#).unwrap());
    let out = META.replace_all(&raw, "-- $0");
    Ok(SCHEMA.replace_all(&out, "CREATE SCHEMA IF NOT EXISTS \"").into_owned())
}

/// `isProtectedDestinationSchema`
fn is_protected_destination_schema(name: &str, supabase_like: bool) -> bool {
    name == "neon_auth" || (supabase_like && is_supabase_excluded_schema(name))
}

async fn drop_statements(db: &Db, cs: &str) -> Result<Vec<String>> {
    let rows = select(
        db,
        "SELECT schema_name
     FROM information_schema.schemata
     WHERE schema_name NOT IN ('information_schema', 'pg_catalog', 'public')
       AND schema_name NOT LIKE 'pg_%'
     ORDER BY schema_name;",
    )
    .await
    .map_err(|e| anyhow!("Could not list destination schemas: {}", err_text(&e)))?;
    let supabase = is_likely_supabase_connection(cs);
    let mut out: Vec<String> = rows
        .iter()
        .map(|r| r.string("schema_name"))
        .filter(|s| !is_protected_destination_schema(s, supabase))
        .map(|s| format!("DROP SCHEMA IF EXISTS \"{}\" CASCADE;", s.replace('"', "\"\"")))
        .collect();
    out.push("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;".into());
    Ok(out)
}

/// Savepoint-guarded statement on the pinned session.
struct Savepoint<'a> {
    db: &'a Db,
    name: &'static str,
    in_txn: bool,
}

impl Exec for Savepoint<'_> {
    fn run(&mut self, sql: &str) -> impl std::future::Future<Output = Result<()>> + Send {
        let db = self.db.clone();
        let (name, in_txn, sql) = (self.name, self.in_txn, sql.to_string());
        async move { guarded(&db, name, in_txn, &sql).await }
    }
}

async fn guarded(db: &Db, name: &str, in_txn: bool, sql: &str) -> Result<()> {
    if !in_txn {
        return exec(db, sql).await;
    }
    exec(db, &format!("SAVEPOINT {name}")).await?;
    match exec(db, sql).await {
        Ok(()) => {
            exec(db, &format!("RELEASE SAVEPOINT {name}")).await?;
            Ok(())
        }
        Err(e) => {
            let _ = exec(db, &format!("ROLLBACK TO SAVEPOINT {name}")).await;
            let _ = exec(db, &format!("RELEASE SAVEPOINT {name}")).await;
            Err(e)
        }
    }
}

async fn backend_pid(db: &Db) -> Result<String> {
    select(db, "SELECT pg_backend_pid() AS pid").await?.first().map(|r| r.string("pid")).ok_or_else(|| anyhow!("no backend pid"))
}

/// `resetAndApplySql`: returns (warnings, skippedRows).
pub async fn reset_and_apply_sql(
    db: &Db,
    cs: &str,
    full_sql: &str,
    data_sql: Option<&str>,
    on_phase: PhaseHook<'_>,
) -> Result<(Vec<String>, i64)> {
    if !db.kind().is_postgres_catalog() {
        bail!("SQL import is supported only for PostgreSQL connections.");
    }
    let drops = drop_statements(db, cs).await?;
    if db.kind() != Kind::Postgres {
        return apply_transfer_via_query(db, &drops, full_sql, data_sql, on_phase).await;
    }

    let chunks = data_sql.map(parse_data_chunks).unwrap_or_default();
    let mut warnings = Vec::new();
    let mut structural = Vec::new();
    let mut programmable = Vec::new();
    for stmt in split_sql_statements(full_sql) {
        let exe = strip_comment_lines(&stmt);
        if exe.is_empty() {
            continue;
        }
        if is_programmable_statement(&exe) {
            programmable.push(exe);
        } else {
            structural.push(exe);
        }
    }
    static NON_TXN: std::sync::LazyLock<Regex> = std::sync::LazyLock::new(|| {
        Regex::new(r"(?im)(CREATE\s+(UNIQUE\s+)?INDEX\s+CONCURRENTLY|^\s*VACUUM\b|^\s*CREATE\s+DATABASE\b|^\s*ALTER\s+SYSTEM\b)").unwrap()
    });
    let non_transactional = NON_TXN.is_match(&format!("{full_sql}\n{}", data_sql.unwrap_or("")));
    let in_txn = !non_transactional;
    let mut skipped_rows = 0i64;

    // pg_dump scripts run `set_config('search_path', '', false)`, which
    // outlives the transaction on this (reused) session; start from the
    // connection's own default so unqualified catalog text resolves.
    let _ = exec(db, "RESET search_path").await;
    let pid = if in_txn {
        let pid = backend_pid(db).await?;
        exec(db, "BEGIN;").await?;
        Some(pid)
    } else {
        None
    };
    let result: Result<()> = async {
        for stmt in &drops {
            exec(db, stmt).await.map_err(|e| anyhow!("Drop failed at {}: {}", short_statement(stmt, 160), err_text(&e)))?;
        }
        let total = structural.len() + programmable.len();
        on_phase("schema", 0, total, "drops applied");
        for (i, stmt) in structural.iter().enumerate() {
            exec(db, stmt).await.map_err(|e| anyhow!("Schema apply failed at {}: {}", short_statement(stmt, 160), err_text(&e)))?;
            let done = i + 1;
            if done % 25 == 0 || done == total {
                on_phase("schema", done, total, &short_statement(stmt, 160));
            }
        }
        let mut failed = Vec::new();
        for stmt in &programmable {
            if let Err(e) = guarded(db, "transfer_prog", in_txn, stmt).await {
                failed.push((stmt.clone(), e));
            }
        }
        let mut still = Vec::new();
        for (stmt, _) in failed {
            if let Err(e) = guarded(db, "transfer_prog", in_txn, &stmt).await {
                still.push((stmt, err_text(&e)));
            }
        }
        if let Some((stmt, err)) = still.iter().find(|(s, _)| is_security_critical_programmable(s)) {
            bail!(
                "Security-critical object failed to apply ({}): {} — transfer aborted instead of leaving the destination without it.",
                err.chars().take(200).collect::<String>(),
                short_statement(stmt, 160)
            );
        }
        for (stmt, err) in &still {
            warnings.push(format!("Skipped programmable object ({}): {}", err.chars().take(200).collect::<String>(), short_statement(stmt, 160)));
        }
        if chunks.is_empty() {
            return Ok(());
        }
        let deps = fk_edges(&select(db, FK_EDGES_SQL).await?);
        let ordered = order_chunks_by_dependency(&chunks, &deps);
        let mut seen = std::collections::HashSet::new();
        let trigger_tables: Vec<(String, String)> = ordered
            .iter()
            .filter(|c| !c.schema.is_empty() && !c.table.is_empty())
            .filter(|c| seen.insert(format!("{}.{}", c.schema, c.table)))
            .map(|c| (c.schema.clone(), c.table.clone()))
            .collect();
        for (s, t) in &trigger_tables {
            if let Err(e) = guarded(db, "transfer_trig", in_txn, &format!("ALTER TABLE {} DISABLE TRIGGER USER", qualified_table(s, t))).await {
                warnings.push(format!("Could not disable triggers on {s}.{t} ({}); row triggers stay live during import.", err_text(&e)));
            }
        }
        let data: Result<()> = async {
            let mut failed_rows = 0usize;
            let total = ordered.len();
            for (i, chunk) in ordered.iter().enumerate() {
                let place = if chunk.table.is_empty() { "unmarked statements".to_string() } else { format!("{}.{}", chunk.schema, chunk.table) };
                on_phase("data", i + 1, total, &place);
                let mut sp = Savepoint { db, name: "transfer_row", in_txn };
                let (_, failed) = apply_chunk_resiliently(&mut sp, &chunk.sql).await?;
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
                failed_rows += failed.len();
            }
            if failed_rows > 0 {
                warnings.push(format!("{failed_rows} row(s) could not be imported and were skipped — see warnings above."));
            }
            skipped_rows = failed_rows as i64;
            Ok(())
        }
        .await;
        let mut enable_err = None;
        for (s, t) in &trigger_tables {
            if let Err(e) = guarded(db, "transfer_trig", in_txn, &format!("ALTER TABLE {} ENABLE TRIGGER USER", qualified_table(s, t))).await {
                enable_err.get_or_insert(e);
            }
        }
        data?;
        if let Some(e) = enable_err {
            return Err(e);
        }
        warnings.push(
            "Row triggers were disabled during data import and re-enabled after; derived rows come from migrated data, not trigger side effects."
                .into(),
        );
        Ok(())
    }
    .await;

    if let Some(pid) = pid {
        let result = match result {
            Ok(()) => match backend_pid(db).await {
                Ok(now) if now == pid => exec(db, "COMMIT;").await,
                Ok(_) => Err(anyhow!("The destination connection was lost mid-transfer; nothing was committed.")),
                Err(e) => Err(e),
            },
            Err(e) => Err(e),
        };
        if let Err(e) = result {
            let _ = exec(db, "ROLLBACK;").await;
            return Err(e);
        }
    } else {
        result?;
    }
    Ok((warnings, skipped_rows))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn supabase_helpers() {
        assert!(is_supabase_excluded_schema("auth"));
        assert!(is_supabase_excluded_schema("pg_toast"));
        assert!(is_supabase_excluded_schema("_timescaledb_internal"));
        assert!(!is_supabase_excluded_schema("public"));
        assert!(is_likely_supabase_connection("postgres://u:p@db.abc.supabase.co:5432/postgres"));
        assert!(is_likely_supabase_connection("supabase-mgmt://ref"));
        assert_eq!(strip_rexadb_params("postgres://u@h/db?rexadb_ssh_mode=x&sslmode=require"), "postgres://u@h/db?sslmode=require");
        assert!(!is_direct_dialable_postgres("supabase-mgmt://x"));
    }

    #[test]
    fn supabase_transforms() {
        let out = apply_supabase_dump_transforms("CREATE SCHEMA \"x\";\nCOMMENT ON EXTENSION foo IS 'x';\nGRANT ALL ON SCHEMA \"auth\" TO anon;", "auth|storage");
        assert!(out.contains("CREATE SCHEMA IF NOT EXISTS \"x\""));
        assert!(out.contains("-- COMMENT ON EXTENSION"));
        assert!(out.contains("-- GRANT ALL ON SCHEMA \"auth\""));
    }
}
