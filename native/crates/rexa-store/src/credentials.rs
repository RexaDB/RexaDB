//! Mirrors lib/credentials/{connection-credentials,local-vault}.ts.
//!
//! A saved connection either carries its secret inline (legacy rows), or a
//! `credential_ref` pointing at a JSON bundle `{connectionString, password,
//! authToken}` stored in the system keychain (service `com.rexa-db.connection`)
//! or, for `vault:` refs, AES-256-GCM encrypted in `credential_secret` with an
//! Argon2id key derived from the user's vault passphrase.

use crate::SavedConnection;
use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use anyhow::{anyhow, bail, Context, Result};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use rand::RngCore;
use serde::Deserialize;
use zeroize::Zeroize;

const KEYCHAIN_SERVICE: &str = "com.rexa-db.connection";
const VAULT_CHECK_REF: &str = "vault-check";
const VAULT_CHECK_TEXT: &str = "RexaDB local credential vault v1";

#[derive(Debug, Clone, Default)]
pub struct ResolvedCredentials {
    pub connection_string: String,
    pub password: Option<String>,
    pub auth_token: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Bundle {
    connection_string: Option<String>,
    password: Option<String>,
    auth_token: Option<String>,
}

/// An unlocked passphrase vault.
pub struct Vault {
    cipher: Aes256Gcm,
}

impl Vault {
    /// Create a vault configuration for a new passphrase vault.
    pub fn create(passphrase: &str) -> Result<(Self, String, String)> {
        if passphrase.chars().count() < 12 {
            bail!("Use at least 12 characters for the vault passphrase.");
        }
        let mut salt = [0u8; 16];
        rand::thread_rng().fill_bytes(&mut salt);
        let salt_b64 = B64.encode(salt);
        let params = argon2::Params::new(65_536, 3, 1, Some(32)).map_err(|e| anyhow!("{e}"))?;
        let argon = argon2::Argon2::new(argon2::Algorithm::Argon2id, argon2::Version::V0x13, params);
        let mut key = [0u8; 32];
        argon.hash_password_into(passphrase.as_bytes(), &salt, &mut key)
            .map_err(|e| anyhow!("deriving vault key: {e}"))?;
        let cipher = Aes256Gcm::new(&key.into());
        key.zeroize();
        let vault = Self { cipher };
        let verifier = vault.encrypt(VAULT_CHECK_REF, VAULT_CHECK_TEXT)?;
        Ok((vault, salt_b64, verifier))
    }

    pub fn unlock(passphrase: &str, salt_b64: &str, verifier: &str) -> Result<Self> {
        let salt = B64.decode(salt_b64).context("vault salt")?;
        let params = argon2::Params::new(65_536, 3, 1, Some(32)).map_err(|e| anyhow!("{e}"))?;
        let argon = argon2::Argon2::new(argon2::Algorithm::Argon2id, argon2::Version::V0x13, params);
        let mut key = [0u8; 32];
        argon
            .hash_password_into(passphrase.as_bytes(), &salt, &mut key)
            .map_err(|e| anyhow!("deriving vault key: {e}"))?;
        let cipher = Aes256Gcm::new(&key.into());
        key.zeroize();
        let vault = Self { cipher };
        match vault.decrypt(VAULT_CHECK_REF, verifier) {
            Ok(text) if text == VAULT_CHECK_TEXT => Ok(vault),
            _ => bail!("That passphrase did not unlock this vault."),
        }
    }

    pub fn decrypt(&self, reference: &str, envelope: &str) -> Result<String> {
        let mut parts = envelope.split('.');
        let (Some("v1"), Some(nonce), Some(ciphertext)) = (parts.next(), parts.next(), parts.next())
        else {
            bail!("Unsupported vault entry.");
        };
        let nonce = B64.decode(nonce)?;
        if nonce.len() != 12 {
            bail!("Unsupported vault entry.");
        }
        let plaintext = self
            .cipher
            .decrypt(
                Nonce::from_slice(&nonce),
                Payload { msg: &B64.decode(ciphertext)?, aad: reference.as_bytes() },
            )
            .map_err(|_| anyhow!("Could not decrypt vault entry."))?;
        Ok(String::from_utf8(plaintext)?)
    }

