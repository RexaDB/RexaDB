import { getSqlContinuationRule, getSqlDialectKeywords } from "@/lib/studio/sql-dialects";
import {
  foldUnquotedSqlIdentifier,
  formatQualifiedSqlIdentifier,
  formatSqlIdentifier,
  getSqlIdentifierQuoteChars,
  quoteSqlIdentifierAlways,
  sqlDialectFoldsCase,
  sqlIdentifierNeedsQuotes,
  unquoteSqlIdentifier,
} from "@/lib/studio/sql-identifier";

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
  /** Text the editor filters on when it differs from `label` (e.g. after an opening quote). */
  filterText?: string;
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

// A bare or quoted ("x", `x`, [x]) identifier.
const IDENTIFIER_PATTERN =
  '(?:"(?:[^"]|"")+"|`(?:[^`]|``)+`|\\[(?:[^\\]]|\\]\\])+\\]|[a-zA-Z_][a-zA-Z0-9_$]*)';

interface ParsedIdentifier {
  name: string;
  quoted: boolean;
}

function parseIdentifier(raw: string): ParsedIdentifier {
  return { name: unquoteSqlIdentifier(raw), quoted: /^["`[]/.test(raw) };
}

/**
 * How well a schema name matches an identifier written in the query:
 * 2 = the name the database resolves it to, 1 = case-insensitive match,
 * 0 = no match. Quoted names in case-folding dialects only match exactly.
 */
function matchIdentifier(candidate: string, id: ParsedIdentifier, dbType: string) {
  const resolved = id.quoted ? id.name : foldUnquotedSqlIdentifier(id.name, dbType);
  if (candidate === resolved) return 2;
  if (id.quoted && sqlDialectFoldsCase(dbType)) return 0;
  return normalize(candidate) === normalize(id.name) ? 1 : 0;
}

/**
 * Index where an unclosed identifier quote starts, or -1. String literals and
 * escaped (doubled) closing quotes are skipped.
 */
function findOpenIdentifierQuote(statement: string, open: string, close: string) {
  let openAt = -1;
  let index = 0;
  while (index < statement.length) {
    const char = statement[index];
    if (openAt < 0) {
      if (char === "'" || (char === '"' && open !== '"')) {
        const end = statement.indexOf(char, index + 1);
        if (end < 0) return -1;
        index = end + 1;
        continue;
      }
      if (statement.startsWith(open, index)) {
        openAt = index;
        index += open.length;
        continue;
      }
    } else if (statement.startsWith(close, index)) {
      if (statement.startsWith(close, index + close.length)) {
        index += close.length * 2;
        continue;
      }
      openAt = -1;
      index += close.length;
      continue;
    }
    index += 1;
  }
  return openAt;
}

/**
 * The identifier fragment being typed, whether it is inside an unclosed
 * identifier quote, how many characters it spans, and the text before it.
 */
function parseCursorToken(statement: string, dbType: string) {
  const [open, close] = getSqlIdentifierQuoteChars(dbType);
  const openAt = findOpenIdentifierQuote(statement, open, close);
  if (openAt >= 0) {
    const fragment = statement.slice(openAt + open.length);
    return {
      token: fragment.split(close + close).join(close),
      quoted: true,
      span: statement.length - openAt,
      head: statement.slice(0, openAt),
    };
  }
  const token = statement.match(/[a-zA-Z_][a-zA-Z0-9_]*$/)?.[0] ?? "";
  return {
    token,
    quoted: false,
    span: token.length,
    head: statement.slice(0, statement.length - token.length),
  };
}

/** `FROM schema.` / `JOIN schema.`: the user is qualifying a table name. */
function parseSchemaPrefix(head: string) {
  const match = head.match(
    new RegExp(`\\b(?:from|join|update|into)\\s+(${IDENTIFIER_PATTERN})\\.$`, "i"),
  );
  return match ? parseIdentifier(match[1]) : null;
}

function parseAliasContext(head: string) {
  const aliasMatch = head.match(new RegExp(`(${IDENTIFIER_PATTERN})\\.$`));
  if (!aliasMatch) return null;
  return { alias: parseIdentifier(aliasMatch[1]) };
}

function findTableEntry(
  entries: SchemaEntry[],
  table: ParsedIdentifier,
  schema: ParsedIdentifier | null,
  dbType: string,
) {
  let best: SchemaEntry | undefined;
  let bestScore = 0;
  for (const entry of entries) {
    const tableScore = matchIdentifier(String(entry.name || ""), table, dbType);
    if (!tableScore) continue;
    let score = tableScore * 2;
    if (schema) {
      const schemaScore = matchIdentifier(String(entry.schema || ""), schema, dbType);
      // Prefer the named schema, but still resolve if it is not loaded.
      score += schemaScore;
    }
    if (score > bestScore) {
      best = entry;
      bestScore = score;
    }
  }
  return best;
}

/** Table references and aliases in the statement, keyed by resolved name. */
function getAliasMap(before: string, entries: SchemaEntry[], dbType: string) {
  const aliasMap = new Map<string, SchemaEntry>();
  const regex = new RegExp(
    `\\b(?:from|join|update|into)\\s+(${IDENTIFIER_PATTERN})(?:\\.(${IDENTIFIER_PATTERN}))?(?:\\s+(?:as\\s+)?([a-zA-Z_][a-zA-Z0-9_]*))?`,
    "gi",
  );

  for (const match of before.matchAll(regex)) {
    const first = parseIdentifier(match[1]);
    const second = match[2] ? parseIdentifier(match[2]) : null;
    const alias = match[3];
    const table = second ?? first;
    const entry = findTableEntry(entries, table, second ? first : null, dbType);
    if (!entry) continue;

    aliasMap.set(String(entry.name || ""), entry);
    if (alias) aliasMap.set(foldUnquotedSqlIdentifier(alias, dbType), entry);
  }

  return aliasMap;
}

function lookupAlias(aliasMap: Map<string, SchemaEntry>, alias: ParsedIdentifier, dbType: string) {
  for (const [key, entry] of aliasMap) {
    if (matchIdentifier(key, alias, dbType) === 2) return entry;
  }
  for (const [key, entry] of aliasMap) {
    if (matchIdentifier(key, alias, dbType) === 1) return entry;
  }
  return undefined;
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
  dbType: string,
) {
  const normalizedToken = normalize(token);
  if (!normalizedToken) return false;

  const keywordMatch = [...SQL_KEYWORDS, ...SQL_FUNCTIONS, ...dialectKeywords]
    .some((item) => normalize(item) === normalizedToken);
  if (keywordMatch) return true;

  // A schema name only counts as already typed if it works without quotes;
  // otherwise keep suggesting so the quoted form can be inserted.
  const matchesBare = (name: string) =>
    normalize(name) === normalizedToken && !sqlIdentifierNeedsQuotes(name, dbType);

  return entries.some((entry) => {
    const table = String(entry?.name || "");
    if (matchesBare(table)) return true;
    return (entry.columns || []).some((column) => matchesBare(String(column?.name || "")));
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
  const { token, quoted, span, head } = parseCursorToken(currentStatement, dbType);
  const entries = Object.values(schemaData || {});
  const schemaPrefix = parseSchemaPrefix(head);
  const schemaPrefixName = schemaPrefix
    ? entries.map((entry) => String(entry.schema || "")).find((name) => name && matchIdentifier(name, schemaPrefix, dbType))
    : undefined;
  const aliasContext = schemaPrefixName ? null : parseAliasContext(head);
  const aliasMap = getAliasMap(currentStatement, entries, dbType);
  // Inside a quote, judge the clause from the text before it, not the quoted words.
  const contextText = quoted ? head : currentStatement;
  const context = getContextInfo(contextText, aliasMap.size > 0);
  const trimmedTokens = contextText.trimEnd().match(/[a-zA-Z_*]+/g)?.map(normalize) ?? [];
  const lastCompletedKeyword = trimmedTokens[trimmedTokens.length - 1] ?? "";
  const continuationRule = getSqlContinuationRule(dbType, trimmedTokens);
  const dialectKeywords = getSqlDialectKeywords(dbType);
  const exactTokenMatch = hasExactTokenMatch(token, entries, dialectKeywords, dbType);
  const shouldOpenOnClauseBoundary =
    token.length === 0 &&
    context.trailingWhitespace &&
    (
      CLAUSE_BOUNDARY_KEYWORDS.has(lastCompletedKeyword) ||
      Boolean(continuationRule) ||
      context.clause === "select"
    );
  const qualifying = Boolean(aliasContext || schemaPrefixName);
  if (!qualifying && !quoted && token.length > 0 && !context.trailingWhitespace && exactTokenMatch) {
    return null;
  }
  if (!qualifying && !quoted && token.length === 0 && !shouldOpenOnClauseBoundary) return null;

  // After an opening quote, replace the quote (and an auto-inserted closing
  // quote) so the identifier is inserted fully quoted exactly once.
  const [openQuote, closeQuote] = getSqlIdentifierQuoteChars(dbType);
  const tokenStart = cursor - span;
  const tokenEnd = quoted && query.startsWith(closeQuote, cursor) ? cursor + closeQuote.length : cursor;
  const identifierText = (name: string) =>
    quoted ? quoteSqlIdentifierAlways(name, dbType) : formatSqlIdentifier(name, dbType);
  const filterText = (label: string) => (quoted ? `${openQuote}${label}` : undefined);
  const ranked: RankedSuggestion[] = [];
  const shortPrefix = token.length <= 2;

  if (schemaPrefixName) {
    for (const entry of entries) {
      const table = String(entry?.name || "");
      if (!table || entry.schema !== schemaPrefixName) continue;
      addRanked(ranked, {
        label: table,
        insertText: identifierText(table),
        filterText: filterText(table),
        kind: "table",
        detail: `Table (${schemaPrefixName})`,
      }, 240, token);
    }
  } else if (aliasContext) {
    const entry = lookupAlias(aliasMap, aliasContext.alias, dbType);
    if (!entry) return null;
    for (const column of entry.columns || []) {
      const columnName = String(column?.name || "");
      if (!columnName) continue;
      addRanked(ranked, {
        label: columnName,
        insertText: identifierText(columnName),
        filterText: filterText(columnName),
        kind: "column",
        detail: `${entry.schema || "public"}.${entry.name}.${columnName}`,
      }, 240, token);
    }
  } else {
    const preferTables = context.clause === "from" || context.clause === "join" || context.clause === "update" || context.clause === "into";
    const preferColumns = ["select", "where", "on", "group", "order", "having", "set"].includes(context.clause);
    const preferKeywords = shortPrefix && !preferTables;
    const constrainedSelectList = context.clause === "select" && !context.hasTableContext;
    const rulePreferTables = Boolean(continuationRule?.preferTables);
    const rulePreferColumns = Boolean(continuationRule?.preferColumns);
    const rulePreferFunctions = Boolean(continuationRule?.preferFunctions);
    const suppressSchemaItemsForShortPrefix = !quoted && ((shortPrefix && !context.hasTableContext && !preferTables) || Boolean(continuationRule?.suppressSchemaItems));
    const stronglyPreferKeywordPrefix =
      !quoted &&
      shortPrefix &&
      !preferTables &&
      ["un", "sel", "se", "fro", "fr", "whe", "wh", "ord", "gro", "ins", "upd", "del", "set", "val", "joi", "jon", "uni"].includes(normalize(token));
    const starterKeywords = ["SELECT", "SET", "SHOW", "WITH", "INSERT", "UPDATE", "DELETE", "CREATE", "ALTER", "DROP"];
    const selectLeadKeywords = ["DISTINCT", "ALL", "CASE", "CAST", "COALESCE", "COUNT", "SUM", "AVG", "MIN", "MAX", "NULL", "TRUE", "FALSE"];
    const selectFollowKeywords = ["FROM", "CASE", "CAST", "COALESCE", "COUNT", "SUM", "AVG", "MIN", "MAX"];
    const unionLeadKeywords = ["ALL", "SELECT"];

    if (!quoted && (normalize(token) === "s" || normalize(token) === "se")) {
      addRanked(ranked, {
        label: "SELECT",
        insertText: "SELECT",
        kind: "keyword",
      }, 1000, token);
    }

    if (!quoted && context.justTypedSelect) {
      addRanked(ranked, {
        label: "*",
        insertText: "*",
        kind: "keyword",
      }, 820, token);
    }

    if (!quoted && context.justTypedUnion) {
      for (const keyword of unionLeadKeywords) {
        addRanked(ranked, {
          label: keyword,
          insertText: keyword,
          kind: "keyword",
        }, keyword === "ALL" ? 520 : 500, token);
      }
    }

    if (!quoted && context.justTypedUnionAll) {
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
          insertText: quoted
            ? [schema && formatSqlIdentifier(schema, dbType), identifierText(table)].filter(Boolean).join(".")
            : formatQualifiedSqlIdentifier([schema, table], dbType),
          filterText: filterText(qualified),
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
            insertText: identifierText(columnName),
            filterText: filterText(columnName),
            kind: "column",
            detail: `${qualified}.${columnName}`,
          }, rulePreferColumns ? 300 : constrainedSelectList ? 10 : preferColumns ? (preferKeywords ? 80 : 220) : 90, token);
        }
      }
    }

    // Inside an identifier quote only schema names make sense.
    const keywordPool = quoted ? [] : Array.from(new Set([...SQL_KEYWORDS, ...dialectKeywords]));
    for (const fn of quoted ? [] : SQL_FUNCTIONS) {
      addRanked(ranked, {
        label: fn,
        insertText: `${fn}()`,
        kind: "function",
        detail: "SQL function",
      }, rulePreferFunctions ? 300 : constrainedSelectList ? 120 : preferColumns ? (preferKeywords ? 120 : 200) : 95, token);
    }

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
