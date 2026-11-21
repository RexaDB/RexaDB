//! Port of `lib/db/supabase-mgmt-client.ts` + `lib/supabase-mgmt/client.ts#dbQuery`:
//! `supabase-mgmt://{projectRef}?token={PAT}` runs SQL through the
//! Management API (`POST /v1/projects/{ref}/database/query`). The endpoint
//! takes raw SQL only, so parameters are inlined ([`crate::value::inline_params`]).
//! Catalog = the shared Postgres catalog (`pgcat.rs`).

use crate::http::{client, json, objects_to_result};
use crate::*;
use std::time::Instant;

const API: &str = "https://api.supabase.com/v1";

pub struct SupabaseMgmtDriver {
    project_ref: String,
    token: String,
}

/// `parseSupabaseMgmtConnectionString`.
pub(crate) fn parse(cs: &str) -> Option<(String, String)> {
    let u = url::Url::parse(cs.trim()).ok()?;
    if u.scheme() != "supabase-mgmt" {
        return None;
    }
    let project = u.host_str().filter(|h| !h.is_empty()).map(str::to_string).unwrap_or_else(|| u.path().trim_start_matches('/').to_string());
    let token = u.query_pairs().find(|(k, _)| k == "token").map(|(_, v)| v.into_owned()).unwrap_or_default();
    (!project.is_empty() && !token.is_empty()).then_some((project, token))
}

/// `buildSupabaseMgmtConnectionString`.
pub fn build_connection_string(project_ref: &str, token: &str) -> String {
    format!("supabase-mgmt://{project_ref}?token={}", percent_encoding::utf8_percent_encode(token, percent_encoding::NON_ALPHANUMERIC))
}

impl SupabaseMgmtDriver {
    pub async fn connect(cs: &str) -> Result<Self> {
        let (project_ref, token) = parse(cs).ok_or_else(|| anyhow::anyhow!("Invalid Supabase Management API connection string"))?;
        Ok(SupabaseMgmtDriver { project_ref, token })
    }
}

#[async_trait]
impl Driver for SupabaseMgmtDriver {
    fn kind(&self) -> Kind {
        Kind::SupabaseMgmt
    }

    /// The original lists `information_schema.schemata` minus system schemas.
    async fn schemas(&self) -> Result<Vec<String>> {
        Ok(self
            .execute(
                "SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ('pg_toast', 'pg_catalog', 'information_schema') ORDER BY schema_name",
                usize::MAX,
            )
            .await?
            .first_column())
    }

    async fn tables(&self, schema: &str) -> Result<Vec<TableRef>> {
        pgcat::tables(self, schema).await
    }

    async fn execute(&self, sql: &str, row_limit: usize) -> Result<QueryResult> {
        let started = Instant::now();
        let req = client()
            .post(format!("{API}/projects/{}/database/query", self.project_ref))
            .bearer_auth(&self.token)
            .header("User-Agent", "supabase-cli")
            .json(&serde_json::json!({ "query": sql }));
        let v = json(req, "Supabase API").await?;
        let rows = match v {
            serde_json::Value::Array(a) => a,
            serde_json::Value::Object(ref o) if o.contains_key("rows") => o["rows"].as_array().cloned().unwrap_or_default(),
            _ => Vec::new(),
        };
        let mut r = objects_to_result(&rows);
        r.column_types = r.columns.iter().map(|c| ColumnMeta::new(c.clone(), "text")).collect();
        if r.rows.len() > row_limit {
            r.rows.truncate(row_limit);
            r.truncated = true;
        }
        r.elapsed = started.elapsed();
        Ok(r)
    }

    async fn execute_readonly(&self, sql: &str, row_limit: usize) -> Result<QueryResult> {
        let statements = split::split_statements(sql, Dialect::Postgres);
        if statements.len() != 1 {
            bail!("Read-only dashboard queries must contain exactly one SQL statement.");
        }
        // The management endpoint executes the script in one transaction;
        // PostgreSQL enforces the transaction's read-only mode server-side.
        self.execute(&format!("BEGIN TRANSACTION READ ONLY;\n{};\nROLLBACK;", statements[0]), row_limit).await
    }

