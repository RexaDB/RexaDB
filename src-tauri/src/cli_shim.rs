//! Auto-installs the `rexadb` terminal command on first launch (and repairs
//! it on later launches if the app moved).
//!
//! Strategy (macOS/Linux, no sudo, no prompts):
//! - symlink `~/.local/bin/rexadb` -> the running app binary, so
//!   `rexadb open <database-url-or-file-path>` works from any terminal;
//! - ensure `~/.local/bin` is on PATH by appending a marker-guarded export
//!   block to the rc file of the shell the user actually uses (zsh, bash,
//!   fish, nushell). The marker makes the operation idempotent — never
//!   duplicated, never touches other lines.
//!
//! Only the user's own shell is touched: a nushell user never gets a
//! `.zshrc` written for them, and a zsh user never gets a fish config. A
//! shell we do not support is no reason to guess a different one; when the
//! shell cannot be determined at all, only rc files that already exist are
//! patched, so no file is created for a shell nobody uses.
//!
//! A read-only home (common on NixOS) is not an error: the app cannot write
//! there and the user cannot act on it, so those failures stay quiet.
//!
//! A real executable shim is used instead of a shell `alias` so it also works
//! from scripts, subshells and GUI-launched terminals. Windows is skipped:
//! there is no per-user bin convention reachable without installer support.

use std::path::{Path, PathBuf};

const SHIM_NAME: &str = "rexadb";
const MARKER: &str = "rexa-db terminal command";

/// PATH line for POSIX shells (zsh, bash).
const PATH_EXPORT: &str = "export PATH=\"$HOME/.local/bin:$PATH\"";
/// PATH line for fish.
const FISH_PATH_EXPORT: &str = "fish_add_path $HOME/.local/bin";

/// Shells we know how to put `~/.local/bin` on PATH for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Shell {
    Zsh,
    Bash,
    Fish,
    Nushell,
}

/// What `$SHELL` told us about the user's shell.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ShellHint {
    /// `$SHELL` names a shell we support.
    Known(Shell),
    /// `$SHELL` names a shell we do not support. Not a reason to guess a
    /// different one: the user may not even run bash.
    Unsupported,
    /// `$SHELL` is not set — fall back to the configs the user has.
    Missing,
}

/// Map a shell executable path to the shell it is (`/usr/bin/nu` -> nushell).
fn shell_from_path(value: &str) -> Option<Shell> {
    let name = Path::new(value).file_stem()?.to_str()?.to_ascii_lowercase();
    match name.as_str() {
        "zsh" => Some(Shell::Zsh),
        "bash" => Some(Shell::Bash),
        "fish" => Some(Shell::Fish),
        "nu" | "nushell" => Some(Shell::Nushell),
        _ => None,
    }
}

/// What the environment says about the user's shell.
#[cfg(not(windows))]
fn shell_hint_from_environment() -> ShellHint {
    match std::env::var("SHELL") {
        Ok(value) => match shell_from_path(&value) {
            Some(shell) => ShellHint::Known(shell),
            None => ShellHint::Unsupported,
        },
        Err(_) => ShellHint::Missing,
    }
}

/// The paths the installer works with.
///
/// Everything is resolved once, up front, from the environment. Nothing
/// below reads the environment again, so a decision is never taken from a
/// half-changed environment — and the tests can point the paths at a scratch
/// directory instead of the developer's own home.
struct InstallPaths {
    home: PathBuf,
    /// `XDG_CONFIG_HOME`, when it is set.
    xdg_config_home: Option<PathBuf>,
    /// What `$SHELL` told us.
    shell_hint: ShellHint,
}

impl InstallPaths {
    /// The paths of the user running the app.
    #[cfg(not(windows))]
    fn from_environment() -> Option<Self> {
        Some(Self {
            home: home_dir()?,
            xdg_config_home: xdg_config_home(),
            shell_hint: shell_hint_from_environment(),
        })
    }

    /// The user's shell.
    ///
    /// `$SHELL` decides when it names a shell we know. A shell we do not know
    /// (`ksh`, `dash`, …) is not a reason to guess another one — that would
    /// write a startup file for a shell the user never runs — so it falls
    /// through to the existing-files-only path. Only a missing `$SHELL` is
    /// inferred from the configs the user has.
    fn user_shell(&self) -> Option<Shell> {
        match self.shell_hint {
            ShellHint::Known(shell) => Some(shell),
            ShellHint::Unsupported => None,
            ShellHint::Missing => self.infer_shell(),
        }
    }

