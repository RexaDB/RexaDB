//! Port of `detectConnectionDbType` (`lib/db/connection-type.ts`), the
//! connection manager's `detectProvider` (`components/connections/
//! connection-manager.tsx`) and `getDatabaseFromConnectionString`
//! (`lib/studio/db-utils.ts`).

use crate::Kind;

fn lower(cs: &str) -> String {
    cs.trim().to_ascii_lowercase()
}

/// `assertUsableDatabaseConnectionString`: `dev://local` placeholders.
pub(crate) fn is_internal_placeholder(cs: &str) -> bool {
    let v = lower(cs);
    v == "dev://local" || v.starts_with("dev://local/")
}

fn is_likely_trino_http_url(cs: &str) -> bool {
    let Ok(u) = url::Url::parse(cs.trim()) else { return false };
    if u.scheme() != "http" && u.scheme() != "https" {
        return false;
    }
    let host = u.host_str().unwrap_or("").to_ascii_lowercase();
    let path = u.path().to_ascii_lowercase();
    host.contains("trino")
        || path.contains("/v1/statement")
        || path == "/ui"
        || path == "/ui/"
        || u.query_pairs().any(|(k, _)| k == "catalog" || k == "schema")
}

fn is_duckdb(raw: &str) -> bool {
    raw.starts_with("duckdb://") || raw.ends_with(".duckdb") || raw.ends_with(".ddb")
}

fn is_windows_path(raw: &str) -> bool {
    let b = raw.as_bytes();
    b.len() >= 3 && b[0].is_ascii_alphabetic() && b[1] == b':' && (b[2] == b'\\' || b[2] == b'/')
}

fn is_sqlite(raw: &str) -> bool {
    const PREFIXES: [&str; 20] = [
        "libsql://", "sqlite:", "file:", "rqlite://", "rqlites://", "rqlite+http://", "rqlite+https://", "d1://",
        "cloudflare-d1://", "starbase://", "starbases://", "starbasedb://", "starbasedbs://", "valtown://", "val.town://",
        "/", "./", "../", "~", ":memory:",
    ];
    let has_protocol = raw.contains("://");
    raw == ":memory:"
        || PREFIXES.iter().any(|p| raw.starts_with(p))
        || is_windows_path(raw)
        || (!has_protocol && !raw.is_empty() && !raw.contains('=') && !raw.contains('@'))
}

fn is_mysql(raw: &str) -> bool {
    if raw.starts_with("mysql://") || raw.starts_with("mariadb://") || raw.starts_with("mysql:/") || raw.starts_with("mariadb:/") {
        return true;
    }
    if !raw.contains("://") {
        // /:(3306|33060)(?:\/|$)/
        for port in [":3306", ":33060"] {
            let mut from = 0;
            while let Some(p) = raw[from..].find(port) {
                let end = from + p + port.len();
                if end == raw.len() || raw.as_bytes()[end] == b'/' {
                    return true;
                }
                from = end;
            }
        }
    }
    false
}

