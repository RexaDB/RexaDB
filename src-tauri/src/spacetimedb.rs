use serde_json::Value;
use std::sync::OnceLock;
use url::Url;

static HTTP_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

fn http_client() -> &'static reqwest::Client {
    HTTP_CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .pool_max_idle_per_host(4)
            .build()
            .expect("failed to build reqwest Client")
    })
}

struct SpacetimeDbInfo {
    base_url: String,
    database: String,
    token: Option<String>,
}

fn parse_connection_string(raw: &str) -> Result<SpacetimeDbInfo, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("SpacetimeDB: empty connection string".into());
    }
    let parsed =
        Url::parse(trimmed).map_err(|e| format!("SpacetimeDB: invalid URL - {}", e))?;
    let host = parsed.host_str().unwrap_or("localhost");
    let protocol = if parsed.scheme() == "spacetimedbs" {
        "https"
    } else {
        "http"
    };
    let port = parsed
        .port()
        .unwrap_or(if protocol == "https" { 443 } else { 3000 });
    let database = parsed
        .path_segments()
        .and_then(|mut s| s.next())
        .map(|s| urlencoding::decode(s).unwrap_or_else(|_| s.into()))
        .unwrap_or_default()
        .to_string();
    if database.is_empty() {
        return Err("SpacetimeDB: database name is required".into());
    }
    let token = parsed
        .query_pairs()
        .find(|(k, _)| k == "token")
        .map(|(_, v)| v.to_string());
    Ok(SpacetimeDbInfo {
        base_url: format!("{}://{}:{}", protocol, host, port),
        database,
        token,
    })
}

fn build_headers(info: &SpacetimeDbInfo) -> reqwest::header::HeaderMap {
    let mut headers = reqwest::header::HeaderMap::new();
    if let Some(ref token) = info.token {
        if let Ok(val) = reqwest::header::HeaderValue::from_str(&format!("Bearer {}", token))
        {
            headers.insert(reqwest::header::AUTHORIZATION, val);
        }
    }
    headers
}

#[tauri::command]
pub async fn spacetimedb_query(
    connection_string: String,
    query: String,
) -> Result<Value, String> {
    let info = parse_connection_string(&connection_string)?;
    let url = format!(
        "{}/v1/database/{}/sql",
        info.base_url,
        urlencoding::encode(&info.database)
    );
    let headers = build_headers(&info);
    let res = http_client()
        .post(&url)
        .headers(headers)
        .header("content-type", "text/plain")
        .body(query)
        .send()
        .await
        .map_err(|e| format!("SpacetimeDB query request failed: {}", e))?;

    let status = res.status();
    let body = res
        .text()
        .await
        .map_err(|e| format!("SpacetimeDB read body failed: {}", e))?;

    if !status.is_success() {
        return Err(format!(
            "SpacetimeDB query failed ({}): {}",
            status, body
        ));
    }

    serde_json::from_str(&body).map_err(|e| format!("SpacetimeDB parse result failed: {}", e))
}

#[tauri::command]
pub async fn spacetimedb_fetch_schema(connection_string: String) -> Result<Value, String> {
    let info = parse_connection_string(&connection_string)?;
    let url = format!(
        "{}/v1/database/{}/schema?version=10",
        info.base_url,
        urlencoding::encode(&info.database)
    );
    let headers = build_headers(&info);
    let res = http_client()
        .get(&url)
        .headers(headers)
        .send()
        .await
        .map_err(|e| format!("SpacetimeDB schema request failed: {}", e))?;

    let status = res.status();
    let body = res
        .text()
        .await
        .map_err(|e| format!("SpacetimeDB read schema body failed: {}", e))?;

    if !status.is_success() {
        return Err(format!(
            "SpacetimeDB schema failed ({}): {}",
            status, body
        ));
    }

    serde_json::from_str(&body).map_err(|e| format!("SpacetimeDB parse schema failed: {}", e))
}

#[tauri::command]
pub async fn spacetimedb_ping(connection_string: String) -> Result<bool, String> {
    let info = parse_connection_string(&connection_string)?;
    let url = format!("{}/v1/ping", info.base_url);
    let headers = build_headers(&info);
    let res = http_client()
        .get(&url)
        .headers(headers)
        .send()
        .await
        .map_err(|e| format!("SpacetimeDB ping failed: {}", e))?;
    Ok(res.status().is_success())
}

#[tauri::command]
pub async fn spacetimedb_call_reducer(
    connection_string: String,
    reducer: String,
    args: Value,
) -> Result<Value, String> {
    let info = parse_connection_string(&connection_string)?;
    let url = format!(
        "{}/v1/database/{}/call/{}",
        info.base_url,
        urlencoding::encode(&info.database),
        urlencoding::encode(&reducer)
    );
    let headers = build_headers(&info);
    let body = serde_json::to_string(&args)
        .map_err(|e| format!("SpacetimeDB serializer args failed: {}", e))?;
    let res = http_client()
        .post(&url)
        .headers(headers)
        .header("content-type", "application/json")
        .body(body)
        .send()
        .await
        .map_err(|e| format!("SpacetimeDB call reducer failed: {}", e))?;

    let status = res.status();
    let response_body = res
        .text()
        .await
        .map_err(|e| format!("SpacetimeDB read call response failed: {}", e))?;

    if !status.is_success() {
        return Err(format!(
            "SpacetimeDB reducer '{}' failed ({}): {}",
            reducer, status, response_body
        ));
    }

    serde_json::from_str(&response_body)
        .map_err(|e| format!("SpacetimeDB parse call response failed: {}", e))
}

#[tauri::command]
pub async fn spacetimedb_fetch_logs(
    connection_string: String,
    num_lines: Option<u32>,
) -> Result<Value, String> {
    let info = parse_connection_string(&connection_string)?;
    let url = format!(
        "{}/v1/database/{}/logs?num_lines={}",
        info.base_url,
        urlencoding::encode(&info.database),
        num_lines.unwrap_or(100)
    );
    let headers = build_headers(&info);
    let res = http_client()
        .get(&url)
        .headers(headers)
        .send()
        .await
        .map_err(|e| format!("SpacetimeDB fetch logs request failed: {}", e))?;

    let status = res.status();
    let body = res
        .text()
        .await
        .map_err(|e| format!("SpacetimeDB read logs body failed: {}", e))?;

    if !status.is_success() {
        return Err(format!(
            "SpacetimeDB fetch logs failed ({}): {}",
            status, body
        ));
    }

    serde_json::from_str(&body).map_err(|e| format!("SpacetimeDB parse logs failed: {}", e))
}

#[tauri::command]
pub async fn spacetimedb_get_database_info(connection_string: String) -> Result<Value, String> {
    let info = parse_connection_string(&connection_string)?;
    let url = format!(
        "{}/v1/database/{}",
        info.base_url,
        urlencoding::encode(&info.database)
    );
    let headers = build_headers(&info);
    let res = http_client()
        .get(&url)
        .headers(headers)
        .send()
        .await
        .map_err(|e| format!("SpacetimeDB database info request failed: {}", e))?;

    let status = res.status();
    let body = res
        .text()
        .await
        .map_err(|e| format!("SpacetimeDB read db info failed: {}", e))?;

    if !status.is_success() {
        return Err(format!(
            "SpacetimeDB database info failed ({}): {}",
            status, body
        ));
    }

    serde_json::from_str(&body).map_err(|e| format!("SpacetimeDB parse db info failed: {}", e))
}
