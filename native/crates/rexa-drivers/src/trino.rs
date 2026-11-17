//! Port of `lib/db/trino-client.ts` + `db-engine/trino-connection.ts`:
//! REST protocol (`POST /v1/statement`, follow `nextUri`). `trino://` and
//! `trino+http://` → http, `trino+https://` → https (default port 8080),
//! plain `http(s)://` URLs are used as the base. `?catalog=` / `?schema=`
//! become `X-Trino-Catalog` / `X-Trino-Schema` (catalog defaults to
//! `system` for catalog browsing, like the original). User = `rexadb`
//! unless the URL has one.

use crate::http::{client, json, json_to_cell};
use crate::*;
use serde_json::Value as J;
use std::time::Instant;

pub struct TrinoDriver {
    base: String,
    user: String,
    password: Option<String>,
    catalog: Option<String>,
    schema: Option<String>,
}

pub(crate) fn parse(cs: &str) -> (String, Option<String>, Option<String>, String, Option<String>) {
    let raw = cs.trim();
    if raw.is_empty() {
        return ("http://127.0.0.1:8080".into(), None, None, "rexadb".into(), None);
    }
    let Ok(u) = url::Url::parse(raw) else { return ("http://127.0.0.1:8080".into(), None, None, "rexadb".into(), None) };
    let get = |k: &str| u.query_pairs().find(|(n, _)| n == k).map(|(_, v)| v.into_owned()).filter(|v| !v.is_empty());
    let (catalog, schema) = (get("catalog"), get("schema"));
    let user = (!u.username().is_empty()).then(|| crate::detect::percent_decode(u.username())).or_else(|| get("user")).unwrap_or_else(|| "rexadb".into());
    let password = u.password().map(crate::detect::percent_decode);
    let host = u.host_str().unwrap_or("127.0.0.1");
    let port = u.port().unwrap_or(8080);
    let path = if u.path() != "/" { u.path().trim_end_matches('/') } else { "" };
    let base = match u.scheme() {
        "trino+https" => format!("https://{host}:{port}{path}"),
        "trino+http" | "trino" => format!("http://{host}:{port}{path}"),
        _ => {
            let mut b = u.clone();
            b.set_query(None);
            let _ = b.set_username("");
            let _ = b.set_password(None);
            b.to_string().trim_end_matches('/').to_string()
        }
    };
    (base, catalog, schema, user, password)
}

impl TrinoDriver {
    pub async fn connect(cs: &str) -> Result<Self> {
        let (base, catalog, schema, user, password) = parse(cs);
        Ok(TrinoDriver { base, user, password, catalog, schema })
    }

    fn browse_catalog(&self) -> String {
        self.catalog.clone().unwrap_or_else(|| "system".into())
    }

    fn req(&self, r: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        let mut r = r.header("X-Trino-User", &self.user);
        if let Some(c) = &self.catalog {
            r = r.header("X-Trino-Catalog", c);
        }
        if let Some(s) = &self.schema {
            r = r.header("X-Trino-Schema", s);
        }
        if let Some(p) = &self.password {
            r = r.basic_auth(&self.user, Some(p));
        }
        r
    }

    async fn one(&self, sql: &str, row_limit: usize) -> Result<QueryResult> {
        let started = Instant::now();
        let first = self.req(client().post(format!("{}/v1/statement", self.base))).header("content-type", "text/plain").body(sql.to_string());
        let mut payload = json(first, &format!("Trino ({})", self.base)).await?;
        let mut columns: Vec<J> = Vec::new();
        let mut r = QueryResult::default();
        loop {
            if let Some(msg) = payload.pointer("/error/message").and_then(J::as_str) {
                bail!("{msg}");
            }
            if columns.is_empty() {
                if let Some(c) = payload.get("columns").and_then(J::as_array) {
                    columns = c.clone();
                }
            }
            for row in payload.get("data").and_then(J::as_array).into_iter().flatten() {
                if r.rows.len() >= row_limit {
                    r.truncated = true;
                    continue;
                }
                r.rows.push(row.as_array().into_iter().flatten().map(json_to_cell).collect());
            }
            if r.affected.is_none() {
                r.affected = payload.get("updateCount").and_then(J::as_u64);
            }
            let Some(next) = payload.get("nextUri").and_then(J::as_str).map(str::to_string) else { break };
            payload = json(self.req(client().get(next)), "Trino").await?;
        }
        r.columns = columns.iter().map(|c| c.get("name").and_then(J::as_str).unwrap_or("").to_string()).collect();
        r.column_types = columns
            .iter()
            .map(|c| ColumnMeta::new(c.get("name").and_then(J::as_str).unwrap_or(""), c.get("type").and_then(J::as_str).unwrap_or("unknown")))
            .collect();
        if r.columns.is_empty() && !r.rows.is_empty() {
            r.columns = vec!["value".into()];
        }
        r.elapsed = started.elapsed();
        Ok(r)
    }