/// `detectConnectionDbType(connectionString, savedType)`. Returns `None`
/// only for an unknown saved type (the original would then fail with
/// "Unsupported engine").
pub fn detect_connection_db_type(connection_string: &str, saved_type: Option<&str>) -> Option<Kind> {
    let raw = lower(connection_string);
    if raw.starts_with("supabase-mgmt://") {
        return Some(Kind::SupabaseMgmt);
    }
    if raw.starts_with("spacetimedb://") || raw.starts_with("spacetimedbs://") {
        return Some(Kind::SpacetimeDb);
    }
    if let Some(saved) = saved_type {
        let n = saved.trim().to_ascii_lowercase();
        return match n.as_str() {
            "postgresql" | "postgres" => Some(Kind::Postgres),
            "sqlserver" | "mssql" => Some(Kind::MsSql),
            "mariadb" | "mysql" | "tidb" => Some(Kind::MySql),
            "turso" | "rqlite" | "d1" | "cloudflare-d1" | "starbase" | "starbasedb" | "valtown" | "sqlite" | "libsql" => {
                Some(Kind::Sqlite)
            }
            "supabase" | "neon" | "timescale" | "cockroachdb" | "yugabytedb" | "redshift" => Some(Kind::Postgres),
            "planetscale" => Some(if raw.starts_with("postgres://") || raw.starts_with("postgresql://") {
                Kind::Postgres
            } else {
                Kind::MySql
            }),
            other => Kind::from_db_type(other),
        };
    }
    if raw.starts_with("jdbc:") {
        return Some(Kind::Jdbc);
    }
    if raw.starts_with("oracle://") || raw.starts_with("oracle:") {
        return Some(Kind::Oracle);
    }
    if raw.starts_with("federated://") {
        return Some(Kind::Federated);
    }
    if is_likely_trino_http_url(connection_string)
        || raw.starts_with("trino://")
        || raw.starts_with("trino+http://")
        || raw.starts_with("trino+https://")
    {
        return Some(Kind::Trino);
    }
    if raw.starts_with("mssql://") || raw.starts_with("sqlserver://") || raw.starts_with("sqlserver:/") {
        return Some(Kind::MsSql);
    }
    if raw.contains("server=") && (raw.contains("database=") || raw.contains("initial catalog=")) {
        return Some(Kind::MsSql);
    }
    if raw.starts_with("clickhouse://")
        || raw.starts_with("clickhouses://")
        || raw.starts_with("clickhouse+http://")
        || raw.starts_with("clickhouse+https://")
    {
        return Some(Kind::ClickHouse);
    }
    if raw.starts_with("redis://") || raw.starts_with("rediss://") {
        return Some(Kind::Redis);
    }
    if raw.starts_with("mongodb://") || raw.starts_with("mongodb+srv://") {
        return Some(Kind::MongoDb);
    }
    if is_duckdb(&raw) {
        return Some(Kind::DuckDb);
    }
    if is_mysql(&raw) {
        return Some(Kind::MySql);
    }
    if is_sqlite(&raw) {
        return Some(Kind::Sqlite);
    }
    Some(Kind::Postgres)
}

/// Connection-manager provider ids (`ConnectionProvider`) — used for logos,
/// form selection and labels.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Provider {
    Postgresql,
    Timescale,
    Supabase,
    Neon,
    Planetscale,
    Cockroachdb,
    Yugabytedb,
    Redshift,
    Mongodb,
    Sqlite,
    Turso,
    Rqlite,
    D1,
    Starbase,
    Valtown,
    Mysql,
    Mariadb,
    Mssql,
    Clickhouse,
    Redis,
    Duckdb,
    Federated,
    Spacetimedb,
    Jdbc,
    Oracle,
    SupabaseMgmt,
}

impl Provider {
    pub const ALL: [Provider; 26] = [
        Provider::Postgresql,
        Provider::Timescale,
        Provider::Supabase,
        Provider::Neon,
        Provider::Planetscale,
        Provider::Cockroachdb,
        Provider::Yugabytedb,
        Provider::Redshift,
        Provider::Mongodb,
        Provider::Sqlite,
        Provider::Turso,
        Provider::Rqlite,
        Provider::D1,
        Provider::Starbase,
        Provider::Valtown,
        Provider::Mysql,
        Provider::Mariadb,
        Provider::Mssql,
        Provider::Clickhouse,
        Provider::Redis,
        Provider::Duckdb,
        Provider::Federated,
        Provider::Spacetimedb,
        Provider::Jdbc,
        Provider::Oracle,
        Provider::SupabaseMgmt,
    ];

    pub fn id(self) -> &'static str {
        match self {
            Provider::Postgresql => "postgresql",
            Provider::Timescale => "timescale",
            Provider::Supabase => "supabase",
            Provider::Neon => "neon",
            Provider::Planetscale => "planetscale",
            Provider::Cockroachdb => "cockroachdb",
            Provider::Yugabytedb => "yugabytedb",
            Provider::Redshift => "redshift",
            Provider::Mongodb => "mongodb",
            Provider::Sqlite => "sqlite",
            Provider::Turso => "turso",
            Provider::Rqlite => "rqlite",
            Provider::D1 => "d1",
            Provider::Starbase => "starbase",
            Provider::Valtown => "valtown",
            Provider::Mysql => "mysql",
            Provider::Mariadb => "mariadb",
            Provider::Mssql => "mssql",
            Provider::Clickhouse => "clickhouse",
            Provider::Redis => "redis",
            Provider::Duckdb => "duckdb",
            Provider::Federated => "federated",
            Provider::Spacetimedb => "spacetimedb",
            Provider::Jdbc => "jdbc",
            Provider::Oracle => "oracle",
            Provider::SupabaseMgmt => "supabase-mgmt",
        }
    }

    pub fn from_id(id: &str) -> Option<Provider> {
        Provider::ALL.into_iter().find(|p| p.id() == id)
    }
}

