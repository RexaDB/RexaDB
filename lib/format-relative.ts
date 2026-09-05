/**
 * Compact relative-time labels.
 * - AgentsClient threads: `formatRelativeTime(ts, { dateStyle: "short" })`
 *   → "now" / "5m" / "3h" / "2d" / "Jan 5"
 * - ai-threads-sidebar: `formatRelativeTime(ts, { suffix: " ago", nowLabel: "just now" })`
 *   → "just now" / "5m ago" / ...
 */
export function formatRelativeTime(
  timestamp: number,
  opts?: { suffix?: string; nowLabel?: string; dateStyle?: "default" | "short" },
): string {
  const suffix = opts?.suffix ?? "";
  const nowLabel = opts?.nowLabel ?? "now";
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return nowLabel;
  if (minutes < 60) return `${minutes}m${suffix}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h${suffix}`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d${suffix}`;
  return opts?.dateStyle === "short"
    ? new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : new Date(timestamp).toLocaleDateString();
}
