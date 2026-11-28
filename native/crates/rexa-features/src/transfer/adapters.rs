//! Port of lib/transfer/adapters/{postgres,supabase,neon}-adapter.ts.
//!
//! The original's `ProviderAdapter` classes become one [`Adapter`] enum;
//! optional methods the original leaves *absent* (so the service reports a
//! "not transferred" warning) return `None` here.
//! Also ports the SQL halves of lib/studio/storage-utils.ts
//! (`fetchStorageBuckets` / `fetchStorageObjects`) and
//! lib/studio/auth/fetch.ts (`fetchAuthProviderConfigs`).

use super::apply::*;
use super::function_compat::build_compat_diffs;
use super::neon_cli::*;
use super::schema_dump::sanitize_extensions_for_destination;
use super::sql::*;
use super::supabase_api::*;
use super::types::*;
use base64::Engine;
use rexa_drivers::Record;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::time::Duration;

/// One side of a transfer: provider, the saved connection string (pointer
/// forms like supabase-mgmt:// / neon-cli:// carry API context) and a
/// dedicated driver.
pub struct Endpoint {
    pub provider: ProviderType,
    pub connection_string: String,
    pub db: Db,
}

pub type ItemHook<'a> = &'a (dyn Fn(TransferStep, &str, usize, usize) + Send + Sync);

#[derive(Clone, Copy, PartialEq)]
pub enum Adapter {
    Supabase,
    Neon,
    Postgres,
}

impl Adapter {
    /// `service.getAdapter(provider)` — generic has none.
    pub fn for_provider(p: ProviderType) -> Option<Adapter> {
        match p {
            ProviderType::Supabase => Some(Adapter::Supabase),
            ProviderType::Neon => Some(Adapter::Neon),
            ProviderType::Postgres => Some(Adapter::Postgres),
            ProviderType::Generic => None,
        }
    }

    pub async fn validate_connection(self, ep: &Endpoint) -> bool {
        exec(&ep.db, "SELECT 1").await.is_ok()
    }

    pub async fn export_database(self, ep: &Endpoint, on_item: ItemHook<'_>) -> anyhow::Result<DatabaseExport> {
        let schema_sql = run_pg_dump_schema_only(&ep.db, &ep.connection_string).await?;
        let not_in = if self == Adapter::Supabase { "'pg_catalog', 'information_schema', 'auth', 'storage', 'extensions'" } else { "'pg_catalog', 'information_schema'" };
        let tables_res = select(
            &ep.db,
            &format!(
                "SELECT table_name, table_schema
       FROM information_schema.tables
       WHERE table_schema NOT IN ({not_in})
         AND table_type = 'BASE TABLE'
       ORDER BY table_schema, table_name"
            ),
        )
        .await;
        let mut out = DatabaseExport { schema_sql, ..Default::default() };
        let mut exported = BTreeMap::new();
        let mut data_sql = String::new();
        if let Ok(rows) = tables_res {
            let total = rows.len();
            let mut skipped_system: Vec<String> = Vec::new();
            for row in rows {
                let (schema, table) = (row.string("table_schema"), row.string("table_name"));
                let full = format!("{schema}.{table}");
                if self == Adapter::Supabase && is_supabase_excluded_schema(&schema) {
                    if !skipped_system.contains(&schema) {
                        skipped_system.push(schema);
                    }
                    exported.insert(full, 0);
                    continue;
                }
                out.tables.push(full.clone());
                if let Ok(c) = select(&ep.db, &format!("SELECT COUNT(*) as count FROM {}", qualified_table(&schema, &table))).await {
                    out.row_counts.insert(full.clone(), c.first().and_then(|r| r.i64("count")).unwrap_or(0));
                }
                let e = export_table_data_sql(&ep.db, &schema, &table, out.row_counts.get(&full).copied().unwrap_or(0)).await;
                data_sql.push_str(&e.sql);
                exported.insert(full.clone(), e.exported_rows);
                on_item(TransferStep::ExportingSchema, &full, out.tables.len(), total);
                if let Some(m) = e.message {
                    out.warnings.push(m);
                }
            }
            if !skipped_system.is_empty() {
                skipped_system.sort();
                out.warnings.push(format!(
                    "Skipped row data for Supabase system schemas ({}): managed outside the transfer — schema is not migrated, so rows would have nowhere to land.",
                    skipped_system.join(", ")
                ));
            }
        }
        out.data_sql = (!data_sql.is_empty()).then_some(data_sql);
        out.exported_row_counts = Some(exported);
        Ok(out)
    }

    pub async fn import_database(self, ep: &Endpoint, data: &DatabaseExport, on_item: ItemHook<'_>) -> anyhow::Result<ImportOutcome> {
        let neon_skip = |ext: &str| {
            (ext == "pg_cron").then(|| "Neon only allows pg_cron in the postgres database; enable it there manually if scheduled jobs are needed".to_string())
        };
        let skip: Option<&(dyn Fn(&str) -> Option<String> + Send + Sync)> = if self == Adapter::Neon { Some(&neon_skip) } else { None };
        let (sql, mut warnings) = sanitize_extensions_for_destination(&ep.db, &data.schema_sql, skip).await;
        let hook = |phase: &str, i: usize, total: usize, label: &str| {
            on_item(if phase == "data" { TransferStep::ImportingData } else { TransferStep::ImportingSchema }, label, i, total)
        };
        let (w, skipped) = reset_and_apply_sql(&ep.db, &ep.connection_string, &sql, data.data_sql.as_deref(), &hook)
            .await
            .map_err(|e| if self == Adapter::Postgres { anyhow::anyhow!("Database import failed: {}", err_text(&e)) } else { e })?;
        warnings.extend(w);
        Ok(ImportOutcome { warnings, stats: StatsPatch { rows_transferred: Some((data.exported_total() - skipped).max(0)), ..Default::default() } })
    }