    /// Encrypt a secret bundle using a fresh nonce and the reference as AAD.
    pub fn encrypt(&self, reference: &str, plaintext: &str) -> Result<String> {
        let mut nonce = [0u8; 12];
        rand::thread_rng().fill_bytes(&mut nonce);
        let ciphertext = self.cipher.encrypt(
            Nonce::from_slice(&nonce),
            Payload { msg: plaintext.as_bytes(), aad: reference.as_bytes() },
        ).map_err(|_| anyhow!("Could not encrypt vault entry."))?;
        Ok(format!("v1.{}.{}", B64.encode(nonce), B64.encode(ciphertext)))
    }
}

/// Produce a connectable connection string (and secrets) for a saved row.
/// `vault` is only needed for rows whose `credential_ref` starts with `vault:`.
pub fn resolve_credentials(conn: &SavedConnection, vault: Option<&Vault>) -> Result<ResolvedCredentials> {
    let mut resolved = ResolvedCredentials {
        connection_string: conn.connection_string.clone(),
        password: conn.password.clone().filter(|p| !p.is_empty()),
        auth_token: conn.auth_token.clone().filter(|t| !t.is_empty()),
    };

    if let Some(reference) = conn.credential_ref.as_deref().filter(|r| !r.is_empty()) {
        let raw = if reference.starts_with("vault:") {
            let vault = vault.ok_or(NeedsVault)?;
            vault.decrypt(reference, conn.credential_secret.as_deref().unwrap_or_default())?
        } else {
            keyring::Entry::new(KEYCHAIN_SERVICE, reference)?
                .get_password()
                .context("reading the saved credentials from the system keychain")?
        };
        let bundle: Bundle = serde_json::from_str(&raw)
            .context("Could not unlock saved credentials: the stored credential bundle is invalid.")?;
        if let Some(cs) = bundle.connection_string.filter(|s| !s.is_empty()) {
            resolved.connection_string = cs;
        }
        if let Some(pw) = bundle.password.filter(|s| !s.is_empty()) {
            resolved.password = Some(pw);
        }
        if let Some(tok) = bundle.auth_token.filter(|s| !s.is_empty()) {
            resolved.auth_token = Some(tok);
        }
    }

    if let Some(pw) = &resolved.password {
        resolved.connection_string =
            restore_url_password(&resolved.connection_string, conn.username.as_deref(), pw);
    }
    Ok(resolved)
}

/// Returned when a `vault:` credential is hit without an unlocked vault, so the
/// UI can prompt for the passphrase and retry.
#[derive(Debug, thiserror::Error)]
#[error("This connection's credentials are in the encrypted vault. Unlock it to connect.")]
pub struct NeedsVault;

/// Port of `restorePostgresPassword`, generalized to any `scheme://` URL.
fn restore_url_password(cs: &str, username: Option<&str>, password: &str) -> String {
    let trimmed = cs.trim();
    let Some(sep) = trimmed.find("://") else { return cs.to_string() };
    let (scheme, rest) = (&trimmed[..sep], &trimmed[sep + 3..]);
    let authority_end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let (authority, tail) = rest.split_at(authority_end);
    let (userinfo, hostport) = match authority.rfind('@') {
        Some(at) => (Some(&authority[..at]), &authority[at + 1..]),
        None => (None, authority),
    };
    let user = match userinfo {
        Some(ui) if ui.contains(':') => return cs.to_string(), // already has a password
        Some(ui) if !ui.is_empty() => ui.to_string(),
        _ => match username {
            Some(u) if !u.is_empty() => encode(u),
            _ => return cs.to_string(),
        },
    };
    format!("{scheme}://{user}:{}@{hostport}{tail}", encode(password))
}

fn encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || b"-._~".contains(&b) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn restores_password_into_url() {
        assert_eq!(
            restore_url_password("postgres://bob@db:5432/app?sslmode=require", None, "p@ss"),
            "postgres://bob:p%40ss@db:5432/app?sslmode=require"
        );
        assert_eq!(
            restore_url_password("mysql://db/app", Some("root"), "x"),
            "mysql://root:x@db/app"
        );
        assert_eq!(restore_url_password("postgres://a:b@h/d", None, "x"), "postgres://a:b@h/d");
    }

    #[test]
    fn vault_round_trip_matches_js_envelope() {
        // Envelope format: v1.<b64 nonce>.<b64 ciphertext+tag>, AAD = reference.
        let salt = B64.encode([7u8; 16]);
        let params = argon2::Params::new(65_536, 3, 1, Some(32)).unwrap();
        let mut key = [0u8; 32];
        argon2::Argon2::new(argon2::Algorithm::Argon2id, argon2::Version::V0x13, params)
            .hash_password_into(b"correct horse battery", &[7u8; 16], &mut key)
            .unwrap();
        let cipher = Aes256Gcm::new_from_slice(&key).unwrap();
        let seal = |aad: &str, msg: &str| {
            let nonce = [3u8; 12];
            let ct = cipher
                .encrypt(Nonce::from_slice(&nonce), Payload { msg: msg.as_bytes(), aad: aad.as_bytes() })
                .unwrap();
            format!("v1.{}.{}", B64.encode(nonce), B64.encode(ct))
        };
        let verifier = seal(VAULT_CHECK_REF, VAULT_CHECK_TEXT);
        let vault = Vault::unlock("correct horse battery", &salt, &verifier).unwrap();
        assert_eq!(vault.decrypt("vault:abc", &seal("vault:abc", "hello")).unwrap(), "hello");
        assert!(vault.decrypt("vault:other", &seal("vault:abc", "hello")).is_err());
        assert!(Vault::unlock("wrong passphrase!!", &salt, &verifier).is_err());
    }
}
