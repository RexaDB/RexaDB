//! Port of lib/db/connection-fields.ts, lib/db/oracle-connection.ts,
//! lib/db/federated/connection-string.ts, lib/db/jdbc-templates.ts and the
//! connection-string helpers inside components/connections/connection-manager.tsx
//! (`parsePostgresConnectionString`, `buildPostgresConnectionString`,
//! `parseTursoConnectionString`, `buildTursoConnectionString`,
//! `buildConnectionNameFromDetails`, the JDBC `jdbc://?jdbcUrl=…` wrapper).

use serde::{Deserialize, Serialize};
use url::Url;

// ---- encoding helpers (encodeURIComponent / URLSearchParams) --------------------

pub fn encode_component(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&b) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

pub fn decode_component(s: &str) -> String {
    percent_decode(s, false)
}

fn percent_decode(s: &str, plus_space: bool) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 3 <= b.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(if plus_space && b[i] == b'+' { b' ' } else { b[i] });
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// `URLSearchParams.toString()` (application/x-www-form-urlencoded).
pub fn search_params(pairs: &[(&str, &str)]) -> String {
    url::form_urlencoded::Serializer::new(String::new()).extend_pairs(pairs.iter().copied()).finish()
}

fn query_get(u: &Url, key: &str) -> Option<String> {
    u.query_pairs().find(|(k, _)| k == key).map(|(_, v)| v.into_owned()).filter(|v| !v.is_empty())
}

fn replace_scheme_ci(s: &str, schemes: &[&str], to: &str) -> String {
    for sc in schemes {
        if s.len() >= sc.len() && s[..sc.len()].eq_ignore_ascii_case(sc) {
            return format!("{to}{}", &s[sc.len()..]);
        }
    }
    s.to_string()
}

fn starts_ci(s: &str, p: &str) -> bool {
    s.len() >= p.len() && s[..p.len()].eq_ignore_ascii_case(p)
}

// ---- field-based providers --------------------------------------------------------

#[derive(Clone, Debug, PartialEq, Default)]
pub struct FieldValues {
    pub host: String,
    pub port: String,
    pub database: String,
    pub username: String,
    pub password: String,
    pub ssl_mode: String,
    pub auth_token: String,
    pub protocol: String,
    /// Oracle only: "service" | "sid".
    pub connect_mode: Option<String>,
}

pub const FIELD_BASED_PROVIDERS: &[&str] = &[
    "timescale", "supabase", "neon", "planetscale", "cockroachdb", "yugabytedb", "redshift", "mongodb", "mysql",
    "mariadb", "mssql", "clickhouse", "redis", "oracle",
];

pub fn is_field_based(provider: &str) -> bool {
    FIELD_BASED_PROVIDERS.contains(&provider)
}

struct Defaults {
    scheme: &'static str,
    port: &'static str,
    username: &'static str,
    ssl_mode: &'static str,
    protocol: Option<&'static str>,
}

fn defaults(p: &str) -> Defaults {
    let d = |scheme, port, username, ssl_mode| Defaults { scheme, port, username, ssl_mode, protocol: None };
    match p {
        "timescale" => d("postgresql", "5432", "postgres", "prefer"),
        "supabase" | "neon" => d("postgresql", "5432", "postgres", "require"),
        "planetscale" => Defaults { protocol: Some("postgresql"), ..d("postgresql", "5432", "root", "require") },
        "cockroachdb" => d("postgresql", "26257", "root", "verify-full"),
        "yugabytedb" => d("postgresql", "5433", "yugabyte", "require"),
        "redshift" => d("postgresql", "5439", "awsuser", "require"),
        "mysql" => d("mysql", "3306", "root", "disable"),
        "mariadb" => d("mariadb", "3306", "root", "disable"),
        "mssql" => d("mssql", "1433", "sa", "disable"),
        "clickhouse" => d("clickhouse", "8123", "default", "disable"),
        "mongodb" => d("mongodb", "27017", "", "disable"),
        "redis" => d("redis", "6379", "", "disable"),
        "oracle" => d("oracle", "1521", "", "disable"),
        _ => d("postgresql", "5432", "postgres", "prefer"),
    }
}

fn is_pg_family(p: &str) -> bool {
    matches!(p, "timescale" | "supabase" | "neon" | "planetscale" | "cockroachdb" | "yugabytedb" | "redshift")
}