    pub async fn export_storage(self, ep: &Endpoint) -> Option<StorageExport> {
        Some(match self {
            Adapter::Postgres => StorageExport {
                warnings: vec!["Generic Postgres exposes no Supabase-compatible storage over SQL: nothing to export.".into()],
                ..Default::default()
            },
            Adapter::Supabase => supabase_export_storage(ep).await,
            Adapter::Neon => neon_export_storage(ep).await,
        })
    }

    /// `None` = the adapter has no importStorage (service warns).
    pub async fn import_storage(self, ep: &Endpoint, data: &StorageExport) -> Option<ImportOutcome> {
        match self {
            Adapter::Postgres => None,
            Adapter::Supabase => Some(supabase_import_storage(ep, data).await),
            Adapter::Neon => Some(neon_import_storage(ep, data).await),
        }
    }

    pub async fn export_auth(self, ep: &Endpoint) -> Option<AuthExport> {
        Some(match self {
            Adapter::Postgres => AuthExport { warnings: vec!["Generic Postgres has no GoTrue-compatible auth schema: nothing to export.".into()], ..Default::default() },
            Adapter::Neon => AuthExport {
                warnings: vec!["Neon Auth migrates with the database transfer (neon_auth tables); the Supabase-shaped auth export is empty.".into()],
                ..Default::default()
            },
            Adapter::Supabase => supabase_export_auth(ep).await,
        })
    }

    pub async fn import_auth(self, ep: &Endpoint, data: &AuthExport) -> Option<ImportOutcome> {
        match self {
            Adapter::Postgres => None,
            Adapter::Supabase => Some(supabase_import_auth(ep, data).await),
            Adapter::Neon => Some(neon_import_auth(ep, data).await),
        }
    }

    pub async fn export_settings(self, ep: &Endpoint) -> Option<SettingsExport> {
        let mut settings = serde_json::Map::new();
        match self {
            Adapter::Postgres => {
                if let Ok(rows) = select(
                    &ep.db,
                    "SELECT name, setting FROM pg_settings
         WHERE name IN ('server_version', 'timezone', 'standard_conforming_strings')
         LIMIT 10",
                )
                .await
                {
                    for r in rows {
                        settings.insert(r.string("name"), r.opt("setting").map_or(serde_json::Value::Null, serde_json::Value::String));
                    }
                }
            }
            Adapter::Neon => {
                if let Ok(rows) = select(&ep.db, "SELECT * FROM pg_settings WHERE name LIKE '%neon%' LIMIT 10").await {
                    for r in rows {
                        settings.insert(r.string("name"), r.opt("setting").map_or(serde_json::Value::Null, serde_json::Value::String));
                    }
                }
            }
            Adapter::Supabase => {
                let exists = select(&ep.db, "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'settings' LIMIT 1").await;
                if exists.is_ok_and(|r| !r.is_empty()) {
                    if let Ok(rows) = select(&ep.db, "SELECT * FROM public.settings LIMIT 1").await {
                        if let Some(r) = rows.first() {
                            for (c, v) in r.columns().iter().zip(r.cells()) {
                                settings.insert(c.clone(), v.as_str().map_or(serde_json::Value::Null, |s| serde_json::Value::String(s.into())));
                            }
                        }
                    }
                }
            }
        }
        Some(SettingsExport { project_settings: settings })
    }

    /// Every adapter has importSettings; none applies anything (the
    /// original only logs the setting count).
    pub async fn import_settings(self, _ep: &Endpoint, _data: &SettingsExport) -> Option<ImportOutcome> {
        Some(ImportOutcome::default())
    }

    pub async fn export_functions(self, ep: &Endpoint) -> Option<FunctionsExport> {
        Some(match self {
            Adapter::Postgres => FunctionsExport { warnings: vec!["Generic Postgres has no edge-functions platform: nothing to export.".into()], ..Default::default() },
            Adapter::Supabase => supabase_export_functions(ep).await,
            Adapter::Neon => neon_export_functions(ep).await,
        })
    }

    pub async fn import_functions(self, ep: &Endpoint, data: &FunctionsExport, opts: &TransferOptions) -> Option<ImportOutcome> {
        match self {
            Adapter::Postgres => None,
            Adapter::Supabase => Some(supabase_import_functions(ep, data, opts).await),
            Adapter::Neon => Some(neon_import_functions(ep, data, opts).await),
        }
    }
}

fn json_of(r: &Record, col: &str) -> serde_json::Value {
    r.get(col).and_then(|s| serde_json::from_str(s).ok()).unwrap_or(serde_json::Value::Object(Default::default()))
}

