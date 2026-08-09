import { Fragment } from "react";

const SQL_KEYWORDS = new Set([
  "select", "from", "where", "insert", "into", "values", "update", "set", "delete",
  "join", "left", "right", "inner", "outer", "full", "on", "group", "by", "order",
  "limit", "offset", "having", "as", "and", "or", "not", "null", "is", "in", "exists",
  "create", "alter", "drop", "table", "view", "index", "primary", "key", "foreign",
  "references", "constraint", "unique", "default", "returning", "with", "union",
  "all", "distinct", "case", "when", "then", "else", "end", "like", "ilike",
]);

function getTokenClass(token: string) {
  const lower = token.toLowerCase();

  if (/^--.*$/.test(token)) return "text-muted-foreground";
  if (/^'[^']*'$/.test(token) || /^"[^"]*"$/.test(token)) return "text-emerald-400";
  if (/^\d+(\.\d+)?$/.test(token)) return "text-amber-300";
  if (SQL_KEYWORDS.has(lower)) return "text-blue-400";
  return "text-foreground";
}

export function highlightSql(query: string) {
  return highlightSqlWithMatches(query);
}

export function highlightSqlWithMatches(
  query: string,
  matches: Array<{ start: number; end: number }> = [],
  activeMatchIndex: number = -1,
) {
  const source = String(query || "");
  let offset = 0;

  return source
    .split(/(\s+|--.*$|'[^']*'|"[^"]*"|\b\d+(?:\.\d+)?\b|\b[a-zA-Z_][a-zA-Z0-9_]*\b|[^\s])/gm)
    .filter(Boolean)
    .map((token, index) => {
      const tokenStart = offset;
      const tokenEnd = tokenStart + token.length;
      offset = tokenEnd;

      if (/^\s+$/.test(token)) {
        return <Fragment key={`${token}-${index}`}>{token}</Fragment>;
      }

      const parts: Array<{ text: string; inMatch: boolean; active: boolean }> = [];
      let cursor = tokenStart;
      const tokenMatches = matches
        .map((match, matchIndex) => ({
          start: Math.max(match.start, tokenStart),
          end: Math.min(match.end, tokenEnd),
          active: matchIndex === activeMatchIndex,
        }))
        .filter((match) => match.start < match.end)
        .sort((a, b) => a.start - b.start);

      for (const match of tokenMatches) {
        if (cursor < match.start) {
          parts.push({
            text: source.slice(cursor, match.start),
            inMatch: false,
            active: false,
          });
        }

        parts.push({
          text: source.slice(match.start, match.end),
          inMatch: true,
          active: match.active,
        });
        cursor = match.end;
      }

      if (cursor < tokenEnd) {
        parts.push({
          text: source.slice(cursor, tokenEnd),
          inMatch: false,
          active: false,
        });
      }

      return (
        <span key={`${token}-${index}`} className={getTokenClass(token)}>
          {parts.map((part, partIndex) => {
            if (!part.inMatch) {
              return <Fragment key={`${token}-${index}-${partIndex}`}>{part.text}</Fragment>;
            }

            return (
              <span
                key={`${token}-${index}-${partIndex}`}
                className={part.active ? "rounded bg-amber-400/35 text-foreground" : "rounded bg-amber-300/20"}
              >
                {part.text}
              </span>
            );
          })}
        </span>
      );
    });
}
