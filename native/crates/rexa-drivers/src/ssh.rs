//! Port of `lib/db/ssh-tunnel.ts` + `ssh-tunnel-common.js`: SSH tunnels are
//! encoded in the connection string as `rexadb_ssh_*` query params and run
//! through the system `ssh -N -L` (same flags, askpass for passwords, the
//! private key in a 0600 temp file).

use anyhow::{bail, Context, Result};
use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;
use tokio::io::AsyncReadExt;
use tokio::process::{Child, Command};

const CUSTOM_KEYS: [&str; 9] = [
    "rexadb_keychain_db",
    "rexadb_ssh_mode",
    "rexadb_ssh_host",
    "rexadb_ssh_port",
    "rexadb_ssh_user",
    "rexadb_ssh_auth",
    "rexadb_ssh_keychain",
    "rexadb_ssh_password",
    "rexadb_ssh_private_key",
];

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SshConfig {
    pub enabled: bool,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub private_key_auth: bool,
    pub password: String,
    pub private_key: String,
}

/// `parseExtendedConnection`: strip the RexaDB params, return the base
/// connection string and the SSH settings. Non-URL strings pass through.
pub fn parse_extended(cs: &str) -> (String, SshConfig) {
    let Ok(mut url) = url::Url::parse(cs.trim()) else { return (cs.to_string(), SshConfig::default()) };
    let get = |k: &str| url.query_pairs().find(|(n, _)| n == k).map(|(_, v)| v.into_owned()).unwrap_or_default();
    let cfg = SshConfig {
        enabled: get("rexadb_ssh_mode") == "ssh",
        host: get("rexadb_ssh_host"),
        port: get("rexadb_ssh_port").parse().ok().filter(|p| *p > 0).unwrap_or(22),
        username: get("rexadb_ssh_user"),
        private_key_auth: get("rexadb_ssh_auth") == "private-key",
        password: get("rexadb_ssh_password"),
        private_key: get("rexadb_ssh_private_key"),
    };
    if url.query().is_none() {
        return (cs.trim().to_string(), cfg);
    }
    let kept: Vec<(String, String)> =
        url.query_pairs().filter(|(k, _)| !CUSTOM_KEYS.contains(&k.as_ref())).map(|(k, v)| (k.into_owned(), v.into_owned())).collect();
    if kept.is_empty() {
        url.set_query(None);
    } else {
        url.query_pairs_mut().clear().extend_pairs(kept);
    }
    (url.to_string(), cfg)
}

/// A running tunnel; killing happens on drop.
pub struct Tunnel {
    child: Child,
    tmp: Option<PathBuf>,
}

impl Drop for Tunnel {
    fn drop(&mut self) {
        let _ = self.child.start_kill();
        if let Some(dir) = self.tmp.take() {
            let _ = std::fs::remove_dir_all(dir);
        }
    }
}

fn free_port() -> Result<u16> {
    let l = std::net::TcpListener::bind("127.0.0.1:0").context("Unable to allocate local tunnel port.")?;
    Ok(l.local_addr()?.port())
}