/// `tryQueries`
async fn try_queries(db: &Db, queries: &[String]) -> Result<Vec<Record>, String> {
    let mut last = String::new();
    for q in queries {
        match select(db, q).await {
            Ok(rows) => return Ok(rows),
            Err(e) => last = err_text(&e),
        }
    }
    Err(last)
}

async fn supabase_export_storage(ep: &Endpoint) -> StorageExport {
    let cols = "id, name, public, file_size_limit, allowed_mime_types, created_at, updated_at";
    let buckets = match try_queries(&ep.db, &[format!("SELECT {cols} FROM storage.buckets ORDER BY name"), "SELECT * FROM storage.buckets ORDER BY name".into()]).await {
        Ok(b) => b,
        Err(_) => return StorageExport::default(),
    };
    let mut warnings = Vec::new();
    let mut files = Vec::new();
    let (creds, cw) = resolve_supabase_api_creds(&ep.connection_string).await;
    warnings.extend(cw);
    let mut total = 0usize;
    let mut out_buckets = Vec::new();
    for b in &buckets {
        let (id, name) = (b.string("id"), b.string("name"));
        out_buckets.push(StorageBucket {
            id: id.clone(),
            name: name.clone(),
            public: b.bool("public"),
            file_size_limit: b.i64("file_size_limit"),
            allowed_mime_types: b.get("allowed_mime_types").map(|_| b.list("allowed_mime_types")),
        });
        let safe = name.replace('\'', "''");
        let where_ = format!("WHERE bucket_id = '{safe}' ORDER BY name");
        let objects = match try_queries(
            &ep.db,
            &[
                format!("SELECT id, name, bucket_id, owner, owner_id, created_at, updated_at, last_accessed_at, metadata FROM storage.objects {where_}"),
                format!("SELECT * FROM storage.objects {where_}"),
            ],
        )
        .await
        {
            Ok(o) => o,
            Err(e) => {
                warnings.push(format!("Failed to list objects for bucket {name}: {e}"));
                continue;
            }
        };
        for o in objects {
            let Some(path) = o.non_empty("name") else { continue };
            let metadata = o.get("metadata").and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok()).unwrap_or(serde_json::json!({}));
            let mut entry = StorageFile { bucket_id: id.clone(), path: path.clone(), size: metadata.get("size").and_then(|v| v.as_i64()), metadata, content_base64: None };
            if let Some(creds) = &creds {
                if total >= MAX_STORAGE_TOTAL_BYTES {
                    warnings.push(format!("Storage byte budget exceeded: {path} and remaining files migrate metadata-only."));
                } else if entry.size.is_some_and(|s| s as usize > MAX_STORAGE_FILE_BYTES) {
                    warnings.push(format!("Skipped {name}/{path}: size {} bytes exceeds per-file cap (metadata migrates).", entry.size.unwrap_or(0)));
                } else {
                    match download_storage_object(creds, &name, &path).await {
                        Ok(bytes) => {
                            total += bytes.len();
                            entry.size = Some(bytes.len() as i64);
                            entry.content_base64 = Some(base64::engine::general_purpose::STANDARD.encode(&bytes));
                        }
                        Err(e) if e == "not found" => {}
                        Err(e) => warnings.push(format!("Could not download {name}/{path}: {e} (metadata migrates).")),
                    }
                }
            }
            files.push(entry);
        }
    }
    if files.iter().any(|f| f.content_base64.is_some()) {
        warnings.push(format!(
            "Downloaded {:.1} MB of file contents from {}; files without contents migrate metadata-only.",
            total as f64 / 1024.0 / 1024.0,
            creds.as_ref().map_or("source", |c| c.project_ref.as_str())
        ));
    } else if !files.is_empty() {
        warnings.push(format!(
            "Storage export is metadata-only: {} file(s) recorded without contents (object bytes are not reachable over SQL{}). File contents will NOT migrate.",
            files.len(),
            if creds.is_some() { "" } else { " and no management token is available" }
        ));
    }
    StorageExport { buckets: out_buckets, files, warnings }
}

async fn supabase_import_storage(ep: &Endpoint, data: &StorageExport) -> ImportOutcome {
    let mut warnings = Vec::new();
    let (mut buckets_ok, mut files_ok) = (0, 0);
    for b in &data.buckets {
        let limit = b.file_size_limit.map_or("NULL".to_string(), |v| v.to_string());
        let mimes = escape_literal(&serde_json::to_string(&b.allowed_mime_types.clone().unwrap_or_default()).unwrap_or_else(|_| "[]".into()));
        let sql = format!(
            "INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
          VALUES ({}, {}, {}, {limit}, {mimes})
          ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            public = EXCLUDED.public,
            file_size_limit = EXCLUDED.file_size_limit,
            allowed_mime_types = EXCLUDED.allowed_mime_types;",
            escape_literal(&b.id),
            escape_literal(&b.name),
            b.public
        );
        match exec(&ep.db, &sql).await {
            Ok(()) => buckets_ok += 1,
            Err(e) => warnings.push(format!("Failed to create bucket {}: {}", b.name, err_text(&e))),
        }
    }
    let with_bytes: Vec<&StorageFile> = data.files.iter().filter(|f| f.content_base64.is_some()).collect();
    let metadata_only = data.files.len() - with_bytes.len();
    if !with_bytes.is_empty() {
        let (creds, cw) = resolve_supabase_api_creds(&ep.connection_string).await;
        match creds {
            None => warnings.push(format!(
                "{} file(s) carried contents but the destination has no management token{} — contents NOT uploaded.",
                with_bytes.len(),
                cw.map(|w| format!(" ({w})")).unwrap_or_default()
            )),
            Some(creds) => {
                for f in with_bytes {
                    let bytes = base64::engine::general_purpose::STANDARD.decode(f.content_base64.as_deref().unwrap_or("")).unwrap_or_default();
                    let mime = f.metadata.get("mimetype").and_then(|v| v.as_str());
                    match upload_storage_object(&creds, &f.bucket_id, &f.path, bytes, mime).await {
                        Ok(()) => files_ok += 1,
                        Err(e) => warnings.push(format!("Failed to upload {}/{}: {e} (bucket + metadata migrated).", f.bucket_id, f.path)),
                    }
                }
            }
        }
    }
    if metadata_only > 0 {
        warnings.push(format!(
            "{metadata_only} file(s) migrated metadata-only: contents were not in the export (unreachable over SQL or over budget) and were NOT copied."
        ));
    }
    ImportOutcome {
        warnings,
        stats: StatsPatch { storage_buckets_transferred: Some(buckets_ok), storage_files_transferred: Some(files_ok), ..Default::default() },
    }
}

