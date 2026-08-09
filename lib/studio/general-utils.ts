export function readInitialAppearance(): Record<string, unknown> {
  if (typeof window === "undefined") return {};
  const el = document.getElementById("rexadb-initial-appearance") as HTMLTemplateElement | null;
  const raw = el?.textContent || "{}";
  let parsed: Record<string, unknown> = {};
  try { parsed = JSON.parse(raw); } catch { parsed = {}; }
  return parsed;
}

export function isJsonColumnType(columnType: string) {
  return String(columnType || "").toLowerCase().includes("json");
}

export function normalizeJsonInput(value: any, columnName: string) {
  if (value === null || value === undefined) {
    return { value: null as any, error: null as string | null };
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      // Treat empty input as NULL for JSON columns.
      return { value: null as any, error: null as string | null };
    }
    try {
      return { value: JSON.parse(trimmed), error: null as string | null };
    } catch {
      return { value, error: `Invalid JSON in column "${columnName}"` };
    }
  }

  if (typeof value === "object") {
    return { value, error: null as string | null };
  }

  try {
    return { value: JSON.parse(String(value)), error: null as string | null };
  } catch {
    return { value, error: `Invalid JSON in column "${columnName}"` };
  }
}

export function stableStringify(value: unknown) {
  if (value === null || value === undefined) return String(value ?? "");
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

export function inferMongoShape(value: any): any {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    if (value.length === 0) return [];
    return [inferMongoShape(value[0])];
  }
  if (value instanceof Date) return "date";
  if (typeof value === "object") {
    const out: Record<string, any> = {};
    for (const [key, nested] of Object.entries(value)) {
      out[key] = inferMongoShape(nested);
    }
    return out;
  }
  return typeof value;
}

export function inferMongoReferenceTarget(fieldName: string, collectionNames: string[]): string | null {
  const normalizedField = String(fieldName || "").trim().toLowerCase();
  if (!normalizedField || normalizedField === "_id") return null;
  if (!normalizedField.endsWith("_id")) return null;

  const base = normalizedField.slice(0, -3);
  if (!base) return null;

  const candidates = new Set<string>([
    base,
    `${base}s`,
    `${base}es`,
    base.endsWith("y") ? `${base.slice(0, -1)}ies` : "",
  ].filter(Boolean));

  const lowerCollections = new Map(collectionNames.map((name) => [name.toLowerCase(), name] as const));
  for (const candidate of candidates) {
    const match = lowerCollections.get(candidate);
    if (match) return match;
  }

  return null;
}

export function mergeById<T extends { id: string }>(
  prev: T[],
  items: T[],
  merge: (existing: T, incoming: T) => T = (e, i) => ({ ...e, ...i }),
): T[] {
  const next = [...prev];
  const indexById = new Map(next.map((item, idx) => [item.id, idx]));
  items.forEach((item) => {
    const idx = indexById.get(item.id);
    if (idx === undefined) {
      indexById.set(item.id, next.length);
      next.push(item);
    } else {
      next[idx] = merge(next[idx], item);
    }
  });
  return next;
}
