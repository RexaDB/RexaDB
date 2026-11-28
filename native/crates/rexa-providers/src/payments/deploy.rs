//! PayKit Management API deploy helpers (port of `server/supabase-paykit.ts` + `lib/supabase-paykit/sync.ts`).

use super::sql::{self, SchemaPhase};
use super::templates::{build_api_source, build_webhook_source};
use super::DraftState;
use crate::supabase::{self, Access};
use anyhow::{anyhow, bail, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::time::Duration;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaykitTableStatus {
    pub table: String,
    pub present: bool,
    pub rls_enabled: Option<bool>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaykitFunctionStatus {
    pub slug: String,
    pub deployed: bool,
    pub verify_jwt: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub template_version: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaykitProjectStatus {
    #[serde(rename = "ref")]
    pub ref_: String,
    pub tables: Vec<PaykitTableStatus>,
    pub schema_exists: bool,
    pub schema_ready: bool,
    pub functions: Vec<PaykitFunctionStatus>,
    pub secrets_present: HashMap<String, bool>,
    pub secrets_ready: bool,
    pub webhook_url: String,
    pub postgrest_exposed: Option<bool>,
    pub grants_ready: Option<bool>,
    pub functions_stale: Option<bool>,
    pub warnings: Vec<String>,
}

#[derive(Clone, Debug)]
pub struct PushSchemaResult {
    pub applied: usize,
    pub total: usize,
    pub phase: SchemaPhase,
}

#[derive(Clone, Debug)]
pub struct ExposeResult {
    pub exposed: bool,
    pub via: &'static str,
}

#[derive(Clone, Debug)]
pub struct FunctionDeployResult {
    pub slug: String,
    pub deployed: bool,
    pub verify_jwt: Option<bool>,
    pub error: Option<String>,
}

#[derive(Clone, Debug)]
pub struct DeployFunctionsResult {
    pub results: Vec<FunctionDeployResult>,
}

#[derive(Clone, Debug)]
pub struct SyncProductsResult {
    pub products: Vec<Value>,
}

#[derive(Clone, Debug)]
pub struct StripeWebhookEndpoint {
    pub id: String,
    pub url: String,
    pub secret: String,
    pub livemode: bool,
    pub status: String,
}

pub fn paykit_webhook_url(ref_: &str) -> String {
    format!("https://{ref_}.supabase.co/functions/v1/{}", sql::webhook_slug())
}

pub fn paykit_api_url(ref_: &str) -> String {
    format!("https://{ref_}.supabase.co/functions/v1/{}", sql::api_slug())
}

pub fn setup_complete(status: &PaykitProjectStatus) -> bool {
    let functions_deployed = !status.functions.is_empty() && status.functions.iter().all(|f| f.deployed);
    let rls_ok = status.tables.iter().all(|t| t.rls_enabled != Some(false));
    let grants_ok = status.grants_ready != Some(false);
    let bundle_ok = status.functions_stale != Some(true);
    let jwt_ok = !status.functions.iter().any(|f| f.deployed && f.verify_jwt == Some(true));
    status.schema_ready
        && functions_deployed
        && status.secrets_ready
        && status.postgrest_exposed != Some(false)
        && rls_ok
        && grants_ok
        && bundle_ok
        && jwt_ok
}

pub fn is_sync_blocking_error(msg: &str) -> bool {
    !msg.is_empty()
        && (msg.contains("don't support one-click sync")
            || msg.contains("gateway blocked the call")
            || msg.contains("doesn't match the project's")
            || msg.contains("no secret key in its environment"))
}

pub fn summarize_sync(products: &[Value]) -> (usize, usize) {
    let with_prices = products.iter().filter(|p| p.get("stripePriceId").or_else(|| p.get("stripe_price_id")).map(|v| !v.is_null() && v != &json!(false)).unwrap_or(false)).count();
    (products.len(), with_prices)
}

fn mgmt_error(action: &str, status: u16, text: &str) -> String {
    let hint = if status == 401 || status == 403 {
        " (check the Supabase token — it may have expired or lack the required scope; remove and re-link the account)"
    } else {
        ""
    };
    let detail = text.chars().take(300).collect::<String>();
    format!("{action} failed ({status}): {detail}{hint}")
}

async fn run_query(a: &Access, query: &str) -> Result<Vec<Value>> {
    let v = supabase::request(&a.token, reqwest::Method::POST, &format!("/projects/{}/database/query", a.project_ref), Some(json!({ "query": query }))).await?;
    if let Some(arr) = v.as_array() {
        return Ok(arr.clone());
    }
    if let Some(arr) = v.get("result").and_then(Value::as_array) {
        return Ok(arr.clone());
    }
    if let Some(arr) = v.get("data").and_then(Value::as_array) {
        return Ok(arr.clone());
    }
    Ok(vec![])
}

fn parse_functions_list(payload: &Value) -> Vec<Value> {
    if let Some(a) = payload.as_array() {
        return a.clone();
    }
    payload.get("functions").and_then(Value::as_array).cloned().unwrap_or_default()
}

fn parse_secret_names(payload: &Value) -> Vec<String> {
    let arr = if let Some(a) = payload.as_array() {
        a
    } else if let Some(a) = payload.get("secrets").and_then(Value::as_array) {
        a
    } else {
        return vec![];
    };
    arr.iter()
        .filter_map(|s| {
            if let Some(n) = s.as_str() {
                Some(n.to_string())
            } else {
                s.get("name").or_else(|| s.get("key")).or_else(|| s.get("secret_name")).and_then(Value::as_str).map(str::to_string)
            }
        })
        .collect()
}

fn pick_api_key(payload: &Value, name: &str) -> Option<String> {
    let list = payload.as_array().or_else(|| payload.get("api_keys").and_then(Value::as_array)).or_else(|| payload.get("apiKeys").and_then(Value::as_array)).or_else(|| payload.get("data").and_then(Value::as_array))?;
    let want = name.to_lowercase();
    for entry in list {
        let entry_name = entry.get("name").and_then(Value::as_str).unwrap_or("").to_lowercase();
        let key = entry.get("api_key").or_else(|| entry.get("apiKey")).and_then(Value::as_str).unwrap_or("");
        if entry_name == want && !key.is_empty() {
            return Some(key.to_string());
        }
    }
    None
}

fn collect_candidate_keys(payload: &Value, max: usize) -> Vec<String> {
    let list = payload
        .as_array()
        .or_else(|| payload.get("api_keys").and_then(Value::as_array))
        .or_else(|| payload.get("apiKeys").and_then(Value::as_array))
        .or_else(|| payload.get("data").and_then(Value::as_array));
    let Some(list) = list else { return vec![] };
    let mut out = Vec::new();
    let mut push = |key: Option<&str>| {
        let Some(k) = key.map(str::trim).filter(|k| k.len() >= 20) else { return };
        if !out.iter().any(|x| x == k) && out.len() < max {
            out.push(k.to_string());
        }
    };
    for entry in list {
        if entry.get("name").and_then(Value::as_str).unwrap_or("").eq_ignore_ascii_case("service_role") {
            push(entry.get("api_key").and_then(Value::as_str));
            push(entry.get("apiKey").and_then(Value::as_str));
        }
    }
    const FIELDS: &[&str] = &["api_key", "apiKey", "secret", "secret_key", "secretKey", "key", "token", "value"];
    for entry in list {
        if let Some(obj) = entry.as_object() {
            for f in FIELDS {
                push(obj.get(*f).and_then(Value::as_str));
            }
        }
    }
    out
}

fn compare_template_version(deployed: Option<&str>, current: &str) -> Option<bool> {
    let d = deployed.map(str::trim).filter(|s| !s.is_empty())?;
    let c = current.trim();
    if c.is_empty() {
        return None;
    }
    Some(d != c)
}

const STALE_FUNCTIONS_MESSAGE: &str =
    "Your deployed functions are from an older version and don't support one-click sync. Press Run setup to update them, then sync again.";
const GATEWAY_BLOCKED_MESSAGE: &str =
    "Supabase's gateway blocked the call before it reached your function — gateway JWT verification is likely still on, or the rollout hasn't finished. Re-run Setup (it disables gateway verification), wait about a minute, then sync again.";
const ENV_MISMATCH_MESSAGE: &str =
    "The function is up to date, but its secret key doesn't match the project's — its environment may hold a rotated key. Re-run Setup to redeploy with fresh credentials, then sync again.";
const NO_SERVICE_KEY_MESSAGE: &str =
    "The deployed function has no secret key in its environment. Re-run Setup to redeploy; if it persists, check Edge Function secrets in the Supabase dashboard.";

fn classify_sync_auth_failure(body: &Value) -> &'static str {
    if let Some(code) = body.get("code").and_then(Value::as_str) {
        if code == "admin-key-mismatch" {
            return "env-mismatch";
        }
        if code == "no-service-key-env" {
            return "no-service-key-env";
        }
    }
    if body.get("error").and_then(Value::as_str).is_some() && body.get("message").and_then(Value::as_str).is_none() {
        return "stale";
    }
    "gateway"
}

fn sync_auth_failure_message(kind: &str) -> &'static str {
    match kind {
        "env-mismatch" => ENV_MISMATCH_MESSAGE,
        "no-service-key-env" => NO_SERVICE_KEY_MESSAGE,
        "gateway" => GATEWAY_BLOCKED_MESSAGE,
        _ => STALE_FUNCTIONS_MESSAGE,
    }
}

pub async fn get_status(a: &Access) -> Result<PaykitProjectStatus> {
    let ref_ = a.project_ref.clone();
    let mut warnings = Vec::new();

    let mut present = HashSet::new();
    let mut rls: HashMap<String, bool> = HashMap::new();
    let mut schema_exists = false;

    let rows = run_query(a, &sql::tables_presence_query()).await?;
    for r in &rows {
        if let Some(name) = r.get("table_name").or_else(|| r.get("tablename")).and_then(Value::as_str) {
            if !name.is_empty() {
                present.insert(name.to_string());
            }
        }
    }
    match run_query(a, &sql::rls_status_query()).await {
        Ok(rls_rows) => {
            for r in rls_rows {
                if let Some(name) = r.get("table_name").and_then(Value::as_str) {
                    rls.insert(name.to_string(), r.get("rls_enabled").and_then(Value::as_bool) == Some(true));
                }
            }
        }
        Err(_) => {}
    }
    match run_query(a, &format!("SELECT to_regnamespace('{}') IS NOT NULL AS exists", sql::PAYKIT_SCHEMA)).await {
        Ok(ns) => schema_exists = ns.first().and_then(|r| r.get("exists")).and_then(Value::as_bool) == Some(true),
        Err(_) => schema_exists = !present.is_empty(),
    }

    let mut functions: Vec<PaykitFunctionStatus> = Vec::new();
    let specs = [(sql::webhook_slug(), "PayKit Stripe webhook"), (sql::api_slug(), "PayKit billing API")];
    match supabase::request(&a.token, reqwest::Method::GET, &format!("/projects/{}/functions", a.project_ref), None).await {
        Ok(json) => {
            let list = parse_functions_list(&json);
            let by_slug: HashMap<String, Value> = list
                .into_iter()
                .filter_map(|f| {
                    let slug = f.get("slug").or_else(|| f.get("name")).and_then(Value::as_str)?.to_string();
                    Some((slug, f))
                })
                .collect();
            for (slug, _) in &specs {
                let found = by_slug.get(*slug);
                functions.push(PaykitFunctionStatus {
                    slug: (*slug).into(),
                    deployed: found.is_some(),
                    verify_jwt: found.and_then(|f| f.get("verify_jwt")).and_then(Value::as_bool),
                    version: found.and_then(|f| f.get("version").or_else(|| f.get("updated_at"))).and_then(|v| v.as_str().map(str::to_string).or_else(|| Some(v.to_string()))),
                    template_version: None,
                });
            }
        }
        Err(e) => {
            warnings.push(format!("Functions list unavailable: {e:#}"));
            for (slug, _) in &specs {
                functions.push(PaykitFunctionStatus { slug: (*slug).into(), deployed: false, verify_jwt: None, version: None, template_version: None });
            }
        }
    }

    let mut functions_stale: Option<bool> = None;
    if functions.iter().any(|f| f.slug == sql::api_slug() && f.deployed) {
        match supabase::request(&a.token, reqwest::Method::GET, &format!("/projects/{}/api-keys", a.project_ref), None).await {
            Ok(keys) => {
                if let Some(anon) = pick_api_key(&keys, "anon") {
                    let url = format!("{}?action=status", paykit_api_url(&ref_));
                    match supabase::http()
                        .post(&url)
                        .header("apikey", &anon)
                        .bearer_auth(&anon)
                        .header("Content-Type", "application/json")
                        .body("{}")
                        .send()
                        .await
                    {
                        Ok(res) => {
                            let status = res.status().as_u16();
                            let text = res.text().await.unwrap_or_default();
                            let payload: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
                            if status == 200 || status == 201 {
                                if payload.is_object() {
                                    let tv = payload.get("templateVersion").and_then(Value::as_str).map(str::to_string);
                                    if let Some(api) = functions.iter_mut().find(|f| f.slug == sql::api_slug()) {
                                        api.template_version = tv.clone();
                                    }
                                    functions_stale = compare_template_version(tv.as_deref(), sql::template_version());
                                } else {
                                    warnings.push("Deployed bundle version unreadable — treating as unknown.".into());
                                }
                            } else {
                                warnings.push(format!("Deployed bundle version check failed (status {status})."));
                            }
                        }
                        Err(e) => warnings.push(format!("Deployed bundle version check failed: {e}")),
                    }
                } else {
                    warnings.push("Project API keys unavailable — deployed bundle version unknown.".into());
                }
            }
            Err(_) => warnings.push("Project API keys unavailable — deployed bundle version unknown.".into()),
        }
    }

    let mut secrets_present: HashMap<String, bool> = sql::required_secrets().iter().map(|n| (n.clone(), false)).collect();
    match supabase::request(&a.token, reqwest::Method::GET, &format!("/projects/{}/secrets", a.project_ref), None).await {
        Ok(json) => {
            let names: HashSet<String> = parse_secret_names(&json).into_iter().collect();
            for name in sql::required_secrets() {
                secrets_present.insert(name.clone(), names.contains(name));
            }
        }
        Err(_) => warnings.push("Secrets list unavailable (token may lack secrets scope) — set secrets anyway; values are write-only.".into()),
    }

    let tables: Vec<PaykitTableStatus> = sql::table_names()
        .iter()
        .map(|table| PaykitTableStatus {
            table: table.clone(),
            present: present.contains(table),
            rls_enabled: rls.get(table).copied(),
        })
        .collect();

    let mut grants_ready: Option<bool> = None;
    match run_query(a, &sql::grants_status_query()).await {
        Ok(grant_rows) => {
            let mut by_table: HashMap<String, HashSet<String>> = HashMap::new();
            for r in grant_rows {
                let name = r.get("table_name").and_then(Value::as_str).unwrap_or("").to_string();
                let priv_ = r.get("privilege_type").and_then(Value::as_str).unwrap_or("").to_uppercase();
                if name.is_empty() || priv_.is_empty() {
                    continue;
                }
                by_table.entry(name).or_default().insert(priv_);
            }
            grants_ready = Some(present.iter().all(|t| sql::required_privileges().iter().all(|p| by_table.get(t).is_some_and(|s| s.contains(p)))));
        }
        Err(_) => {}
    }

    let mut postgrest_exposed: Option<bool> = None;
    match supabase::request(&a.token, reqwest::Method::GET, &format!("/projects/{}/postgrest", a.project_ref), None).await {
        Ok(json) => {
            if let Some(db_schema) = json.get("db_schema").or_else(|| json.get("dbSchema")).and_then(Value::as_str) {
                postgrest_exposed = Some(db_schema.split(',').map(str::trim).any(|s| s == sql::PAYKIT_SCHEMA));
            } else {
                warnings.push("Could not read PostgREST exposed schemas.".into());
            }
        }
        Err(_) => warnings.push("PostgREST config unavailable (token may lack config scope).".into()),
    }

    let secrets_ready = sql::required_secrets().iter().all(|n| secrets_present.get(n) == Some(&true));
    let schema_ready = tables.iter().all(|t| t.present);

    Ok(PaykitProjectStatus {
        ref_: ref_.clone(),
        tables,
        schema_exists,
        schema_ready,
        functions,
        secrets_present,
        secrets_ready,
        webhook_url: paykit_webhook_url(&ref_),
        postgrest_exposed,
        grants_ready,
        functions_stale,
        warnings,
    })
}

pub async fn push_schema(a: &Access, phase: SchemaPhase) -> Result<PushSchemaResult> {
    let statements = sql::schema_statements_for(phase);
    let mut applied = 0;
    for stmt in statements {
        match run_query(a, stmt).await {
            Ok(_) => applied += 1,
            Err(e) => {
                let label = match phase {
                    SchemaPhase::Schema => "schema",
                    SchemaPhase::Tables => "tables",
                    SchemaPhase::All => "all",
                };
                bail!("Schema statement {}/{} (phase {label}) failed: {e:#}", applied + 1, statements.len());
            }
        }
    }
    Ok(PushSchemaResult { applied, total: statements.len(), phase })
}

pub async fn expose_schema(a: &Access) -> Result<ExposeResult> {
    let manual = format!("Fallback: Supabase Dashboard → Project Settings → Data API → Exposed schemas → add \"{}\".", sql::PAYKIT_SCHEMA);
    let current = match supabase::request(&a.token, reqwest::Method::GET, &format!("/projects/{}/postgrest", a.project_ref), None).await {
        Ok(json) => json.get("db_schema").and_then(Value::as_str).map(str::to_string),
        Err(e) => bail!("Read PostgREST config failed: {e:#} {manual}"),
    };
    let Some(merged) = sql::merge_exposed_schemas(current.as_deref()) else {
        return Ok(ExposeResult { exposed: true, via: "already" });
    };
    supabase::request(&a.token, reqwest::Method::PATCH, &format!("/projects/{}/postgrest", a.project_ref), Some(json!({ "db_schema": merged }))).await.map_err(|e| anyhow!("Update PostgREST config failed: {e:#} {manual}"))?;

    for payload in ["reload config", "reload schema"] {
        run_query(a, &format!("NOTIFY pgrst, '{payload}'")).await.map_err(|e| {
            anyhow!("PostgREST config updated but reload failed: {e:#} If the API still misses the \"{}\" schema, restart the project from General Settings.", sql::PAYKIT_SCHEMA)
        })?;
    }

    let verify = supabase::request(&a.token, reqwest::Method::GET, &format!("/projects/{}/postgrest", a.project_ref), None).await.map_err(|e| anyhow!("PostgREST verification failed: {e:#} {manual}"))?;
    let db_schema = verify.get("db_schema").and_then(Value::as_str).unwrap_or("");
    let exposed = db_schema.split(',').map(str::trim).any(|s| s == sql::PAYKIT_SCHEMA);
    if !exposed {
        bail!("PostgREST config updated but \"{}\" is not exposed yet. {manual}", sql::PAYKIT_SCHEMA);
    }
    Ok(ExposeResult { exposed: true, via: "auto" })
}

async fn deploy_one(a: &Access, slug: &str, name: &str, source: String, verify_jwt: bool) -> FunctionDeployResult {
    let meta = json!({ "entrypoint_path": "index.ts", "name": name });
    let form = match (|| -> Result<_> {
        let form = reqwest::multipart::Form::new().text("metadata", meta.to_string()).part(
            "file",
            reqwest::multipart::Part::text(source).file_name("index.ts").mime_str("application/typescript")?,
        );
        Ok(form)
    })() {
        Ok(f) => f,
        Err(e) => return FunctionDeployResult { slug: slug.into(), deployed: false, verify_jwt: None, error: Some(e.to_string()) },
    };

    let res = match supabase::http()
        .post(format!("{}/projects/{}/functions/deploy?slug={}", supabase::API, a.project_ref, supabase::enc(slug)))
        .bearer_auth(&a.token)
        .multipart(form)
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => return FunctionDeployResult { slug: slug.into(), deployed: false, verify_jwt: None, error: Some(format!("Deploy {slug} failed: {e}")) },
    };
    let status = res.status().as_u16();
    if !(200..300).contains(&status) {
        let text = res.text().await.unwrap_or_default();
        return FunctionDeployResult { slug: slug.into(), deployed: false, verify_jwt: None, error: Some(mgmt_error(&format!("Deploy {slug}"), status, &text)) };
    }

    let flag = if verify_jwt { "true" } else { "false" };
    for attempt in 0..2 {
        let patch = supabase::http()
            .request(reqwest::Method::PATCH, format!("{}/projects/{}/functions/{}?verify_jwt={flag}", supabase::API, a.project_ref, supabase::enc(slug)))
            .bearer_auth(&a.token)
            .header("Content-Type", "application/json")
            .json(&json!({ "verify_jwt": verify_jwt }))
            .send()
            .await;
        let Ok(patch) = patch else {
            if attempt == 0 {
                tokio::time::sleep(Duration::from_secs(2)).await;
                continue;
            }
            return FunctionDeployResult {
                slug: slug.into(),
                deployed: true,
                verify_jwt: None,
                error: Some(format!(
                    "Deployed {slug} but verify_jwt={flag} could not be confirmed. Set it manually: supabase functions deploy {slug} --project-ref {} {}",
                    a.project_ref,
                    if verify_jwt { "" } else { "--no-verify-jwt" }
                )),
            };
        };
        let pstatus = patch.status().as_u16();
        if !(200..300).contains(&pstatus) {
            if attempt == 0 {
                tokio::time::sleep(Duration::from_secs(2)).await;
                continue;
            }
            return FunctionDeployResult {
                slug: slug.into(),
                deployed: true,
                verify_jwt: None,
                error: Some(format!(
                    "Deployed {slug} but verify_jwt={flag} could not be confirmed ({pstatus}). Set it manually: supabase functions deploy {slug} --project-ref {} {}",
                    a.project_ref,
                    if verify_jwt { "" } else { "--no-verify-jwt" }
                )),
            };
        }
        match supabase::request(&a.token, reqwest::Method::GET, &format!("/projects/{}/functions", a.project_ref), None).await {
            Ok(list_json) => {
                let found = parse_functions_list(&list_json).into_iter().find(|f| f.get("slug").or_else(|| f.get("name")).and_then(Value::as_str) == Some(slug));
                match found.as_ref().and_then(|f| f.get("verify_jwt")) {
                    None => return FunctionDeployResult { slug: slug.into(), deployed: true, verify_jwt: Some(verify_jwt), error: None },
                    Some(v) if v.as_bool() == Some(verify_jwt) => {
                        return FunctionDeployResult { slug: slug.into(), deployed: true, verify_jwt: Some(verify_jwt), error: None };
                    }
                    Some(v) => {
                        if attempt == 0 {
                            tokio::time::sleep(Duration::from_secs(2)).await;
                            continue;
                        }
                        let actual = v.as_bool().unwrap_or(false);
                        return FunctionDeployResult {
                            slug: slug.into(),
                            deployed: true,
                            verify_jwt: None,
                            error: Some(format!(
                                "Deployed {slug} but gateway verification stayed {} (wanted {}). Flip it manually: Supabase Dashboard → Edge Functions → {slug} → disable JWT verification{}.",
                                if actual { "on" } else { "off" },
                                if verify_jwt { "on" } else { "off" },
                                if verify_jwt { ", or redeploy without --no-verify-jwt" } else { "" }
                            )),
                        };
                    }
                }
            }
            Err(_) => return FunctionDeployResult { slug: slug.into(), deployed: true, verify_jwt: Some(verify_jwt), error: None },
        }
    }
    FunctionDeployResult { slug: slug.into(), deployed: true, verify_jwt: None, error: None }
}