async fn neon_export_storage(ep: &Endpoint) -> StorageExport {
    let mut warnings = Vec::new();
    let buckets = match list_neon_buckets(&ep.connection_string).await {
        Ok(b) => b,
        Err(e) => return StorageExport { warnings: vec![format!("Failed to list Neon buckets: {e}")], ..Default::default() },
    };
    let mut files = Vec::new();
    let mut total = 0usize;
    for b in &buckets {
        let keys = match list_neon_objects(&ep.connection_string, &b.name).await {
            Ok(k) => k,
            Err(e) => {
                warnings.push(format!("Failed to list objects for bucket {}: {e}", b.name));
                continue;
            }
        };
        for key in keys {
            let mut entry = StorageFile { bucket_id: b.name.clone(), path: key.clone(), metadata: serde_json::json!({}), ..Default::default() };
            if total >= MAX_STORAGE_TOTAL_BYTES {
                warnings.push(format!("Storage byte budget exceeded: {key} and remaining files migrate metadata-only."));
            } else {
                match download_neon_object(&ep.connection_string, &b.name, &key).await {
                    Ok(bytes) => {
                        total += bytes.len();
                        entry.size = Some(bytes.len() as i64);
                        entry.content_base64 = Some(base64::engine::general_purpose::STANDARD.encode(&bytes));
                    }
                    Err(e) => warnings.push(format!("Could not download {}/{key}: {e} (listed, contents skipped).", b.name)),
                }
            }
            files.push(entry);
        }
    }
    if buckets.is_empty() {
        warnings.push("No Neon Object Storage buckets found on this branch.".into());
    }
    StorageExport {
        buckets: buckets
            .iter()
            .map(|b| StorageBucket { id: b.name.clone(), name: b.name.clone(), public: b.access_level.as_deref() == Some("public_read"), file_size_limit: None, allowed_mime_types: None })
            .collect(),
        files,
        warnings,
    }
}

async fn neon_import_storage(ep: &Endpoint, data: &StorageExport) -> ImportOutcome {
    let mut warnings = Vec::new();
    let (mut buckets_ok, mut files_ok) = (0, 0);
    let mut name_map: HashMap<String, String> = HashMap::new();
    let mut used: HashSet<String> = HashSet::new();
    for b in &data.buckets {
        let (sanitized, renamed) = sanitize_bucket_name(&b.name);
        let mut dest = sanitized.clone();
        if used.contains(&dest) {
            let base: String = sanitized.chars().take(60).collect();
            let mut n = 2;
            while used.contains(&format!("{base}-{n}")) {
                n += 1;
            }
            dest = format!("{base}-{n}");
            warnings.push(format!("Bucket {} collides after sanitize — using {dest} instead.", b.name));
        }
        used.insert(dest.clone());
        name_map.insert(b.id.clone(), dest.clone());
        if renamed && dest == sanitized {
            warnings.push(format!("Bucket {} renamed to {dest} (S3 naming rules).", b.name));
        }
        match ensure_neon_bucket(&ep.connection_string, &dest, b.public).await {
            Ok(()) => buckets_ok += 1,
            Err(e) => warnings.push(format!("Failed to create bucket {dest}: {e}")),
        }
    }
    let with_bytes: Vec<&StorageFile> = data.files.iter().filter(|f| f.content_base64.is_some()).collect();
    let metadata_only = data.files.len() - with_bytes.len();
    for f in with_bytes {
        let dest = name_map.get(&f.bucket_id).cloned().unwrap_or_else(|| sanitize_bucket_name(&f.bucket_id).0);
        let bytes = base64::engine::general_purpose::STANDARD.decode(f.content_base64.as_deref().unwrap_or("")).unwrap_or_default();
        match upload_neon_object(&ep.connection_string, &dest, &f.path, &bytes, f.metadata.get("mimetype").and_then(|v| v.as_str())).await {
            Ok(()) => files_ok += 1,
            Err(e) => warnings.push(format!("Failed to upload {dest}/{}: {e} (bucket migrated, contents skipped).", f.path)),
        }
    }
    if metadata_only > 0 {
        warnings.push(format!("{metadata_only} file(s) migrated metadata-only: contents were not in the export and were NOT copied."));
    }
    ImportOutcome {
        warnings,
        stats: StatsPatch { storage_buckets_transferred: Some(buckets_ok), storage_files_transferred: Some(files_ok), ..Default::default() },
    }
}