    /// Guess the shell from the config files the user already has. Used when
    /// `$SHELL` is missing (GUI launch, minimal environment): the config that
    /// exists is the one the user actually reads.
    fn infer_shell(&self) -> Option<Shell> {
        if self.nushell_config_file().exists() {
            return Some(Shell::Nushell);
        }
        if self.home.join(".config/fish/config.fish").exists() {
            return Some(Shell::Fish);
        }
        if self.home.join(".zshrc").exists() {
            return Some(Shell::Zsh);
        }
        if self.home.join(".bashrc").exists() {
            return Some(Shell::Bash);
        }
        None
    }

    /// Where nushell reads its configuration from.
    ///
    /// Nushell follows `XDG_CONFIG_HOME` when it is set and otherwise uses
    /// the platform default: `~/.config/nushell` on Linux,
    /// `~/Library/Application Support/nushell` on macOS. The file inside it
    /// is `config.nu` — the main config, and the place nushell recommends
    /// for environment variables. There is no `config.nushell`.
    fn nushell_config_dir(&self) -> PathBuf {
        nushell_config_dir_in(
            &self.home,
            self.xdg_config_home.as_deref(),
            cfg!(target_os = "macos"),
        )
    }

    /// The nushell config file: the main config, where env vars belong.
    fn nushell_config_file(&self) -> PathBuf {
        self.nushell_config_dir().join("config.nu")
    }

    /// PATH line for nushell.
    ///
    /// The absolute path is written out on purpose: nushell does not expand
    /// `~` in PATH entries, and its `$nu` constants were renamed across
    /// versions (`$nu.home-path` -> `$nu.home-dir`), so a literal path is
    /// the only form that keeps working everywhere. A single quote in the
    /// path is escaped the way nushell expects.
    fn nushell_path_export(&self) -> String {
        let bin = self.home.join(".local/bin");
        format!(
            "$env.PATH = ($env.PATH | prepend '{}')",
            bin.to_string_lossy().replace('\'', "''")
        )
    }

    /// The bash login file. Bash reads only the first existing
    /// `~/.bash_profile` > `~/.bash_login` > `~/.profile`, so creating a
    /// new `.bash_profile` would shadow an existing `.profile`/`.bash_login`.
    /// Update the user's existing login config instead.
    fn bash_login_target(&self) -> PathBuf {
        for candidate in [".bash_profile", ".bash_login", ".profile"] {
            let path = self.home.join(candidate);
            if path.exists() {
                return path;
            }
        }
        self.home.join(".bash_profile")
    }

    /// The rc files of one shell: (absolute path, export line for that
    /// shell). Only these are ever patched for a user whose shell is known.
    fn rc_files_for(&self, shell: Shell) -> Vec<(PathBuf, String)> {
        match shell {
            Shell::Zsh => vec![(self.home.join(".zshrc"), PATH_EXPORT.to_string())],
            Shell::Bash => vec![
                (self.home.join(".bashrc"), PATH_EXPORT.to_string()),
                (self.bash_login_target(), PATH_EXPORT.to_string()),
            ],
            Shell::Fish => vec![(
                self.home.join(".config/fish/config.fish"),
                FISH_PATH_EXPORT.to_string(),
            )],
            Shell::Nushell => {
                vec![(self.nushell_config_file(), self.nushell_path_export())]
            }
        }
    }

    /// Every rc file we know about, for the case where the shell is unknown.
    /// Callers only patch the ones that already exist.
    fn all_rc_files(&self) -> Vec<(PathBuf, String)> {
        vec![
            (self.home.join(".zshrc"), PATH_EXPORT.to_string()),
            (self.home.join(".bashrc"), PATH_EXPORT.to_string()),
            (self.bash_login_target(), PATH_EXPORT.to_string()),
            (
                self.home.join(".config/fish/config.fish"),
                FISH_PATH_EXPORT.to_string(),
            ),
            (self.nushell_config_file(), self.nushell_path_export()),
        ]
    }

    /// The known rc files the user already has. Never creates one.
    fn existing_rc_files(&self) -> Vec<(PathBuf, String)> {
        self.all_rc_files()
            .into_iter()
            .filter(|(path, _)| path.exists())
            .collect()
    }

    /// The rc files to patch: the user's own shell, or — when the shell is
    /// unknown — only the rc files that already exist, so no file is created
    /// for a shell nobody uses.
    fn rc_targets(&self) -> Vec<(PathBuf, String)> {
        match self.user_shell() {
            Some(shell) => self.rc_files_for(shell),
            None => self.existing_rc_files(),
        }
    }
}

