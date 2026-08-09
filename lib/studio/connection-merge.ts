import type { Connection } from "@/lib/db/schema";

function normalizeId(value: number | null | undefined) {
  return Number.isInteger(value) && Number(value) > 0 ? String(value) : "";
}

export function mergeConnections(primary: Connection[], secondary: Connection[]) {
  const seen = new Set<string>();
  const merged: Connection[] = [];

  const push = (conn: Connection) => {
    const key = normalizeId(conn.id);
    if (!key || seen.has(key)) return;
    seen.add(key);
    merged.push(conn);
  };

  primary.forEach(push);
  secondary.forEach(push);

  return merged.sort((a, b) => {
    const aOrder = Number(a.sortOrder ?? a.createdAt ?? 0);
    const bOrder = Number(b.sortOrder ?? b.createdAt ?? 0);
    return bOrder - aOrder;
  });
}