/// `detectProvider(conn, savedType)` from the connection manager.
pub fn detect_provider(connection_string: &str, saved_type: Option<&str>) -> Option<Provider> {
    if let Some(saved) = saved_type.filter(|s| !s.is_empty()) {
        return match saved {
            "postgres" => Some(Provider::Postgresql),
            "sqlserver" => Some(Provider::Mssql),
            other => Provider::from_id(other),
        };
    }
    let n = lower(connection_string);
    if n.is_empty() {
        return None;
    }
    let starts = |ps: &[&str]| ps.iter().any(|p| n.starts_with(p));
    let has = |ps: &[&str]| ps.iter().any(|p| n.contains(p));
    if n.starts_with("federated://") {
        return Some(Provider::Federated);
    }
    let has_protocol = n.contains("://");
    if starts(&["mongodb://", "mongodb+srv://"]) {
        return Some(Provider::Mongodb);
    }
    if starts(&["redis://", "rediss://"]) {
        return Some(Provider::Redis);
    }
    if n.starts_with("duckdb://") || n.ends_with(".duckdb") || n.ends_with(".ddb") {
        return Some(Provider::Duckdb);
    }
    if starts(&["clickhouse://", "clickhouses://", "clickhouse+http://", "clickhouse+https://"]) {
        return Some(Provider::Clickhouse);
    }
    if starts(&["spacetimedb://", "spacetimedbs://"]) {
        return Some(Provider::Spacetimedb);
    }
    if starts(&["mysql://", "mysql:/"]) {
        return Some(Provider::Mysql);
    }
    if starts(&["mariadb://", "mariadb:/"]) {
        return Some(Provider::Mariadb);
    }
    if starts(&["mssql://", "sqlserver://", "sqlserver:/"]) {
        return Some(Provider::Mssql);
    }
    if n.contains("server=") && (n.contains("database=") || n.contains("initial catalog=")) {
        return Some(Provider::Mssql);
    }
    if n == ":memory:"
        || starts(&["sqlite:", "file:", "/", "./", "../", "~"])
        || is_windows_path(&n)
        || (!has_protocol && !n.contains('=') && !n.contains('@'))
    {
        return Some(Provider::Sqlite);
    }
    if n.starts_with("libsql://") || n.contains(".turso.io") {
        return Some(Provider::Turso);
    }
    if starts(&["rqlite://", "rqlites://", "rqlite+http://", "rqlite+https://"]) {
        return Some(Provider::Rqlite);
    }
    if starts(&["d1://", "cloudflare-d1://"]) {
        return Some(Provider::D1);
    }
    if starts(&["starbase://", "starbases://", "starbasedb://", "starbasedbs://"]) {
        return Some(Provider::Starbase);
    }
    if starts(&["valtown://", "val.town://"]) {
        return Some(Provider::Valtown);
    }
    if has(&["tsdb.cloud", "timescale.com", "timescaledb.com", "timescale"]) {
        return Some(Provider::Timescale);
    }
    if n.contains("supabase.co") {
        return Some(Provider::Supabase);
    }
    if n.contains("neon.tech") {
        return Some(Provider::Neon);
    }
    if has(&["psdb.cloud", "planetscale.com"]) {
        return Some(Provider::Planetscale);
    }
    if n.starts_with("cockroachdb://") || has(&["cockroachlabs.cloud", "cockroachdb.cloud"]) {
        return Some(Provider::Cockroachdb);
    }
    if n.starts_with("yugabytedb://") || has(&["yugabytecloud.com", "yugabyte.com"]) {
        return Some(Provider::Yugabytedb);
    }
    if n.starts_with("redshift://") || has(&["redshift.amazonaws.com", "redshift-serverless.amazonaws.com"]) {
        return Some(Provider::Redshift);
    }
    if n.starts_with("jdbc:") {
        return Some(Provider::Jdbc);
    }
    if starts(&["oracle://", "oracle:"]) {
        return Some(Provider::Oracle);
    }
    if starts(&["postgres://", "postgresql://", "postgres:/", "postgresql:/"]) {
        return Some(Provider::Postgresql);
    }
    None
}

