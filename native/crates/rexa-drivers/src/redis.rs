//! Port of `lib/db/redis-client.ts` + `redis-utils.ts` with a small RESP2
//! client (TCP or TLS for `rediss://`). The editor's text is tokenized like
//! `createTokenizer()` (quotes, backslash escapes) and sent as one command;
//! replies map to rows like `toRows`: scalar → `{ result }`, array of
//! scalars → `{ value }` per element.

use crate::*;
use anyhow::{anyhow, Context};
use std::pin::Pin;
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::sync::Mutex as AsyncMutex;

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

/// `updateRedisConnectionStringDatabase` (`db3` → `/3`).
pub(crate) fn with_db(cs: &str, label: &str) -> String {
    let n: u32 = label.chars().filter(|c| c.is_ascii_digit()).collect::<String>().parse().unwrap_or(0);
    match url::Url::parse(&normalize(cs)) {
        Ok(mut u) => {
            u.set_path(&format!("/{n}"));
            u.to_string()
        }
        Err(_) => normalize(cs),
    }
}

/// `createTokenizer()` (space-delimited, `"`/`'` quotes, `\` escapes).
pub fn split_args(input: &str) -> Vec<String> {
    let raw = input.trim();
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut quote: Option<char> = None;
    let mut escape = false;
    for ch in raw.chars() {
        if escape {
            cur.push(ch);
            escape = false;
            continue;
        }
        if ch == '\\' {
            escape = true;
            continue;
        }
        if let Some(q) = quote {
            if ch == q {
                quote = None;
            } else {
                cur.push(ch);
            }
            continue;
        }
        if ch == '"' || ch == '\'' {
            quote = Some(ch);
            continue;
        }
        if ch.is_whitespace() {
            if !cur.is_empty() {
                out.push(std::mem::take(&mut cur));
            }
            continue;
        }
        cur.push(ch);
    }
    if !cur.trim().is_empty() {
        out.push(cur.trim().to_string());
    }
    out
}

/// `formatTtlHuman`
pub fn format_ttl_human(seconds: i64) -> String {
    if seconds < 0 {
        return "—".into();
    }
    if seconds == 0 {
        return "0s".into();
    }
    let mut rem = seconds;
    let mut parts = Vec::new();
    for (unit, size) in [("y", 365 * 86400), ("d", 86400), ("h", 3600), ("m", 60)] {
        let n = rem / size;
        if n > 0 {
            parts.push(format!("{n}{unit}"));
        }
        rem %= size;
    }
    if rem > 0 || parts.is_empty() {
        parts.push(format!("{rem}s"));
    }
    parts.join(" ")
}