pub async fn deploy_functions(a: &Access, drafts: &DraftState) -> Result<DeployFunctionsResult> {
    if drafts.version != 1 {
        bail!("Missing plan drafts.");
    }
    let webhook = build_webhook_source(drafts);
    let api = build_api_source(drafts);
    let mut results = Vec::new();
    results.push(deploy_one(a, sql::webhook_slug(), "PayKit Stripe webhook", webhook.source, false).await);
    results.push(deploy_one(a, sql::api_slug(), "PayKit billing API", api.source, false).await);
    Ok(DeployFunctionsResult { results })
}

pub async fn set_secrets(a: &Access, secrets: &[(String, String)]) -> Result<Vec<String>> {
    if secrets.is_empty() {
        bail!("No secrets provided.");
    }
    if secrets.len() > 20 {
        bail!("Too many secrets in one request.");
    }
    let mut entries = Vec::new();
    for (name, value) in secrets {
        if !name.chars().next().is_some_and(|c| c.is_ascii_uppercase()) || !name.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_') || name.len() > 64 {
            bail!("Invalid secret name: {name}");
        }
        if value.is_empty() || value.len() > 20_000 {
            bail!("Invalid value for secret: {name}");
        }
        entries.push(json!({ "name": name, "value": value }));
    }
    let names: Vec<String> = secrets.iter().map(|(n, _)| n.clone()).collect();
    match supabase::request(&a.token, reqwest::Method::POST, &format!("/projects/{}/secrets", a.project_ref), Some(Value::Array(entries))).await {
        Ok(_) => Ok(names),
        Err(e) => bail!("Set secrets failed: {e:#} — fallback: supabase secrets set --project-ref {} {}", a.project_ref, names.join(" ")),
    }
}