/// The config directory resolution, split out so every branch is testable.
fn nushell_config_dir_in(home: &Path, xdg_config_home: Option<&Path>, macos: bool) -> PathBuf {
    if let Some(base) = xdg_config_home {
        return base.join("nushell");
    }
    if macos {
        home.join("Library/Application Support/nushell")
    } else {
        home.join(".config/nushell")
    }
}

/// `XDG_CONFIG_HOME`, when it is set.
#[cfg(not(windows))]
fn xdg_config_home() -> Option<PathBuf> {
    std::env::var_os("XDG_CONFIG_HOME")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

#[cfg(not(windows))]
fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .filter(|h| !h.is_empty())
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var_os("USERPROFILE")
                .filter(|h| !h.is_empty())
                .map(PathBuf::from)
        })
}

/// The full export block written to rc files (also used to detect prior installs).
fn export_block(export_line: &str) -> String {
    format!("# >>> {MARKER} >>>\n{export_line}\n# <<< {MARKER} <<<\n")
}

/// True when `rc_content` already carries our marker (any version of it).
fn has_marker(rc_content: &str) -> bool {
    rc_content.contains(MARKER)
}

/// `EROFS` — the filesystem is mounted read-only (a NixOS home, for example).
const EROFS: i32 = 30;

/// True when the failure means "this location is not ours to write".
///
/// A read-only or permission-denied home is not something the user can act
/// on from the app, and the app cannot work around it either, so those
/// failures are logged quietly instead of as a warning.
fn is_quiet_fs_error(error: &std::io::Error) -> bool {
    if error.kind() == std::io::ErrorKind::PermissionDenied {
        return true;
    }
    matches!(error.raw_os_error(), Some(EROFS))
}

/// Append the export block to `rc_path` unless the marker is already there.
/// Missing files (and missing parent dirs, e.g. `~/.config/fish`) are created.
fn ensure_rc_entry(rc_path: &Path, export_line: &str) -> std::io::Result<bool> {
    if let Some(parent) = rc_path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)?;
        }
    }
    let existing = match std::fs::read_to_string(rc_path) {
        Ok(content) => content,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(error) => return Err(error),
    };
    if has_marker(&existing) {
        return Ok(false);
    }
    let mut content = existing;
    if !content.is_empty() && !content.ends_with('\n') {
        content.push('\n');
    }
    content.push_str(&export_block(export_line));
    std::fs::write(rc_path, content)?;
    Ok(true)
}

/// Ensure `link_path` is a symlink pointing at `target`.
/// Returns `Ok(true)` when anything changed. A real (non-symlink) file that
/// the user put there themselves is never clobbered.
fn ensure_symlink(link_path: &Path, target: &Path) -> std::io::Result<bool> {
    match std::fs::read_link(link_path) {
        Ok(current) if current == target => return Ok(false),
        Ok(_) => {
            // Stale symlink (e.g. app moved) — replace it.
            std::fs::remove_file(link_path)?;
        }
        Err(_) => {
            if link_path.exists() {
                // Real file owned by the user — leave it alone.
                return Ok(false);
            }
        }
    }
    #[cfg(unix)]
    std::os::unix::fs::symlink(target, link_path)?;
    #[cfg(not(unix))]
    {
        let _ = target;
        return Ok(false);
    }
    Ok(true)
}

/// Entry point, called from the Tauri `setup` hook on every launch.
/// Best-effort and silent: failures are logged, never surfaced to the user.
pub fn ensure_cli_shim() {
    #[cfg(windows)]
    {
        return;
    }
    #[cfg(not(windows))]
    {
        if let Err(error) = ensure_cli_shim_inner() {
            if is_quiet_fs_error(&error) {
                log::debug!("Skipped the rexadb terminal command: {error}");
            } else {
                log::warn!("Could not install rexadb terminal command: {error}");
            }
        }
    }
}

/// Resolve the persistent binary to link: AppImage mounts are temporary, so
/// `current_exe()` inside the mount would leave a broken link after exit.
/// Prefer the `APPIMAGE` launcher path when present.
fn resolve_shim_target(exe: &Path) -> PathBuf {
    if let Ok(appimage) = std::env::var("APPIMAGE") {
        if !appimage.trim().is_empty() {
            return PathBuf::from(appimage);
        }
    }
    // Canonicalize so the link survives being launched through another link.
    std::fs::canonicalize(exe).unwrap_or_else(|_| exe.to_path_buf())
}

