//! Port of `lib/realtime/{types,client,table-watch}.ts`,
//! `hooks/use-table-realtime.ts`, and
//! `components/studio/toolbar/toolbar-realtime.tsx`.
//!
//! Neon: seal a live-query capability and subscribe over `neon.realtime.v1`.
//! Supabase: add the table to `supabase_realtime` and listen for
//! `postgres_changes` on the Realtime WebSocket.
//!
//! Unlike the web app, the native shell holds secrets itself (no Bun sidecar).

mod neon_seal;
pub(crate) mod neon_watch;
mod supabase;
pub(crate) mod toolbar;
mod types;
mod watch;

pub use toolbar::render_realtime_control;
pub use types::{
    realtime_provider_for, RealtimeErrorCode, RealtimeProvider, TableRealtimeStatus, REALTIME_ERROR,
};
#[allow(unused_imports)]
pub use watch::{TableWatchEvent, TableWatchHandle, TableWatchRequest};