pub async fn sync_products(a: &Access) -> Result<SyncProductsResult> {
    let keys = supabase::request(&a.token, reqwest::Method::GET, &format!("/projects/{}/api-keys", a.project_ref), None).await.map_err(|e| anyhow!("Read project API keys failed: {e:#}"))?;
    let candidates = collect_candidate_keys(&keys, 8);
    let attempts: Vec<String> = if candidates.is_empty() { vec![String::new()] } else { candidates };

    let mut mismatch_detail: Option<(usize, usize)> = None;
    for service_key in attempts {
        let url = format!("{}?action=sync-products", paykit_api_url(&a.project_ref));
        let mut req = supabase::http().post(&url).header("Content-Type", "application/json").header("x-rexadb-mgmt", &a.token);
        if !service_key.is_empty() {
            req = req.header("apikey", &service_key).bearer_auth(&service_key);
        }
        let res = match req.body("{}").send().await {
            Ok(r) => r,
            Err(e) => {
                let msg = e.to_string();
                if msg.to_lowercase().contains("invalid") && (msg.to_lowercase().contains("value") || msg.to_lowercase().contains("header") || msg.to_lowercase().contains("bytestring")) {
                    continue;
                }
                bail!("Sync request failed: {e}");
            }
        };
        let status = res.status().as_u16();
        let text = res.text().await.unwrap_or_default();
        let json: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
        if status == 200 || status == 201 {
            if let Some(err) = json.get("error").and_then(Value::as_str).filter(|e| !e.is_empty()) {
                if err.to_uppercase().contains("STRIPE_SECRET_KEY") {
                    bail!("Sync needs Stripe secrets — set them first, then sync again.");
                }
                bail!("Sync failed: {}", err.chars().take(300).collect::<String>());
            }
            let products = json.get("products").and_then(Value::as_array).cloned().unwrap_or_default();
            return Ok(SyncProductsResult { products });
        }
        if status == 404 {
            bail!("paykit-api is not deployed yet — Run setup first, then sync.");
        }
        if status != 401 {
            let detail = json.get("error").and_then(Value::as_str).unwrap_or(&text);
            bail!("Sync failed ({status}): {}", detail.chars().take(300).collect::<String>());
        }
        let kind = classify_sync_auth_failure(&json);
        if kind == "stale" || kind == "no-service-key-env" {
            bail!("{}", sync_auth_failure_message(kind));
        }
        if kind == "env-mismatch" {
            if mismatch_detail.is_none() {
                if let Some(d) = json.get("detail") {
                    if let (Some(req_len), Some(env_len)) = (d.get("reqLen").and_then(Value::as_u64), d.get("envLen").and_then(Value::as_u64)) {
                        mismatch_detail = Some((req_len as usize, env_len as usize));
                    }
                }
            }
            continue;
        }
    }
    if let Some((req_len, env_len)) = mismatch_detail {
        bail!("{ENV_MISMATCH_MESSAGE} (sent {req_len} chars, function holds {env_len} chars)");
    }
    bail!("{}", sync_auth_failure_message("gateway"));
}