    /// One request: the API runs the whole script in a single transaction.
    async fn transaction(&self, statements: &[String]) -> Result<Vec<QueryResult>> {
        let script = format!("BEGIN;\n{};\nCOMMIT;", statements.join(";\n"));
        self.execute(&script, usize::MAX).await?;
        Ok(statements.iter().map(|_| QueryResult::default()).collect())
    }

    async fn databases(&self) -> Result<Vec<String>> {
        Ok(Vec::new())
    }
    async fn table_infos(&self, schema: &str) -> Result<Vec<TableInfo>> {
        pgcat::table_infos(self, schema).await
    }
    async fn views(&self, schema: &str) -> Result<Vec<String>> {
        pgcat::views(self, schema).await
    }
    async fn table_structure(&self, table: &TableRef) -> Result<Vec<ColumnDetail>> {
        pgcat::table_structure(self, table).await
    }
    async fn foreign_keys(&self, table: &TableRef) -> Result<Vec<ForeignKey>> {
        pgcat::foreign_keys(self, table).await
    }
    async fn primary_key(&self, table: &TableRef) -> Result<Vec<String>> {
        pgcat::primary_key(self, table).await
    }
    async fn all_tables_with_columns(&self, schema: Option<&str>) -> Result<Vec<SchemaColumn>> {
        pgcat::all_tables_with_columns(self, schema).await
    }
    async fn indexes(&self, schema: Option<&str>) -> Result<Vec<IndexInfo>> {
        pgcat::indexes(self, schema).await
    }
    async fn constraints(&self, table: &TableRef) -> Result<Vec<ConstraintInfo>> {
        pgcat::constraints(self, table).await
    }
    async fn enums(&self) -> Result<Vec<EnumType>> {
        pgcat::enums(self).await
    }
    async fn functions(&self, schema: &str) -> Result<Vec<RoutineInfo>> {
        pgcat::functions(self, schema).await
    }
    async fn triggers(&self, schema: Option<&str>) -> Result<Vec<TriggerInfo>> {
        pgcat::triggers(self, schema).await
    }
    async fn sequences(&self, schema: &str) -> Result<Vec<SequenceInfo>> {
        pgcat::sequences(self, schema).await
    }
    async fn extensions(&self) -> Result<Vec<ExtensionInfo>> {
        pgcat::extensions(self).await
    }
    async fn rls_policies(&self, schema: Option<&str>, table: Option<&str>) -> Result<Vec<RlsPolicy>> {
        pgcat::rls_policies(self, schema, table).await
    }
    async fn table_security(&self, schema: &str) -> Result<Vec<TableSecurity>> {
        pgcat::table_security(self, schema).await
    }
    async fn roles(&self) -> Result<Vec<String>> {
        pgcat::roles(self).await
    }
    async fn materialized_views(&self, schema: &str) -> Result<Vec<MaterializedViewInfo>> {
        pgcat::materialized_views(self, schema).await
    }
    async fn sessions(&self) -> Result<QueryResult> {
        pgcat::sessions(self).await
    }
    async fn locks(&self) -> Result<QueryResult> {
        pgcat::locks(self).await
    }
    async fn kill_session(&self, pid: i64) -> Result<()> {
        self.execute(&format!("SELECT pg_terminate_backend({pid})"), 1).await.map(|_| ())
    }
    async fn cancel_session_query(&self, pid: i64) -> Result<()> {
        self.execute(&format!("SELECT pg_cancel_backend({pid})"), 1).await.map(|_| ())
    }
    async fn supabase_auth_users(&self) -> Result<Vec<AuthUser>> {
        pgcat::auth_users(self).await
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn parses() {
        assert_eq!(super::parse("supabase-mgmt://abcd?token=sbp_x"), Some(("abcd".into(), "sbp_x".into())));
        assert_eq!(super::parse("supabase-mgmt://abcd"), None);
        assert_eq!(super::build_connection_string("r", "a b"), "supabase-mgmt://r?token=a%20b");
    }
}
