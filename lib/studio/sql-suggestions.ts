import { getSqlContinuationRule, getSqlDialectKeywords } from "@/lib/studio/sql-dialects";

const SQL_KEYWORDS = [
  "SELECT", "FROM", "WHERE", "INSERT", "INTO", "VALUES", "UPDATE", "SET", "DELETE",
  "CREATE", "ALTER", "DROP", "TABLE", "VIEW", "INDEX", "JOIN", "LEFT", "RIGHT",
  "INNER", "OUTER", "FULL", "ON", "GROUP", "BY", "ORDER", "LIMIT", "OFFSET",
  "HAVING", "DISTINCT", "UNION", "ALL", "AS", "AND", "OR", "NOT", "NULL",
  "CASE", "WHEN", "THEN", "ELSE", "END", "LIKE", "ILIKE", "IN", "EXISTS",
  "WITH", "RECURSIVE", "RETURNING", "MERGE", "USING", "ONLY", "LATERAL",
  "CROSS", "NATURAL", "ASC", "DESC", "NULLS", "FIRST", "LAST", "WINDOW",
  "OVER", "PARTITION", "ROWS", "RANGE", "CURRENT", "ROW", "FOLLOWING",
  "PRECEDING", "BETWEEN", "FETCH", "NEXT", "TIES", "FOR", "SHARE", "LOCKED",
  "NOWAIT", "SKIP", "MATERIALIZED", "TEMP", "TEMPORARY", "IF", "CASCADE",
  "RESTRICT", "TRUNCATE", "COMMENT", "ANALYZE", "VACUUM", "GRANT", "REVOKE",
  "BEGIN", "COMMIT", "ROLLBACK", "SAVEPOINT", "RELEASE", "DECLARE", "CURSOR",
  "DO", "LANGUAGE", "FUNCTION", "PROCEDURE", "TRIGGER", "SEQUENCE", "SCHEMA",
  "DATABASE", "TYPE", "ENUM", "PRIMARY", "FOREIGN", "KEY", "REFERENCES",
  "CONSTRAINT", "UNIQUE", "CHECK", "DEFAULT", "GENERATED", "IDENTITY",
  "SERIAL", "BIGSERIAL", "SMALLSERIAL", "BOOLEAN", "INTEGER", "BIGINT",
  "SMALLINT", "NUMERIC", "DECIMAL", "REAL", "DOUBLE", "PRECISION", "TEXT",
  "VARCHAR", "CHAR", "UUID", "JSON", "JSONB", "DATE", "TIME", "TIMESTAMP",
  "TIMESTAMPTZ", "INTERVAL", "BYTEA", "ARRAY", "CAST", "COALESCE", "GREATEST",
  "LEAST", "COUNT", "SUM", "AVG", "MIN", "MAX", "ABS", "ROUND", "FLOOR",
  "CEIL", "LOWER", "UPPER", "TRIM", "LTRIM", "RTRIM", "SUBSTRING", "POSITION",
  "LENGTH", "CONCAT", "REPLACE", "SPLIT_PART", "DATE_TRUNC", "EXTRACT", "AGE",
  "NOW", "CURRENT_DATE", "CURRENT_TIME", "CURRENT_TIMESTAMP", "TRUE", "FALSE",
];

const SQL_FUNCTIONS = [
  "COUNT", "SUM", "AVG", "MIN", "MAX", "COALESCE", "CAST", "DATE_TRUNC",
  "EXTRACT", "LOWER", "UPPER", "TRIM", "SUBSTRING", "LENGTH", "CONCAT",
  "ROW_NUMBER", "RANK", "DENSE_RANK", "LAG", "LEAD", "JSON_BUILD_OBJECT",
  "JSONB_BUILD_OBJECT", "ARRAY_AGG", "STRING_AGG", "GREATEST", "LEAST", "NOW",
];

const CLAUSE_BOUNDARY_KEYWORDS = new Set([
  "select", "all", "distinct", "from", "join", "left", "right", "inner", "outer", "full",
  "where", "on", "group", "by", "order", "having", "limit", "offset", "insert", "into",
  "update", "set", "delete", "values", "as", "and", "or", "case", "when", "then", "else",
]);

export interface SqlSuggestionItem {
  label: string;
  insertText: string;
  kind: "keyword" | "table" | "column" | "function";
  detail?: string;
}

interface SchemaEntry {
  schema?: string;
  name?: string;
  columns?: Array<{ name?: string; type?: string }>;
}

interface RankedSuggestion extends SqlSuggestionItem {
  score: number;
}

