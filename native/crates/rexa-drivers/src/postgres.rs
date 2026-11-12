use crate::*;
use anyhow::Context;
use std::time::Instant;
use tokio_postgres::{Client, SimpleQueryMessage};

pub struct PostgresDriver {
    client: Client,
}

impl PostgresDriver {
    pub async fn connect(connection_string: &str) -> Result<Self> {
        let (cs, accept_invalid) = normalize(connection_string);
        let config: tokio_postgres::Config = cs.parse().context("invalid Postgres connection string")?;
        let tls = native_tls::TlsConnector::builder()
            .danger_accept_invalid_certs(accept_invalid)
            .danger_accept_invalid_hostnames(accept_invalid)
            .build()?;
        let (client, connection) = config
            .connect(postgres_native_tls::MakeTlsConnector::new(tls))
            .await
            .context("connecting to Postgres")?;
        tokio::spawn(async move {
            if let Err(err) = connection.await {
                eprintln!("postgres connection closed: {err}");
            }
        });
        Ok(Self { client })
    }

    async fn rows(&self, sql: &str) -> Result<Vec<Vec<Cell>>> {
        Ok(self.execute(sql, usize::MAX).await?.rows)
    }
}

/// tokio-postgres treats `sslmode=require` as "verify the chain"; libpq (and
/// node-postgres) only encrypt. Keep libpq semantics: require/prefer accept any
/// cert, verify-ca/verify-full verify. Unknown params are stripped.
fn normalize(cs: &str) -> (String, bool) {
    let Ok(mut url) = url::Url::parse(cs.trim()) else { return (cs.to_string(), false) };
    let mut accept_invalid = false;
    let pairs: Vec<(String, String)> = url
        .query_pairs()
        .filter_map(|(k, v)| match k.as_ref() {
            "sslmode" => {
                let mode = match v.as_ref() {
                    "verify-ca" | "verify-full" => "require",
                    "disable" => "disable",
                    other => {
                        accept_invalid = true;
                        if other == "require" { "require" } else { "prefer" }
                    }
                };
                Some((k.into_owned(), mode.to_string()))
            }
            "user" | "password" | "dbname" | "host" | "port" | "options" | "application_name"
            | "connect_timeout" | "keepalives" | "keepalives_idle" | "target_session_attrs"
            | "channel_binding" => Some((k.into_owned(), v.into_owned())),
            _ => None,
        })
        .collect();
    if !pairs.iter().any(|(k, _)| k == "sslmode") {
        accept_invalid = true;
    }
    url.query_pairs_mut().clear().extend_pairs(pairs);
    let mut s = url.to_string();
    if s.ends_with('?') {
        s.pop();
    }
    (s, accept_invalid)
}

#[async_trait]
impl Driver for PostgresDriver {
    fn kind(&self) -> Kind {
        Kind::Postgres
    }

    async fn schemas(&self) -> Result<Vec<String>> {
        let rows = self
            .rows(
                "SELECT nspname FROM pg_namespace
                 WHERE nspname NOT LIKE 'pg\\_%' AND nspname <> 'information_schema'
                 ORDER BY nspname = 'public' DESC, nspname",
            )
            .await?;
        Ok(rows.into_iter().map(|r| r[0].display().to_string()).collect())
    }

    async fn tables(&self, schema: &str) -> Result<Vec<TableRef>> {
        let sql = format!(
            "SELECT c.relname, c.relkind IN ('v','m') FROM pg_class c
             JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = {} AND c.relkind IN ('r','p','v','m','f')
             ORDER BY c.relname",
            quote_literal(schema)
        );
        Ok(self
            .rows(&sql)
            .await?
            .into_iter()
            .map(|r| TableRef {
                schema: schema.to_string(),
                name: r[0].display().to_string(),
                is_view: r[1].display() == "t",
            })
            .collect())
    }

    async fn columns(&self, table: &TableRef) -> Result<Vec<ColumnInfo>> {
        let sql = format!(
            "SELECT a.attname, format_type(a.atttypid, a.atttypmod), NOT a.attnotnull,
                    COALESCE(a.attnum = ANY(i.indkey), false)
             FROM pg_attribute a
             JOIN pg_class c ON c.oid = a.attrelid
             JOIN pg_namespace n ON n.oid = c.relnamespace
             LEFT JOIN pg_index i ON i.indrelid = c.oid AND i.indisprimary
             WHERE n.nspname = {} AND c.relname = {} AND a.attnum > 0 AND NOT a.attisdropped
             ORDER BY a.attnum",
            quote_literal(&table.schema),
            quote_literal(&table.name)
        );
        Ok(self
            .rows(&sql)
            .await?
            .into_iter()
            .map(|r| ColumnInfo {
                name: r[0].display().to_string(),
                data_type: r[1].display().to_string(),
                nullable: r[2].display() == "t",
                is_primary_key: r[3].display() == "t",
            })
            .collect())
    }

    async fn execute(&self, sql: &str, row_limit: usize) -> Result<QueryResult> {
        let started = Instant::now();
        let messages = self.client.simple_query(sql).await.map_err(describe)?;
        // Keep only the final statement's output, like a SQL console.
        let mut result = QueryResult::default();
        for message in messages {
            match message {
                SimpleQueryMessage::RowDescription(cols) => {
                    result = QueryResult {
                        columns: cols.iter().map(|c| c.name().to_string()).collect(),
                        ..Default::default()
                    };
                }
                SimpleQueryMessage::Row(row) => {
                    if result.rows.len() >= row_limit {
                        result.truncated = true;
                        continue;
                    }
                    if result.columns.is_empty() {
                        result.columns = row.columns().iter().map(|c| c.name().to_string()).collect();
                    }
                    result.rows.push(
                        (0..row.len())
                            .map(|i| row.get(i).map_or(Cell::Null, |v| Cell::Text(v.to_string())))
                            .collect(),
                    );
                }
                SimpleQueryMessage::CommandComplete(n) if result.columns.is_empty() => {
                    result.affected = Some(n);
                }
                _ => {}
            }
        }
        result.elapsed = started.elapsed();
        Ok(result)
    }
}

/// Surface the server's message (and position/hint) instead of "db error".
fn describe(err: tokio_postgres::Error) -> anyhow::Error {
    match err.as_db_error() {
        Some(db) => {
            let mut msg = format!("{}: {}", db.severity(), db.message());
            if let Some(detail) = db.detail() {
                msg.push_str(&format!("\nDETAIL: {detail}"));
            }
            if let Some(hint) = db.hint() {
                msg.push_str(&format!("\nHINT: {hint}"));
            }
            anyhow::anyhow!(msg)
        }
        None => err.into(),
    }
}

pub(crate) fn quote_literal(s: &str) -> String {
    format!("'{}'", s.replace('\'', "''"))
}

#[cfg(test)]
mod tests {
    use super::normalize;

    #[test]
    fn sslmode_follows_libpq_semantics() {
        assert_eq!(normalize("postgres://u@h/d?sslmode=require&pgbouncer=true"), ("postgres://u@h/d?sslmode=require".into(), true));
        assert_eq!(normalize("postgres://u@h/d?sslmode=verify-full"), ("postgres://u@h/d?sslmode=require".into(), false));
        assert_eq!(normalize("postgres://u@h/d"), ("postgres://u@h/d".into(), true));
    }
}