/// `startSshTunnelIfNeeded`: returns the connection string to dial (host
/// rewritten to the local forward) and the tunnel guard to keep alive.
pub async fn start_if_needed(cs: &str, default_port: u16) -> Result<(String, Option<Tunnel>)> {
    let (base, cfg) = parse_extended(cs);
    if !cfg.enabled {
        return Ok((base, None));
    }
    let mut target = url::Url::parse(&base).context("invalid connection string")?;
    let target_host = target.host_str().unwrap_or("localhost").to_string();
    let target_port = target.port().unwrap_or(default_port);
    if cfg.host.is_empty() || cfg.username.is_empty() {
        bail!("SSH host and username are required when SSH tunnel is enabled.");
    }
    let local_port = free_port()?;
    let tmp = std::env::temp_dir().join(format!("rexadb-ssh-{}-{local_port}", std::process::id()));
    std::fs::create_dir_all(&tmp)?;
    let mut cmd = Command::new("ssh");
    if cfg.private_key_auth {
        if cfg.private_key.trim().is_empty() {
            bail!("SSH private key is required for private-key authentication.");
        }
        let key = tmp.join("id_key");
        write_private(&key, cfg.private_key.as_bytes(), 0o600)?;
        cmd.arg("-i").arg(&key);
    } else {
        if cfg.password.is_empty() {
            bail!("SSH password is required for password authentication.");
        }
        let askpass = tmp.join("askpass.sh");
        write_private(&askpass, b"#!/bin/sh\nprintf %s \"$REXADB_SSH_PASSWORD\"\n", 0o700)?;
        cmd.env("SSH_ASKPASS", &askpass)
            .env("SSH_ASKPASS_REQUIRE", "force")
            .env("DISPLAY", std::env::var("DISPLAY").unwrap_or_else(|_| ":0".into()))
            .env("REXADB_SSH_PASSWORD", &cfg.password);
    }
    cmd.args(["-N", "-L", &format!("{local_port}:{target_host}:{target_port}"), "-p", &cfg.port.to_string()])
        .args(["-o", "ExitOnForwardFailure=yes", "-o", "StrictHostKeyChecking=accept-new", "-o", "UserKnownHostsFile=/dev/null"])
        .args(["-o", "LogLevel=ERROR"])
        .arg(format!("{}@{}", cfg.username, cfg.host))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let mut child = cmd.spawn().context("Failed to start ssh")?;
    let mut stderr = child.stderr.take();
    // Wait ~1.4s like the original; fail fast on exit or a known error.
    let deadline = tokio::time::sleep(Duration::from_millis(1400));
    tokio::pin!(deadline);
    let mut buf = vec![0u8; 4096];
    loop {
        tokio::select! {
            _ = &mut deadline => break,
            status = child.wait() => {
                let _ = std::fs::remove_dir_all(&tmp);
                let code = status.ok().and_then(|s| s.code()).map_or("unknown".to_string(), |c| c.to_string());
                bail!("SSH tunnel failed to start ({code}).");
            }
            n = async { match stderr.as_mut() { Some(s) => s.read(&mut buf).await.unwrap_or(0), None => std::future::pending().await } } => {
                if n == 0 { stderr = None; continue; }
                let msg = String::from_utf8_lossy(&buf[..n]).trim().to_string();
                let l = msg.to_ascii_lowercase();
                if ["permission denied", "could not resolve hostname", "connection refused", "host key verification failed", "no such identity", "operation timed out"].iter().any(|p| l.contains(p)) {
                    let _ = child.start_kill();
                    let _ = std::fs::remove_dir_all(&tmp);
                    bail!("SSH: {msg}");
                }
            }
        }
    }
    let _ = target.set_host(Some("127.0.0.1"));
    let _ = target.set_port(Some(local_port));
    Ok((target.to_string(), Some(Tunnel { child, tmp: Some(tmp) })))
}

fn write_private(path: &std::path::Path, data: &[u8], mode: u32) -> Result<()> {
    std::fs::write(path, data)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode))?;
    }
    #[cfg(not(unix))]
    let _ = mode;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_rexadb_params() {
        let (base, cfg) = parse_extended("postgres://u@db:5432/x?sslmode=require&rexadb_ssh_mode=ssh&rexadb_ssh_host=bastion&rexadb_ssh_user=me&rexadb_ssh_port=2222");
        assert_eq!(base, "postgres://u@db:5432/x?sslmode=require");
        assert!(cfg.enabled && cfg.host == "bastion" && cfg.port == 2222 && cfg.username == "me" && !cfg.private_key_auth);
        let (base, cfg) = parse_extended("mysql://u@h/d?rexadb_keychain_db=1");
        assert_eq!(base, "mysql://u@h/d");
        assert!(!cfg.enabled);
    }
}