    /// Split `catalog.schema` (what the studio passes for Trino) or use the browse catalog.
    fn cat_schema(&self, schema: &str) -> (String, String) {
        match schema.split_once('.') {
            Some((c, s)) if !c.is_empty() && !s.is_empty() => (c.to_string(), s.to_string()),
            _ => (self.browse_catalog(), schema.to_string()),
        }
    }
}

fn q(s: &str) -> String {
    Dialect::Trino.quote_ident(s)
}

#[async_trait]
impl Driver for TrinoDriver {
    fn kind(&self) -> Kind {
        Kind::Trino
    }

    /// `listSchemas(catalog)`.
    async fn schemas(&self) -> Result<Vec<String>> {
        Ok(self.one(&format!("SHOW SCHEMAS FROM {}", q(&self.browse_catalog())), usize::MAX).await?.first_column())
    }

    /// `listCatalogs`.
    async fn databases(&self) -> Result<Vec<String>> {
        Ok(self.one("SHOW CATALOGS", usize::MAX).await?.first_column())
    }

    async fn tables(&self, schema: &str) -> Result<Vec<TableRef>> {
        let (c, s) = self.cat_schema(schema);
        let sql = format!(
            "SELECT table_name, table_type FROM {}.information_schema.tables WHERE table_schema = {} ORDER BY table_name",
            q(&c),
            Dialect::Trino.quote_str(&s)
        );
        match self.one(&sql, usize::MAX).await {
            Ok(r) => Ok(r
                .records()
                .into_iter()
                .map(|r| TableRef { schema: schema.to_string(), name: r.string("table_name"), is_view: r.get("table_type") == Some("VIEW") })
                .collect()),
            Err(_) => Ok(self
                .one(&format!("SHOW TABLES FROM {}.{}", q(&c), q(&s)), usize::MAX)
                .await?
                .first_column()
                .into_iter()
                .map(|name| TableRef { schema: schema.to_string(), name, is_view: false })
                .collect()),
        }
    }

    /// The original returns no views for Trino.
    async fn views(&self, _schema: &str) -> Result<Vec<String>> {
        Ok(Vec::new())
    }

    async fn execute(&self, sql: &str, row_limit: usize) -> Result<QueryResult> {
        let mut last = QueryResult::default();
        for s in split::split_statements(sql, Dialect::Trino) {
            last = self.one(&s, row_limit).await?;
        }
        Ok(last)
    }

    /// `describeTable`.
    async fn table_structure(&self, t: &TableRef) -> Result<Vec<ColumnDetail>> {
        let (c, s) = self.cat_schema(&t.schema);
        let r = self.one(&format!("DESCRIBE {}.{}.{}", q(&c), q(&s), q(&t.name)), usize::MAX).await?;
        Ok(r.records()
            .into_iter()
            .enumerate()
            .map(|(i, r)| {
                let ty = r.opt("Type").unwrap_or_default();
                ColumnDetail {
                    column_name: r.opt("Column").unwrap_or_default(),
                    full_type: ty.clone(),
                    data_type: ty,
                    is_nullable: true,
                    comment: r.non_empty("Comment"),
                    ordinal_position: i as i64 + 1,
                    ..Default::default()
                }
            })
            .collect())
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn parses() {
        let (b, c, s, u, _) = super::parse("trino+https://me@h:8443?catalog=hive&schema=web");
        assert_eq!((b.as_str(), c.as_deref(), s.as_deref(), u.as_str()), ("https://h:8443", Some("hive"), Some("web"), "me"));
        let (b, ..) = super::parse("http://trino.local:8080/");
        assert_eq!(b, "http://trino.local:8080");
        let (b, _, _, u, _) = super::parse("trino://h");
        assert_eq!((b.as_str(), u.as_str()), ("http://h:8080", "rexadb"));
    }
}
