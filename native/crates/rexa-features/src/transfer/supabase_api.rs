//! Port of lib/transfer/supabase-api.ts: Supabase project HTTP APIs for
//! content SQL cannot reach (storage object bytes, edge-function sources),
//! using the service_role key fetched through the Management API.

use serde_json::Value;

pub const MAX_STORAGE_FILE_BYTES: usize = 10 * 1024 * 1024;
pub const MAX_STORAGE_TOTAL_BYTES: usize = 200 * 1024 * 1024;
pub const MAX_FUNCTIONS: usize = 50;
pub const MAX_FUNCTION_BODY_BYTES: usize = 500 * 1024;

const API: &str = "https://api.supabase.com/v1";

#[derive(Debug, Clone)]
pub struct SupabaseApiCreds {
    pub project_ref: String,
    pub project_url: String,
    pub service_role: String,
    pub mgmt_token: String,
}

fn client() -> reqwest::Client {
    reqwest::Client::builder().timeout(std::time::Duration::from_secs(120)).build().unwrap_or_default()
}

/// `parseSupabaseMgmtConnectionString`
pub fn parse_mgmt(cs: &str) -> Option<(String, String)> {
    let u = url::Url::parse(cs.trim()).ok()?;
    if u.scheme() != "supabase-mgmt" {
        return None;
    }
    let project = u.host_str().filter(|h| !h.is_empty()).map(str::to_string).unwrap_or_else(|| u.path().trim_start_matches('/').to_string());
    let token = u.query_pairs().find(|(k, _)| k == "token").map(|(_, v)| v.into_owned()).unwrap_or_default();
    (!project.is_empty() && !token.is_empty()).then_some((project, token))
}

/// `resolveSupabaseApiCreds` → (creds, warning).
pub async fn resolve_supabase_api_creds(cs: &str) -> (Option<SupabaseApiCreds>, Option<String>) {
    let Some((project_ref, token)) = parse_mgmt(cs) else {
        return (
            None,
            Some("No Supabase management token on this connection (direct Postgres): file contents and function sources cannot migrate — metadata only. Use a supabase-mgmt connection for content migration.".into()),
        );
    };
    let res = client().get(format!("{API}/projects/{project_ref}/api-keys")).bearer_auth(&token).send().await;
    let res = match res {
        Ok(r) => r,
        Err(e) => return (None, Some(format!("Failed to resolve Supabase API credentials: {e}"))),
    };
    if !res.status().is_success() {
        return (None, Some(format!("Could not list API keys for {project_ref} (HTTP {}): content migration disabled.", res.status().as_u16())));
    }
    let payload: Value = res.json().await.unwrap_or(Value::Null);
    let list = payload
        .as_array()
        .or_else(|| payload.get("data").and_then(Value::as_array))
        .or_else(|| payload.get("api_keys").and_then(Value::as_array))
        .cloned()
        .unwrap_or_default();
    let name_of = |k: &Value| k.get("name").or_else(|| k.get("type")).and_then(Value::as_str).unwrap_or("").to_lowercase();
    let service_role = list
        .iter()
        .find(|k| name_of(k).contains("service_role"))
        .and_then(|k| k.get("api_key").and_then(Value::as_str))
        .or_else(|| list.iter().filter_map(|k| k.get("api_key").and_then(Value::as_str)).find(|k| k.starts_with("eyJ")))
        .map(str::to_string);
    match service_role {
        Some(service_role) if !service_role.is_empty() => (
            Some(SupabaseApiCreds { project_url: format!("https://{project_ref}.supabase.co"), project_ref, service_role, mgmt_token: token }),
            None,
        ),
        _ => (None, Some(format!("No service_role key found for {project_ref}: content migration disabled."))),
    }
}

fn object_url(creds: &SupabaseApiCreds, bucket: &str, path: &str) -> String {
    let enc = |s: &str| percent_encoding::utf8_percent_encode(s, percent_encoding::NON_ALPHANUMERIC).to_string();
    format!("{}/storage/v1/object/{}/{}", creds.project_url, enc(bucket), path.split('/').map(enc).collect::<Vec<_>>().join("/"))
}

/// `downloadStorageObject` (bounded by the per-file cap).
pub async fn download_storage_object(creds: &SupabaseApiCreds, bucket: &str, path: &str) -> Result<Vec<u8>, String> {
    let mut res = client()
        .get(object_url(creds, bucket, path))
        .header("apikey", &creds.service_role)
        .bearer_auth(&creds.service_role)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if res.status().as_u16() == 404 {
        return Err("not found".into());
    }
    if !res.status().is_success() {
        return Err(format!("HTTP {}", res.status().as_u16()));
    }
    if let Some(len) = res.content_length() {
        if len as usize > MAX_STORAGE_FILE_BYTES {
            return Err(format!("exceeds per-file cap ({len} bytes)"));
        }
    }
    let mut buf = Vec::new();
    while let Some(chunk) = res.chunk().await.map_err(|e| e.to_string())? {
        buf.extend_from_slice(&chunk);
        if buf.len() > MAX_STORAGE_FILE_BYTES {
            return Err(format!("exceeds per-file cap (>{MAX_STORAGE_FILE_BYTES} bytes)"));
        }
    }
    Ok(buf)
}

