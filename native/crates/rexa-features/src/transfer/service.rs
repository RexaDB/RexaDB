//! Port of lib/transfer/transfer-service.ts (orchestration, stats, warning
//! collapsing, package export) and server/transfer-api.ts (background jobs
//! with pollable progress, one running transfer per destination).

use super::adapters::{Adapter, Endpoint};
use super::types::*;
use regex::Regex;
use std::collections::HashMap;
use std::sync::{Arc, LazyLock, Mutex};

pub const TRANSFER_VERSION: &str = "1.0.0";

/// Shared progress sink (`options.onProgress`). The UI polls it.
pub type ProgressSink = Arc<dyn Fn(TransferProgress) + Send + Sync>;

struct Ctx {
    sink: ProgressSink,
    total: usize,
}

impl Ctx {
    fn update(&self, step: TransferStep, index: usize, pct: Option<u32>, message: impl Into<String>, item: Option<String>) {
        let percentage = pct.unwrap_or_else(|| ((index as f64 / self.total as f64) * 100.0).round() as u32);
        (self.sink)(TransferProgress { current_step: step, total_steps: self.total, current_step_index: index, percentage, message: message.into(), item, error: None });
    }
}

/// `TransferService.collapseWarnings`
pub fn collapse_warnings(warnings: &[String]) -> Vec<String> {
    static SQ: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"'[^']*'").unwrap());
    static DQ: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#""[^"]*""#).unwrap());
    static NUM: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\b\d[\d,]*(?:\.\d+)?\b").unwrap());
    let key_of = |w: &str| NUM.replace_all(&DQ.replace_all(&SQ.replace_all(w, "'$$'"), "\"$$\""), "#").into_owned();
    let mut order: Vec<String> = Vec::new();
    let mut groups: HashMap<String, (String, usize)> = HashMap::new();
    for w in warnings {
        let k = key_of(w);
        match groups.get_mut(&k) {
            Some(g) => g.1 += 1,
            None => {
                order.push(k.clone());
                groups.insert(k, (w.clone(), 1));
            }
        }
    }
    let mut out = Vec::new();
    let mut shown = 0;
    for k in order.iter().take(25) {
        let (sample, count) = &groups[k];
        shown += count;
        out.push(if *count > 1 { format!("{sample} (×{count})") } else { sample.clone() });
    }
    if shown < warnings.len() {
        out.push(format!("+{} more — see server log.", warnings.len() - shown));
    }
    out
}

fn calculate_stats(p: &TransferPackage) -> TransferStats {
    TransferStats {
        tables_transferred: p.database.as_ref().map_or(0, |d| d.tables.len() as i64),
        rows_transferred: p.database.as_ref().map_or(0, |d| d.exported_total()),
        storage_buckets_transferred: p.storage.as_ref().map_or(0, |s| s.buckets.len() as i64),
        storage_files_transferred: p.storage.as_ref().map_or(0, |s| s.files.len() as i64),
        auth_users_transferred: p.auth.as_ref().map_or(0, |a| a.users.len() as i64),
        auth_providers_transferred: p.auth.as_ref().map_or(0, |a| a.providers.len() as i64),
        functions_transferred: p.functions.as_ref().map_or(0, |f| f.functions.len() as i64),
    }
}

fn collect_warnings(p: &TransferPackage) -> Vec<String> {
    let mut w = Vec::new();
    if let Some(d) = &p.database {
        w.extend(d.warnings.iter().cloned());
    }
    if let Some(s) = &p.storage {
        w.extend(s.warnings.iter().cloned());
    }
    if let Some(a) = &p.auth {
        w.extend(a.warnings.iter().cloned());
    }
    if let Some(f) = &p.functions {
        w.extend(f.warnings.iter().cloned());
    }
    w
}

