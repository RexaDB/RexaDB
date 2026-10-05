//! Auto-installs the `rexadb` terminal command on first launch (and repairs
//! it on later launches if the app moved).
//!
//! Strategy (macOS/Linux, no sudo, no prompts):
//! - symlink `~/.local/bin/rexadb` -> the running app binary, so
//!   `rexadb open <database-url-or-file-path>` works from any terminal;
//! - ensure `~/.local/bin` is on PATH by appending a marker-guarded export
//!   block to the user's shell rc files (zsh, bash, fish). The marker makes
//!   the operation idempotent — never duplicated, never touches other lines.
//!
//! A real executable shim is used instead of a shell `alias` so it also works
//! from scripts, subshells and GUI-launched terminals. Windows is skipped:
//! there is no per-user bin convention reachable without installer support.

use std::path::{Path, PathBuf};

const SHIM_NAME: &str = "rexadb";
const MARKER: &str = "rexa-db terminal command";

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

fn rc_files(home: &Path) -> Vec<(PathBuf, String)> {
    vec![
        (
            PathBuf::from(".zshrc"),
            "export PATH=\"$HOME/.local/bin:$PATH\"".to_string(),
        ),
        (
            PathBuf::from(".bashrc"),
            "export PATH=\"$HOME/.local/bin:$PATH\"".to_string(),
        ),
        (
            bash_login_target(home),
            "export PATH=\"$HOME/.local/bin:$PATH\"".to_string(),
        ),
        (
            PathBuf::from(".config/fish/config.fish"),
            "fish_add_path $HOME/.local/bin".to_string(),
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
            log::warn!("Could not install rexadb terminal command: {error}");
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
        Err(error) => log::warn!("Could not link rexadb terminal command: {error}"),
    }

    for (relative, export_line) in rc_files(&home) {
        let rc_path = home.join(relative);
        match ensure_rc_entry(&rc_path, &export_line) {
            Ok(true) => log::info!("Added ~/.local/bin to PATH in {}", rc_path.display()),
            Ok(false) => {}
            Err(error) => {
                log::warn!("Could not update {}: {error}", rc_path.display());
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod cli_shim_tests {
    use super::{ensure_rc_entry, ensure_symlink, export_block, has_marker};
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
}