pub fn empty_field_values(provider: &str) -> FieldValues {
    let d = defaults(provider);
    FieldValues {
        host: "localhost".into(),
        port: d.port.into(),
        database: String::new(),
        username: d.username.into(),
        password: String::new(),
        ssl_mode: d.ssl_mode.into(),
        auth_token: String::new(),
        protocol: d.protocol.unwrap_or("postgresql").into(),
        connect_mode: (provider == "oracle").then(|| "service".into()),
    }
}

fn auth(username: &str, password: &str) -> String {
    if username.is_empty() {
        return String::new();
    }
    let pw = if password.is_empty() { String::new() } else { format!(":{}", encode_component(password)) };
    format!("{}{pw}@", encode_component(username))
}

fn ssl_on(mode: &str) -> bool {
    !mode.is_empty() && !matches!(mode, "disable" | "false" | "off" | "0")
}

pub fn build_from_fields(provider: &str, f: &FieldValues) -> String {
    let d = defaults(provider);
    let host = if f.host.trim().is_empty() { "localhost".to_string() } else { f.host.trim().to_string() };
    let port = if f.port.trim().is_empty() { d.port.to_string() } else { f.port.trim().to_string() };
    let database = f.database.trim();
    let username = f.username.trim();
    let ssl = if f.ssl_mode.is_empty() { d.ssl_mode.to_string() } else { f.ssl_mode.to_lowercase().trim().to_string() };
    let a = auth(username, &f.password);
    let path = if database.is_empty() { String::new() } else { format!("/{}", encode_component(database)) };

    if provider == "planetscale" && f.protocol == "mysql" {
        let p = if port == d.port && d.port == "5432" { "3306".to_string() } else { port };
        return format!("mysql://{a}{host}:{p}{path}?{}", search_params(&[("sslmode", "require")]));
    }
    if is_pg_family(provider) {
        return format!("postgresql://{a}{host}:{port}{path}?{}", search_params(&[("sslmode", &ssl)]));
    }
    match provider {
        "mysql" | "mariadb" => {
            let q = if ssl_on(&ssl) { format!("?{}", search_params(&[("sslmode", "require")])) } else { String::new() };
            format!("{}://{a}{host}:{port}{path}{q}", d.scheme)
        }
        "mssql" => {
            let on = ssl_on(&ssl);
            let mut pairs = vec![("encrypt", if on { "true" } else { "false" })];
            if on && ssl != "verify-full" {
                pairs.push(("trustServerCertificate", "true"));
            }
            format!("mssql://{a}{host}:{port}{path}?{}", search_params(&pairs))
        }
        "clickhouse" => format!("{}://{a}{host}:{port}{path}", if ssl_on(&ssl) { "clickhouses" } else { "clickhouse" }),
        "mongodb" => {
            let on = ssl_on(&ssl);
            if on && host.to_lowercase().contains(".mongodb.net") {
                format!("mongodb+srv://{a}{host}{path}")
            } else {
                format!("mongodb://{a}{host}:{port}{path}{}", if on { "?tls=true" } else { "" })
            }
        }
        "redis" => {
            let db = if database.is_empty() { "0" } else { database };
            format!("{}://{a}{host}:{port}/{}", if ssl_on(&ssl) { "rediss" } else { "redis" }, encode_component(db))
        }
        "oracle" => build_oracle(&OracleParts {
            host,
            port,
            username: username.into(),
            password: f.password.clone(),
            sid: f.connect_mode.as_deref() == Some("sid"),
            target: database.into(),
            ssl_mode: ssl,
        }),
        _ => format!("{}://{a}{host}:{port}{path}", d.scheme),
    }
}

