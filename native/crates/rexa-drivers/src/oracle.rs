//! Port of `lib/db/oracle-client.ts`, `oracle-connection.ts`, `oracle-bridge-manager.ts`.

/// `OracleConnectionParts`
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OracleParts {
    pub host: String,
    pub port: String,
    pub username: String,
    pub password: String,
    /// SID mode (`?sid=`) instead of service name.
    pub sid_mode: bool,
    pub target: String,
    pub ssl_mode: String,
}

impl Default for OracleParts {
    fn default() -> Self {
        OracleParts {
            host: "localhost".into(),
            port: "1521".into(),
            username: String::new(),
            password: String::new(),
            sid_mode: false,
            target: String::new(),
            ssl_mode: "disable".into(),
        }
    }
}

/// `parseOracleConnectionString`
pub fn parse_oracle_connection_string(cs: &str) -> OracleParts {
    let t = cs.trim();
    if t.is_empty() {
        return OracleParts::default();
    }
    let parseable = if t.len() >= 7 && t[..7].eq_ignore_ascii_case("oracle:") { format!("http:{}", &t[7..]) } else { t.to_string() };
    let Ok(u) = url::Url::parse(&parseable) else { return OracleParts::default() };
    let get = |k: &str| u.query_pairs().find(|(n, _)| n == k).map(|(_, v)| v.trim().to_string()).filter(|v| !v.is_empty());
    let sid = get("sid");
    let path_target = crate::detect::percent_decode(u.path().trim_start_matches('/')).trim().to_string();
    let d = OracleParts::default();
    OracleParts {
        host: u.host_str().filter(|h| !h.is_empty()).map_or(d.host, str::to_string),
        port: u.port().map_or(d.port, |p| p.to_string()),
        username: crate::detect::percent_decode(u.username()),
        password: u.password().map(crate::detect::percent_decode).unwrap_or_default(),
        sid_mode: sid.is_some(),
        target: sid.unwrap_or(path_target),
        ssl_mode: get("sslmode").or_else(|| get("ssl")).map(|s| s.to_ascii_lowercase()).unwrap_or(d.ssl_mode),
    }
}