/// `uploadStorageObject` (upsert).
pub async fn upload_storage_object(creds: &SupabaseApiCreds, bucket: &str, path: &str, bytes: Vec<u8>, content_type: Option<&str>) -> Result<(), String> {
    if bytes.len() > MAX_STORAGE_FILE_BYTES {
        return Err(format!("exceeds per-file cap ({} bytes)", bytes.len()));
    }
    let res = client()
        .post(object_url(creds, bucket, path))
        .header("apikey", &creds.service_role)
        .bearer_auth(&creds.service_role)
        .header("Content-Type", content_type.unwrap_or("application/octet-stream"))
        .header("x-upsert", "true")
        .body(bytes)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        let status = res.status().as_u16();
        let text = res.text().await.unwrap_or_default();
        return Err(if text.is_empty() { format!("HTTP {status}") } else { format!("HTTP {status}: {}", text.chars().take(200).collect::<String>()) });
    }
    Ok(())
}

pub struct SupabaseFunctionInfo {
    pub slug: String,
    pub verify_jwt: Option<bool>,
}

/// `listSupabaseFunctions`
pub async fn list_supabase_functions(creds: &SupabaseApiCreds) -> Result<Vec<SupabaseFunctionInfo>, String> {
    let res = client()
        .get(format!("{API}/projects/{}/functions", creds.project_ref))
        .bearer_auth(&creds.mgmt_token)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("HTTP {}", res.status().as_u16()));
    }
    let payload: Value = res.json().await.unwrap_or(Value::Null);
    let arr = payload.as_array().or_else(|| payload.get("data").and_then(Value::as_array)).cloned().unwrap_or_default();
    Ok(arr
        .iter()
        .map(|f| SupabaseFunctionInfo {
            slug: ["slug", "name", "id"].iter().find_map(|k| f.get(*k).and_then(|v| v.as_str().map(str::to_string).or_else(|| v.as_i64().map(|n| n.to_string())))).unwrap_or_default(),
            verify_jwt: f.get("verify_jwt").and_then(Value::as_bool),
        })
        .filter(|f| !f.slug.is_empty())
        .take(MAX_FUNCTIONS)
        .collect())
}

/// `getSupabaseFunctionBody`
pub async fn get_supabase_function_body(creds: &SupabaseApiCreds, slug: &str) -> Result<String, String> {
    let enc = percent_encoding::utf8_percent_encode(slug, percent_encoding::NON_ALPHANUMERIC);
    let res = client()
        .get(format!("{API}/projects/{}/functions/{enc}/body", creds.project_ref))
        .bearer_auth(&creds.mgmt_token)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("HTTP {}", res.status().as_u16()));
    }
    let text = res.text().await.map_err(|e| e.to_string())?;
    if text.is_empty() {
        return Err("empty body".into());
    }
    if let Ok(v) = serde_json::from_str::<Value>(&text) {
        if let Some(body) = v.get("body").and_then(Value::as_str).filter(|b| !b.is_empty()) {
            if body.len() > MAX_FUNCTION_BODY_BYTES {
                return Err("exceeds size cap".into());
            }
            return Ok(body.to_string());
        }
    }
    if text.len() > MAX_FUNCTION_BODY_BYTES {
        return Err(format!("exceeds size cap ({} bytes)", text.len()));
    }
    Ok(text)
}

/// `deploySupabaseFunction` (create, then PATCH when it already exists).
pub async fn deploy_supabase_function(creds: &SupabaseApiCreds, slug: &str, body: &str, verify_jwt: Option<bool>) -> Result<(), String> {
    let mut payload = serde_json::json!({ "slug": slug, "name": slug, "body": body });
    if let Some(v) = verify_jwt {
        payload["verify_jwt"] = Value::Bool(v);
    }
    let res = client()
        .post(format!("{API}/projects/{}/functions", creds.project_ref))
        .bearer_auth(&creds.mgmt_token)
        .json(&payload)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if res.status().is_success() {
        return Ok(());
    }
    let status = res.status().as_u16();
    let text = res.text().await.unwrap_or_default();
    let lower = text.to_lowercase();
    let exists = status == 409 || lower.contains("exist") || lower.contains("conflict") || lower.contains("duplicate");
    if !exists {
        return Err(if text.is_empty() { format!("HTTP {status}") } else { format!("HTTP {status}: {}", text.chars().take(200).collect::<String>()) });
    }
    let mut patch = serde_json::json!({ "body": body });
    if let Some(v) = verify_jwt {
        patch["verify_jwt"] = Value::Bool(v);
    }
    let enc = percent_encoding::utf8_percent_encode(slug, percent_encoding::NON_ALPHANUMERIC);
    let res = client()
        .patch(format!("{API}/projects/{}/functions/{enc}", creds.project_ref))
        .bearer_auth(&creds.mgmt_token)
        .json(&patch)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        let status = res.status().as_u16();
        let text = res.text().await.unwrap_or_default();
        return Err(if text.is_empty() { format!("HTTP {status}") } else { format!("HTTP {status}: {}", text.chars().take(200).collect::<String>()) });
    }
    Ok(())
}
