//! PayKit schema constants + status query builders (port of `lib/supabase-paykit/paykit-sql.ts`).

use serde::Deserialize;
use std::sync::OnceLock;

const RAW: &str = include_str!("assets/paykit-constants.json");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Constants {
    schema_statements: Vec<String>,
    schema_setup_count: usize,
    table_names: Vec<String>,
    grant_statements: Vec<String>,
    required_privileges: Vec<String>,
    schema_version: String,
    webhook_events: Vec<String>,
    required_secrets: Vec<String>,
    api_slug: String,
    webhook_slug: String,
    template_version: String,
}

fn constants() -> &'static Constants {
    static C: OnceLock<Constants> = OnceLock::new();
    C.get_or_init(|| serde_json::from_str(RAW).expect("paykit-constants.json"))
}

pub const PAYKIT_SCHEMA: &str = "paykit";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SchemaPhase {
    Schema,
    Tables,
    All,
}

pub fn schema_setup_count() -> usize {
    constants().schema_setup_count
}

pub fn schema_statements() -> &'static [String] {
    &constants().schema_statements
}

pub fn schema_statements_for(phase: SchemaPhase) -> &'static [String] {
    let all = schema_statements();
    let n = schema_setup_count().min(all.len());
    match phase {
        SchemaPhase::Schema => &all[..n],
        SchemaPhase::Tables => &all[n..],
        SchemaPhase::All => all,
    }
}

pub fn table_names() -> &'static [String] {
    &constants().table_names
}

pub fn grant_statements() -> &'static [String] {
    &constants().grant_statements
}

pub fn required_privileges() -> &'static [String] {
    &constants().required_privileges
}

pub fn schema_version() -> &'static str {
    &constants().schema_version
}

pub fn webhook_events() -> &'static [String] {
    &constants().webhook_events
}

pub fn required_secrets() -> &'static [String] {
    &constants().required_secrets
}

pub fn api_slug() -> &'static str {
    &constants().api_slug
}

pub fn webhook_slug() -> &'static str {
    &constants().webhook_slug
}

pub fn template_version() -> &'static str {
    &constants().template_version
}

pub fn rls_statement(table: &str) -> Option<String> {
    if !table_names().iter().any(|t| t == table) {
        return None;
    }
    Some(format!("ALTER TABLE \"{PAYKIT_SCHEMA}\".\"{table}\" ENABLE ROW LEVEL SECURITY"))
}

pub fn tables_presence_query() -> String {
    let tables = table_names().iter().map(|t| format!("'{t}'")).collect::<Vec<_>>().join(", ");
    format!("SELECT tablename AS table_name FROM pg_tables WHERE schemaname = '{PAYKIT_SCHEMA}' AND tablename IN ({tables})")
}

pub fn rls_status_query() -> String {
    let tables = table_names().iter().map(|t| format!("'{t}'")).collect::<Vec<_>>().join(", ");
    format!(
        "SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = '{PAYKIT_SCHEMA}' AND c.relkind = 'r' AND c.relname IN ({tables})"
    )
}

pub fn grants_status_query() -> String {
    let tables = table_names().iter().map(|t| format!("'{t}'")).collect::<Vec<_>>().join(", ");
    format!(
        "SELECT table_name, privilege_type FROM information_schema.role_table_grants WHERE table_schema = '{PAYKIT_SCHEMA}' AND grantee = 'service_role' AND table_name IN ({tables})"
    )
}

/// Merge `paykit` into a PostgREST `db_schema` list. `None` when already present.
pub fn merge_exposed_schemas(current: Option<&str>) -> Option<String> {
    let mut parts: Vec<String> = current.unwrap_or("").split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect();
    if parts.iter().any(|p| p == PAYKIT_SCHEMA) {
        return None;
    }
    parts.push(PAYKIT_SCHEMA.into());
    Some(parts.join(","))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn phase_lengths() {
        assert_eq!(schema_statements().len(), 55);
        assert_eq!(schema_setup_count(), 4);
        assert_eq!(schema_statements_for(SchemaPhase::Schema).len(), 4);
        assert_eq!(schema_statements_for(SchemaPhase::Tables).len(), 51);
        assert_eq!(schema_statements_for(SchemaPhase::All).len(), 55);
        assert_eq!(template_version(), "3");
        assert_eq!(schema_version(), "paykit-schema-1");
        assert_eq!(table_names().len(), 10);
        assert_eq!(webhook_events().len(), 11);
    }

    #[test]
    fn merge_schemas() {
        assert_eq!(merge_exposed_schemas(None).as_deref(), Some("paykit"));
        assert_eq!(merge_exposed_schemas(Some("public")).as_deref(), Some("public,paykit"));
        assert_eq!(merge_exposed_schemas(Some("public, paykit")), None);
    }
}
