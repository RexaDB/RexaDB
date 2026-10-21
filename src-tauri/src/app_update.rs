//! Release checks for installs that cannot update themselves.
//!
//! The Tauri updater replaces the running binary, which a Nix install
//! cannot do: the binary lives in the read-only `/nix/store` and the user
//! updates through their flake instead. The Nix build also disables the
//! updater plugin entirely (no signing key is available for it), so the
//! in-app updater has nothing to work with there.
//!
//! This module answers the same question — "is there a newer release?" —
//! without the updater plugin, so the app can still tell a Nix user that a
//! new version exists and how to get it.

use std::time::{Duration, Instant};

use serde::Serialize;

/// The GitHub API for the newest release. Public, but it needs a User-Agent.
const RELEASES_API: &str = "https://api.github.com/repos/RexaDB/RexaDB/releases/latest";
/// The updater manifest the Tauri plugin uses. Same source of truth, and it
/// works when the API is rate limited.
const RELEASE_MANIFEST: &str =
    "https://github.com/RexaDB/RexaDB/releases/latest/download/latest.json";
/// The release page, for the "what changed" link.
const RELEASES_PAGE: &str = "https://github.com/RexaDB/RexaDB/releases/latest";

/// The time the whole check may take, both requests together: the API and
/// the manifest fallback share this budget, so a slow first request cannot
/// push the fallback past the deadline.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);

/// How the app was installed, which decides how it can be updated.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum InstallKind {
    /// A regular install (AppImage, .deb, .msi, …): the app can replace
    /// itself through the updater.
    Standalone,
    /// A Nix install: the binary lives in the read-only store, so the user
    /// updates through their flake and rebuilds.
    Nix,
}

/// The version information the app needs to show an update notice.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LatestRelease {
    /// The version the app is running.
    pub current_version: String,
    /// The newest published version, when it could be read.
    pub latest_version: Option<String>,
    /// Whether `latest_version` is newer than `current_version`.
    pub update_available: bool,
    /// Where the release notes are.
    pub release_url: Option<String>,
    /// When the release was published.
    pub published_at: Option<String>,
}

/// The install kind of the running app.
///
/// The Nix build sets `REXADB_INSTALL_KIND` through its wrapper, and the
/// binary's own path is the fallback: anything under `/nix/store` came from
/// a flake and cannot be updated in place.
#[tauri::command]
pub fn install_kind() -> InstallKind {
    if let Ok(kind) = std::env::var("REXADB_INSTALL_KIND") {
        if kind.trim().eq_ignore_ascii_case("nix") {
            return InstallKind::Nix;
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        if exe.starts_with("/nix/store") {
            return InstallKind::Nix;
        }
    }
    InstallKind::Standalone
}

/// The newest published release, compared with the running version.
#[tauri::command]
pub async fn latest_release_info() -> Result<LatestRelease, String> {
    let current_version = env!("CARGO_PKG_VERSION").to_string();
    let client = reqwest::Client::builder()
        .user_agent("RexaDB")
        .build()
        .map_err(|error| format!("Could not reach the release feed: {error}"))?;
    let deadline = Deadline::new(REQUEST_TIMEOUT);

    // The API carries the release date and the release page; the manifest is
    // the fallback for when the API is rate limited.
    match fetch_release_from_api(&client, &deadline).await {
        Ok(Some(release)) => Ok(release.into_latest(&current_version)),
        Ok(None) => fetch_release_from_manifest(&client, &deadline).await,
        Err(error) => Err(error),
    }
}

/// The time the requests may still take.
struct Deadline {
    at: Instant,
}

impl Deadline {
    fn new(budget: Duration) -> Self {
        Self {
            at: Instant::now() + budget,
        }
    }

    /// What is left of the budget, or `None` when it is spent.
    fn remaining(&self) -> Option<Duration> {
        self.at
            .checked_duration_since(Instant::now())
            .filter(|left| !left.is_zero())
    }
}

/// A release as the GitHub API reports it.
struct ApiRelease {
    version: String,
    release_url: Option<String>,
    published_at: Option<String>,
}

impl ApiRelease {
    fn into_latest(self, current_version: &str) -> LatestRelease {
        LatestRelease {
            current_version: current_version.to_string(),
            latest_version: Some(self.version.clone()),
            update_available: is_newer(current_version, &self.version),
            release_url: self.release_url,
            published_at: self.published_at,
        }
    }
}

/// Read the newest release from the GitHub API.
async fn fetch_release_from_api(
    client: &reqwest::Client,
    deadline: &Deadline,
) -> Result<Option<ApiRelease>, String> {
    let left = deadline
        .remaining()
        .ok_or_else(|| "The release feed took too long.".to_string())?;
    let response = client
        .get(RELEASES_API)
        .timeout(left)
        .send()
        .await
        .map_err(|error| format!("Could not reach GitHub: {error}"))?;
    if !response.status().is_success() {
        // Rate limited or offline: the manifest is the fallback.
        return Ok(None);
    }
    let payload: serde_json::Value = response
        .json()
        .await
        .map_err(|error| format!("Could not read the release feed: {error}"))?;

    let tag = payload
        .get("tag_name")
        .and_then(|value| value.as_str())
        .unwrap_or_default();
    let version = match parse_release_version(tag) {
        Some(version) => version,
        None => return Ok(None),
    };
    Ok(Some(ApiRelease {
        version,
        release_url: payload
            .get("html_url")
            .and_then(|value| value.as_str())
            .map(str::to_string)
            .or_else(|| Some(RELEASES_PAGE.to_string())),
        published_at: payload
            .get("published_at")
            .and_then(|value| value.as_str())
            .map(str::to_string),
    }))
}

/// Read the newest release from the updater manifest the Tauri plugin uses.
async fn fetch_release_from_manifest(
    client: &reqwest::Client,
    deadline: &Deadline,
) -> Result<LatestRelease, String> {
    let left = deadline
        .remaining()
        .ok_or_else(|| "The release feed took too long.".to_string())?;
    let response = client
        .get(RELEASE_MANIFEST)
        .timeout(left)
        .send()
        .await
        .map_err(|error| format!("Could not reach the release feed: {error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "The release feed answered with status {}",
            response.status()
        ));
    }
    let payload: serde_json::Value = response
        .json()
        .await
        .map_err(|error| format!("Could not read the release feed: {error}"))?;
    let version = payload
        .get("version")
        .and_then(|value| value.as_str())
        .and_then(parse_release_version)
        .ok_or_else(|| "The release feed did not name a version.".to_string())?;

    let current_version = env!("CARGO_PKG_VERSION").to_string();
    Ok(LatestRelease {
        current_version: current_version.clone(),
        latest_version: Some(version.clone()),
        update_available: is_newer(&current_version, &version),
        release_url: Some(RELEASES_PAGE.to_string()),
        published_at: payload
            .get("pub_date")
            .and_then(|value| value.as_str())
            .map(str::to_string),
    })
}

