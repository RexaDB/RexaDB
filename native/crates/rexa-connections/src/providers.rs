//! Provider detection, labels, logos and the card subtitle, ported from
//! components/connections/connection-manager.tsx (`detectProvider`,
//! `providerCards`, `getConnectionTarget`) and shared/provider-logo.tsx.

use rexa_store::SavedConnection;

pub struct ProviderCard {
    pub id: &'static str,
    pub label: &'static str,
    pub logo: &'static str,
}

pub const PROVIDER_CARDS: &[ProviderCard] = &[
    ProviderCard { id: "postgresql", label: "PostgreSQL", logo: "providers/postgres.png" },
    ProviderCard { id: "timescale", label: "TimescaleDB", logo: "providers/timescale.png" },
    ProviderCard { id: "supabase", label: "Supabase", logo: "providers/supabase.png" },
    ProviderCard { id: "neon", label: "Neon", logo: "providers/neon.png" },
    ProviderCard { id: "planetscale", label: "PlanetScale", logo: "providers/planetscale.png" },
    ProviderCard { id: "cockroachdb", label: "CockroachDB", logo: "providers/cockroachdb.png" },
    ProviderCard { id: "yugabytedb", label: "YugabyteDB", logo: "providers/yogabyte.png" },
    ProviderCard { id: "redshift", label: "Redshift", logo: "providers/redshift.png" },
    ProviderCard { id: "mongodb", label: "MongoDB", logo: "providers/MongoDB.png" },
    ProviderCard { id: "redis", label: "Redis", logo: "providers/redis.png" },
    ProviderCard { id: "mysql", label: "MySQL", logo: "providers/mysql.png" },
    ProviderCard { id: "mariadb", label: "MariaDB", logo: "providers/mariadb.png" },
    ProviderCard { id: "mssql", label: "SQL Server", logo: "providers/sqlserver.png" },
    ProviderCard { id: "oracle", label: "Oracle", logo: "providers/Oracle.svg" },
    ProviderCard { id: "clickhouse", label: "ClickHouse", logo: "providers/clickhouse.png" },
    ProviderCard { id: "sqlite", label: "SQLite", logo: "providers/sqlite.png" },
    ProviderCard { id: "turso", label: "Turso", logo: "providers/Turso.png" },
    ProviderCard { id: "rqlite", label: "rqlite", logo: "providers/sqlite.png" },
    ProviderCard { id: "d1", label: "Cloudflare D1", logo: "providers/cloudflare.svg" },
    ProviderCard { id: "starbase", label: "StarbaseDB", logo: "providers/cloudflare.svg" },
    ProviderCard { id: "valtown", label: "Val.town", logo: "providers/sqlite.png" },
    ProviderCard { id: "duckdb", label: "DuckDB", logo: "providers/duckdb-logo.svg" },
    ProviderCard { id: "federated", label: "Federated", logo: "providers/federated.svg" },
    ProviderCard { id: "spacetimedb", label: "SpacetimeDB", logo: "providers/spacetimedb.svg" },
    ProviderCard { id: "jdbc", label: "Other Databases…", logo: "providers/jdbc.svg" },
];

/// `LOGO_MAP` from provider-logo.tsx, used when no provider card matches.
pub fn logo_for(provider: &str) -> &'static str {
    match provider.to_ascii_lowercase().as_str() {
        "mysql" => "providers/mysql.png",
        "mariadb" => "providers/mariadb.png",
        "mongo" | "mongodb" => "providers/MongoDB.png",
        "redis" => "providers/redis.png",
        "sqlite" | "rqlite" | "valtown" => "providers/sqlite.png",
        "turso" => "providers/Turso.png",
        "d1" | "cloudflare-d1" | "starbase" | "starbasedb" => "providers/cloudflare.svg",
        "clickhouse" => "providers/clickhouse.png",
        "sqlserver" | "mssql" => "providers/sqlserver.png",
        "redshift" => "providers/redshift.png",
        "supabase" | "supabase-mgmt" => "providers/supabase.png",
        "neon" => "providers/neon.png",
        "timescale" => "providers/timescale.png",
        "planetscale" => "providers/planetscale.png",
        "cockroachdb" => "providers/cockroachdb.png",
        "yugabytedb" => "providers/yogabyte.png",
        "federated" => "providers/federated.svg",
        "jdbc" => "providers/jdbc.svg",
        "oracle" => "providers/Oracle.svg",
        _ => "providers/postgres.png",
    }
}