pub fn parse_fields(provider: &str, cs: &str) -> FieldValues {
    if provider == "oracle" {
        let p = parse_oracle(cs);
        return FieldValues {
            host: p.host,
            port: p.port,
            database: p.target,
            username: p.username,
            password: p.password,
            ssl_mode: p.ssl_mode,
            auth_token: String::new(),
            protocol: "oracle".into(),
            connect_mode: Some(if p.sid { "sid" } else { "service" }.into()),
        };
    }
    let dv = empty_field_values(provider);
    let trimmed = cs.trim();
    if trimmed.is_empty() {
        return dv;
    }
    let pg = is_pg_family(provider);
    let parseable = if pg {
        let s = replace_scheme_ci(trimmed, &["postgresql://", "postgres://"], "http://");
        replace_scheme_ci(&s, &["postgresql:/", "postgres:/"], "http://")
    } else if provider == "clickhouse" {
        replace_scheme_ci(trimmed, &["clickhouses://"], "https://").pipe(|s| replace_scheme_ci(&s, &["clickhouse://"], "http://"))
    } else {
        trimmed.to_string()
    };
    let Ok(u) = Url::parse(&parseable) else { return dv };
    let host = u.host_str().filter(|h| !h.is_empty()).unwrap_or("localhost").to_string();
    let mut port = u.port().map(|p| p.to_string()).unwrap_or_default();
    let mut database = decode_component(u.path().trim_start_matches('/'));
    if provider == "redis" && database.is_empty() {
        database = "0".into();
    }
    let mut protocol = dv.protocol.clone();
    if provider == "planetscale" {
        if starts_ci(trimmed, "mysql:") {
            protocol = "mysql".into();
        } else if starts_ci(trimmed, "postgres") {
            protocol = "postgresql".into();
        }
        if port.is_empty() {
            port = if protocol == "mysql" { "3306" } else { "5432" }.into();
        }
    }
    let req = |b: bool| if b { "require".to_string() } else { "disable".to_string() };
    let ssl_mode = if pg {
        query_get(&u, "sslmode").map(|s| s.to_lowercase()).unwrap_or(dv.ssl_mode.clone())
    } else {
        match provider {
            "clickhouse" => req(u.scheme() == "https" || starts_ci(trimmed, "clickhouses:")),
            "mongodb" => {
                let tls = query_get(&u, "tls");
                req(starts_ci(trimmed, "mongodb+srv:")
                    || matches!(tls.as_deref(), Some("true" | "1"))
                    || query_get(&u, "ssl").as_deref() == Some("true"))
            }
            "redis" => req(starts_ci(trimmed, "rediss:")),
            "mssql" => {
                let e = query_get(&u, "encrypt").or_else(|| query_get(&u, "ssl")).unwrap_or_default().to_lowercase();
                req(!e.is_empty() && !matches!(e.as_str(), "false" | "0" | "no" | "off"))
            }
            "mysql" | "mariadb" => {
                let r = query_get(&u, "sslmode").or_else(|| query_get(&u, "ssl")).unwrap_or_default().to_lowercase();
                req(!r.is_empty() && !matches!(r.as_str(), "disable" | "false" | "0" | "off"))
            }
            _ => dv.ssl_mode.clone(),
        }
    };
    let user = decode_component(u.username());
    FieldValues {
        host,
        port,
        database,
        username: if user.is_empty() { dv.username.clone() } else { user },
        password: decode_component(u.password().unwrap_or("")),
        ssl_mode,
        auth_token: query_get(&u, "authToken").or_else(|| query_get(&u, "auth_token")).or_else(|| query_get(&u, "token")).unwrap_or_default(),
        protocol,
        connect_mode: None,
    }
}

trait Pipe: Sized {
    fn pipe<R>(self, f: impl FnOnce(Self) -> R) -> R {
        f(self)
    }
}
impl<T> Pipe for T {}

pub fn ssl_options(provider: &str, protocol: &str) -> Vec<(&'static str, &'static str)> {
    if (provider == "planetscale" && protocol == "mysql") || provider == "mysql" || provider == "mariadb" {
        return vec![("disable", "Disabled"), ("require", "Require")];
    }
    if is_pg_family(provider) {
        return PG_SSL_OPTIONS.to_vec();
    }
    if provider == "clickhouse" {
        return vec![("disable", "Disabled (HTTP)"), ("require", "Enabled (HTTPS)")];
    }
    vec![("disable", "Disabled"), ("require", "Require")]
}

pub const PG_SSL_OPTIONS: &[(&str, &str)] =
    &[("disable", "Disabled"), ("prefer", "Prefer"), ("require", "Require"), ("verify-ca", "Verify CA"), ("verify-full", "Verify Full")];

// ---- oracle --------------------------------------------------------------------------

pub struct OracleParts {
    pub host: String,
    pub port: String,
    pub username: String,
    pub password: String,
    pub sid: bool,
    pub target: String,
    pub ssl_mode: String,
}

pub fn parse_oracle(cs: &str) -> OracleParts {
    let empty = || OracleParts {
        host: "localhost".into(),
        port: "1521".into(),
        username: String::new(),
        password: String::new(),
        sid: false,
        target: String::new(),
        ssl_mode: "disable".into(),
    };
    let t = cs.trim();
    if t.is_empty() {
        return empty();
    }
    let Ok(u) = Url::parse(&replace_scheme_ci(t, &["oracle:"], "http:")) else { return empty() };
    let sid = query_get(&u, "sid").map(|s| s.trim().to_string()).unwrap_or_default();
    let path_target = decode_component(u.path().trim_start_matches('/').trim());
    OracleParts {
        host: u.host_str().filter(|h| !h.is_empty()).unwrap_or("localhost").into(),
        port: u.port().map(|p| p.to_string()).unwrap_or("1521".into()),
        username: decode_component(u.username()),
        password: decode_component(u.password().unwrap_or("")),
        target: if sid.is_empty() { path_target } else { sid.clone() },
        sid: !sid.is_empty(),
        ssl_mode: query_get(&u, "sslmode").or_else(|| query_get(&u, "ssl")).map(|s| s.to_lowercase()).unwrap_or("disable".into()),
    }
}