/// `exportFromSource`
async fn export_from_source(adapter: Adapter, src: &Endpoint, o: &TransferOptions, ctx: &Ctx) -> anyhow::Result<TransferPackage> {
    let mut pkg = TransferPackage {
        version: TRANSFER_VERSION.into(),
        exported_at: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        source_provider: src.provider,
        source_project_id: None,
        database: None,
        storage: None,
        auth: None,
        settings: None,
        functions: None,
    };
    let mut i = 1;
    if o.include_database {
        ctx.update(TransferStep::ExportingSchema, i, None, "Phase 1 of 2 — exporting database schema...", None);
        let idx = i;
        let on_item = |step: TransferStep, item: &str, n: usize, total: usize| {
            let suffix = if total > 1 { format!(" ({n}/{total})") } else { String::new() };
            ctx.update(step, idx, None, format!("Phase 1 of 2 — exporting database — {item}{suffix}"), Some(item.to_string()));
        };
        pkg.database = Some(adapter.export_database(src, &on_item).await?);
        i += 1;
    }
    if o.include_storage {
        ctx.update(TransferStep::ExportingStorage, i, None, "Phase 1 of 2 — exporting storage buckets and files...", None);
        pkg.storage = adapter.export_storage(src).await;
        i += 1;
    }
    if o.include_auth {
        ctx.update(TransferStep::ExportingAuth, i, None, "Phase 1 of 2 — exporting authentication data...", None);
        pkg.auth = adapter.export_auth(src).await;
        i += 1;
    }
    if o.include_settings {
        ctx.update(TransferStep::ExportingSettings, i, None, "Phase 1 of 2 — exporting project settings...", None);
        pkg.settings = adapter.export_settings(src).await;
        i += 1;
    }
    if o.include_edge_functions {
        ctx.update(TransferStep::ExportingFunctions, i, None, "Phase 1 of 2 — exporting edge functions...", None);
        pkg.functions = adapter.export_functions(src).await;
    }
    Ok(pkg)
}

/// `importToDestination` → (warnings, stats patch).
async fn import_to_destination(adapter: Adapter, dst: &Endpoint, pkg: &TransferPackage, o: &TransferOptions, ctx: &Ctx) -> anyhow::Result<(Vec<String>, StatsPatch)> {
    let mut warnings = Vec::new();
    let mut stats = StatsPatch::default();
    let mut i = ctx.total / 2;
    let dest = dst.provider.as_str();
    if let (Some(db), true) = (&pkg.database, o.include_database) {
        ctx.update(TransferStep::ImportingSchema, i, None, "Phase 2 of 2 — importing database schema...", None);
        let idx = i;
        let on_item = |step: TransferStep, item: &str, n: usize, total: usize| {
            let suffix = if total > 1 { format!(" ({n}/{total})") } else { String::new() };
            ctx.update(step, idx, None, format!("Phase 2 of 2 — {item}{suffix}"), Some(item.to_string()));
        };
        let out = adapter.import_database(dst, db, &on_item).await?;
        warnings.extend(out.warnings);
        stats.merge(out.stats);
        i += 1;
    }
    if let (Some(st), true) = (&pkg.storage, o.include_storage) {
        ctx.update(TransferStep::ImportingStorage, i, None, "Phase 2 of 2 — importing storage buckets and files...", None);
        match adapter.import_storage(dst, st).await {
            Some(out) => {
                warnings.extend(out.warnings);
                stats.merge(out.stats);
                i += 1;
            }
            None if !st.buckets.is_empty() || !st.files.is_empty() => {
                warnings.push(format!(
                    "Storage not transferred: {} bucket(s) and {} file(s) were exported, but the {dest} destination has no Supabase-compatible storage schema — they were skipped, not imported. Ordinary tables migrate with the database transfer.",
                    st.buckets.len(),
                    st.files.len()
                ));
                stats.storage_buckets_transferred = Some(0);
                stats.storage_files_transferred = Some(0);
            }
            None => {}
        }
    }
    if let (Some(a), true) = (&pkg.auth, o.include_auth) {
        ctx.update(TransferStep::ImportingAuth, i, None, "Phase 2 of 2 — importing authentication data...", None);
        match adapter.import_auth(dst, a).await {
            Some(out) => {
                warnings.extend(out.warnings);
                stats.merge(out.stats);
                i += 1;
            }
            None if !a.users.is_empty() || !a.providers.is_empty() => {
                warnings.push(format!(
                    "Auth not transferred: {} user(s) and {} provider(s) were exported, but the {dest} destination has no GoTrue-compatible auth schema — they were skipped, not imported. Neon Auth lives in neon_auth tables and migrates with the database transfer.",
                    a.users.len(),
                    a.providers.len()
                ));
                stats.auth_users_transferred = Some(0);
                stats.auth_providers_transferred = Some(0);
            }
            None => {}
        }
    }
    if let (Some(s), true) = (&pkg.settings, o.include_settings) {
        ctx.update(TransferStep::ImportingSettings, i, None, "Phase 2 of 2 — importing project settings...", None);
        match adapter.import_settings(dst, s).await {
            Some(out) => {
                warnings.extend(out.warnings);
                stats.merge(out.stats);
                i += 1;
            }
            None => warnings.push(format!("Settings not transferred: the {dest} destination has no settings import support.")),
        }
    }
    if let (Some(f), true) = (&pkg.functions, o.include_edge_functions) {
        ctx.update(TransferStep::ImportingFunctions, i, None, "Phase 2 of 2 — importing edge functions...", None);
        match adapter.import_functions(dst, f, o).await {
            Some(out) => {
                warnings.extend(out.warnings);
                stats.merge(out.stats);
            }
            None if !f.functions.is_empty() => {
                warnings.push(format!(
                    "Edge functions not transferred: {} function(s) exported, but the {dest} destination has no functions import support — sources preserved in the package; deploy manually.",
                    f.functions.len()
                ));
                stats.functions_transferred = Some(0);
            }
            None => {}
        }
    }
    Ok((warnings, stats))
}