/// Paginated `fetchAll` → (rows, complete, error).
async fn fetch_all(db: &Db, base: &str, batch: usize) -> (Vec<Record>, bool, String) {
    let mut all = Vec::new();
    for page in 0..200 {
        match select(db, &format!("{base} ORDER BY id LIMIT {batch} OFFSET {}", page * batch)).await {
            Err(e) => return (all, false, err_text(&e)),
            Ok(rows) => {
                let n = rows.len();
                all.extend(rows);
                if n < batch {
                    return (all, true, String::new());
                }
            }
        }
    }
    (all, false, "safety cap reached".into())
}

async fn supabase_export_auth(ep: &Endpoint) -> AuthExport {
    let mut out = AuthExport::default();
    let (mut rows, complete, error) =
        fetch_all(&ep.db, "SELECT id, email, email_confirmed_at, created_at, updated_at, raw_user_meta_data, encrypted_password FROM auth.users", 1000).await;
    let mut passwordless = false;
    if !complete && rows.is_empty() {
        let (fallback, fc, fe) = fetch_all(&ep.db, "SELECT id, email, email_confirmed_at, created_at, updated_at, raw_user_meta_data FROM auth.users", 1000).await;
        rows = fallback;
        passwordless = true;
        out.warnings.push(if !fc {
            format!("Auth user export incomplete after {} user(s): {fe}", rows.len())
        } else {
            "Password hashes are not readable with this connection: users migrate metadata-only and must reset passwords to sign in.".into()
        });
    } else if !complete {
        out.warnings.push(if error == "safety cap reached" {
            "Auth export hit the 200,000-user safety cap; remaining users were not exported.".into()
        } else {
            format!("Auth user export incomplete after {} user(s): {error}; remaining accounts were omitted.", rows.len())
        });
    }
    for r in rows {
        out.users.push(AuthUser {
            id: r.string("id"),
            email: r.string("email"),
            email_confirmed_at: r.opt("email_confirmed_at"),
            created_at: r.string("created_at"),
            updated_at: r.string("updated_at"),
            raw_user_meta_data: json_of(&r, "raw_user_meta_data"),
            encrypted_password: if passwordless { None } else { r.opt("encrypted_password") },
        });
    }
    let (ids, complete, error) = fetch_all(&ep.db, "SELECT id, user_id, provider, provider_id, identity_data, created_at, updated_at FROM auth.identities", 2000).await;
    let n_ids = ids.len();
    for r in ids {
        out.identities.push(AuthIdentity {
            id: r.string("id"),
            user_id: r.string("user_id"),
            provider: r.string("provider"),
            provider_id: r.opt("provider_id"),
            identity_data: json_of(&r, "identity_data"),
            created_at: r.opt("created_at"),
            updated_at: r.opt("updated_at"),
        });
    }
    if !complete {
        out.warnings.push(format!("Auth identity export incomplete after {n_ids} identit(ies): {error}; some sign-in links were omitted."));
    }
    if let Ok(rows) = select(&ep.db, "SELECT * FROM auth.custom_oauth_providers ORDER BY name;").await {
        for r in rows {
            out.providers.push(AuthProvider { id: r.string("id"), name: r.string("name"), provider: r.string("provider_type"), secret: r.string("client_secret") });
        }
    }
    match select(
        &ep.db,
        "SELECT n.nspname AS schema, c.relname AS table_name, p.polname AS name,
        CASE p.polcmd WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT' WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE' ELSE 'ALL' END AS cmd,
        COALESCE((SELECT string_agg(quote_ident(r.rolname), ', ') FROM pg_roles r WHERE r.oid = ANY (p.polroles)), 'PUBLIC') AS roles,
        pg_get_expr(p.polqual, p.polrelid) AS qual,
        pg_get_expr(p.polwithcheck, p.polrelid) AS with_check
 FROM pg_policy p
 JOIN pg_class c ON c.oid = p.polrelid
 JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
 LIMIT 500",
    )
    .await
    {
        Ok(rows) => {
            for r in rows {
                let (schema, table, name) = (r.string("schema"), r.string("table_name"), r.string("name"));
                let mut def = format!("CREATE POLICY {name} ON {schema}.{table} FOR {} TO {}", r.string("cmd"), r.string("roles"));
                if let Some(q) = r.opt("qual") {
                    def.push_str(&format!(" USING ({q})"));
                }
                if let Some(w) = r.opt("with_check") {
                    def.push_str(&format!(" WITH CHECK ({w})"));
                }
                out.policies.push(AuthPolicy { id: format!("{schema}.{table}.{name}"), name, schema, table, definition: def });
            }
        }
        Err(e) => out.warnings.push(format!("RLS policy export skipped: {} (policies in the schema dump still migrate).", err_text(&e))),
    }
    out
}