pub fn build_oracle(p: &OracleParts) -> String {
    let a = auth(p.username.trim(), &p.password);
    let target = p.target.trim();
    if p.sid {
        let mut pairs = vec![("sslmode", p.ssl_mode.as_str())];
        if !target.is_empty() {
            pairs.push(("sid", target));
        }
        return format!("oracle://{a}{}:{}/?{}", p.host, p.port, search_params(&pairs));
    }
    let path = if target.is_empty() { "/".to_string() } else { format!("/{}", encode_component(target)) };
    format!("oracle://{a}{}:{}{path}?{}", p.host, p.port, search_params(&[("sslmode", &p.ssl_mode)]))
}

// ---- postgres form ---------------------------------------------------------------------

#[derive(Clone, Debug, PartialEq)]
pub struct PgForm {
    pub host: String,
    pub port: String,
    pub database: String,
    pub username: String,
    pub password: String,
    pub ssl_mode: String,
    pub keychain: bool,
    pub ssh: bool,
    pub ssh_host: String,
    pub ssh_port: String,
    pub ssh_username: String,
    pub ssh_private_key_auth: bool,
    pub ssh_password: String,
    pub ssh_private_key: String,
    pub ssh_keychain: bool,
}

impl Default for PgForm {
    /// `resetConnectionDraft`.
    fn default() -> Self {
        Self {
            host: "localhost".into(),
            port: "5432".into(),
            database: String::new(),
            username: "postgres".into(),
            password: String::new(),
            ssl_mode: "prefer".into(),
            keychain: true,
            ssh: false,
            ssh_host: "192.168.1.1".into(),
            ssh_port: "22".into(),
            ssh_username: "ubuntu".into(),
            ssh_private_key_auth: false,
            ssh_password: String::new(),
            ssh_private_key: String::new(),
            ssh_keychain: true,
        }
    }
}

fn normalize_pg(conn: &str) -> String {
    let t = conn.trim();
    for sc in ["postgresql:/", "postgres:/"] {
        if starts_ci(t, sc) && !t[sc.len()..].starts_with('/') {
            return format!("{}/{}", &t[..sc.len()], &t[sc.len()..]);
        }
    }
    t.to_string()
}

/// `parsePostgresConnectionString`.
pub fn parse_postgres(conn: &str) -> Option<PgForm> {
    let t = normalize_pg(conn);
    if t.is_empty() {
        return None;
    }
    let u = Url::parse(&replace_scheme_ci(&t, &["postgresql://", "postgres://"], "http://")).ok()?;
    let host = u.host_str().filter(|h| !h.is_empty())?.to_string();
    let ssl = query_get(&u, "sslmode").unwrap_or("prefer".into()).to_lowercase();
    let q = |k: &str, d: &str| query_get(&u, k).unwrap_or_else(|| d.to_string());
    let user = decode_component(u.username());
    Some(PgForm {
        host,
        port: u.port().map(|p| p.to_string()).unwrap_or("5432".into()),
        database: decode_component(u.path().trim_start_matches('/')),
        username: if user.is_empty() { "postgres".into() } else { user },
        password: decode_component(u.password().unwrap_or("")),
        ssl_mode: if PG_SSL_OPTIONS.iter().any(|(v, _)| *v == ssl) { ssl } else { "prefer".into() },
        keychain: true,
        ssh: q("rexadb_ssh_mode", "") == "ssh",
        ssh_host: q("rexadb_ssh_host", "192.168.1.1"),
        ssh_port: q("rexadb_ssh_port", "22"),
        ssh_username: q("rexadb_ssh_user", "ubuntu"),
        ssh_private_key_auth: q("rexadb_ssh_auth", "") == "private-key",
        ssh_password: q("rexadb_ssh_password", ""),
        ssh_private_key: q("rexadb_ssh_private_key", ""),
        ssh_keychain: true,
    })
}

