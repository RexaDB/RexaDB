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
//! `.zshrc` written for them, and a zsh user never gets a fish config.
//! When the shell cannot be determined, only rc files that already exist are
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
/// PATH line for nushell. `$nu.home-path` is nushell's home directory, so
/// the line works without assuming the user's name.
const NUSHELL_PATH_EXPORT: &str =
    "$env.PATH = ($env.PATH | prepend $\"($nu.home-path)/.local/bin\")";

/// Shells we know how to put `~/.local/bin` on PATH for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Shell {
    Zsh,
    Bash,
    Fish,
    Nushell,
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

/// Guess the shell from the config files the user already has. Used when
/// `$SHELL` is missing (GUI launch, minimal environment): the config that
/// exists is the one the user actually reads.
fn infer_shell_from_home(home: &Path) -> Option<Shell> {
    let candidates = [
        (".config/nushell/config.nushell", Shell::Nushell),
        (".config/fish/config.fish", Shell::Fish),
        (".zshrc", Shell::Zsh),
        (".bashrc", Shell::Bash),
    ];
    candidates
        .iter()
        .find(|(relative, _)| home.join(relative).exists())
        .map(|(_, shell)| *shell)
}

/// The user's shell: `$SHELL` first, then what the home directory suggests.
fn user_shell(home: &Path) -> Option<Shell> {
    std::env::var("SHELL")
        .ok()
        .and_then(|value| shell_from_path(&value))
        .or_else(|| infer_shell_from_home(home))
}

/// Shell rc files to patch: (relative path, export line for that shell).
/// The bash login file is resolved dynamically: bash reads only the first
/// existing `~/.bash_profile` > `~/.bash_login` > `~/.profile`, so creating a
/// new `.bash_profile` would shadow an existing `.profile`/`.bash_login`.
/// Update the user's existing login config instead.
fn bash_login_target(home: &Path) -> PathBuf {
    for candidate in [".bash_profile", ".bash_login", ".profile"] {
        if home.join(candidate).exists() {
            return PathBuf::from(candidate);
        }
    }
    PathBuf::from(".bash_profile")
}

/// The rc files of one shell. Only these are ever patched for a user whose
/// shell is known.
fn rc_files_for(shell: Shell, home: &Path) -> Vec<(PathBuf, String)> {
    match shell {
        Shell::Zsh => vec![(PathBuf::from(".zshrc"), PATH_EXPORT.to_string())],
        Shell::Bash => vec![
            (PathBuf::from(".bashrc"), PATH_EXPORT.to_string()),
            (bash_login_target(home), PATH_EXPORT.to_string()),
        ],
        Shell::Fish => vec![(
            PathBuf::from(".config/fish/config.fish"),
            FISH_PATH_EXPORT.to_string(),
        )],
        Shell::Nushell => vec![(
            PathBuf::from(".config/nushell/config.nushell"),
            NUSHELL_PATH_EXPORT.to_string(),
        )],
    }
}

/// Every rc file we know about, for the case where the shell is unknown.
/// Callers only patch the ones that already exist.
fn all_rc_files(home: &Path) -> Vec<(PathBuf, String)> {
    vec![
        (PathBuf::from(".zshrc"), PATH_EXPORT.to_string()),
        (PathBuf::from(".bashrc"), PATH_EXPORT.to_string()),
        (bash_login_target(home), PATH_EXPORT.to_string()),
        (
            PathBuf::from(".config/fish/config.fish"),
            FISH_PATH_EXPORT.to_string(),
        ),
        (
            PathBuf::from(".config/nushell/config.nushell"),
            NUSHELL_PATH_EXPORT.to_string(),
        ),
    ]
}

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

/// The rc files to patch: the user's own shell, or — when the shell is
/// unknown — only the rc files that already exist, so no file is created for
/// a shell nobody uses.
#[cfg(not(windows))]
fn rc_targets(home: &Path) -> Vec<(PathBuf, String)> {
    match user_shell(home) {
        Some(shell) => rc_files_for(shell, home),
        None => existing_rc_files(home),
    }
}

/// The known rc files the user already has. Never creates one.
fn existing_rc_files(home: &Path) -> Vec<(PathBuf, String)> {
    all_rc_files(home)
        .into_iter()
        .filter(|(relative, _)| home.join(relative).exists())
        .collect()
}