pub fn card(provider: &str) -> Option<&'static ProviderCard> {
    PROVIDER_CARDS.iter().find(|c| c.id == provider)
}

pub fn detect(conn: &str, saved_type: Option<&str>) -> Option<String> {
    if let Some(t) = saved_type.filter(|t| !t.is_empty()) {
        return Some(match t {
            "postgres" => "postgresql".into(),
            "sqlserver" => "mssql".into(),
            other => other.into(),
        });
    }
    let n = conn.trim().to_ascii_lowercase();
    if n.is_empty() {
        return None;
    }
    let sw = |p: &str| n.starts_with(p);
    let has = |p: &str| n.contains(p);
    let explicit = has("://");
    let id = if sw("federated://") {
        "federated"
    } else if sw("mongodb://") || sw("mongodb+srv://") {
        "mongodb"
    } else if sw("redis://") || sw("rediss://") {
        "redis"
    } else if sw("duckdb://") || n.ends_with(".duckdb") || n.ends_with(".ddb") {
        "duckdb"
    } else if sw("clickhouse://") || sw("clickhouses://") || sw("clickhouse+http://") || sw("clickhouse+https://") {
        "clickhouse"
    } else if sw("spacetimedb://") || sw("spacetimedbs://") {
        "spacetimedb"
    } else if sw("mysql://") || sw("mysql:/") {
        "mysql"
    } else if sw("mariadb://") || sw("mariadb:/") {
        "mariadb"
    } else if sw("mssql://") || sw("sqlserver://") || sw("sqlserver:/")
        || (has("server=") && (has("database=") || has("initial catalog=")))
    {
        "mssql"
    } else if n == ":memory:" || sw("sqlite:") || sw("file:") || sw("/") || sw("./") || sw("../") || sw("~")
        || is_windows_path(&n)
        || (!explicit && !has("=") && !has("@"))
    {
        "sqlite"
    } else if sw("libsql://") || has(".turso.io") {
        "turso"
    } else if sw("rqlite://") || sw("rqlites://") || sw("rqlite+http://") || sw("rqlite+https://") {
        "rqlite"
    } else if sw("d1://") || sw("cloudflare-d1://") {
        "d1"
    } else if sw("starbase://") || sw("starbases://") || sw("starbasedb://") || sw("starbasedbs://") {
        "starbase"
    } else if sw("valtown://") || sw("val.town://") {
        "valtown"
    } else if has("tsdb.cloud") || has("timescale") {
        "timescale"
    } else if has("supabase.co") {
        "supabase"
    } else if has("neon.tech") {
        "neon"
    } else if has("psdb.cloud") || has("planetscale.com") {
        "planetscale"
    } else if sw("cockroachdb://") || has("cockroachlabs.cloud") || has("cockroachdb.cloud") {
        "cockroachdb"
    } else if sw("yugabytedb://") || has("yugabytecloud.com") || has("yugabyte.com") {
        "yugabytedb"
    } else if sw("redshift://") || has("redshift.amazonaws.com") || has("redshift-serverless.amazonaws.com") {
        "redshift"
    } else if sw("jdbc:") {
        "jdbc"
    } else if sw("oracle://") || sw("oracle:") {
        "oracle"
    } else {
        "postgresql"
    };
    Some(id.into())
}

fn is_windows_path(n: &str) -> bool {
    let b = n.as_bytes();
    b.len() > 2 && b[0].is_ascii_alphabetic() && b[1] == b':' && (b[2] == b'\\' || b[2] == b'/')
}

pub fn provider_of(conn: &SavedConnection) -> String {
    detect(&conn.connection_string, Some(&conn.kind)).unwrap_or_else(|| "postgresql".into())
}

