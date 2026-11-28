//! Port of lib/transfer/neon-storage.ts and the `runNeonCli` helper of
//! lib/transfer/adapters/neon-adapter.ts: Neon Object Storage and Neon
//! Functions through the `neon` / `neonctl` CLI, with project/branch context
//! parsed from `neon-cli://profile/project/branch/db?role=` pointers
//! (lib/neon-cli/pointer.ts).

use super::supabase_api::MAX_STORAGE_FILE_BYTES;
use serde_json::Value;
use std::time::Duration;

pub struct NeonPointer {
    pub profile: String,
    pub project_id: String,
    pub branch_id: String,
}

/// `parseNeonCliConnectionString`
pub fn parse_pointer(cs: &str) -> Option<NeonPointer> {
    let url = url::Url::parse(cs.trim()).ok()?;
    if url.scheme() != "neon-cli" {
        return None;
    }
    let joined = format!("{}{}", url.host_str().unwrap_or(""), url.path());
    let segs: Vec<String> = joined
        .split('/')
        .filter(|s| !s.is_empty())
        .map(|s| percent_encoding::percent_decode_str(s).decode_utf8_lossy().into_owned())
        .collect();
    let role = url.query_pairs().find(|(k, _)| k == "role").map(|(_, v)| v.into_owned()).unwrap_or_default();
    if segs.len() < 4 || role.is_empty() {
        return None;
    }
    Some(NeonPointer { profile: segs[0].clone(), project_id: segs[1].clone(), branch_id: segs[2].clone() })
}

/// `locateNeonCliBinary` (`which neon` / `which neonctl`, plus Homebrew).
pub fn locate_neon_cli() -> Option<String> {
    let mut dirs: Vec<String> = std::env::var("PATH").unwrap_or_default().split(':').map(str::to_string).collect();
    dirs.extend(["/opt/homebrew/bin".into(), "/usr/local/bin".into()]);
    for name in ["neon", "neonctl"] {
        for d in &dirs {
            let p = format!("{d}/{name}");
            if std::path::Path::new(&p).is_file() {
                return Some(p);
            }
        }
    }
    None
}

pub struct CliOutput {
    pub stdout: String,
}

/// `runNeonCli` / `runBuckets`: args + context flags (+ `-o json`).
pub async fn run_neon_cli(cs: &str, args: &[String], json: bool, timeout: Duration, cwd: Option<&std::path::Path>) -> Result<CliOutput, String> {
    let ctx = parse_pointer(cs).ok_or("not a neon-cli:// connection")?;
    let bin = locate_neon_cli().ok_or("neon CLI not installed")?;
    let mut full: Vec<String> = args.to_vec();
    full.extend(["--profile".into(), ctx.profile, "--project-id".into(), ctx.project_id, "--branch".into(), ctx.branch_id]);
    if json {
        full.extend(["-o".into(), "json".into()]);
    }
    let mut cmd = tokio::process::Command::new(bin);
    cmd.args(&full).env("CI", "true").stdin(std::process::Stdio::null()).kill_on_drop(true);
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }
    let out = tokio::time::timeout(timeout, cmd.output()).await.map_err(|_| "timed out".to_string())?.map_err(|e| e.to_string())?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        let last = stderr.trim().lines().last().unwrap_or("").to_string();
        return Err(if last.is_empty() { format!("exited with code {}", out.status.code().unwrap_or(-1)) } else { last });
    }
    Ok(CliOutput { stdout: String::from_utf8_lossy(&out.stdout).into_owned() })
}

fn as_json_array(stdout: &str) -> Vec<Value> {
    let Ok(v) = serde_json::from_str::<Value>(stdout) else { return Vec::new() };
    if let Some(a) = v.as_array() {
        return a.clone();
    }
    for k in ["data", "buckets", "objects", "Contents"] {
        if let Some(a) = v.get(k).and_then(Value::as_array) {
            return a.clone();
        }
    }
    Vec::new()
}

fn s(v: &Value, keys: &[&str]) -> String {
    keys.iter().find_map(|k| v.get(*k).and_then(Value::as_str)).unwrap_or("").to_string()
}

pub struct NeonBucketInfo {
    pub name: String,
    pub access_level: Option<String>,
}

const MIN: Duration = Duration::from_secs(60);
const TWO_MIN: Duration = Duration::from_secs(120);

fn a(v: &[&str]) -> Vec<String> {
    v.iter().map(|s| s.to_string()).collect()
}

pub async fn list_neon_buckets(cs: &str) -> Result<Vec<NeonBucketInfo>, String> {
    let out = run_neon_cli(cs, &a(&["buckets", "list"]), true, MIN, None).await?;
    Ok(as_json_array(&out.stdout)
        .iter()
        .map(|b| NeonBucketInfo { name: s(b, &["name", "bucket", "Bucket"]), access_level: b.get("access_level").and_then(Value::as_str).map(str::to_string) })
        .filter(|b| !b.name.is_empty())
        .collect())
}