/// `transferProjectEffect` → (result, package for the compat diffs).
pub async fn transfer_project(src: &Endpoint, dst: &Endpoint, o: &TransferOptions, sink: ProgressSink) -> TransferResult {
    let fail = |e: String| TransferResult { success: false, error: Some(e), ..Default::default() };
    let Some(sa) = Adapter::for_provider(src.provider) else { return fail(format!("No adapter found for source provider: {}", src.provider.as_str())) };
    let Some(da) = Adapter::for_provider(dst.provider) else { return fail(format!("No adapter found for destination provider: {}", dst.provider.as_str())) };
    let steps = transfer_steps(o);
    let ctx = Ctx { sink: sink.clone(), total: steps.len() };
    ctx.update(TransferStep::Validating, 0, Some(0), "Validating source connection...", None);
    if !sa.validate_connection(src).await {
        return fail("Source connection validation failed".into());
    }
    ctx.update(TransferStep::Validating, 0, Some(5), "Validating destination connection...", None);
    if !da.validate_connection(dst).await {
        return fail("Destination connection validation failed".into());
    }
    let run = async {
        let pkg = export_from_source(sa, src, o, &ctx).await?;
        let (iw, patch) = import_to_destination(da, dst, &pkg, o, &ctx).await?;
        anyhow::Ok((pkg, iw, patch))
    };
    match run.await {
        Ok((pkg, iw, patch)) => {
            let mut stats = calculate_stats(&pkg);
            patch.apply(&mut stats);
            let mut all = collect_warnings(&pkg);
            all.extend(iw);
            let warnings = collapse_warnings(&all);
            ctx.update(TransferStep::Complete, ctx.total - 1, Some(100), "Transfer completed successfully", None);
            let function_diffs = pkg
                .functions
                .iter()
                .flat_map(|f| f.functions.iter())
                .flat_map(|f| {
                    f.diffs.iter().map(|d| FunctionDiffView {
                        slug: f.slug.clone(),
                        target_provider: d.target_provider.as_str().into(),
                        diff: if d.diff.chars().count() > 6000 {
                            format!("{}\n… (truncated — full diff in exported package)", d.diff.chars().take(6000).collect::<String>())
                        } else {
                            d.diff.clone()
                        },
                        notes: d.notes.clone(),
                    })
                })
                .collect();
            TransferResult { success: true, stats: Some(stats), warnings, error: None, function_diffs }
        }
        Err(e) => {
            let msg = format!("{e:#}");
            let last = *steps.last().unwrap_or(&TransferStep::Complete);
            (sink)(TransferProgress {
                current_step: last,
                total_steps: ctx.total,
                current_step_index: ctx.total - 1,
                percentage: 0,
                message: "Transfer failed".into(),
                item: None,
                error: Some(msg.clone()),
            });
            fail(msg)
        }
    }
}