interface ContextInfo {
  clause: string;
  hasTableContext: boolean;
  justTypedSelect: boolean;
  justTypedSelectModifier: boolean;
  startOfStatement: boolean;
  trailingWhitespace: boolean;
  afterSelectStar: boolean;
  justTypedUnion: boolean;
  justTypedUnionAll: boolean;
}

function normalize(value: string) {
  return value.toLowerCase();
}

function getCurrentStatement(before: string) {
  const parts = before.split(";");
  return parts[parts.length - 1] ?? before;
}

function getClause(before: string) {
  const tokens = before.match(/[a-zA-Z_]+/g)?.map(normalize) ?? [];
  const clauses = new Set([
    "select", "from", "join", "where", "on", "group", "order", "having",
    "update", "into", "set", "delete", "insert",
  ]);

  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    if (clauses.has(tokens[index])) return tokens[index];
  }
  return "select";
}

function getContextInfo(before: string, hasTableContext: boolean): ContextInfo {
  const tokens = before.match(/[a-zA-Z_*]+/g)?.map(normalize) ?? [];
  const last = tokens[tokens.length - 1] ?? "";
  const prev = tokens[tokens.length - 2] ?? "";
  const clause = getClause(before);
  const trimmed = before.trimEnd();
  const startOfStatement = trimmed.length === 0 || /[;(]\s*[a-zA-Z_*]*$/i.test(trimmed);
  const trailingWhitespace = /\s$/.test(before);
  const afterSelectStar = /\bselect\s+\*\s*$/i.test(trimmed);

  return {
    clause,
    hasTableContext,
    justTypedSelect: last === "select",
    justTypedSelectModifier: prev === "select" && (last === "all" || last === "distinct"),
    startOfStatement,
    trailingWhitespace,
    afterSelectStar,
    justTypedUnion: last === "union",
    justTypedUnionAll: prev === "union" && last === "all",
  };
}

function parseAliasContext(before: string) {
  const aliasMatch = before.match(/([a-zA-Z_][a-zA-Z0-9_]*)\.([a-zA-Z0-9_]*)$/);
  if (!aliasMatch) return null;
  return {
    alias: aliasMatch[1],
    prefix: aliasMatch[2] ?? "",
  };
}

function parseToken(before: string) {
  const tokenMatch = before.match(/([a-zA-Z_][a-zA-Z0-9_]*)$/);
  return tokenMatch?.[1] ?? "";
}

function getAliasMap(before: string, entries: SchemaEntry[]) {
  const aliasMap = new Map<string, SchemaEntry>();
  const regex = /\b(?:from|join|update|into)\s+([a-zA-Z_][a-zA-Z0-9_]*)(?:\.([a-zA-Z_][a-zA-Z0-9_]*))?(?:\s+(?:as\s+)?([a-zA-Z_][a-zA-Z0-9_]*))?/gi;

  for (const match of before.matchAll(regex)) {
    const first = match[1];
    const second = match[2];
    const alias = match[3];
    const schema = second ? first : "";
    const table = second || first;
    const entry = entries.find((item) => normalize(String(item.schema || "")) === normalize(schema) && normalize(String(item.name || "")) === normalize(table))
      ?? entries.find((item) => normalize(String(item.name || "")) === normalize(table));
    if (!entry) continue;

    aliasMap.set(table, entry);
    if (schema) aliasMap.set(`${schema}.${table}`, entry);
    if (alias) aliasMap.set(alias, entry);
  }

  return aliasMap;
}

function scorePrefix(label: string, prefix: string) {
  if (!prefix) return 30;
  const lowerLabel = normalize(label);
  const lowerPrefix = normalize(prefix);
  if (lowerLabel === lowerPrefix) return 140;
  if (lowerLabel.startsWith(lowerPrefix)) return 120 - (lowerLabel.length - lowerPrefix.length);
  if (lowerPrefix.length <= 2) return -1;
  const index = lowerLabel.indexOf(lowerPrefix);
  if (index >= 0) return 80 - index;
  return -1;
}

function addRanked(
  items: RankedSuggestion[],
  item: SqlSuggestionItem,
  baseScore: number,
  prefix: string,
) {
  const prefixScore = scorePrefix(item.label, prefix);
  if (prefixScore < 0) return;
  items.push({ ...item, score: baseScore + prefixScore });
}

function hasExactTokenMatch(
  token: string,
  entries: SchemaEntry[],
  dialectKeywords: string[],
) {
  const normalizedToken = normalize(token);
  if (!normalizedToken) return false;

  const keywordMatch = [...SQL_KEYWORDS, ...SQL_FUNCTIONS, ...dialectKeywords]
    .some((item) => normalize(item) === normalizedToken);
  if (keywordMatch) return true;

  return entries.some((entry) => {
    const schema = String(entry?.schema || "");
    const table = String(entry?.name || "");
    const qualified = schema ? `${schema}.${table}` : table;
    if (normalize(table) === normalizedToken || normalize(qualified) === normalizedToken) {
      return true;
    }

    return (entry.columns || []).some((column) => normalize(String(column?.name || "")) === normalizedToken);
  });
}

export function getSqlSuggestions(
  query: string,
  cursor: number,
  schemaData: Record<string, SchemaEntry>,
  dbType: string = "postgres",
): { items: SqlSuggestionItem[]; tokenStart: number; tokenEnd: number } | null {
  const before = query.slice(0, cursor);
  const currentStatement = getCurrentStatement(before);
  const aliasContext = parseAliasContext(currentStatement);
  const entries = Object.values(schemaData || {});
  const aliasMap = getAliasMap(currentStatement, entries);
  const context = getContextInfo(currentStatement, aliasMap.size > 0);
  const token = aliasContext ? aliasContext.prefix : parseToken(currentStatement);
  const trimmedTokens = currentStatement.trimEnd().match(/[a-zA-Z_*]+/g)?.map(normalize) ?? [];
  const lastCompletedKeyword = trimmedTokens[trimmedTokens.length - 1] ?? "";
  const continuationRule = getSqlContinuationRule(dbType, trimmedTokens);
  const dialectKeywords = getSqlDialectKeywords(dbType);
  const exactTokenMatch = hasExactTokenMatch(token, entries, dialectKeywords);
  const shouldOpenOnClauseBoundary =
    token.length === 0 &&
    context.trailingWhitespace &&
    (
      CLAUSE_BOUNDARY_KEYWORDS.has(lastCompletedKeyword) ||
      Boolean(continuationRule) ||
      context.clause === "select"
    );
  if (!aliasContext && token.length > 0 && !context.trailingWhitespace && exactTokenMatch) {
    return null;
  }
  if (!aliasContext && token.length === 0 && !shouldOpenOnClauseBoundary) return null;
  const tokenStart = cursor - token.length;
  const tokenEnd = cursor;
  const ranked: RankedSuggestion[] = [];
  const shortPrefix = token.length <= 2;

  if (aliasContext) {
    const entry = aliasMap.get(aliasContext.alias);
    if (!entry) return null;
    for (const column of entry.columns || []) {
      const columnName = String(column?.name || "");
      if (!columnName) continue;
      addRanked(ranked, {
        label: columnName,
        insertText: columnName,
        kind: "column",
        detail: `${entry.schema || "public"}.${entry.name}.${columnName}`,
      }, 240, aliasContext.prefix);
    }
  } else {
    const preferTables = context.clause === "from" || context.clause === "join" || context.clause === "update" || context.clause === "into";
    const preferColumns = ["select", "where", "on", "group", "order", "having", "set"].includes(context.clause);
    const preferKeywords = shortPrefix && !preferTables;
    const constrainedSelectList = context.clause === "select" && !context.hasTableContext;
    const rulePreferTables = Boolean(continuationRule?.preferTables);
    const rulePreferColumns = Boolean(continuationRule?.preferColumns);
    const rulePreferFunctions = Boolean(continuationRule?.preferFunctions);
    const suppressSchemaItemsForShortPrefix = (shortPrefix && !context.hasTableContext && !preferTables) || Boolean(continuationRule?.suppressSchemaItems);
    const stronglyPreferKeywordPrefix =
      shortPrefix &&
      !preferTables &&
      ["un", "sel", "se", "fro", "fr", "whe", "wh", "ord", "gro", "ins", "upd", "del", "set", "val", "joi", "jon", "uni"].includes(normalize(token));
    const starterKeywords = ["SELECT", "SET", "SHOW", "WITH", "INSERT", "UPDATE", "DELETE", "CREATE", "ALTER", "DROP"];
    const selectLeadKeywords = ["DISTINCT", "ALL", "CASE", "CAST", "COALESCE", "COUNT", "SUM", "AVG", "MIN", "MAX", "NULL", "TRUE", "FALSE"];
    const selectFollowKeywords = ["FROM", "CASE", "CAST", "COALESCE", "COUNT", "SUM", "AVG", "MIN", "MAX"];
    const unionLeadKeywords = ["ALL", "SELECT"];

    if (normalize(token) === "s" || normalize(token) === "se") {
      addRanked(ranked, {
        label: "SELECT",
        insertText: "SELECT",
        kind: "keyword",
      }, 1000, token);
    }

    if (context.justTypedSelect) {
      addRanked(ranked, {
        label: "*",
        insertText: "*",
        kind: "keyword",
      }, 820, token);
    }

    if (context.justTypedUnion) {
      for (const keyword of unionLeadKeywords) {
        addRanked(ranked, {
          label: keyword,
          insertText: keyword,
          kind: "keyword",
        }, keyword === "ALL" ? 520 : 500, token);
      }
    }

    if (context.justTypedUnionAll) {
      addRanked(ranked, {
        label: "SELECT",
        insertText: "SELECT",
        kind: "keyword",
      }, 560, token);
    }

    for (const entry of entries) {
      const schema = String(entry?.schema || "");
      const table = String(entry?.name || "");
      if (!table) continue;
      const qualified = schema ? `${schema}.${table}` : table;

      if ((!suppressSchemaItemsForShortPrefix && !stronglyPreferKeywordPrefix) || rulePreferTables) {
        addRanked(ranked, {
          label: qualified,
          insertText: qualified,
          kind: "table",
          detail: schema ? `Table (${schema})` : "Table",
        }, rulePreferTables ? 320 : preferTables ? 240 : constrainedSelectList ? 15 : preferKeywords ? 40 : 90, token);
      }

      for (const column of entry.columns || []) {
        const columnName = String(column?.name || "");
        if (!columnName) continue;
        if ((!suppressSchemaItemsForShortPrefix && !stronglyPreferKeywordPrefix) || rulePreferColumns) {
          addRanked(ranked, {
            label: columnName,
            insertText: columnName,
            kind: "column",
            detail: `${qualified}.${columnName}`,
          }, rulePreferColumns ? 300 : constrainedSelectList ? 10 : preferColumns ? (preferKeywords ? 80 : 220) : 90, token);
        }
      }
    }

    for (const fn of SQL_FUNCTIONS) {
      addRanked(ranked, {
        label: fn,
        insertText: `${fn}()`,
        kind: "function",
        detail: "SQL function",
      }, rulePreferFunctions ? 300 : constrainedSelectList ? 120 : preferColumns ? (preferKeywords ? 120 : 200) : 95, token);
    }

    const keywordPool = Array.from(new Set([...SQL_KEYWORDS, ...dialectKeywords]));
    for (const keyword of keywordPool) {
      if (token.length === 0 && context.trailingWhitespace && normalize(keyword) === lastCompletedKeyword) {
        continue;
      }
      const isClauseKeyword = preferTables
        ? ["FROM", "JOIN", "WHERE", "ON", "ORDER", "GROUP", "LIMIT"].includes(keyword)
        : preferColumns
          ? ["AS", "DISTINCT", "FROM", "WHERE", "AND", "OR", "CASE"].includes(keyword)
          : false;
      const isAfterSelectStarKeyword = context.afterSelectStar
        ? ["FROM"].includes(keyword)
        : false;
      const isStarterKeyword = context.startOfStatement && starterKeywords.includes(keyword);
      const isUnionContinuationKeyword = context.justTypedUnion && unionLeadKeywords.includes(keyword);
      const isUnionAllContinuationKeyword = context.justTypedUnionAll && keyword === "SELECT";
      const isRuleKeyword = Boolean(continuationRule?.keywords?.includes(keyword));
      const isPreferredSelectKeyword = (constrainedSelectList || normalize(lastCompletedKeyword) === "all" || normalize(lastCompletedKeyword) === "distinct")
        ? (context.justTypedSelect || context.justTypedSelectModifier
          ? selectLeadKeywords.includes(keyword)
          : selectFollowKeywords.includes(keyword))
        : false;
      addRanked(ranked, {
        label: keyword,
        insertText: keyword,
        kind: "keyword",
      }, isRuleKeyword ? 600 : isUnionAllContinuationKeyword ? 560 : isUnionContinuationKeyword ? (keyword === "ALL" ? 520 : 500) : stronglyPreferKeywordPrefix ? 420 : isAfterSelectStarKeyword ? 500 : isStarterKeyword ? 360 : isPreferredSelectKeyword ? 300 : preferKeywords ? 230 : isClauseKeyword ? 150 : 60, token);
    }
  }

  const deduped = new Map<string, RankedSuggestion>();
  for (const item of ranked) {
    const key = `${item.kind}:${item.label}`;
    const existing = deduped.get(key);
    if (!existing || existing.score < item.score) deduped.set(key, item);
  }

  const items = Array.from(deduped.values())
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
    .slice(0, 20)
    .map(({ score: _score, ...item }) => item);

  if (items.length === 0) return null;
  return { items, tokenStart, tokenEnd };
}