/// `buildPostgresConnectionString`.
pub fn build_postgres(f: &PgForm) -> String {
    let host = if f.host.trim().is_empty() { "localhost" } else { f.host.trim() };
    let port = if f.port.trim().is_empty() { "5432" } else { f.port.trim() };
    let a = auth(f.username.trim(), &f.password);
    let db = f.database.trim();
    let path = if db.is_empty() { String::new() } else { format!("/{}", encode_component(db)) };
    let mut p: Vec<(&str, String)> = vec![
        ("uselibpqcompat", "true".into()),
        ("sslmode", f.ssl_mode.clone()),
        ("rexadb_keychain_db", if f.keychain { "1" } else { "0" }.into()),
        ("rexadb_ssh_mode", if f.ssh { "ssh" } else { "off" }.into()),
    ];
    if f.ssh {
        p.push(("rexadb_ssh_host", f.ssh_host.trim().into()));
        p.push(("rexadb_ssh_port", if f.ssh_port.trim().is_empty() { "22".into() } else { f.ssh_port.trim().into() }));
        p.push(("rexadb_ssh_user", f.ssh_username.trim().into()));
        p.push(("rexadb_ssh_auth", if f.ssh_private_key_auth { "private-key" } else { "password" }.into()));
        p.push(("rexadb_ssh_keychain", if f.ssh_keychain { "1" } else { "0" }.into()));
        if f.ssh_private_key_auth {
            p.push(("rexadb_ssh_private_key", f.ssh_private_key.clone()));
        } else {
            p.push(("rexadb_ssh_password", f.ssh_password.clone()));
        }
    }
    let pairs: Vec<(&str, &str)> = p.iter().map(|(k, v)| (*k, v.as_str())).collect();
    format!("postgresql://{a}{host}:{port}{path}?{}", search_params(&pairs))
}

// ---- turso -------------------------------------------------------------------------------

pub fn parse_turso(conn: &str) -> Option<(String, String)> {
    let t = conn.trim();
    if t.is_empty() {
        return None;
    }
    let u = Url::parse(&replace_scheme_ci(t, &["libsql://"], "http://")).ok()?;
    let path = if u.path() != "/" { u.path() } else { "" };
    let host = match u.port() {
        Some(p) => format!("{}:{p}", u.host_str().unwrap_or("")),
        None => u.host_str().unwrap_or("").to_string(),
    };
    Some((format!("{host}{path}"), query_get(&u, "authToken").or_else(|| query_get(&u, "auth_token")).unwrap_or_default()))
}

pub fn turso_endpoint(endpoint: &str) -> String {
    let e = endpoint.trim();
    let e = replace_scheme_ci(e, &["libsql://"], "");
    replace_scheme_ci(&e, &["https://", "http://"], "")
}

pub fn build_turso(endpoint: &str, token: &str) -> String {
    let e = turso_endpoint(endpoint);
    if e.is_empty() {
        return String::new();
    }
    let token = token.trim();
    if token.is_empty() {
        return format!("libsql://{e}");
    }
    format!("libsql://{e}?{}", search_params(&[("authToken", token)]))
}

// ---- jdbc ----------------------------------------------------------------------------------

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JdbcTemplate {
    pub name: String,
    pub driver_class: String,
    pub url_template: String,
    pub default_port: u32,
    pub jar_url: String,
    pub logo: Option<String>,
    pub category: String,
}

pub fn jdbc_templates() -> &'static [JdbcTemplate] {
    static T: std::sync::OnceLock<Vec<JdbcTemplate>> = std::sync::OnceLock::new();
    T.get_or_init(|| serde_json::from_str(include_str!("../data/jdbc-templates.json")).expect("jdbc templates"))
}

pub fn detect_driver_template(raw: &str) -> Option<&'static JdbcTemplate> {
    let url = raw.trim().to_lowercase();
    jdbc_templates().iter().find(|t| {
        let prefix = t.url_template.split("${").next().unwrap_or("").to_lowercase();
        url.starts_with(&prefix) || (!url.starts_with("jdbc:") && url.starts_with(prefix.trim_start_matches("jdbc:")))
    })
}

pub fn detect_driver_class(raw: &str) -> String {
    detect_driver_template(raw).map(|t| t.driver_class.clone()).unwrap_or_default()
}