/// `exportPackageEffect` → pretty JSON.
pub async fn export_package(src: &Endpoint, o: &TransferOptions) -> anyhow::Result<String> {
    let adapter = Adapter::for_provider(src.provider).ok_or_else(|| anyhow::anyhow!("No adapter found for provider: {}", src.provider.as_str()))?;
    let steps = transfer_steps(o);
    let ctx = Ctx { sink: Arc::new(|_| {}), total: steps.len() };
    let pkg = export_from_source(adapter, src, o, &ctx).await?;
    Ok(serde_json::to_string_pretty(&pkg)?)
}

// ---- jobs (server/transfer-api.ts) -------------------------------------------

/// `activeByDestination`: one running transfer per destination.
static ACTIVE: LazyLock<Mutex<HashMap<String, String>>> = LazyLock::new(Default::default);

/// Claim the destination lock; `Err` = the clash message.
pub fn claim_destination(destination: &str, transfer_id: &str) -> Result<(), String> {
    let mut active = ACTIVE.lock().unwrap();
    if let Some(clash) = active.get(destination) {
        return Err(format!(
            "Another transfer to this destination is already running ({clash}). Wait for it to finish before starting a new one — concurrent imports would corrupt the destination."
        ));
    }
    active.insert(destination.to_string(), transfer_id.to_string());
    Ok(())
}

pub fn release_destination(destination: &str, transfer_id: &str) {
    let mut active = ACTIVE.lock().unwrap();
    if active.get(destination).is_some_and(|id| id == transfer_id) {
        active.remove(destination);
    }
}