pub async fn ensure_neon_bucket(cs: &str, name: &str, public_read: bool) -> Result<(), String> {
    let mut args = a(&["buckets", "create", name]);
    if public_read {
        args.extend(a(&["--access-level", "public_read"]));
    }
    match run_neon_cli(cs, &args, true, MIN, None).await {
        Ok(_) => Ok(()),
        Err(e) if ["exist", "already", "conflict", "duplicate"].iter().any(|w| e.to_lowercase().contains(w)) => Ok(()),
        Err(e) => Err(e),
    }
}

pub async fn list_neon_objects(cs: &str, bucket: &str) -> Result<Vec<String>, String> {
    let out = run_neon_cli(cs, &a(&["buckets", "object", "list", bucket, "--recursive"]), true, MIN, None).await?;
    Ok(as_json_array(&out.stdout)
        .iter()
        .map(|o| o.as_str().map(str::to_string).unwrap_or_else(|| s(o, &["key", "Key", "name", "path"])))
        .map(|k| k.trim_start_matches('/').to_string())
        .filter(|k| !k.is_empty())
        .collect())
}

fn temp_dir(prefix: &str) -> std::io::Result<std::path::PathBuf> {
    let dir = std::env::temp_dir().join(format!("{prefix}{}", uuid_like()));
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

fn uuid_like() -> String {
    format!("{:x}{:x}", std::process::id(), chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default())
}

pub async fn download_neon_object(cs: &str, bucket: &str, key: &str) -> Result<Vec<u8>, String> {
    let dir = temp_dir("neon-dl-").map_err(|e| e.to_string())?;
    let dest = dir.join("object");
    let res = async {
        run_neon_cli(cs, &a(&["buckets", "object", "get", &format!("{bucket}/{key}"), "--file", &dest.to_string_lossy()]), false, TWO_MIN, None)
            .await
            .map_err(|e| format!("download failed: {}", e.chars().take(200).collect::<String>()))?;
        let len = std::fs::metadata(&dest).map_err(|e| e.to_string())?.len() as usize;
        if len > MAX_STORAGE_FILE_BYTES {
            return Err(format!("exceeds per-file cap ({len} bytes)"));
        }
        std::fs::read(&dest).map_err(|e| e.to_string())
    }
    .await;
    let _ = std::fs::remove_dir_all(&dir);
    res
}

pub async fn upload_neon_object(cs: &str, bucket: &str, key: &str, bytes: &[u8], content_type: Option<&str>) -> Result<(), String> {
    if bytes.len() > MAX_STORAGE_FILE_BYTES {
        return Err(format!("exceeds per-file cap ({} bytes)", bytes.len()));
    }
    let dir = temp_dir("neon-ul-").map_err(|e| e.to_string())?;
    let src = dir.join("object");
    let res = async {
        std::fs::write(&src, bytes).map_err(|e| e.to_string())?;
        let mut args = a(&["buckets", "object", "put", &format!("{bucket}/{key}"), "--file", &src.to_string_lossy()]);
        if let Some(ct) = content_type {
            args.extend(a(&["--content-type", ct]));
        }
        run_neon_cli(cs, &args, false, TWO_MIN, None).await.map(|_| ()).map_err(|e| format!("upload failed: {}", e.chars().take(200).collect::<String>()))
    }
    .await;
    let _ = std::fs::remove_dir_all(&dir);
    res
}

/// `sanitizeBucketName` (S3 naming rules) → (name, renamed).
pub fn sanitize_bucket_name(name: &str) -> (String, bool) {
    let lower: String = name.to_lowercase().chars().map(|c| if c.is_ascii_lowercase() || c.is_ascii_digit() || c == '.' || c == '-' { c } else { '-' }).collect();
    let mut collapsed = String::new();
    for c in lower.chars() {
        if c == '-' && collapsed.ends_with('-') {
            continue;
        }
        collapsed.push(c);
    }
    let mut out = collapsed.trim_matches(|c| c == '.' || c == '-').to_string();
    if out.len() < 3 {
        out = format!("bucket-{}", if out.is_empty() { "data" } else { &out });
    }
    out.truncate(63);
    let renamed = out != name;
    (out, renamed)
}

pub async fn temp_function_dir(slug: &str) -> std::io::Result<std::path::PathBuf> {
    temp_dir(&format!("neon-fn-{slug}-"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bucket_names() {
        assert_eq!(sanitize_bucket_name("My_Bucket"), ("my-bucket".into(), true));
        assert_eq!(sanitize_bucket_name("ab"), ("bucket-ab".into(), true));
        assert_eq!(sanitize_bucket_name("photos"), ("photos".into(), false));
        assert!(parse_pointer("neon-cli://default/proj/br-1/neondb?role=owner").is_some());
    }
}