pub fn sample_jdbc_url(t: &JdbcTemplate) -> String {
    let port = if t.default_port == 0 { 5432 } else { t.default_port };
    t.url_template.replacen("${host}", "localhost", 1).replacen("${port}", &port.to_string(), 1).replacen("${database}", "mydb", 1)
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct JdbcForm {
    pub url: String,
    pub driver_class: String,
    pub username: String,
    pub password: String,
    pub jar_paths: Vec<String>,
}

pub fn build_jdbc(f: &JdbcForm) -> String {
    if f.url.is_empty() {
        return String::new();
    }
    let raw = f.url.trim();
    let url = if raw.starts_with("jdbc:") { raw.to_string() } else { format!("jdbc:{raw}") };
    let dc = if f.driver_class.is_empty() { detect_driver_class(&url) } else { f.driver_class.clone() };
    let jars = f.jar_paths.join(",");
    let mut p: Vec<(&str, &str)> = vec![("jdbcUrl", &url)];
    if !dc.is_empty() {
        p.push(("driverClass", &dc));
    }
    if !f.username.is_empty() {
        p.push(("user", &f.username));
    }
    if !f.password.is_empty() {
        p.push(("password", &f.password));
    }
    if !f.jar_paths.is_empty() {
        p.push(("jarPaths", &jars));
    }
    format!("jdbc://?{}", search_params(&p))
}

pub fn parse_jdbc(cs: &str) -> JdbcForm {
    match Url::parse(cs) {
        Ok(u) => {
            let g = |k: &str| query_get(&u, k).unwrap_or_default();
            JdbcForm {
                url: g("jdbcUrl"),
                driver_class: g("driverClass"),
                username: g("user"),
                password: g("password"),
                jar_paths: g("jarPaths").split(',').filter(|s| !s.is_empty()).map(str::to_string).collect(),
            }
        }
        Err(_) => JdbcForm { url: cs.into(), ..Default::default() },
    }
}

/// One installed JDBC driver (src-tauri `load_jdbc_drivers`): `<app data>/jdbc-drivers/<name>/manifest.json`.
#[derive(Clone, Debug, PartialEq)]
pub struct InstalledDriver {
    pub name: String,
    pub driver_class: String,
    pub jar_paths: Vec<String>,
}

fn jdbc_drivers_dir() -> std::path::PathBuf {
    std::env::var("REXADB_DATA_DIR")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| dirs::data_dir().unwrap_or_default().join("com.rexadb"))
        .join("jdbc-drivers")
}

#[derive(Serialize, Deserialize)]
struct Manifest {
    name: String,
    driver_class: String,
    jar_paths: Vec<String>,
    installed_at: u64,
}

/// `loadInstalledDrivers`.
pub fn load_installed_drivers() -> Vec<InstalledDriver> {
    let Ok(entries) = std::fs::read_dir(jdbc_drivers_dir()) else { return Vec::new() };
    let mut out = Vec::new();
    for e in entries.flatten() {
        if !e.file_type().is_ok_and(|t| t.is_dir()) {
            continue;
        }
        let name = e.file_name().to_string_lossy().to_string();
        let m: Option<Manifest> = std::fs::read_to_string(e.path().join("manifest.json")).ok().and_then(|s| serde_json::from_str(&s).ok());
        let driver_class = m.as_ref().map(|m| m.driver_class.clone()).unwrap_or_default();
        let mut jar_paths: Vec<String> = m.map(|m| m.jar_paths).unwrap_or_default().into_iter().filter(|p| std::path::Path::new(p).is_file()).collect();
        if jar_paths.is_empty() {
            if let Ok(sub) = std::fs::read_dir(e.path()) {
                jar_paths = sub.flatten().map(|s| s.path()).filter(|p| p.extension().is_some_and(|x| x == "jar")).map(|p| p.to_string_lossy().to_string()).collect();
            }
        }
        out.push(InstalledDriver { name, driver_class, jar_paths });
    }
    out
}

/// `saveInstalledDriver`: write the manifest next to the jars.
pub fn save_installed_driver(name: &str, driver_class: &str, jar_paths: &[String]) -> std::io::Result<()> {
    let dir = jdbc_drivers_dir().join(name);
    std::fs::create_dir_all(&dir)?;
    let m = Manifest {
        name: name.into(),
        driver_class: driver_class.into(),
        jar_paths: jar_paths.to_vec(),
        installed_at: std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64),
    };
    std::fs::write(dir.join("manifest.json"), serde_json::to_string_pretty(&m).unwrap())
}

pub fn remove_installed_driver(name: &str) -> std::io::Result<()> {
    let dir = jdbc_drivers_dir().join(name);
    if dir.exists() {
        std::fs::remove_dir_all(dir)?;
    }
    Ok(())
}

/// Where a driver's jar is downloaded to.
pub fn driver_jar_path(name: &str, jar_url: &str) -> std::path::PathBuf {
    let file = jar_url.rsplit('/').next().unwrap_or("driver.jar");
    jdbc_drivers_dir().join(name).join(file)
}

