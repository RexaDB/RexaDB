//! Port of `@neon/realtime/server` capability sealing:
//! `parseRealtimeSecret`, `queryFingerprint`, Compact-JWE (dir / A256GCM).

use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use anyhow::{bail, Context, Result};
use base64::{engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD}, Engine};
use rand::RngCore;
use sha2::{Digest, Sha256};

const SECRET_PREFIX: &str = "nrt_live_1";
const KEY_BYTES: usize = 32;
const SEALED_QUERY_LIFETIME_SECONDS: u64 = 60;
const IV_BYTES: usize = 12;
const FINGERPRINT_DOMAIN: &[u8] = b"neon-live-query-fingerprint-v1\0";

#[derive(Debug, Clone)]
pub struct SealedLiveQuery {
    pub capability: String,
    pub query_fingerprint: String,
    /// Unix milliseconds.
    pub expires_at: u64,
}

#[derive(Debug, Clone)]
struct PgParam {
    type_oid: u32,
    /// PostgreSQL text encoding, or None for NULL.
    value: Option<String>,
}

/// Seal a parameterized SQL query the way `@neon/realtime` does.
pub fn seal_raw_sql(secret: &str, database: &str, sql: &str, params: &[serde_json::Value], debug: bool) -> Result<SealedLiveQuery> {
    let key = parse_realtime_secret(secret)?;
    // Match `@neon/realtime` `encodeTextParameter`: String(value), OID 0.
    let parameters: Vec<PgParam> = params
        .iter()
        .map(|value| match value {
            serde_json::Value::Null => PgParam { type_oid: 0, value: None },
            serde_json::Value::Bool(b) => PgParam {
                type_oid: 0,
                value: Some(if *b { "true".into() } else { "false".into() }),
            },
            serde_json::Value::Number(n) => PgParam {
                type_oid: 0,
                value: Some(n.to_string()),
            },
            serde_json::Value::String(s) => PgParam {
                type_oid: 0,
                value: Some(s.clone()),
            },
            other => PgParam {
                type_oid: 0,
                value: Some(other.to_string()),
            },
        })
        .collect();
    let fingerprint = query_fingerprint(sql, &parameters);
    let issued_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .context("system clock")?
        .as_secs();
    let expires_at = issued_at + SEALED_QUERY_LIFETIME_SECONDS;
    let params_json: Vec<serde_json::Value> = parameters
        .iter()
        .map(|p| {
            serde_json::json!({
                "type_oid": p.type_oid,
                "value": p.value.as_ref().map(|v| STANDARD.encode(v.as_bytes())),
            })
        })
        .collect();
    let claims = serde_json::json!({
        "v": 1,
        "aud": "realtime-proxy",
        "database": database,
        "error_details": if debug { "full" } else { "safe" },
        "query_fingerprint": fingerprint,
        "sql": sql,
        "parameters": params_json,
        "iat": issued_at,
        "exp": expires_at,
    });
    let capability = encrypt_compact_jwe(&key, &claims)?;
    Ok(SealedLiveQuery {
        capability,
        query_fingerprint: fingerprint,
        expires_at: expires_at * 1000,
    })
}

fn parse_realtime_secret(secret: &str) -> Result<[u8; KEY_BYTES]> {
    if !secret.starts_with(SECRET_PREFIX) {
        bail!("Invalid Realtime secret");
    }
    let encoded = &secret[SECRET_PREFIX.len()..];
    let key = URL_SAFE_NO_PAD
        .decode(encoded)
        .context("Invalid Realtime secret")?;
    if key.len() != KEY_BYTES || URL_SAFE_NO_PAD.encode(&key) != encoded {
        bail!("Invalid Realtime secret");
    }
    let mut out = [0u8; KEY_BYTES];
    out.copy_from_slice(&key);
    Ok(out)
}

fn query_fingerprint(sql: &str, parameters: &[PgParam]) -> String {
    let params_json: Vec<serde_json::Value> = parameters
        .iter()
        .map(|p| {
            serde_json::json!({
                "type_oid": p.type_oid,
                "value": p.value.as_ref().map(|v| STANDARD.encode(v.as_bytes())),
            })
        })
        .collect();
    let canonical = serde_json::json!({ "sql": sql, "parameters": params_json });
    let mut hasher = Sha256::new();
    hasher.update(FINGERPRINT_DOMAIN);
    hasher.update(canonical.to_string().as_bytes());
    encode_hex(&hasher.finalize())
}

fn encode_hex(bytes: &[u8]) -> String {
    const HEX: &[u8] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push(HEX[(b >> 4) as usize] as char);
        out.push(HEX[(b & 0xf) as usize] as char);
    }
    out
}

fn encrypt_compact_jwe(key: &[u8; KEY_BYTES], claims: &serde_json::Value) -> Result<String> {
    let header = serde_json::json!({ "alg": "dir", "enc": "A256GCM", "v": 1 });
    let encoded_header = URL_SAFE_NO_PAD.encode(header.to_string().as_bytes());
    let mut iv = [0u8; IV_BYTES];
    rand::thread_rng().fill_bytes(&mut iv);
    let cipher = Aes256Gcm::new_from_slice(key).context("AES key")?;
    let plaintext = claims.to_string();
    let encrypted = cipher
        .encrypt(
            Nonce::from_slice(&iv),
            Payload {
                msg: plaintext.as_bytes(),
                aad: encoded_header.as_bytes(),
            },
        )
        .map_err(|e| anyhow::anyhow!("AES-GCM encrypt failed: {e}"))?;
    // aes-gcm appends the 16-byte tag.
    if encrypted.len() < 16 {
        bail!("AES-GCM produced a truncated ciphertext");
    }
    let (ciphertext, tag) = encrypted.split_at(encrypted.len() - 16);
    let token = [
        encoded_header.as_str(),
        "",
        &URL_SAFE_NO_PAD.encode(iv),
        &URL_SAFE_NO_PAD.encode(ciphertext),
        &URL_SAFE_NO_PAD.encode(tag),
    ]
    .join(".");
    if token.len() > 262_144 {
        bail!("Live-query capability exceeds the size limit");
    }
    Ok(token)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_bad_secret() {
        assert!(parse_realtime_secret("nope").is_err());
    }

    #[test]
    fn seals_with_valid_secret() {
        let key = [7u8; 32];
        let secret = format!("{SECRET_PREFIX}{}", URL_SAFE_NO_PAD.encode(key));
        let sealed = seal_raw_sql(&secret, "neondb", "SELECT 1", &[], true).unwrap();
        assert!(sealed.capability.split('.').count() == 5);
        assert_eq!(sealed.query_fingerprint.len(), 64);
        assert!(sealed.expires_at > 0);
    }
}
