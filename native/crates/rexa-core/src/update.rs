//! App-update state shared between the update checker (rexa-settings, port of
//! hooks/use-app-update.ts + components/providers/app-update-context.tsx) and
//! the screens that show it (the connections-home update pill, Settings →
//! Advanced → App Updates). Set as a `gpui::Global`; readers use
//! `cx.try_global::<UpdateState>()`.

/// `ConnectionsUpdatePill` input (useAppUpdateContext).
#[derive(Clone, Default, Debug)]
pub struct UpdateState {
    pub enabled: bool,
    pub checking: bool,
    pub downloading: bool,
    pub update_available: bool,
    pub update_downloaded: bool,
    pub latest_version: Option<String>,
    pub progress_percent: Option<u32>,
    pub nix: bool,
    pub dismissed: bool,
    pub updates_expired: bool,
    /// `currentVersion` (the running app's version).
    pub current_version: String,
    pub release_date: Option<String>,
    pub release_url: Option<String>,
    pub error: Option<String>,
}

impl gpui::Global for UpdateState {}