#[cfg(not(windows))]
fn ensure_cli_shim_inner() -> std::io::Result<()> {
    let paths = match InstallPaths::from_environment() {
        Some(paths) => paths,
        None => return Ok(()),
    };
    install_shim(&paths)
}

/// Link the command and put `~/.local/bin` on the user's PATH.
#[cfg(not(windows))]
fn install_shim(paths: &InstallPaths) -> std::io::Result<()> {
    let exe = std::env::current_exe()?;
    let target = resolve_shim_target(&exe);

    let bin_dir = paths.home.join(".local/bin");
    std::fs::create_dir_all(&bin_dir)?;
    let link_path = bin_dir.join(SHIM_NAME);
    match ensure_symlink(&link_path, &target) {
        Ok(true) => log::info!("Installed rexadb terminal command at {}", link_path.display()),
        Ok(false) => {}
        Err(error) => {
            if is_quiet_fs_error(&error) {
                log::debug!("Skipped the rexadb terminal command: {error}");
            } else {
                log::warn!("Could not link rexadb terminal command: {error}");
            }
        }
    }

    for (rc_path, export_line) in paths.rc_targets() {
        match ensure_rc_entry(&rc_path, &export_line) {
            Ok(true) => log::info!("Added ~/.local/bin to PATH in {}", rc_path.display()),
            Ok(false) => {}
            Err(error) => {
                if is_quiet_fs_error(&error) {
                    // A read-only home (NixOS) or a file we may not touch:
                    // nothing the user can act on, so stay quiet.
                    log::debug!("Skipped {}: {error}", rc_path.display());
                } else {
                    log::warn!("Could not update {}: {error}", rc_path.display());
                }
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod cli_shim_tests {
    use super::{
        ensure_rc_entry, ensure_symlink, export_block, has_marker, is_quiet_fs_error,
        nushell_config_dir_in, shell_from_path, InstallPaths, Shell, ShellHint, EROFS, PATH_EXPORT,
    };
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn scratch_dir(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!("rexadb-{name}-{nanos}-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Paths for a scratch home. The tests never read the environment, so
    /// they can never touch the developer's own shell configuration.
    fn scratch_paths(name: &str) -> (PathBuf, InstallPaths) {
        let dir = scratch_dir(name);
        let paths = InstallPaths {
            home: dir.clone(),
            xdg_config_home: None,
            shell_hint: ShellHint::Missing,
        };
        (dir, paths)
    }

    #[test]
    fn marker_detection() {
        assert!(!has_marker("export PATH=\"$HOME/.local/bin:$PATH\"\n"));
        assert!(has_marker(&export_block("export PATH=\"$HOME/.local/bin:$PATH\"")));
        assert!(has_marker("# >>> rexa-db terminal command >>>"));
    }

    #[test]
    fn rc_entry_is_idempotent_and_preserves_content() {
        let dir = scratch_dir("rc");
        let rc = dir.join(".zshrc");
        std::fs::write(&rc, "alias ll=\"ls -la\"\n").unwrap();
        assert!(ensure_rc_entry(&rc, "export PATH=\"$HOME/.local/bin:$PATH\"").unwrap());
        // Second run changes nothing.
        assert!(!ensure_rc_entry(&rc, "export PATH=\"$HOME/.local/bin:$PATH\"").unwrap());
        let content = std::fs::read_to_string(&rc).unwrap();
        assert!(content.contains("alias ll=\"ls -la\""), "{content}");
        assert!(content.contains("rexa-db terminal command"), "{content}");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn rc_entry_creates_missing_file_and_parents() {
        let dir = scratch_dir("rc-missing");
        let rc = dir.join(".config/fish/config.fish");
        assert!(ensure_rc_entry(&rc, "fish_add_path $HOME/.local/bin").unwrap());
        let content = std::fs::read_to_string(&rc).unwrap();
        assert!(content.contains("fish_add_path"), "{content}");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[cfg(unix)]
    #[test]
    fn symlink_points_at_target_and_repairs_stale_links() {
        let dir = scratch_dir("link");
        let real = dir.join("real-bin");
        let other = dir.join("other-bin");
        std::fs::write(&real, b"x").unwrap();
        std::fs::write(&other, b"x").unwrap();
        let link = dir.join("rexadb");
        assert!(ensure_symlink(&link, &real).unwrap());
        // Already correct — no change.
        assert!(!ensure_symlink(&link, &real).unwrap());
        // Stale link gets repointed.
        assert!(ensure_symlink(&link, &other).unwrap());
        assert_eq!(std::fs::read_link(&link).unwrap(), other);
        // A real user file is never clobbered.
        std::fs::remove_file(&link).unwrap();
        std::fs::write(&link, "mine").unwrap();
        assert!(!ensure_symlink(&link, &real).unwrap());
        assert_eq!(std::fs::read_to_string(&link).unwrap(), "mine");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn shell_executables_map_to_shells() {
        assert_eq!(shell_from_path("/bin/zsh"), Some(Shell::Zsh));
        assert_eq!(shell_from_path("/usr/bin/bash"), Some(Shell::Bash));
        assert_eq!(shell_from_path("/usr/bin/fish"), Some(Shell::Fish));
        assert_eq!(shell_from_path("/usr/bin/nu"), Some(Shell::Nushell));
        assert_eq!(shell_from_path("/usr/bin/nushell"), Some(Shell::Nushell));
        // A nushell installed through nix, and shells we do not know.
        assert_eq!(
            shell_from_path("/home/user/.nix-profile/bin/nu"),
            Some(Shell::Nushell)
        );
        assert_eq!(shell_from_path("/bin/ksh"), None);
        assert_eq!(shell_from_path(""), None);
    }

    #[test]
    fn shell_is_inferred_from_the_configs_the_user_has() {
        let (dir, paths) = scratch_paths("infer");
        assert_eq!(paths.infer_shell(), None);

        std::fs::write(dir.join(".zshrc"), "").unwrap();
        assert_eq!(paths.infer_shell(), Some(Shell::Zsh));

        // The nushell config lives in the platform directory, so ask the
        // paths where that is.
        let nushell = paths.nushell_config_file();
        std::fs::create_dir_all(nushell.parent().unwrap()).unwrap();
        std::fs::write(&nushell, "").unwrap();
        assert_eq!(paths.infer_shell(), Some(Shell::Nushell));

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn nushell_reads_its_config_from_the_platform_directory() {
        let home = PathBuf::from("/home/user");

        // Linux default.
        assert_eq!(
            nushell_config_dir_in(&home, None, false),
            PathBuf::from("/home/user/.config/nushell")
        );
        // macOS default.
        assert_eq!(
            nushell_config_dir_in(&home, None, true),
            PathBuf::from("/home/user/Library/Application Support/nushell")
        );
        // XDG_CONFIG_HOME wins on every platform.
        assert_eq!(
            nushell_config_dir_in(&home, Some(Path::new("/xdg")), false),
            PathBuf::from("/xdg/nushell")
        );
        assert_eq!(
            nushell_config_dir_in(&home, Some(Path::new("/xdg")), true),
            PathBuf::from("/xdg/nushell")
        );
    }

    #[test]
    fn the_xdg_config_home_is_where_nushell_is_looked_for() {
        let (dir, mut paths) = scratch_paths("xdg");
        paths.xdg_config_home = Some(PathBuf::from("/xdg"));
        assert_eq!(
            paths.nushell_config_file(),
            PathBuf::from("/xdg/nushell/config.nu")
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn every_path_stays_inside_the_scratch_home() {
        // Without an XDG override nothing may point outside the home the
        // paths were built for — otherwise a test would write to the real
        // configuration of whoever runs it.
        let (dir, paths) = scratch_paths("contained");
        for (path, _) in paths.all_rc_files() {
            assert!(path.starts_with(&dir), "{path:?} escapes {dir:?}");
        }
        assert!(paths.nushell_config_file().starts_with(&dir));
        assert!(paths
            .nushell_path_export()
            .contains(&dir.display().to_string()));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn each_shell_gets_its_own_rc_file() {
        let (dir, paths) = scratch_paths("rc-files");

        let zsh = paths.rc_files_for(Shell::Zsh);
        assert_eq!(zsh.len(), 1);
        assert_eq!(zsh[0].0, dir.join(".zshrc"));
        assert_eq!(zsh[0].1, PATH_EXPORT);

        let bash = paths.rc_files_for(Shell::Bash);
        assert_eq!(bash[0].0, dir.join(".bashrc"));
        // The login file is resolved dynamically, so bash reads the config
        // the user already has.
        assert_eq!(bash[1].0, dir.join(".bash_profile"));

        let fish = paths.rc_files_for(Shell::Fish);
        assert_eq!(fish.len(), 1);
        assert_eq!(fish[0].0, dir.join(".config/fish/config.fish"));
        assert!(fish[0].1.contains("fish_add_path"));

        // Nushell reads `config.nu`, not `config.nushell`.
        let nushell = paths.rc_files_for(Shell::Nushell);
        assert_eq!(nushell.len(), 1);
        assert!(nushell[0].0.ends_with("config.nu"), "{:?}", nushell[0].0);
        assert!(
            !nushell[0].0.ends_with("config.nushell"),
            "{:?}",
            nushell[0].0
        );
        assert_eq!(nushell[0].1, paths.nushell_path_export());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn an_unknown_shell_never_creates_an_rc_file() {
        let (dir, paths) = scratch_paths("unknown-shell");
        std::fs::write(dir.join(".zshrc"), "").unwrap();

        let targets = paths.existing_rc_files();
        assert_eq!(targets.len(), 1);
        assert_eq!(targets[0].0, dir.join(".zshrc"));
        // No file is created for a shell the user does not have.
        assert!(!dir.join(".bashrc").exists());
        assert!(!dir.join(".config/fish/config.fish").exists());
        assert!(!paths.nushell_config_file().exists());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn nushell_config_gets_a_path_line() {
        let (dir, paths) = scratch_paths("nushell");
        let rc = paths.nushell_config_file();
        let export_line = paths.nushell_path_export();
        assert!(ensure_rc_entry(&rc, &export_line).unwrap());
        // Second run changes nothing.
        assert!(!ensure_rc_entry(&rc, &export_line).unwrap());
        let content = std::fs::read_to_string(&rc).unwrap();
        assert!(
            content.contains("$env.PATH = ($env.PATH | prepend"),
            "{content}"
        );
        // The absolute path is written out: nushell does not expand `~` in
        // PATH entries, and its `$nu` constants change across versions.
        assert!(
            content.contains(&format!("{}/.local/bin", dir.display())),
            "{content}"
        );
        assert!(!content.contains("$nu.home-path"), "{content}");
        assert!(!content.contains("$nu.home-dir"), "{content}");
        assert!(content.contains("rexa-db terminal command"), "{content}");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn read_only_locations_fail_quietly() {
        // A read-only home (NixOS) and a file we may not touch are not
        // something the user can act on, so they must not warn.
        assert!(is_quiet_fs_error(&std::io::Error::from_raw_os_error(EROFS)));
        assert!(is_quiet_fs_error(&std::io::Error::from(
            std::io::ErrorKind::PermissionDenied
        )));
        assert!(!is_quiet_fs_error(&std::io::Error::from(
            std::io::ErrorKind::NotFound
        )));
        assert!(!is_quiet_fs_error(&std::io::Error::from(
            std::io::ErrorKind::Other
        )));
    }

    #[cfg(unix)]
    #[test]
    fn only_the_users_own_shell_is_touched() {
        use super::install_shim;

        let (dir, mut paths) = scratch_paths("e2e");
        // A nushell user, as on NixOS.
        paths.shell_hint = ShellHint::Known(Shell::Nushell);

        install_shim(&paths).unwrap();

        // The command is linked in, and the PATH line lands in the config of
        // the shell the user actually uses.
        assert!(dir.join(".local/bin/rexadb").exists());
        let config = paths.nushell_config_file();
        let nushell = std::fs::read_to_string(&config).unwrap();
        assert!(
            nushell.contains(&format!("{}/.local/bin", dir.display())),
            "{nushell}"
        );
        // No rc file is created for a shell the user does not have.
        assert!(!dir.join(".zshrc").exists());
        assert!(!dir.join(".bashrc").exists());
        assert!(!dir.join(".config/fish/config.fish").exists());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[cfg(unix)]
    #[test]
    fn an_unsupported_shell_does_not_guess_another_one() {
        let (dir, mut paths) = scratch_paths("unsupported-shell");
        // The user has a bash config, but runs a shell we do not support.
        std::fs::write(dir.join(".bashrc"), "").unwrap();
        paths.shell_hint = ShellHint::Unsupported;

        let targets = paths.rc_targets();
        // Only the file the user already has — no login file is created for
        // a shell we had to guess.
        assert_eq!(targets.len(), 1);
        assert_eq!(targets[0].0, dir.join(".bashrc"));

        std::fs::remove_dir_all(&dir).ok();
    }
}