// ---- federated --------------------------------------------------------------------------------

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FederatedSource {
    pub alias: String,
    pub connection_id: i64,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub namespace: String,
}

fn normalize_federated(sources: &[FederatedSource]) -> Vec<FederatedSource> {
    sources
        .iter()
        .map(|s| FederatedSource { alias: s.alias.trim().into(), connection_id: s.connection_id, namespace: s.namespace.trim().into() })
        .filter(|s| !s.alias.is_empty() && s.connection_id > 0)
        .collect()
}

pub fn validate_federated(sources: &[FederatedSource]) -> Result<Vec<FederatedSource>, String> {
    let sources = normalize_federated(sources);
    if sources.is_empty() {
        return Err("Federated connections require at least one mapped source.".into());
    }
    let mut seen = std::collections::HashSet::new();
    for s in &sources {
        let mut chars = s.alias.chars();
        let ok = chars.next().is_some_and(|c| c.is_ascii_alphabetic() || c == '_') && chars.all(|c| c.is_ascii_alphanumeric() || c == '_');
        if !ok {
            return Err(format!("Invalid federated alias \"{}\". Use letters, numbers, and underscores only.", s.alias));
        }
        if !seen.insert(s.alias.clone()) {
            return Err(format!("Duplicate federated alias \"{}\".", s.alias));
        }
    }
    Ok(sources)
}

pub fn build_federated(sources: &[FederatedSource]) -> Result<String, String> {
    use base64::Engine;
    let sources = validate_federated(sources)?;
    let json = serde_json::json!({ "version": 1, "sources": sources }).to_string();
    Ok(format!("federated://{}", base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(json)))
}

pub fn parse_federated(cs: &str) -> Result<Vec<FederatedSource>, String> {
    use base64::Engine;
    let raw = cs.trim();
    if !starts_ci(raw, "federated://") {
        return Err("Invalid federated connection string.".into());
    }
    let payload = raw[12..].trim_end_matches('=');
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(payload).map_err(|e| e.to_string())?;
    #[derive(Deserialize)]
    struct Cfg {
        #[serde(default)]
        sources: Vec<FederatedSource>,
    }
    let cfg: Cfg = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    validate_federated(&cfg.sources)
}

/// `getFederatedDraftError` (components/federated/federated-connection-utils.ts).
pub fn federated_draft_error(s: &FederatedSource) -> Option<String> {
    if s.connection_id <= 0 {
        return Some("Select a connection.".into());
    }
    let alias = s.alias.trim();
    if alias.is_empty() {
        return Some("Alias is required.".into());
    }
    let mut chars = alias.chars();
    let ok = chars.next().is_some_and(|c| c.is_ascii_alphabetic() || c == '_') && chars.all(|c| c.is_ascii_alphanumeric() || c == '_');
    (!ok).then(|| "Alias must start with a letter or underscore and use only letters, numbers, and underscores.".into())
}

// ---- names ------------------------------------------------------------------------------------

/// `buildConnectionNameFromDetails`.
pub fn connection_name_from_details(conn: &str, provider: Option<&str>) -> String {
    let label = provider.and_then(crate::providers::card).map(|c| c.label).unwrap_or("PostgreSQL");
    let t = conn.trim();
    if t.is_empty() {
        return label.into();
    }
    let http = |s: &str| match s.find("://") {
        Some(i) if s[..i].chars().all(|c| c.is_ascii_alphanumeric() || "+.-".contains(c)) => format!("http://{}", &s[i + 3..]),
        _ => s.to_string(),
    };
    match provider {
        Some("sqlite") => {
            if t == ":memory:" {
                return "SQLite • :memory:".into();
            }
            let n = replace_scheme_ci(t, &["sqlite:"], "").trim_start_matches('/').to_string();
            let n = replace_scheme_ci(&n, &["file:"], "").trim_start_matches('/').to_string();
            format!("SQLite • {}", n.split('/').filter(|p| !p.is_empty()).last().unwrap_or("database.db"))
        }
        Some("turso") => match Url::parse(&replace_scheme_ci(t, &["libsql://"], "http://")) {
            Ok(u) => format!("Turso • {}", u.host_str().filter(|h| !h.is_empty()).unwrap_or("database")),
            Err(_) => "Turso Connection".into(),
        },
        Some("rqlite" | "starbase" | "valtown" | "d1") => match Url::parse(&http(t)) {
            Ok(u) => format!("{label} • {}", u.host_str().filter(|h| !h.is_empty()).unwrap_or("database")),
            Err(_) => label.into(),
        },
        Some("federated") => match parse_federated(t) {
            Ok(s) => format!("Federated • {} source{}", s.len(), if s.len() == 1 { "" } else { "s" }),
            Err(_) => "Federated Connection".into(),
        },
        Some("jdbc") => match Url::parse(t) {
            Ok(u) => {
                let url = query_get(&u, "jdbcUrl").unwrap_or_default();
                let dc = query_get(&u, "driverClass").unwrap_or_default();
                let db = url
                    .rsplit_once('/')
                    .map(|(_, r)| r.split('?').next().unwrap_or(""))
                    .filter(|s| !s.is_empty())
                    .unwrap_or("database")
                    .to_string();
                format!("JDBC • {db} ({})", dc.rsplit('.').next().unwrap_or(&dc))
            }
            Err(_) => "JDBC Connection".into(),
        },
        _ => match Url::parse(&http(t)) {
            Ok(u) => {
                let host = u.host_str().unwrap_or("");
                let host = host.strip_prefix("db.").unwrap_or(host);
                let db = u.path().replacen('/', "", 1);
                format!("{label} • {host}/{}", if db.is_empty() { "database" } else { &db })
            }
            Err(_) => label.into(),
        },
    }
}