/// `getRedisKeyCommand`: the command that shows a key's value.
pub fn key_command(key: &str, ty: &str) -> String {
    let k = if key.contains(' ') { format!("\"{}\"", key.replace('"', "\\\"")) } else { key.to_string() };
    match ty {
        "string" => format!("GET {k}"),
        "hash" => format!("HGETALL {k}"),
        "list" => format!("LRANGE {k} 0 100"),
        "set" => format!("SMEMBERS {k}"),
        "zset" => format!("ZRANGE {k} 0 100 WITHSCORES"),
        "stream" => format!("XRANGE {k} - + COUNT 100"),
        _ => format!("TYPE {k}"),
    }
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Reply {
    Nil,
    Simple(String),
    Int(i64),
    Bulk(Vec<u8>),
    Array(Vec<Reply>),
    Error(String),
}

impl Reply {
    fn text(&self) -> Option<String> {
        match self {
            Reply::Simple(s) => Some(s.clone()),
            Reply::Int(i) => Some(i.to_string()),
            Reply::Bulk(b) => Some(String::from_utf8_lossy(b).into_owned()),
            Reply::Error(e) => Some(e.clone()),
            _ => None,
        }
    }

    fn to_json(&self) -> serde_json::Value {
        match self {
            Reply::Nil => serde_json::Value::Null,
            Reply::Int(i) => (*i).into(),
            Reply::Array(a) => a.iter().map(Reply::to_json).collect(),
            other => other.text().unwrap_or_default().into(),
        }
    }

    fn int(&self) -> Option<i64> {
        match self {
            Reply::Int(i) => Some(*i),
            other => other.text()?.parse().ok(),
        }
    }
}

trait Io: AsyncRead + AsyncWrite + Send + Unpin {}
impl<T: AsyncRead + AsyncWrite + Send + Unpin> Io for T {}

struct Conn {
    io: BufReader<Pin<Box<dyn Io>>>,
}

impl Conn {
    async fn open(cs: &str) -> Result<Conn> {
        let u = url::Url::parse(&normalize(cs)).context("invalid Redis connection string")?;
        let host = u.host_str().unwrap_or("localhost").to_string();
        let port = u.port().unwrap_or(6379);
        let tcp = tokio::time::timeout(Duration::from_secs(15), tokio::net::TcpStream::connect((host.as_str(), port)))
            .await
            .map_err(|_| anyhow!("Redis connection timed out"))??;
        let io: Pin<Box<dyn Io>> = if u.scheme() == "rediss" {
            let c = tokio_native_tls::TlsConnector::from(native_tls::TlsConnector::new()?);
            Box::pin(c.connect(&host, tcp).await?)
        } else {
            Box::pin(tcp)
        };
        let mut conn = Conn { io: BufReader::new(io) };
        let user = crate::detect::percent_decode(u.username());
        if let Some(pw) = u.password().map(crate::detect::percent_decode) {
            let args: Vec<String> = if user.is_empty() { vec!["AUTH".into(), pw] } else { vec!["AUTH".into(), user, pw] };
            if let Reply::Error(e) = conn.cmd(&args).await? {
                bail!("{e}");
            }
        }
        let db = db_index(cs);
        if db != 0 {
            if let Reply::Error(e) = conn.cmd(&["SELECT".to_string(), db.to_string()]).await? {
                bail!("{e}");
            }
        }
        Ok(conn)
    }

    async fn cmd(&mut self, args: &[String]) -> Result<Reply> {
        let mut buf = format!("*{}\r\n", args.len()).into_bytes();
        for a in args {
            buf.extend(format!("${}\r\n", a.len()).as_bytes());
            buf.extend(a.as_bytes());
            buf.extend(b"\r\n");
        }
        self.io.get_mut().write_all(&buf).await?;
        self.io.get_mut().flush().await?;
        read_reply(&mut self.io).await
    }
}

fn read_reply<'a>(r: &'a mut BufReader<Pin<Box<dyn Io>>>) -> Pin<Box<dyn std::future::Future<Output = Result<Reply>> + Send + 'a>> {
    Box::pin(async move {
        let mut line = String::new();
        if r.read_line(&mut line).await? == 0 {
            bail!("Redis connection closed");
        }
        let line = line.trim_end_matches(['\r', '\n']);
        let (tag, rest) = line.split_at(1.min(line.len()));
        Ok(match tag {
            "+" => Reply::Simple(rest.into()),
            "-" => Reply::Error(rest.into()),
            ":" => Reply::Int(rest.parse()?),
            "$" => {
                let n: i64 = rest.parse()?;
                if n < 0 {
                    Reply::Nil
                } else {
                    let mut b = vec![0; n as usize + 2];
                    r.read_exact(&mut b).await?;
                    b.truncate(n as usize);
                    Reply::Bulk(b)
                }
            }
            "*" => {
                let n: i64 = rest.parse()?;
                if n < 0 {
                    Reply::Nil
                } else {
                    let mut items = Vec::with_capacity(n as usize);
                    for _ in 0..n {
                        items.push(read_reply(r).await?);
                    }
                    Reply::Array(items)
                }
            }
            other => bail!("Unexpected Redis reply: {other}{rest}"),
        })
    })
}

/// `toRows`.
pub(crate) fn reply_to_result(reply: &Reply) -> QueryResult {
    let cell = |r: &Reply| match r {
        Reply::Nil => Cell::Null,
        Reply::Array(_) => Cell::Text(r.to_json().to_string()),
        other => Cell::Text(other.text().unwrap_or_default()),
    };
    match reply {
        Reply::Array(items) => {
            let mut r = QueryResult::from_columns(vec!["value".into()]);
            if items.is_empty() {
                r.columns.clear();
            }
            r.rows = items.iter().map(|i| vec![cell(i)]).collect();
            r
        }
        other => QueryResult { columns: vec!["result".into()], rows: vec![vec![cell(other)]], ..Default::default() },
    }
}

pub struct RedisDriver {
    cs: String,
    conn: AsyncMutex<Option<Conn>>,
}

impl RedisDriver {
    pub async fn connect(cs: &str) -> Result<Self> {
        let conn = Conn::open(cs).await?;
        Ok(RedisDriver { cs: cs.to_string(), conn: AsyncMutex::new(Some(conn)) })
    }

    pub(crate) async fn command(&self, args: &[String]) -> Result<Reply> {
        let mut g = self.conn.lock().await;
        if g.is_none() {
            *g = Some(Conn::open(&self.cs).await?);
        }
        match g.as_mut().unwrap().cmd(args).await {
            Ok(r) => Ok(r),
            Err(_) => {
                // Reconnect once (the original opens a client per command).
                *g = Some(Conn::open(&self.cs).await?);
                g.as_mut().unwrap().cmd(args).await
            }
        }
    }
}