pub async fn create_stripe_webhook(secret_key: &str, url: &str, events: &[&str]) -> Result<StripeWebhookEndpoint> {
    let key = secret_key.trim();
    if !(key.starts_with("sk_test_") || key.starts_with("sk_live_")) || !key.chars().skip(8).all(|c| c.is_ascii_alphanumeric()) {
        bail!("Invalid Stripe secret key (expected sk_test_… or sk_live_…).");
    }
    let url = url.trim();
    if !url.starts_with("https://") || url.contains(char::is_whitespace) {
        bail!("Endpoint URL must be a valid https:// URL.");
    }
    if events.is_empty() {
        bail!("No events provided.");
    }
    if events.len() > 100 {
        bail!("Too many events requested.");
    }
    let body = {
        let mut form = url::form_urlencoded::Serializer::new(String::new());
        form.append_pair("url", url);
        form.append_pair("description", "RexaDB PayKit");
        for e in events {
            form.append_pair("enabled_events[]", e);
        }
        form.finish()
    };
    let res = supabase::http()
        .post("https://api.stripe.com/v1/webhook_endpoints")
        .basic_auth(key, Some(""))
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(body)
        .send()
        .await
        .map_err(|e| anyhow!("Could not reach Stripe: {e}"))?;
    let status = res.status();
    let json: Value = res.json().await.unwrap_or(Value::Null);
    if !status.is_success() {
        let message = json.get("error").and_then(|e| e.get("message")).and_then(Value::as_str).map(str::to_string).unwrap_or_else(|| format!("Stripe rejected the request (HTTP {}).", status.as_u16()));
        bail!(message);
    }
    Ok(StripeWebhookEndpoint {
        id: json.get("id").and_then(Value::as_str).unwrap_or("").into(),
        url: json.get("url").and_then(Value::as_str).unwrap_or("").into(),
        secret: json.get("secret").and_then(Value::as_str).unwrap_or("").into(),
        livemode: json.get("livemode").and_then(Value::as_bool).unwrap_or(false),
        status: json.get("status").and_then(Value::as_str).unwrap_or("").into(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn setup_complete_null_tolerance() {
        let mut status = PaykitProjectStatus {
            ref_: "abc".into(),
            tables: sql::table_names().iter().map(|t| PaykitTableStatus { table: t.clone(), present: true, rls_enabled: None }).collect(),
            schema_exists: true,
            schema_ready: true,
            functions: vec![
                PaykitFunctionStatus { slug: "paykit-webhook".into(), deployed: true, verify_jwt: Some(false), version: None, template_version: None },
                PaykitFunctionStatus { slug: "paykit-api".into(), deployed: true, verify_jwt: Some(false), version: None, template_version: None },
            ],
            secrets_present: sql::required_secrets().iter().map(|n| (n.clone(), true)).collect(),
            secrets_ready: true,
            webhook_url: paykit_webhook_url("abc"),
            postgrest_exposed: None,
            grants_ready: None,
            functions_stale: None,
            warnings: vec![],
        };
        assert!(setup_complete(&status));
        status.functions_stale = Some(true);
        assert!(!setup_complete(&status));
        status.functions_stale = None;
        status.postgrest_exposed = Some(false);
        assert!(!setup_complete(&status));
        status.postgrest_exposed = Some(true);
        status.functions[0].verify_jwt = Some(true);
        assert!(!setup_complete(&status));
    }

    #[test]
    fn sync_blocking_and_summarize() {
        assert!(is_sync_blocking_error(GATEWAY_BLOCKED_MESSAGE));
        assert!(is_sync_blocking_error(ENV_MISMATCH_MESSAGE));
        assert!(is_sync_blocking_error(STALE_FUNCTIONS_MESSAGE));
        assert!(is_sync_blocking_error(NO_SERVICE_KEY_MESSAGE));
        assert!(!is_sync_blocking_error("network timeout"));
        let products = vec![json!({"stripePriceId": "price_1"}), json!({"stripe_price_id": null}), json!({"id": "x"})];
        assert_eq!(summarize_sync(&products), (3, 1));
    }

    #[test]
    fn webhook_url() {
        assert_eq!(paykit_webhook_url("myref"), "https://myref.supabase.co/functions/v1/paykit-webhook");
    }
}