async fn supabase_import_auth(ep: &Endpoint, data: &AuthExport) -> ImportOutcome {
    let mut warnings = Vec::new();
    let mut vouched: HashSet<String> = HashSet::new();
    let (mut users_ok, mut providers_ok) = (0, 0);
    for u in &data.users {
        let confirmed = u.email_confirmed_at.as_deref().map_or("NULL".into(), escape_literal);
        let meta = escape_literal(&serde_json::to_string(&u.raw_user_meta_data).unwrap_or_else(|_| "{}".into()));
        let attempt = |with_pw: bool| {
            let (cols, vals) = {
                let mut cols = "id, email, email_confirmed_at, created_at, updated_at, raw_user_meta_data".to_string();
                let mut vals = format!(
                    "{}, {}, {confirmed}, {}, {}, {meta}",
                    escape_literal(&u.id),
                    escape_literal(&u.email),
                    escape_literal(&u.created_at),
                    escape_literal(&u.updated_at)
                );
                if let (true, Some(pw)) = (with_pw, &u.encrypted_password) {
                    cols.push_str(", encrypted_password");
                    vals.push_str(&format!(", {}", escape_literal(pw)));
                }
                (cols, vals)
            };
            let db = ep.db.clone();
            async move {
                let rows = select(&db, &format!("INSERT INTO auth.users ({cols})\n VALUES ({vals})\n ON CONFLICT (id) DO NOTHING\n RETURNING id;")).await?;
                anyhow::Ok(!rows.is_empty())
            }
        };
        let check_existing = || async {
            let existing = select(&ep.db, &format!("SELECT email FROM auth.users WHERE id = {} LIMIT 1;", escape_literal(&u.id))).await;
            existing.ok().and_then(|r| r.first().map(|r| r.string("email"))).unwrap_or_default()
        };
        let result = match attempt(true).await {
            Ok(inserted) => Ok(inserted),
            Err(first) => {
                if u.encrypted_password.is_some() {
                    match attempt(false).await {
                        Ok(inserted) => {
                            if inserted {
                                warnings.push(format!("User {} migrated without password hash (destination rejected it); password reset required.", u.email));
                            }
                            Ok(inserted)
                        }
                        Err(e) => Err(e),
                    }
                } else {
                    Err(first)
                }
            }
        };
        match result {
            Ok(true) => {
                vouched.insert(u.id.clone());
                users_ok += 1;
            }
            Ok(false) => {
                let existing = check_existing().await;
                if !existing.is_empty() && existing.eq_ignore_ascii_case(&u.email) {
                    vouched.insert(u.id.clone());
                    users_ok += 1;
                } else {
                    warnings.push(format!(
                        "User {} not imported: id {} already belongs to a different destination account ({}); skipped to avoid hijacking it.",
                        u.email,
                        u.id,
                        if existing.is_empty() { "unknown" } else { &existing }
                    ));
                }
            }
            Err(e) => warnings.push(format!("Failed to import user {}: {}", u.email, err_text(&e))),
        }
    }
    for i in &data.identities {
        if !vouched.contains(&i.user_id) {
            warnings.push(format!("Identity for user {} not linked: its account was not imported by this transfer.", i.user_id));
            continue;
        }
        let sql = format!(
            "INSERT INTO auth.identities (id, user_id, provider, provider_id, identity_data, created_at, updated_at)
   VALUES ({}, {}, {}, {}, {}, {}, {})
   ON CONFLICT (id) DO NOTHING;",
            escape_literal(&i.id),
            escape_literal(&i.user_id),
            escape_literal(&i.provider),
            i.provider_id.as_deref().map_or("NULL".into(), escape_literal),
            escape_literal(&serde_json::to_string(&i.identity_data).unwrap_or_else(|_| "{}".into())),
            i.created_at.as_deref().map_or("NOW()".into(), escape_literal),
            i.updated_at.as_deref().map_or("NOW()".into(), escape_literal)
        );
        if let Err(e) = exec(&ep.db, &sql).await {
            warnings.push(format!("Failed to import identity for user {}: {}", i.user_id, err_text(&e)));
        }
    }
    for p in &data.providers {
        let sql = format!(
            "INSERT INTO auth.custom_oauth_providers (id, name, provider_type, client_secret)
  VALUES ({}, {}, {}, {})
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    provider_type = EXCLUDED.provider_type,
    client_secret = EXCLUDED.client_secret;",
            escape_literal(&p.id),
            escape_literal(&p.name),
            escape_literal(&p.provider),
            escape_literal(&p.secret)
        );
        match exec(&ep.db, &sql).await {
            Ok(()) => providers_ok += 1,
            Err(e) => warnings.push(format!("Failed to import provider {}: {}", p.name, err_text(&e))),
        }
    }
    ImportOutcome {
        warnings,
        stats: StatsPatch { auth_users_transferred: Some(users_ok), auth_providers_transferred: Some(providers_ok), ..Default::default() },
    }
}

