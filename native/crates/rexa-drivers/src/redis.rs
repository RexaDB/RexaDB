//! Port of `lib/db/redis-client.ts` + `redis-utils.ts`.

/// `normalizeRedisConnectionString`
pub(crate) fn normalize(input: &str) -> String {
    let raw = input.trim();
    if raw.is_empty() {
        return "redis://localhost:6379/0".into();
    }
    let l = raw.to_ascii_lowercase();
    if l.starts_with("redis://") || l.starts_with("rediss://") {
        raw.to_string()
    } else {
        format!("redis://{raw}")
    }
}

/// `getRedisDbIndex`
pub(crate) fn db_index(cs: &str) -> u32 {
    url::Url::parse(&normalize(cs))
        .ok()
        .and_then(|u| crate::detect::percent_decode(u.path().trim_start_matches('/')).trim().parse().ok())
        .unwrap_or(0)
}