/// `getMongoDatabaseFromConnectionString`
pub fn mongo_database(cs: &str) -> String {
    url::Url::parse(cs.trim())
        .ok()
        .filter(|u| u.scheme().eq_ignore_ascii_case("mongodb") || u.scheme().eq_ignore_ascii_case("mongodb+srv"))
        .map(|u| percent_decode(u.path().trim_start_matches('/')).trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "admin".into())
}

pub(crate) fn percent_decode(s: &str) -> String {
    percent_encoding::percent_decode_str(s).decode_utf8_lossy().into_owned()
}

fn url_db_name(cs: &str) -> Option<String> {
    let u = url::Url::parse(cs).ok()?;
    let p = percent_decode(u.path().trim_start_matches('/'));
    let first = p.split('/').next().unwrap_or("").trim().to_string();
    (!first.is_empty()).then_some(first)
}

/// `getDatabaseFromConnectionString` (`lib/studio/db-utils.ts`).
pub fn database_name(cs: &str) -> String {
    if cs.is_empty() {
        return "postgres".into();
    }
    let kind = detect_connection_db_type(cs, None).unwrap_or(Kind::Postgres);
    match kind {
        Kind::MongoDb => mongo_database(cs),
        Kind::Redis => format!("db{}", crate::redis::db_index(cs)),
        Kind::Federated => "federated".into(),
        Kind::Trino => url::Url::parse(cs)
            .ok()
            .and_then(|u| u.query_pairs().find(|(k, _)| k == "schema").map(|(_, v)| v.into_owned()))
            .unwrap_or_else(|| "default".into()),
        Kind::SupabaseMgmt => url::Url::parse(cs).ok().and_then(|u| u.host_str().map(str::to_string)).unwrap_or_else(|| "supabase".into()),
        Kind::MsSql => {
            if cs.contains(';') {
                for part in cs.split(';') {
                    if let Some((k, v)) = part.split_once('=') {
                        let k = k.trim().to_ascii_lowercase();
                        if (k == "database" || k == "initial catalog") && !v.trim().is_empty() {
                            return v.trim().to_string();
                        }
                    }
                }
            }
            url_db_name(&cs.replacen("sqlserver:", "mssql:", 1)).unwrap_or_else(|| "master".into())
        }
        Kind::MySql => {
            let n = if cs.contains("://") { cs.to_string() } else { format!("mysql://{cs}") };
            let n = if n.to_ascii_lowercase().starts_with("mysql:/") && !n.contains("://") { n.replacen(":/", "://", 1) } else { n };
            url_db_name(&n).unwrap_or_else(|| "mysql".into())
        }
        Kind::ClickHouse => {
            let n = cs
                .replacen("clickhouse+https:", "https:", 1)
                .replacen("clickhouse+http:", "http:", 1)
                .replacen("clickhouses:", "https:", 1)
                .replacen("clickhouse:", "http:", 1);
            url_db_name(&n).unwrap_or_else(|| "default".into())
        }
        Kind::Sqlite => {
            let t = cs.trim();
            if t == ":memory:" {
                return t.into();
            }
            if t.to_ascii_lowercase().starts_with("libsql://") {
                return url::Url::parse(t)
                    .ok()
                    .map(|u| {
                        let p = percent_decode(u.path().trim_start_matches('/'));
                        if p.trim().is_empty() { u.host_str().unwrap_or("turso").to_string() } else { p }
                    })
                    .unwrap_or_else(|| "turso".into());
            }
            let raw = t.split(['?', '#']).next().unwrap_or(t);
            raw.rsplit(['/', '\\']).next().unwrap_or(raw).to_string()
        }
        _ => url_db_name(cs).unwrap_or_else(|| "postgres".into()),
    }
}