#[cfg(not(windows))]
fn ensure_cli_shim_inner() -> std::io::Result<()> {
    let home = match home_dir() {
        Some(home) => home,
        None => return Ok(()),
    };
    let exe = std::env::current_exe()?;
    let target = resolve_shim_target(&exe);

    let bin_dir = home.join(".local/bin");
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

    for (relative, export_line) in rc_targets(&home) {
        let rc_path = home.join(relative);
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
        ensure_rc_entry, ensure_symlink, existing_rc_files, export_block, has_marker,
        infer_shell_from_home, is_quiet_fs_error, rc_files_for, shell_from_path, Shell, EROFS,
        NUSHELL_PATH_EXPORT, PATH_EXPORT,
    };
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn scratch_dir(name: &str) -> std::path::PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!("rexadb-{name}-{nanos}-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
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
        std::fs::write(&link, b"mine").unwrap();
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
        let dir = scratch_dir("infer");
        assert_eq!(infer_shell_from_home(&dir), None);

        std::fs::write(dir.join(".zshrc"), "").unwrap();
        assert_eq!(infer_shell_from_home(&dir), Some(Shell::Zsh));

        let nushell = dir.join(".config/nushell");
        std::fs::create_dir_all(&nushell).unwrap();
        std::fs::write(nushell.join("config.nushell"), "").unwrap();
        assert_eq!(infer_shell_from_home(&dir), Some(Shell::Nushell));

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn each_shell_gets_its_own_rc_file() {
        let dir = scratch_dir("rc-files");

        let zsh = rc_files_for(Shell::Zsh, &dir);
        assert_eq!(zsh.len(), 1);
        assert_eq!(zsh[0].0, PathBuf::from(".zshrc"));
        assert_eq!(zsh[0].1, PATH_EXPORT);

        let bash = rc_files_for(Shell::Bash, &dir);
        assert_eq!(bash[0].0, PathBuf::from(".bashrc"));
        // The login file is resolved dynamically, so bash reads the config
        // the user already has.
        assert_eq!(bash[1].0, PathBuf::from(".bash_profile"));

        let fish = rc_files_for(Shell::Fish, &dir);
        assert_eq!(fish.len(), 1);
        assert_eq!(fish[0].0, PathBuf::from(".config/fish/config.fish"));
        assert!(fish[0].1.contains("fish_add_path"));

        let nushell = rc_files_for(Shell::Nushell, &dir);
        assert_eq!(nushell.len(), 1);
        assert_eq!(
            nushell[0].0,
            PathBuf::from(".config/nushell/config.nushell")
        );
        assert_eq!(nushell[0].1, NUSHELL_PATH_EXPORT);

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn an_unknown_shell_never_creates_an_rc_file() {
        let dir = scratch_dir("unknown-shell");
        std::fs::write(dir.join(".zshrc"), "").unwrap();

        let targets = existing_rc_files(&dir);
        assert_eq!(targets.len(), 1);
        assert_eq!(targets[0].0, PathBuf::from(".zshrc"));
        // No file is created for a shell the user does not have.
        assert!(!dir.join(".bashrc").exists());
        assert!(!dir.join(".config/fish/config.fish").exists());
        assert!(!dir.join(".config/nushell/config.nushell").exists());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn nushell_config_gets_a_path_line() {
        let dir = scratch_dir("nushell");
        let rc = dir.join(".config/nushell/config.nushell");
        assert!(ensure_rc_entry(&rc, NUSHELL_PATH_EXPORT).unwrap());
        // Second run changes nothing.
        assert!(!ensure_rc_entry(&rc, NUSHELL_PATH_EXPORT).unwrap());
        let content = std::fs::read_to_string(&rc).unwrap();
        assert!(
            content.contains("$env.PATH = ($env.PATH | prepend"),
            "{content}"
        );
        assert!(content.contains("($nu.home-path)/.local/bin"), "{content}");
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
        use super::ensure_cli_shim_inner;

        let dir = scratch_dir("e2e");
        let previous_home = std::env::var_os("HOME");
        let previous_shell = std::env::var_os("SHELL");
        std::env::set_var("HOME", &dir);
        // A nushell user, as on NixOS.
        std::env::set_var("SHELL", "/home/user/.nix-profile/bin/nu");

        ensure_cli_shim_inner().unwrap();

        // The command is linked in, and the PATH line lands in the config of
        // the shell the user actually uses.
        assert!(dir.join(".local/bin/rexadb").exists());
        let nushell = std::fs::read_to_string(dir.join(".config/nushell/config.nushell")).unwrap();
        assert!(nushell.contains("($nu.home-path)/.local/bin"), "{nushell}");
        // No rc file is created for a shell the user does not have.
        assert!(!dir.join(".zshrc").exists());
        assert!(!dir.join(".bashrc").exists());
        assert!(!dir.join(".config/fish/config.fish").exists());

        match previous_home {
            Some(value) => std::env::set_var("HOME", value),
            None => std::env::remove_var("HOME"),
        }
        match previous_shell {
            Some(value) => std::env::set_var("SHELL", value),
            None => std::env::remove_var("SHELL"),
        }
        std::fs::remove_dir_all(&dir).ok();
    }
}
