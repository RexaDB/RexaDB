// ─── Shared analytics helpers ─────────────────────────────────────────

type HistoryRow = { status: string; executedAt: number; duration: number; query: string };

export function computeBasicStats(rows: HistoryRow[]) {
  const totalQueries = rows.length;
  const successCount = rows.filter((r) => r.status?.toLowerCase() === "success").length;
  const errorCount = rows.filter((r) => r.status?.toLowerCase() === "error").length;
  const successRate = totalQueries > 0 ? successCount / totalQueries : 0;
  return { totalQueries, successCount, errorCount, successRate };
}

export function computeQueriesByDay(
  rows: HistoryRow[],
): Array<{ date: string; count: number; successCount: number; errorCount: number; avgDuration: number }> {
  const dayDataMap = new Map<string, { count: number; successCount: number; errorCount: number; totalDuration: number }>();
  for (const r of rows) {
    const d = new Date(r.executedAt);
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const entry = dayDataMap.get(dateStr) || { count: 0, successCount: 0, errorCount: 0, totalDuration: 0 };
    entry.count++;
    if (r.status?.toLowerCase() === "success") entry.successCount++;
    else if (r.status?.toLowerCase() === "error") entry.errorCount++;
    entry.totalDuration += r.duration;
    dayDataMap.set(dateStr, entry);
  }
  return Array.from(dayDataMap.entries())
    .map(([date, d]) => ({
      date,
      count: d.count,
      successCount: d.successCount,
      errorCount: d.errorCount,
      avgDuration: d.count > 0 ? Math.round(d.totalDuration / d.count) : 0,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function computeTopQueries(
  rows: HistoryRow[],
  limit = 10,
): Array<{ query: string; count: number }> {
  const queryCountMap = new Map<string, number>();
  for (const r of rows) {
    const q = r.query.trim().slice(0, 200);
    queryCountMap.set(q, (queryCountMap.get(q) || 0) + 1);
  }
  return Array.from(queryCountMap.entries())
    .map(([query, count]) => ({ query, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}