async fn neon_import_auth(ep: &Endpoint, data: &AuthExport) -> ImportOutcome {
    let mut warnings = Vec::new();
    let zero = StatsPatch { auth_users_transferred: Some(0), auth_providers_transferred: Some(0), ..Default::default() };
    let cols: HashSet<String> = match select(&ep.db, "SELECT column_name FROM information_schema.columns WHERE table_schema = 'neon_auth' AND table_name = 'user'").await {
        Ok(rows) if !rows.is_empty() => rows.iter().map(|r| r.string("column_name")).collect(),
        _ => {
            if !data.users.is_empty() || !data.providers.is_empty() {
                warnings.push(format!(
                    "Auth not transferred: {} user(s) exported, but this Neon project has no neon_auth schema (Neon Auth not provisioned) — skipped, not imported.",
                    data.users.len()
                ));
            }
            return ImportOutcome { warnings, stats: zero };
        }
    };
    let mut users_ok = 0;
    for u in &data.users {
        let mut pairs: Vec<(String, String)> = Vec::new();
        let mut put = |c: &str, v: String| {
            if cols.contains(c) {
                pairs.push((c.to_string(), v));
            }
        };
        put("id", escape_literal(&u.id));
        put("email", escape_literal(&u.email));
        if let Some(name) = u.raw_user_meta_data.get("name").or_else(|| u.raw_user_meta_data.get("full_name")).and_then(|v| v.as_str()).filter(|s| !s.is_empty()) {
            put("name", escape_literal(name));
        }
        put("emailVerified", if u.email_confirmed_at.is_some() { "TRUE".into() } else { "FALSE".into() });
        put("createdAt", escape_literal(&u.created_at));
        put("updatedAt", escape_literal(&u.updated_at));
        if pairs.len() < 2 {
            warnings.push(format!("User {}: neon_auth.user has no recognizable columns; skipped.", u.email));
            continue;
        }
        let sql = format!(
            "INSERT INTO \"neon_auth\".\"user\" ({}) VALUES ({}) ON CONFLICT DO NOTHING;",
            pairs.iter().map(|(c, _)| escape_ident(c)).collect::<Vec<_>>().join(", "),
            pairs.iter().map(|(_, v)| v.as_str()).collect::<Vec<_>>().join(", ")
        );
        match exec(&ep.db, &sql).await {
            Ok(()) => {
                users_ok += 1;
                if u.encrypted_password.is_some() {
                    warnings.push(format!("User {}: password hash cannot transfer (Supabase bcrypt vs Neon scrypt) — password reset required.", u.email));
                }
            }
            Err(e) => warnings.push(format!("User {}: {}", u.email, err_text(&e))),
        }
    }
    if !data.providers.is_empty() {
        warnings.push(format!(
            "{} OAuth provider config(s) not transferred: Neon Auth provider setup lives outside SQL — configure providers in the Neon console.",
            data.providers.len()
        ));
    }
    ImportOutcome { warnings, stats: StatsPatch { auth_users_transferred: Some(users_ok), auth_providers_transferred: Some(0), ..Default::default() } }
}

async fn supabase_export_functions(ep: &Endpoint) -> FunctionsExport {
    let (creds, cw) = resolve_supabase_api_creds(&ep.connection_string).await;
    let Some(creds) = creds else {
        return FunctionsExport { warnings: vec![cw.unwrap_or_else(|| "Edge functions require a supabase-mgmt connection; nothing exported.".into())], ..Default::default() };
    };
    let listed = match list_supabase_functions(&creds).await {
        Ok(l) => l,
        Err(e) => return FunctionsExport { warnings: vec![format!("Failed to list edge functions: {e}")], ..Default::default() },
    };
    let mut out = FunctionsExport::default();
    for f in &listed {
        match get_supabase_function_body(&creds, &f.slug).await {
            Err(e) => out.warnings.push(format!("Function {}: source not readable ({e}); skipped.", f.slug)),
            Ok(body) => {
                let files = vec![FunctionFile { path: "index.ts".into(), content: body }];
                out.functions.push(ExportedFunction {
                    slug: f.slug.clone(),
                    provider: ProviderType::Supabase,
                    verify_jwt: f.verify_jwt,
                    diffs: build_compat_diffs(ProviderType::Supabase, &files),
                    files,
                });
            }
        }
    }
    if listed.is_empty() {
        out.warnings.push("No edge functions found on source.".into());
    }
    out
}

async fn supabase_import_functions(ep: &Endpoint, data: &FunctionsExport, opts: &TransferOptions) -> ImportOutcome {
    let mut warnings = Vec::new();
    let mut deployed = 0;
    let (creds, cw) = resolve_supabase_api_creds(&ep.connection_string).await;
    let Some(creds) = creds else {
        if !data.functions.is_empty() {
            warnings.push(format!(
                "Edge functions not deployed: destination has no management token{}. Sources are preserved in the transfer package — deploy manually.",
                cw.map(|w| format!(" ({w})")).unwrap_or_default()
            ));
        }
        return ImportOutcome { warnings, stats: StatsPatch { functions_transferred: Some(0), ..Default::default() } };
    };
    for f in &data.functions {
        if f.provider != ProviderType::Supabase && !opts.allow_auto_ported_deploy {
            warnings.push(format!("Function {}: cross-runtime auto-ported draft NOT deployed — review its compat diff, then redeploy with auto-ported deploys enabled. Sources preserved in package.", f.slug));
            continue;
        }
        let files = if f.provider == ProviderType::Supabase {
            &f.files
        } else {
            f.diffs.iter().find(|d| d.target_provider == ProviderType::Supabase).map_or(&f.files, |d| &d.transformed_files)
        };
        if f.provider != ProviderType::Supabase {
            warnings.push(format!("Function {}: deploying auto-ported draft (explicitly enabled) — runtime APIs may differ, verify behavior.", f.slug));
        }
        let Some(entry) = files.iter().find(|x| x.path.ends_with("index.ts") || x.path.ends_with("index.js")).or(files.first()) else {
            warnings.push(format!("Function {}: no deployable file; skipped.", f.slug));
            continue;
        };
        match deploy_supabase_function(&creds, &f.slug, &entry.content, f.verify_jwt).await {
            Ok(()) => deployed += 1,
            Err(e) => warnings.push(format!("Function {}: deploy failed ({e}).", f.slug)),
        }
    }
    ImportOutcome { warnings, stats: StatsPatch { functions_transferred: Some(deployed), ..Default::default() } }
}