pub fn new_transfer_id() -> String {
    let nanos = chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default();
    format!("transfer_{}_{:x}", chrono::Utc::now().timestamp_millis(), (nanos as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15) >> 36)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn collapses_repetitive_warnings() {
        let w: Vec<String> = (0..30).map(|i| format!("Row skipped in public.t{i} (dup 'x{i}')")).chain(["Other".to_string()]).collect();
        let out = collapse_warnings(&w);
        assert_eq!(out.len(), 30.min(26));
        let w2 = vec!["Row skipped in 'a' 12".to_string(), "Row skipped in 'b' 13".to_string(), "x".to_string()];
        assert_eq!(collapse_warnings(&w2), vec!["Row skipped in 'a' 12 (×2)".to_string(), "x".to_string()]);
    }

    /// Live round trip between two throwaway local databases:
    /// `REXA_TRANSFER_PG_SRC=postgres://…/rexa_transfer_src REXA_TRANSFER_PG_DST=… cargo test -p rexa-features live_postgres_transfer`.
    #[test]
    fn live_postgres_transfer() {
        let (Ok(src), Ok(dst)) = (std::env::var("REXA_TRANSFER_PG_SRC"), std::env::var("REXA_TRANSFER_PG_DST")) else { return };
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let s = Endpoint { provider: ProviderType::Postgres, db: rexa_drivers::connect_detect("postgres", &src).await.unwrap(), connection_string: src };
            let d = Endpoint { provider: ProviderType::Postgres, db: rexa_drivers::connect_detect("postgres", &dst).await.unwrap(), connection_string: dst.clone() };
            let log: Arc<Mutex<Vec<TransferProgress>>> = Default::default();
            let l = log.clone();
            let sink: ProgressSink = Arc::new(move |p| l.lock().unwrap().push(p));
            let r = transfer_project(&s, &d, &TransferOptions::default(), sink).await;
            assert!(r.success, "{:?}", r.error);
            eprintln!("stats={:?}\nwarnings={:#?}", r.stats, r.warnings);
            assert_eq!(r.stats.as_ref().unwrap().rows_transferred, 4);
            let notes = super::super::sql::select(&d.db, "SELECT note FROM app.child ORDER BY id").await.unwrap();
            assert_eq!(notes.iter().map(|r| r.string("note")).collect::<Vec<_>>(), vec!["hello", "-- not a comment"]);
            let p = super::super::sql::select(&d.db, "SELECT name, tags::text, encode(blob,'hex') AS b, meta->>'k' AS k, mood::text, total FROM public.parent ORDER BY id").await.unwrap();
            assert_eq!(p[0].string("name"), "a;b");
            assert_eq!(p[0].string("tags"), "{x,\"y,z\"}");
            assert_eq!(p[0].string("b"), "00ff");
            assert_eq!(p[0].string("k"), "it's");
            assert_eq!(p[1].string("total"), "4");
            assert!(log.lock().unwrap().iter().any(|p| p.current_step == TransferStep::ImportingData));
            // Second run (re-transfer) must be idempotent: drops + recreates.
            let r2 = transfer_project(&s, &d, &TransferOptions::default(), Arc::new(|_| {})).await;
            assert!(r2.success, "{:?}", r2.error);
            // SQL-introspection dump (non-dialable sources) applied through
            // both apply paths (pinned transactional + statement-by-statement).
            let schemas: Vec<String> = vec!["app".into(), "public".into()];
            let (dump, w) = super::super::schema_dump::build_schema_dump_via_sql(&s.db, &schemas).await;
            assert!(w.is_empty(), "{w:?}");
            let data = Adapter::Postgres.export_database(&s, &|_, _, _, _| {}).await.unwrap();
            let hook = |_: &str, _: usize, _: usize, _: &str| {};
            let (_, skipped) = super::super::apply::reset_and_apply_sql(&d.db, &dst, &dump, data.data_sql.as_deref(), &hook).await.unwrap();
            assert_eq!(skipped, 0);
            let drops = vec!["DROP SCHEMA IF EXISTS \"app\" CASCADE;".to_string(), "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;".to_string()];
            let (_, skipped) = super::super::schema_dump::apply_transfer_via_query(&d.db, &drops, &dump, data.data_sql.as_deref(), &hook).await.unwrap();
            assert_eq!(skipped, 0);
            let v = super::super::sql::select(&d.db, "SELECT count(*) AS n FROM app.v").await.unwrap();
            assert_eq!(v[0].string("n"), "2");
            let pol = super::super::sql::select(&d.db, "SELECT count(*) AS n FROM pg_policy").await.unwrap();
            assert_eq!(pol[0].string("n"), "1");
        });
    }

    #[test]
    fn generic_provider_has_no_adapter() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let dir = std::env::temp_dir().join(format!("rexa-transfer-{}.db", std::process::id()));
            let cs = format!("sqlite://{}", dir.display());
            let Ok(db) = rexa_drivers::connect_detect("sqlite", &cs).await else { return };
            let a = Endpoint { provider: ProviderType::Generic, db: db.clone(), connection_string: cs.clone() };
            let b = Endpoint { provider: ProviderType::Postgres, db, connection_string: cs };
            let r = transfer_project(&a, &b, &TransferOptions::default(), Arc::new(|_| {})).await;
            assert_eq!(r.error.as_deref(), Some("No adapter found for source provider: generic"));
            let _ = std::fs::remove_file(dir);
        });
    }

    #[test]
    fn destination_lock() {
        assert!(claim_destination("pg://d", "a").is_ok());
        assert!(claim_destination("pg://d", "b").is_err());
        release_destination("pg://d", "b");
        assert!(claim_destination("pg://d", "c").is_err());
        release_destination("pg://d", "a");
        assert!(claim_destination("pg://d", "c").is_ok());
    }
}
