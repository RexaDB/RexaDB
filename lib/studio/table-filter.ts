export type TableTypeFilter = "all" | "tables" | "views";
export type NameFilterMode = "auto" | "substring" | "pattern";

export interface TableNameFilterOptions {
  mode?: NameFilterMode;
  caseSensitive?: boolean;
}

export function hasWildcardChars(pattern: string): boolean {
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "\\") {
      i++;
      continue;
    }
    if (c === "%" || c === "_") return true;
  }
  return false;
}

/** Convert a SQL LIKE pattern (%, _, \ escapes) to a RegExp body (no anchors). */
function likeBodyToRegExpSource(pattern: string): string {
  let out = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "\\" && i + 1 < pattern.length) {
      out += escapeRegExpChar(pattern[i + 1]);
      i++;
      continue;
    }
    if (c === "%") {
      out += ".*";
      continue;
    }
    if (c === "_") {
      out += ".";
      continue;
    }
    out += escapeRegExpChar(c);
  }
  return out;
}

function escapeRegExpChar(c: string): string {
  return c.replace(/[.*+?^${}()|[\]\\]/, "\\$&");
}

export function likeToRegExp(pattern: string, caseSensitive = false): RegExp {
  return new RegExp(`^${likeBodyToRegExpSource(pattern)}$`, caseSensitive ? "" : "i");
}

export function matchesTableName(
  tableName: string,
  query: string,
  options: TableNameFilterOptions = {},
): boolean {
  const { mode = "auto", caseSensitive = false } = options;
  const q = (query ?? "").trim();
  if (!q) return true;
  const name = tableName ?? "";
  if (mode === "substring") {
    return caseSensitive ? name.includes(q) : name.toLowerCase().includes(q.toLowerCase());
  }
  if (mode === "pattern") {
    try {
      return likeToRegExp(q, caseSensitive).test(name);
    } catch {
      return false;
    }
  }
  // auto: LIKE when wildcards present, otherwise substring (friendlier than
  // SQL Developer which would require % on both ends for contains).
  if (hasWildcardChars(q)) {
    try {
      return likeToRegExp(q, caseSensitive).test(name);
    } catch {
      return false;
    }
  }
  return caseSensitive ? name.includes(q) : name.toLowerCase().includes(q.toLowerCase());
}

export function effectiveNameFilterMode(query: string, mode: NameFilterMode): "substring" | "pattern" {
  if (mode === "auto") return hasWildcardChars((query ?? "").trim()) ? "pattern" : "substring";
  return mode;
}

export interface FilterTablesOptions extends TableNameFilterOptions {
  query?: string;
  typeFilter?: TableTypeFilter;
  viewSet?: Set<string> | string[];
  /** When false, %/_ are treated as literal characters (plain contains search). Default true. */
  wildcardsEnabled?: boolean;
}

export function filterTablesByNameAndType<T>(
  tables: T[],
  getName: (t: T) => string,
  options: FilterTablesOptions = {},
): T[] {
  const { query = "", typeFilter = "all", viewSet, wildcardsEnabled = true } = options;
  const q = (query ?? "").trim();
  const views = viewSet instanceof Set ? viewSet : new Set(viewSet ?? []);
  const nameOpts = {
    mode: (wildcardsEnabled ? options.mode ?? "auto" : "substring") as NameFilterMode,
    caseSensitive: options.caseSensitive,
  };
  return (tables ?? []).filter((t) => {
    const name = getName(t);
    if (typeFilter === "tables" && views.has(name)) return false;
    if (typeFilter === "views" && !views.has(name)) return false;
    if (!q) return true;
    return matchesTableName(name, q, nameOpts);
  });
}

/**
 * Merge base tables + views into the browsable object list.
 *
 * Root cause of "sidebar shows no views": for Oracle/MSSQL/JDBC the backend
 * splits them (getTables returns TABLE only, getViews returns VIEW only) and
 * consumers iterated `tables` alone. Postgres masked it because its getTables
 * returns everything. Dedupes so engines that already include views are safe.
 */
export function mergeTablesAndViews(
  tables: string[],
  views: string[] | Set<string> | undefined | null,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of [...(tables ?? []), ...(views instanceof Set ? [...views] : (views ?? []))]) {
    const key = String(name ?? "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}
