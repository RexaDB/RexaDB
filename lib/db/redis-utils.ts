export function normalizeRedisConnectionString(input: string): string {
  const raw = String(input || "").trim();
  if (!raw) return "redis://localhost:6379/0";
  if (/^redis(s)?:\/\//i.test(raw)) return raw;
  return `redis://${raw}`;
}

export function getRedisDbIndex(connectionString: string): number {
  try {
    const url = new URL(normalizeRedisConnectionString(connectionString));
    const rawPath = decodeURIComponent(String(url.pathname || "").replace(/^\/+/, "").trim());
    const parsed = Number.parseInt(rawPath || "0", 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  } catch {
    return 0;
  }
}

export function getRedisDbLabel(connectionString: string): string {
  return `db${getRedisDbIndex(connectionString)}`;
}

export function updateRedisConnectionStringDatabase(connectionString: string, dbLabel: string): string {
  const normalized = normalizeRedisConnectionString(connectionString);
  const rawLabel = String(dbLabel || "").trim().toLowerCase();
  const numberMatch = rawLabel.match(/\d+/);
  const index = numberMatch ? Number.parseInt(numberMatch[0], 10) : 0;
  try {
    const url = new URL(normalized);
    url.pathname = `/${Number.isFinite(index) && index >= 0 ? index : 0}`;
    return url.toString();
  } catch {
    return normalized;
  }
}

export function buildRedisDatabaseList(count: number): string[] {
  const size = Number.isFinite(count) && count > 0 ? Math.min(count, 64) : 16;
  return Array.from({ length: size }, (_, i) => `db${i}`);
}

export function formatTtlHuman(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  if (seconds === 0) return "0s";

  let remaining = seconds;
  const parts: string[] = [];

  const y = Math.floor(remaining / (365 * 86400));
  if (y > 0) { parts.push(`${y}y`); }
  remaining %= 365 * 86400;

  const d = Math.floor(remaining / 86400);
  if (d > 0) { parts.push(`${d}d`); }
  remaining %= 86400;

  const h = Math.floor(remaining / 3600);
  if (h > 0) { parts.push(`${h}h`); }
  remaining %= 3600;

  const m = Math.floor(remaining / 60);
  if (m > 0) { parts.push(`${m}m`); }
  remaining %= 60;

  if (remaining > 0 || parts.length === 0) { parts.push(`${remaining}s`); }

  return parts.join(" ");
}

export function getRedisKeyCommand(key: string, type: string): string {
  const safeKey = key.includes(" ") ? `"${key.replace(/"/g, '\\"')}"` : key;
  switch (type) {
    case "string":
      return `GET ${safeKey}`;
    case "hash":
      return `HGETALL ${safeKey}`;
    case "list":
      return `LRANGE ${safeKey} 0 100`;
    case "set":
      return `SMEMBERS ${safeKey}`;
    case "zset":
      return `ZRANGE ${safeKey} 0 100 WITHSCORES`;
    case "stream":
      return `XRANGE ${safeKey} - + COUNT 100`;
    default:
      return `TYPE ${safeKey}`;
  }
}
