use crate::*;
use anyhow::Context;
use mysql_async::prelude::*;
use mysql_async::{Opts, OptsBuilder, Pool, SslOpts, Value};
use std::time::Instant;

pub struct MySqlDriver {
    pool: Pool,
}

impl MySqlDriver {
    pub async fn connect(connection_string: &str) -> Result<Self> {
        let cs = connection_string.trim().replacen("mariadb://", "mysql://", 1);
        let mut url = url::Url::parse(&cs).context("invalid MySQL connection string")?;
        // `ssl=true` / `sslaccept=strict` (PlanetScale style) aren't mysql_async params.
        let wants_tls = url
            .query_pairs()
            .any(|(k, v)| matches!((k.as_ref(), v.as_ref()), ("ssl", "true") | ("sslaccept", _) | ("ssl-mode", "REQUIRED")));
        let kept: Vec<(String, String)> = url
            .query_pairs()
            .filter(|(k, _)| !matches!(k.as_ref(), "ssl" | "sslaccept" | "ssl-mode"))
            .map(|(k, v)| (k.into_owned(), v.into_owned()))
            .collect();
        url.query_pairs_mut().clear().extend_pairs(kept);
        let base = url.as_str().trim_end_matches('?');
        let mut opts = OptsBuilder::from_opts(Opts::from_url(base).context("invalid MySQL connection string")?);
        if wants_tls {
            opts = opts.ssl_opts(SslOpts::default());
        }
        let pool = Pool::new(opts);
        pool.get_conn().await.context("connecting to MySQL")?.ping().await?;
        Ok(Self { pool })
    }

    async fn rows(&self, sql: &str) -> Result<Vec<Vec<Cell>>> {
        Ok(self.execute(sql, usize::MAX).await?.rows)
    }
}

fn cell(value: Value) -> Cell {
    match value {
        Value::NULL => Cell::Null,
        Value::Bytes(b) => Cell::Text(match String::from_utf8(b) {
            Ok(s) => s,
            Err(e) => format!("0x{}", e.into_bytes().iter().map(|b| format!("{b:02x}")).collect::<String>()),
        }),
        Value::Int(i) => Cell::Text(i.to_string()),
        Value::UInt(u) => Cell::Text(u.to_string()),
        Value::Float(f) => Cell::Text(f.to_string()),
        Value::Double(f) => Cell::Text(f.to_string()),
        other => Cell::Text(other.as_sql(true).trim_matches('\'').to_string()),
    }
}

#[async_trait]
impl Driver for MySqlDriver {
    fn kind(&self) -> Kind {
        Kind::MySql
    }

    fn quote_ident(&self, ident: &str) -> String {
        format!("`{}`", ident.replace('`', "``"))
    }

    async fn schemas(&self) -> Result<Vec<String>> {
        let rows = self
            .rows(
                "SELECT schema_name FROM information_schema.schemata
                 WHERE schema_name NOT IN ('information_schema','performance_schema','mysql','sys')
                 ORDER BY schema_name = DATABASE() DESC, schema_name",
            )
            .await?;
        Ok(rows.into_iter().map(|r| r[0].display().to_string()).collect())
    }

    async fn tables(&self, schema: &str) -> Result<Vec<TableRef>> {
        let sql = format!(
            "SELECT table_name, table_type = 'VIEW' FROM information_schema.tables
             WHERE table_schema = {} ORDER BY table_name",
            quote_literal(schema)
        );
        Ok(self
            .rows(&sql)
            .await?
            .into_iter()
            .map(|r| TableRef {
                schema: schema.to_string(),
                name: r[0].display().to_string(),
                is_view: r[1].display() == "1",
            })
            .collect())
    }

    async fn columns(&self, table: &TableRef) -> Result<Vec<ColumnInfo>> {
        let sql = format!(
            "SELECT column_name, column_type, is_nullable = 'YES', column_key = 'PRI'
             FROM information_schema.columns
             WHERE table_schema = {} AND table_name = {} ORDER BY ordinal_position",
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
                nullable: r[2].display() == "1",
                is_primary_key: r[3].display() == "1",
            })
            .collect())
    }

    async fn execute(&self, sql: &str, row_limit: usize) -> Result<QueryResult> {
        let started = Instant::now();
        let mut conn = self.pool.get_conn().await?;
        let mut stream = conn.query_iter(sql).await?;
        let mut result;
        // Walk every result set; keep the last one, like a SQL console.
        loop {
            let columns: Vec<String> = stream
                .columns_ref()
                .iter()
                .map(|c| c.name_str().into_owned())
                .collect();
            let mut current = QueryResult { columns, ..Default::default() };
            let mut saw_set = false;
            while let Some(row) = stream.next().await? {
                saw_set = true;
                if current.rows.len() >= row_limit {
                    current.truncated = true;
                    continue;
                }
                current.rows.push(row.unwrap().into_iter().map(cell).collect());
            }
            if current.columns.is_empty() && !saw_set {
                current.affected = Some(stream.affected_rows());
            }
            result = current;
            if stream.is_empty() {
                break;
            }
        }
        drop(stream);
        result.elapsed = started.elapsed();
        Ok(result)
    }
}

fn quote_literal(s: &str) -> String {
    format!("'{}'", s.replace('\\', "\\\\").replace('\'', "''"))
}