/// Turn a release tag into a version: `v1.3.26` -> `1.3.26`.
fn parse_release_version(tag: &str) -> Option<String> {
    let trimmed = tag.trim();
    let without_prefix = trimmed
        .strip_prefix('v')
        .or_else(|| trimmed.strip_prefix('V'))
        .unwrap_or(trimmed);
    if without_prefix.is_empty() {
        return None;
    }
    // Only accept something that is actually a version, so a tag like
    // "nightly" never becomes a bogus version.
    semver::Version::parse(without_prefix).ok()?;
    Some(without_prefix.to_string())
}

/// Whether `latest` is newer than `current`.
fn is_newer(current: &str, latest: &str) -> bool {
    match (
        semver::Version::parse(current),
        semver::Version::parse(latest),
    ) {
        (Ok(current), Ok(latest)) => latest > current,
        _ => false,
    }
}

#[cfg(test)]
mod app_update_tests {
    use super::{is_newer, parse_release_version, InstallKind};

    #[test]
    fn release_tags_become_versions() {
        assert_eq!(parse_release_version("v1.3.26").as_deref(), Some("1.3.26"));
        assert_eq!(parse_release_version("1.3.26").as_deref(), Some("1.3.26"));
        assert_eq!(parse_release_version(" v1.4.0 ").as_deref(), Some("1.4.0"));
        // A pre-release is a version too.
        assert_eq!(
            parse_release_version("v1.4.0-rc.1").as_deref(),
            Some("1.4.0-rc.1")
        );
    }

    #[test]
    fn tags_that_are_not_versions_are_rejected() {
        assert_eq!(parse_release_version("nightly"), None);
        assert_eq!(parse_release_version("v"), None);
        assert_eq!(parse_release_version(""), None);
        assert_eq!(parse_release_version("v1.3"), None);
    }

    #[test]
    fn newer_releases_are_detected() {
        assert!(is_newer("1.3.25", "1.3.26"));
        assert!(is_newer("1.3.25", "1.4.0"));
        assert!(is_newer("1.3.25", "2.0.0"));
        // A pre-release of the next version is still newer.
        assert!(is_newer("1.3.25", "1.3.26-rc.1"));
    }

    #[test]
    fn the_same_or_an_older_release_is_not_an_update() {
        assert!(!is_newer("1.3.25", "1.3.25"));
        assert!(!is_newer("1.3.26", "1.3.25"));
        assert!(!is_newer("1.3.26", "1.3.26-rc.1"));
        // Nonsense versions never claim an update.
        assert!(!is_newer("1.3.25", "nightly"));
        assert!(!is_newer("", "1.3.26"));
    }

    #[test]
    fn the_install_kind_serializes_for_the_frontend() {
        assert_eq!(serde_json::to_string(&InstallKind::Nix).unwrap(), "\"nix\"");
        assert_eq!(
            serde_json::to_string(&InstallKind::Standalone).unwrap(),
            "\"standalone\""
        );
    }

    /// Checks the release feed for real. Run it with
    /// `cargo test -- --ignored` after a release, to see that the app would
    /// notice the new version.
    #[tokio::test]
    #[ignore = "needs the network"]
    async fn the_latest_release_is_read_from_the_feed() {
        let info = super::latest_release_info()
            .await
            .expect("release check failed");
        assert_eq!(info.current_version, env!("CARGO_PKG_VERSION"));
        assert!(info.latest_version.is_some(), "no version in the feed");
        assert!(info.release_url.is_some(), "no release page in the feed");
    }

    #[test]
    fn both_requests_share_one_budget() {
        use super::Deadline;
        use std::time::Duration;

        let deadline = Deadline::new(Duration::from_secs(15));
        let first = deadline.remaining().expect("budget left");
        assert!(first <= Duration::from_secs(15));
        assert!(first > Duration::from_secs(14));

        // A spent budget stops the second request instead of starting a
        // fresh one.
        assert!(Deadline::new(Duration::ZERO).remaining().is_none());
    }
}
