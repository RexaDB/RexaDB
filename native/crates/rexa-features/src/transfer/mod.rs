//! Port of the data-transfer feature: lib/transfer/*, server/transfer-api.ts,
//! components/transfer/* — "Transfer Project" between Supabase / Neon /
//! Postgres connections (schema + row data + storage + auth + settings +
//! edge functions), claimed on `Route::ConnectionScreen("transfer")` and
//! `"transfer:<source connection id>"`.

pub mod adapters;
pub mod apply;
pub mod function_compat;
pub mod neon_cli;
pub mod schema_dump;
pub mod service;
pub mod sql;
pub mod supabase_api;
pub mod types;
mod wizard;

pub fn init(cx: &mut gpui::App) {
    rexa_core::Registry::screen(cx, "rexa-features", wizard::build);
}