/// `getConnectionTarget`: the monospace line at the bottom of a card.
pub fn target(conn: &SavedConnection) -> String {
    let raw = conn.connection_string.as_str();
    if raw.trim().is_empty() {
        return "untitled".into();
    }
    match provider_of(conn).as_str() {
        "sqlite" => {
            let t = raw.trim();
            if t == ":memory:" {
                return t.into();
            }
            let stripped = strip_prefix_ci(t, "sqlite:").map(|s| s.trim_start_matches('/'))
                .or_else(|| strip_prefix_ci(t, "file:").map(|s| s.trim_start_matches('/')))
                .unwrap_or(t);
            stripped.split('/').filter(|p| !p.is_empty()).last().unwrap_or("database.db").into()
        }
        "turso" => {
            let http = replace_scheme(raw, "libsql", "http");
            match url::Url::parse(&http) {
                Ok(u) => format!("{}{}", host_port(&u), if u.path() != "/" { u.path() } else { "" }),
                Err(_) => raw.into(),
            }
        }
        _ => {
            let normalized = normalize_pg(raw);
            let http = match normalized.find("://") {
                Some(i) if normalized[..i].chars().all(|c| c.is_ascii_alphanumeric() || "+.-".contains(c)) => {
                    format!("http://{}", &normalized[i + 3..])
                }
                _ => normalized.clone(),
            };
            if http.contains("://") && http.len() > 10 {
                match url::Url::parse(&http) {
                    Ok(u) => {
                        let host = u.host_str().filter(|h| !h.is_empty()).unwrap_or("localhost");
                        let db = u.path().replacen('/', "", 1);
                        format!("{host}/{}", if db.is_empty() { "database" } else { &db })
                    }
                    Err(_) => raw.into(),
                }
            } else {
                raw.into()
            }
        }
    }
}

fn normalize_pg(s: &str) -> String {
    let t = s.trim();
    for scheme in ["postgresql:/", "postgres:/"] {
        if let Some(rest) = strip_prefix_ci(t, scheme) {
            if !rest.starts_with('/') {
                return format!("{}/{}", &t[..scheme.len()], rest);
            }
        }
    }
    t.into()
}

fn host_port(u: &url::Url) -> String {
    match (u.host_str(), u.port()) {
        (Some(h), Some(p)) => format!("{h}:{p}"),
        (Some(h), None) => h.into(),
        _ => String::new(),
    }
}

fn replace_scheme(s: &str, from: &str, to: &str) -> String {
    match strip_prefix_ci(s, &format!("{from}://")) {
        Some(rest) => format!("{to}://{rest}"),
        None => s.into(),
    }
}

fn strip_prefix_ci<'a>(s: &'a str, prefix: &str) -> Option<&'a str> {
    (s.len() >= prefix.len() && s[..prefix.len()].eq_ignore_ascii_case(prefix)).then(|| &s[prefix.len()..])
}

#[cfg(test)]
mod tests {
    use super::*;

    fn conn(cs: &str, kind: &str) -> SavedConnection {
        SavedConnection {
            id: 1, name: "x".into(), connection_string: cs.into(), kind: kind.into(),
            environment: None, color: None, group: None, is_favorite: false, host: None, port: None,
            database: None, username: None, password: None, auth_token: None, credential_ref: None,
            credential_secret: None, tags: vec![], icon: None, last_active: None,
        }
    }

    #[test]
    fn targets_match_the_web_app() {
        assert_eq!(target(&conn("postgresql://u@aws-1-eu-north-1.pooler.supabase.com:6543/postgres", "supabase")), "aws-1-eu-north-1.pooler.supabase.com/postgres");
        assert_eq!(target(&conn("mysql://root@192.168.2.105:3306/appdb", "mysql")), "192.168.2.105/appdb");
        assert_eq!(target(&conn("~/.local/share/opencode/opencode.db", "sqlite")), "opencode.db");
        assert_eq!(target(&conn("supabase://llnwhkty", "supabase-mgmt")), "llnwhkty/database");
        assert_eq!(target(&conn("jdbc://?jdbcUrl=jdbc%3Apostgresql", "jdbc")), "jdbc://?jdbcUrl=jdbc%3Apostgresql");
    }
}
