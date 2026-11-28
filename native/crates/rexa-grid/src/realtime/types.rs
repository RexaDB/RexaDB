//! Browser-safe types from `lib/realtime/types.ts`.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RealtimeProvider {
    Neon,
    Supabase,
}

pub const REALTIME_ERROR: RealtimeErrorCodes = RealtimeErrorCodes {
    disabled: "REALTIME_DISABLED",
    pending: "REALTIME_PENDING",
    not_published: "TABLE_NOT_PUBLISHED",
    no_primary_key: "NO_PRIMARY_KEY",
    unsupported: "UNSUPPORTED",
};

pub struct RealtimeErrorCodes {
    pub disabled: &'static str,
    pub pending: &'static str,
    pub not_published: &'static str,
    pub no_primary_key: &'static str,
    pub unsupported: &'static str,
}

pub type RealtimeErrorCode = &'static str;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TableRealtimeStatus {
    Off,
    Connecting,
    Live,
    Stale,
    Error,
}

impl TableRealtimeStatus {
    pub fn label(self) -> &'static str {
        match self {
            Self::Off => "Off",
            Self::Connecting => "Connecting…",
            Self::Live => "Live",
            Self::Stale => "Reconnecting…",
            Self::Error => "Stopped",
        }
    }
}

pub fn realtime_provider_for(connection_string: &str) -> Option<RealtimeProvider> {
    let raw = connection_string.trim().to_ascii_lowercase();
    if raw.starts_with("neon-cli://") {
        Some(RealtimeProvider::Neon)
    } else if raw.starts_with("supabase-mgmt://") {
        Some(RealtimeProvider::Supabase)
    } else {
        None
    }
}
