const ON_CONFLICT_NOTHING_RE = /\s+ON\s+CONFLICT\s*\(([^)]+)\)\s+DO\s+NOTHING\s*;?\s*$/i;
const ON_CONFLICT_UPDATE_RE = /\s+ON\s+CONFLICT\s*\(([^)]+)\)\s+DO\s+UPDATE\s+SET\s+([\s\S]+?)\s*;?\s*$/i;

function replaceExcludedReferences(fragment: string) {
  return String(fragment || "").replace(/\bexcluded\.([a-zA-Z_][\w]*)\b/gi, "VALUES($1)");
}

export function compileMysqlUpsert(query: string) {
  if (ON_CONFLICT_NOTHING_RE.test(query)) {
    return query.replace(/^\s*INSERT\s+/i, (match) => `${match}IGNORE `).replace(ON_CONFLICT_NOTHING_RE, "");
  }

  const updateMatch = query.match(ON_CONFLICT_UPDATE_RE);
  if (!updateMatch) return query;

  const updateSetClause = replaceExcludedReferences(updateMatch[2] || "");
  const insertQuery = query.replace(ON_CONFLICT_UPDATE_RE, "");
  return `${insertQuery} ON DUPLICATE KEY UPDATE ${updateSetClause}`;
}