/// `isNeonCliConnectionString` (lib/neon-cli/pointer.ts).
pub fn is_neon_cli(cs: &str) -> bool {
    starts_ci(cs.trim(), "neon-cli://")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn field_round_trips() {
        let mut f = empty_field_values("mysql");
        f.password = "p@ss".into();
        f.database = "app".into();
        assert_eq!(build_from_fields("mysql", &f), "mysql://root:p%40ss@localhost:3306/app");
        assert_eq!(parse_fields("mysql", "mysql://root:p%40ss@localhost:3306/app").password, "p@ss");
        let s = empty_field_values("supabase");
        assert_eq!(build_from_fields("supabase", &s), "postgresql://postgres@localhost:5432?sslmode=require");
        assert_eq!(build_from_fields("redis", &empty_field_values("redis")), "redis://localhost:6379/0");
        let mut o = empty_field_values("oracle");
        o.database = "FREEPDB1".into();
        assert_eq!(build_from_fields("oracle", &o), "oracle://localhost:1521/FREEPDB1?sslmode=disable");
        o.connect_mode = Some("sid".into());
        o.database = "ORCL".into();
        assert_eq!(build_from_fields("oracle", &o), "oracle://localhost:1521/?sslmode=disable&sid=ORCL");
        assert!(parse_fields("oracle", "oracle://localhost:1521/?sslmode=disable&sid=ORCL").connect_mode.as_deref() == Some("sid"));
    }

    #[test]
    fn postgres_form() {
        let f = PgForm { database: "app".into(), password: "x y".into(), ..Default::default() };
        let cs = build_postgres(&f);
        assert_eq!(cs, "postgresql://postgres:x%20y@localhost:5432/app?uselibpqcompat=true&sslmode=prefer&rexadb_keychain_db=1&rexadb_ssh_mode=off");
        let p = parse_postgres(&cs).unwrap();
        assert_eq!((p.password.as_str(), p.database.as_str()), ("x y", "app"));
        assert!(parse_postgres("postgresql:/u@h/db").is_some());
    }

    #[test]
    fn turso_jdbc_federated_names() {
        assert_eq!(build_turso("libsql://db.turso.io", "tok"), "libsql://db.turso.io?authToken=tok");
        assert_eq!(parse_turso("libsql://db.turso.io?authToken=tok"), Some(("db.turso.io".into(), "tok".into())));
        let j = JdbcForm { url: "postgresql://h:5432/db".into(), ..Default::default() };
        let cs = build_jdbc(&j);
        assert!(cs.starts_with("jdbc://?jdbcUrl=jdbc%3Apostgresql"), "{cs}");
        assert_eq!(parse_jdbc(&cs).url, "jdbc:postgresql://h:5432/db");
        let fed = build_federated(&[FederatedSource { alias: "app".into(), connection_id: 3, namespace: String::new() }]).unwrap();
        assert_eq!(parse_federated(&fed).unwrap().len(), 1);
        assert_eq!(connection_name_from_details(&fed, Some("federated")), "Federated • 1 source");
        assert_eq!(connection_name_from_details("postgresql://u@db.abc.supabase.co:5432/postgres", Some("supabase")), "Supabase • abc.supabase.co/postgres");
        assert_eq!(connection_name_from_details("~/x/a.db", Some("sqlite")), "SQLite • a.db");
        assert!(jdbc_templates().len() > 50);
    }
}
