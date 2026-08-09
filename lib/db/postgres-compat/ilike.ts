const PG_ILIKE_RE = /(\([^()]+\)|"[^"]+"|`[^`]+`|\b[a-zA-Z_][\w.]*\b)\s+(NOT\s+)?ILIKE\s+(\$\d+|\?|'[^']*'|\([^()]+\)|"[^"]+"|`[^`]+`|\b[a-zA-Z_][\w.]*\b)/gi;

export function compilePgIlike(query: string) {
  return String(query || "").replace(
    PG_ILIKE_RE,
    (_, left, notWord = "", right) => `LOWER(${left}) ${notWord ? "NOT " : ""}LIKE LOWER(${right})`
  );
}
