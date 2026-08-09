export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  let inDollarTag: string | null = null;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (!inDouble && ch === "'" && (!inSingle || next !== "'") && !inDollarTag) {
      inSingle = !inSingle;
    } else if (inSingle && ch === "'" && next === "'") {
      current += ch;
      i++;
      continue;
    } else if (!inSingle && ch === '"' && !inDollarTag) {
      inDouble = !inDouble;
    } else if (!inSingle && !inDouble && ch === '$') {
      const match = sql.slice(i).match(/^\$[A-Za-z0-9_]*\$/);
      if (match) {
        const tag = match[0];
        if (!inDollarTag) {
          inDollarTag = tag;
        } else if (inDollarTag === tag) {
          inDollarTag = null;
        }
      }
    }
    if (ch === ';' && !inSingle && !inDouble && !inDollarTag) {
      const trimmed = current.trim();
      if (trimmed) statements.push(trimmed);
      current = '';
      continue;
    }
    current += ch;
  }
  const trimmed = current.trim();
  if (trimmed) statements.push(trimmed);
  return statements;
}