/// `useStudio#fallbackSchemaForDb`.
pub(crate) fn fallback_schema(kind: Kind, cs: &str) -> String {
    match kind {
        Kind::Postgres | Kind::SupabaseMgmt => "public".into(),
        Kind::MsSql => "dbo".into(),
        Kind::Oracle => {
            let user = crate::oracle::parse_oracle_connection_string(cs).username.to_uppercase();
            if user.is_empty() { "REXADB".into() } else { user }
        }
        Kind::MySql | Kind::ClickHouse | Kind::Redis => database_name(cs),
        Kind::Sqlite => "main".into(),
        _ => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(cs: &str) -> Kind {
        detect_connection_db_type(cs, None).unwrap()
    }

    #[test]
    fn detects_like_the_original() {
        assert_eq!(d("postgres://u@h/d"), Kind::Postgres);
        assert_eq!(d("host=x user=y"), Kind::Postgres);
        assert_eq!(d("mysql://u@h/d"), Kind::MySql);
        assert_eq!(d("u:p@host:3306/db"), Kind::MySql);
        assert_eq!(d("/tmp/a.db"), Kind::Sqlite);
        assert_eq!(d("C:\\data\\a.db"), Kind::Sqlite);
        assert_eq!(d("libsql://x.turso.io"), Kind::Sqlite);
        assert_eq!(d("rqlite://h:4001"), Kind::Sqlite);
        assert_eq!(d("a.duckdb"), Kind::DuckDb);
        assert_eq!(d("duckdb://:memory:"), Kind::DuckDb);
        assert_eq!(d("mongodb+srv://c.x/db"), Kind::MongoDb);
        assert_eq!(d("rediss://h"), Kind::Redis);
        assert_eq!(d("clickhouses://h/db"), Kind::ClickHouse);
        assert_eq!(d("Server=h;Database=d;User Id=u"), Kind::MsSql);
        assert_eq!(d("sqlserver://h"), Kind::MsSql);
        assert_eq!(d("http://trino.local:8080"), Kind::Trino);
        assert_eq!(d("https://h/x?catalog=hive"), Kind::Trino);
        assert_eq!(d("trino+https://h"), Kind::Trino);
        assert_eq!(d("jdbc:?jdbcUrl=x"), Kind::Jdbc);
        assert_eq!(d("oracle://u:p@h:1521/XE"), Kind::Oracle);
        assert_eq!(d("federated://abc"), Kind::Federated);
        assert_eq!(d("spacetimedb://h/db"), Kind::SpacetimeDb);
        assert_eq!(d("supabase-mgmt://ref?token=x"), Kind::SupabaseMgmt);
    }

    #[test]
    fn saved_type_wins() {
        let s = |t, cs| detect_connection_db_type(cs, Some(t));
        assert_eq!(s("supabase", "x"), Some(Kind::Postgres));
        assert_eq!(s("turso", "libsql://x"), Some(Kind::Sqlite));
        assert_eq!(s("planetscale", "mysql://x"), Some(Kind::MySql));
        assert_eq!(s("planetscale", "postgresql://x"), Some(Kind::Postgres));
        assert_eq!(s("sqlserver", "x"), Some(Kind::MsSql));
        assert_eq!(s("redis", "x"), Some(Kind::Redis));
        assert_eq!(s("nope", "x"), None);
        // spacetimedb:// beats the saved type
        assert_eq!(s("postgres", "spacetimedb://h/db"), Some(Kind::SpacetimeDb));
        assert_eq!(Kind::detect("", "mysql://h/d"), Some(Kind::MySql));
    }

    #[test]
    fn providers() {
        let p = |cs| detect_provider(cs, None);
        assert_eq!(p("postgresql://u@db.abc.supabase.co/postgres"), Some(Provider::Supabase));
        assert_eq!(p("postgres://u@ep-x.neon.tech/db"), Some(Provider::Neon));
        assert_eq!(p("libsql://x.turso.io"), Some(Provider::Turso));
        assert_eq!(p("mariadb://h/d"), Some(Provider::Mariadb));
        assert_eq!(p("postgres://localhost/x"), Some(Provider::Postgresql));
        assert_eq!(detect_provider("x", Some("postgres")), Some(Provider::Postgresql));
    }

    #[test]
    fn database_names() {
        assert_eq!(database_name("mysql://u@h:3306/shop"), "shop");
        assert_eq!(database_name("Server=h;Database=Sales"), "Sales");
        assert_eq!(database_name("/tmp/x/app.db"), "app.db");
        assert_eq!(database_name("redis://h/3"), "db3");
        assert_eq!(fallback_schema(Kind::Postgres, ""), "public");
    }
}
