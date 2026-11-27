//! Port of lib/transfer/transfer-types.ts (+ errors.ts as plain messages).
//!
//! Serialized with the original's camelCase field names so exported
//! transfer packages stay interchangeable with the old app.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProviderType {
    Supabase,
    Neon,
    Postgres,
    Generic,
}

impl ProviderType {
    pub fn as_str(self) -> &'static str {
        match self {
            ProviderType::Supabase => "supabase",
            ProviderType::Neon => "neon",
            ProviderType::Postgres => "postgres",
            ProviderType::Generic => "generic",
        }
    }

    /// The wizard's `getProviderType(connectionType)`.
    pub fn from_connection_type(connection_type: &str) -> ProviderType {
        if connection_type.contains("supabase") {
            ProviderType::Supabase
        } else if connection_type.contains("neon") {
            ProviderType::Neon
        } else if connection_type.contains("postgres") {
            ProviderType::Postgres
        } else {
            ProviderType::Generic
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferOptions {
    pub include_database: bool,
    pub include_storage: bool,
    pub include_auth: bool,
    #[serde(default)]
    pub include_edge_functions: bool,
    pub include_settings: bool,
    #[serde(default)]
    pub allow_auto_ported_deploy: bool,
    #[serde(default)]
    pub batch_size: Option<u32>,
}

impl Default for TransferOptions {
    /// The wizard's initial `transferOptions`.
    fn default() -> Self {
        TransferOptions {
            include_database: true,
            include_storage: true,
            include_auth: true,
            include_edge_functions: true,
            include_settings: true,
            allow_auto_ported_deploy: false,
            batch_size: Some(100),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TransferStep {
    Validating,
    ExportingSchema,
    ExportingData,
    ExportingStorage,
    ExportingAuth,
    ExportingSettings,
    ExportingFunctions,
    ImportingSchema,
    ImportingData,
    ImportingStorage,
    ImportingAuth,
    ImportingSettings,
    ImportingFunctions,
    Finalizing,
    Complete,
}

impl TransferStep {
    /// `STEP_LABELS` (transfer-wizard.tsx).
    pub fn label(self) -> &'static str {
        match self {
            TransferStep::Validating => "Validating connections",
            TransferStep::ExportingSchema => "Exporting database",
            TransferStep::ExportingData => "Exporting table data",
            TransferStep::ExportingStorage => "Exporting storage",
            TransferStep::ExportingAuth => "Exporting auth",
            TransferStep::ExportingSettings => "Exporting settings",
            TransferStep::ImportingSchema => "Importing database",
            TransferStep::ImportingData => "Importing table data",
            TransferStep::ImportingStorage => "Importing storage",
            TransferStep::ImportingAuth => "Importing auth",
            TransferStep::ImportingSettings => "Importing settings",
            TransferStep::ExportingFunctions => "Exporting edge functions",
            TransferStep::ImportingFunctions => "Importing edge functions",
            TransferStep::Finalizing => "Finalizing",
            TransferStep::Complete => "Complete",
        }
    }
}

/// `buildTransferSteps` / the wizard's `displaySteps` (identical lists).
pub fn transfer_steps(o: &TransferOptions) -> Vec<TransferStep> {
    use TransferStep::*;
    let mut steps = vec![Validating];
    if o.include_database {
        steps.extend([ExportingSchema, ExportingData, ImportingSchema, ImportingData]);
    }
    if o.include_storage {
        steps.extend([ExportingStorage, ImportingStorage]);
    }
    if o.include_auth {
        steps.extend([ExportingAuth, ImportingAuth]);
    }
    if o.include_settings {
        steps.extend([ExportingSettings, ImportingSettings]);
    }
    if o.include_edge_functions {
        steps.extend([ExportingFunctions, ImportingFunctions]);
    }
    steps.extend([Finalizing, Complete]);
    steps
}

#[derive(Debug, Clone, PartialEq)]
pub struct TransferProgress {
    pub current_step: TransferStep,
    pub total_steps: usize,
    pub current_step_index: usize,
    pub percentage: u32,
    pub message: String,
    /// `details.item` (what's running inside a long phase).
    pub item: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseExport {
    pub schema_sql: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data_sql: Option<String>,
    pub tables: Vec<String>,
    pub row_counts: BTreeMap<String, i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exported_row_counts: Option<BTreeMap<String, i64>>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub warnings: Vec<String>,
}

impl DatabaseExport {
    pub fn exported_total(&self) -> i64 {
        self.exported_row_counts.as_ref().unwrap_or(&self.row_counts).values().sum()
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct StorageBucket {
    pub id: String,
    pub name: String,
    pub public: bool,
    pub file_size_limit: Option<i64>,
    pub allowed_mime_types: Option<Vec<String>>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageFile {
    pub bucket_id: String,
    pub path: String,
    pub metadata: serde_json::Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_base64: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<i64>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct StorageExport {
    pub buckets: Vec<StorageBucket>,
    pub files: Vec<StorageFile>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AuthUser {
    pub id: String,
    pub email: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub email_confirmed_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default)]
    pub raw_user_meta_data: serde_json::Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub encrypted_password: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AuthProvider {
    pub id: String,
    pub name: String,
    pub provider: String,
    pub secret: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AuthIdentity {
    pub id: String,
    pub user_id: String,
    pub provider: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider_id: Option<String>,
    #[serde(default)]
    pub identity_data: serde_json::Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AuthPolicy {
    pub id: String,
    pub name: String,
    pub schema: String,
    pub table: String,
    pub definition: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AuthExport {
    pub users: Vec<AuthUser>,
    pub providers: Vec<AuthProvider>,
    #[serde(default)]
    pub identities: Vec<AuthIdentity>,
    #[serde(default)]
    pub policies: Vec<AuthPolicy>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsExport {
    pub project_settings: serde_json::Map<String, serde_json::Value>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct FunctionFile {
    pub path: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FunctionCompatDiff {
    pub target_provider: ProviderType,
    pub diff: String,
    pub transformed_files: Vec<FunctionFile>,
    pub notes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportedFunction {
    pub slug: String,
    pub provider: ProviderType,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub verify_jwt: Option<bool>,
    pub files: Vec<FunctionFile>,
    pub diffs: Vec<FunctionCompatDiff>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct FunctionsExport {
    pub functions: Vec<ExportedFunction>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferPackage {
    pub version: String,
    pub exported_at: String,
    pub source_provider: ProviderType,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_project_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub database: Option<DatabaseExport>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub storage: Option<StorageExport>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auth: Option<AuthExport>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub settings: Option<SettingsExport>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub functions: Option<FunctionsExport>,
}

/// `TransferStats`; `Partial<TransferStats>` import outcomes use
/// [`StatsPatch`].
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferStats {
    pub tables_transferred: i64,
    pub rows_transferred: i64,
    pub storage_buckets_transferred: i64,
    pub storage_files_transferred: i64,
    pub auth_users_transferred: i64,
    pub auth_providers_transferred: i64,
    pub functions_transferred: i64,
}

#[derive(Debug, Clone, Default)]
pub struct StatsPatch {
    pub rows_transferred: Option<i64>,
    pub storage_buckets_transferred: Option<i64>,
    pub storage_files_transferred: Option<i64>,
    pub auth_users_transferred: Option<i64>,
    pub auth_providers_transferred: Option<i64>,
    pub functions_transferred: Option<i64>,
}

impl StatsPatch {
    pub fn merge(&mut self, o: StatsPatch) {
        macro_rules! m { ($($f:ident),*) => { $( if o.$f.is_some() { self.$f = o.$f; } )* } }
        m!(rows_transferred, storage_buckets_transferred, storage_files_transferred, auth_users_transferred, auth_providers_transferred, functions_transferred);
    }

    pub fn apply(&self, s: &mut TransferStats) {
        macro_rules! a { ($($f:ident),*) => { $( if let Some(v) = self.$f { s.$f = v; } )* } }
        a!(rows_transferred, storage_buckets_transferred, storage_files_transferred, auth_users_transferred, auth_providers_transferred, functions_transferred);
    }
}

/// `ImportOutcome`
#[derive(Debug, Clone, Default)]
pub struct ImportOutcome {
    pub warnings: Vec<String>,
    pub stats: StatsPatch,
}

/// Compat diffs surfaced on the completion screen (`FunctionDiffView`).
#[derive(Debug, Clone)]
pub struct FunctionDiffView {
    pub slug: String,
    pub target_provider: String,
    pub diff: String,
    pub notes: Vec<String>,
}

/// `TransferResult` as the job reports it to the wizard.
#[derive(Debug, Clone, Default)]
pub struct TransferResult {
    pub success: bool,
    pub stats: Option<TransferStats>,
    pub warnings: Vec<String>,
    pub error: Option<String>,
    pub function_diffs: Vec<FunctionDiffView>,
}