async fn neon_export_functions(ep: &Endpoint) -> FunctionsExport {
    let cs = &ep.connection_string;
    let listed = match run_neon_cli(cs, &["functions".into(), "list".into()], true, Duration::from_secs(60), None).await {
        Ok(o) => o,
        Err(e) => return FunctionsExport { warnings: vec![format!("Failed to list Neon functions: {e}")], ..Default::default() },
    };
    let v: serde_json::Value = serde_json::from_str(&listed.stdout).unwrap_or_default();
    let items = v.as_array().or_else(|| v.get("data").and_then(|d| d.as_array())).cloned().unwrap_or_default();
    let mut out = FunctionsExport::default();
    for item in items.iter().take(50) {
        let slug = ["slug", "name", "id"].iter().find_map(|k| item.get(*k).and_then(|v| v.as_str().map(str::to_string))).unwrap_or_default();
        if slug.is_empty() {
            continue;
        }
        let mut files = Vec::new();
        if let Ok(got) = run_neon_cli(cs, &["functions".into(), "get".into(), slug.clone()], true, Duration::from_secs(60), None).await {
            let d: serde_json::Value = serde_json::from_str(&got.stdout).unwrap_or_default();
            let source = d.get("source").or(d.get("code")).or(d.pointer("/files/index")).or(d.pointer("/data/source")).and_then(|s| s.as_str());
            if let Some(src) = source.filter(|s| !s.is_empty()) {
                files.push(FunctionFile { path: "index.ts".into(), content: src.chars().take(500_000).collect() });
            } else if let Some(arr) = d.get("files").and_then(|f| f.as_array()) {
                files = arr
                    .iter()
                    .filter_map(|f| Some(FunctionFile { path: f.get("path")?.as_str()?.into(), content: f.get("content")?.as_str()?.chars().take(500_000).collect() }))
                    .collect();
            }
        }
        if files.is_empty() {
            out.warnings.push(format!("Function {slug}: CLI exposes no sources; metadata recorded without code."));
        }
        out.functions.push(ExportedFunction { diffs: build_compat_diffs(ProviderType::Neon, &files), slug, provider: ProviderType::Neon, verify_jwt: None, files });
    }
    if items.is_empty() {
        out.warnings.push("No functions found on Neon branch.".into());
    }
    out
}

async fn neon_import_functions(ep: &Endpoint, data: &FunctionsExport, opts: &TransferOptions) -> ImportOutcome {
    let mut warnings = Vec::new();
    let mut deployed = 0;
    for f in &data.functions {
        if f.provider != ProviderType::Neon && !opts.allow_auto_ported_deploy {
            warnings.push(format!("Function {}: cross-runtime auto-ported draft NOT deployed — review its compat diff, then redeploy with auto-ported deploys enabled. Sources preserved in package.", f.slug));
            continue;
        }
        let files = if f.provider == ProviderType::Neon {
            &f.files
        } else {
            f.diffs.iter().find(|d| d.target_provider == ProviderType::Neon).map_or(&f.files, |d| &d.transformed_files)
        };
        if f.provider != ProviderType::Neon {
            warnings.push(format!("Function {}: deploying auto-ported draft (explicitly enabled) — runtime APIs may differ, verify behavior.", f.slug));
        }
        if files.is_empty() {
            warnings.push(format!("Function {}: no sources to deploy; skipped.", f.slug));
            continue;
        }
        let dir = match temp_function_dir(&f.slug).await {
            Ok(d) => d,
            Err(e) => {
                warnings.push(format!("Function {}: deploy failed ({e}).", f.slug));
                continue;
            }
        };
        let mut write_err = None;
        for file in files {
            let safe: String = file.path.trim_start_matches('/').replace("..", "_").chars().take(200).collect();
            let safe = if safe.is_empty() { "index.ts".to_string() } else { safe };
            let p = dir.join(&safe);
            if let Some(parent) = p.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            if let Err(e) = std::fs::write(&p, &file.content) {
                write_err = Some(e.to_string());
            }
        }
        let res = match write_err {
            Some(e) => Err(e),
            None => run_neon_cli(&ep.connection_string, &["functions".into(), "deploy".into(), f.slug.clone()], false, Duration::from_secs(120), Some(&dir)).await.map(|_| ()),
        };
        let _ = std::fs::remove_dir_all(&dir);
        match res {
            Ok(()) => deployed += 1,
            Err(e) => warnings.push(format!(
                "Function {}: deploy failed ({e}). Sources preserved in package — deploy manually with `neon functions deploy {}`.",
                f.slug, f.slug
            )),
        }
    }
    ImportOutcome { warnings, stats: StatsPatch { functions_transferred: Some(deployed), ..Default::default() } }
}