async fn keys_with_meta(conn: &mut Conn, pattern: &str, limit: usize) -> Result<Vec<RedisKeyInfo>> {
    let mut keys = Vec::new();
    let mut cursor = "0".to_string();
    loop {
        let mut args = vec!["SCAN".to_string(), cursor.clone()];
        if !pattern.is_empty() {
            args.extend(["MATCH".to_string(), pattern.to_string()]);
        }
        args.extend(["COUNT".to_string(), "200".to_string()]);
        match conn.cmd(&args).await? {
            Reply::Array(a) if a.len() >= 2 => {
                cursor = a[0].text().unwrap_or_else(|| "0".into());
                if let Reply::Array(batch) = &a[1] {
                    keys.extend(batch.iter().filter_map(Reply::text));
                }
            }
            Reply::Error(e) => bail!("{e}"),
            _ => break,
        }
        if cursor == "0" || keys.len() >= limit {
            break;
        }
    }
    keys.truncate(limit);
    let mut out = Vec::with_capacity(keys.len());
    for key in keys {
        let ty = conn.cmd(&["TYPE".into(), key.clone()]).await?.text().unwrap_or_else(|| "unknown".into());
        let ttl = conn.cmd(&["TTL".into(), key.clone()]).await?.int().filter(|t| *t >= 0);
        let size_cmd = match ty.as_str() {
            "string" => Some("STRLEN"),
            "list" => Some("LLEN"),
            "set" => Some("SCARD"),
            "zset" => Some("ZCARD"),
            "hash" => Some("HLEN"),
            "stream" => Some("XLEN"),
            _ => None,
        };
        let size = match size_cmd {
            Some(c) => conn.cmd(&[c.into(), key.clone()]).await.ok().and_then(|r| r.int()),
            None => None,
        };
        out.push(RedisKeyInfo { key, r#type: ty, ttl_seconds: ttl, size });
    }
    Ok(out)
}

#[async_trait]
impl Driver for RedisDriver {
    fn kind(&self) -> Kind {
        Kind::Redis
    }

    async fn schemas(&self) -> Result<Vec<String>> {
        Ok(Vec::new())
    }

    async fn tables(&self, _schema: &str) -> Result<Vec<TableRef>> {
        Ok(Vec::new())
    }

    async fn table_structure(&self, _t: &TableRef) -> Result<Vec<ColumnDetail>> {
        Ok(Vec::new())
    }

    async fn execute(&self, sql: &str, row_limit: usize) -> Result<QueryResult> {
        let started = std::time::Instant::now();
        let args = split_args(sql);
        if args.is_empty() {
            return Ok(QueryResult::default());
        }
        let reply = self.command(&args).await?;
        if let Reply::Error(e) = reply {
            bail!("{e}");
        }
        let mut r = reply_to_result(&reply);
        if r.rows.len() > row_limit {
            r.rows.truncate(row_limit);
            r.truncated = true;
        }
        r.elapsed = started.elapsed();
        Ok(r)
    }

    async fn ping(&self) -> Result<()> {
        self.execute("PING", 1).await.map(|_| ())
    }

    /// `getRedisDatabases`: `CONFIG GET databases` (default 16, max 64).
    async fn databases(&self) -> Result<Vec<String>> {
        let n = match self.command(&["CONFIG".into(), "GET".into(), "databases".into()]).await {
            Ok(Reply::Array(a)) if a.len() >= 2 => a[1].int().unwrap_or(16),
            _ => 16,
        };
        let n = if n > 0 { n.min(64) } else { 16 };
        Ok((0..n).map(|i| format!("db{i}")).collect())
    }

    /// `getRedisKeysWithMeta` (limit clamped to 1..=1000, default 200).
    async fn redis_keys(&self, pattern: &str, limit: usize, db: Option<&str>) -> Result<Vec<RedisKeyInfo>> {
        let limit = if limit == 0 { 200 } else { limit.clamp(1, 1000) };
        let pattern = if pattern.is_empty() { "*" } else { pattern };
        match db {
            Some(db) => {
                let mut c = Conn::open(&with_db(&self.cs, db)).await?;
                keys_with_meta(&mut c, pattern, limit).await
            }
            None => {
                let mut g = self.conn.lock().await;
                if g.is_none() {
                    *g = Some(Conn::open(&self.cs).await?);
                }
                keys_with_meta(g.as_mut().unwrap(), pattern, limit).await
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn utils() {
        assert_eq!(split_args(r#"SET "my key" 'a b' x\ y"#), vec!["SET", "my key", "a b", "x y"]);
        assert_eq!(db_index("redis://h:6379/4"), 4);
        assert_eq!(db_index("h:6379"), 0);
        assert_eq!(with_db("redis://h/1", "db7"), "redis://h/7");
        assert_eq!(format_ttl_human(90061), "1d 1h 1m 1s");
        assert_eq!(format_ttl_human(-1), "—");
        assert_eq!(key_command("a b", "hash"), "HGETALL \"a b\"");
        let r = reply_to_result(&Reply::Array(vec![Reply::Bulk(b"a".to_vec()), Reply::Nil]));
        assert_eq!((r.columns.clone(), r.rows.clone()), (vec!["value".to_string()], vec![vec![Cell::Text("a".into())], vec![Cell::Null]]));
        let r = reply_to_result(&Reply::Simple("PONG".into()));
        assert_eq!(r.columns, vec!["result"]);
    }
}
