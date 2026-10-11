import { describe, expect, test } from "bun:test";
import {
  buildRuleClause,
  decomposeFilterQuery,
  hasTopLevelOr,
  parseSegmentToRule,
  splitTopLevelAnd,
  stripBalancedOuterParens,
  stripLeadingWhereKeyword,
} from "@/components/studio/toolbar/toolbar-filter-sort";
import {
  joinFilterClause,
  parseQuickFilter,
  toQuickLiteral,
} from "@/components/studio/data-table-toolbar";

const COLUMNS = ["id", "message_id", "status", "time_created"];

describe("stripBalancedOuterParens", () => {
  test("strips stacked parens", () => {
    expect(stripBalancedOuterParens(`(("a" = 'b'))`)).toBe(`"a" = 'b'`);
  });
  test("leaves unbalanced and partial parens alone", () => {
    expect(stripBalancedOuterParens(`(a = 1`)).toBe(`(a = 1`);
    expect(stripBalancedOuterParens(`(a=1) AND (b=2)`)).toBe(`(a=1) AND (b=2)`);
  });
});

describe("splitTopLevelAnd", () => {
  test("splits top-level AND, keeps OR and quoted AND", () => {
    expect(splitTopLevelAnd(`a = 1 AND b = 2`)).toEqual(["a = 1", "b = 2"]);
    expect(splitTopLevelAnd(`a = 1 OR b = 2`)).toEqual(["a = 1 OR b = 2"]);
    expect(splitTopLevelAnd(`name = 'bread and butter' AND id = 1`)).toEqual([
      "name = 'bread and butter'",
      "id = 1",
    ]);
    expect(splitTopLevelAnd(`(a = 1) AND (b = 2)`)).toEqual(["(a = 1)", "(b = 2)"]);
  });
});

describe("parseSegmentToRule", () => {
  test("parses the user's exact stored filter", () => {
    const rule = parseSegmentToRule(
      `(("message_id" = 'msg_da180cd1100151hb8bBGTLxd1'))`,
      COLUMNS,
    );
    expect(rule).not.toBeNull();
    expect(rule?.column).toBe("message_id");
    expect(rule?.operator).toBe("eq");
    expect(rule?.value).toBe("msg_da180cd1100151hb8bBGTLxd1");
  });
  test("parses unquoted, null checks, and LIKE shapes", () => {
    expect(parseSegmentToRule(`time_created >= 100`, COLUMNS)).toMatchObject({
      column: "time_created",
      operator: "gte",
      value: "100",
    });
    expect(parseSegmentToRule(`status IS NULL`, COLUMNS)?.operator).toBe("is_null");
    expect(parseSegmentToRule(`status IS NOT NULL`, COLUMNS)?.operator).toBe("is_not_null");
    const like = parseSegmentToRule(`CAST("status" AS TEXT) LIKE '%act%'`, COLUMNS);
    expect(like).toMatchObject({ column: "status", operator: "contains", value: "act" });
  });
  test("rejects non-filters", () => {
    expect(parseSegmentToRule(`hello world`, COLUMNS)).toBeNull();
    expect(parseSegmentToRule(`status`, COLUMNS)).toBeNull();
    expect(parseSegmentToRule(`status =`, COLUMNS)).toBeNull();
  });
});

describe("stripLeadingWhereKeyword", () => {
  test("strips the WHERE keyword the agent echoes", () => {
    expect(stripLeadingWhereKeyword(`WHERE "message_id" = 'msg_1'`)).toBe(
      `"message_id" = 'msg_1'`,
    );
    expect(stripLeadingWhereKeyword(`where status = 'x'`)).toBe(`status = 'x'`);
  });
  test("extracts the condition out of a full SELECT", () => {
    expect(stripLeadingWhereKeyword(`SELECT * FROM part WHERE id = 1`)).toBe(`id = 1`);
  });
  test("leaves real filters alone", () => {
    expect(stripLeadingWhereKeyword(`"where" = 1`)).toBe(`"where" = 1`);
    expect(stripLeadingWhereKeyword(`status = 'x'`)).toBe(`status = 'x'`);
  });
});

describe("decomposeFilterQuery", () => {
  test("round-trips the user's stored filter into one filled row", () => {
    const { rules, remainder } = decomposeFilterQuery(
      `(("message_id" = 'msg_da180cd1100151hb8bBGTLxd1'))`,
      COLUMNS,
    );
    expect(remainder).toBe("");
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ column: "message_id", operator: "eq" });
  });
  test("splits AND groups and keeps OR as remainder", () => {
    const { rules, remainder } = decomposeFilterQuery(
      `"status" = 'active' AND ("priority" > 3 OR "x" = 1)`,
      [...COLUMNS, "priority", "x"],
    );
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ column: "status", operator: "eq" });
    expect(remainder).toBe(`("priority" > 3 OR "x" = 1)`);
  });
  test("heals a stored filter that starts with WHERE", () => {
    const { rules, remainder } = decomposeFilterQuery(
      `WHERE "message_id" = 'msg_da180cd1100151hb8bBGTLxd1'`,
      COLUMNS,
    );
    expect(remainder).toBe("");
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ column: "message_id", operator: "eq" });
  });
  test("empty query gives one blank row", () => {
    const { rules, remainder } = decomposeFilterQuery(``, COLUMNS);
    expect(rules).toHaveLength(1);
    expect(rules[0].column).toBe("none");
    expect(remainder).toBe("");
  });
  test("top-level OR survives Apply unchanged (no AND-split reorder)", () => {
    const input = `status = 'active' OR id = 1 AND message_id = 'x'`;
    expect(hasTopLevelOr(input)).toBe(true);
    const { rules, remainder } = decomposeFilterQuery(input, COLUMNS);
    expect(rules[0].column).toBe("none");
    expect(remainder).toBe(input);
  });
  test("leaves non-round-trippable SQL as remainder", () => {
    expect(parseSegmentToRule(`time_created >= NOW()`, COLUMNS)).toBeNull();
    expect(parseSegmentToRule(`status LIKE 'act%'`, COLUMNS)).toBeNull();
    expect(parseSegmentToRule(`status ILIKE '%act%'`, COLUMNS)).toBeNull();
    expect(parseSegmentToRule(`"status" = '123'`, COLUMNS)).toBeNull();
    expect(parseSegmentToRule(`"status" = 'true'`, COLUMNS)).toBeNull();
    // Bare words are column references, not strings — must stay raw so
    // Apply doesn't rewrite `active` into `'active'`.
    expect(parseSegmentToRule(`status = active`, COLUMNS)).toBeNull();
    // LIKE without wildcards is an exact match, not a contains.
    expect(
      parseSegmentToRule(`CAST("status" AS TEXT) LIKE 'act'`, COLUMNS),
    ).toBeNull();
    // `= NULL` / `<> NULL` would rebuild as IS NULL / IS NOT NULL.
    expect(parseSegmentToRule(`status = NULL`, COLUMNS)).toBeNull();
    expect(parseSegmentToRule(`status <> NULL`, COLUMNS)).toBeNull();
    // ...but the canonical forms still parse.
    expect(parseSegmentToRule(`status IS NULL`, COLUMNS)?.operator).toBe("is_null");
    const { remainder } = decomposeFilterQuery(`time_created >= NOW()`, COLUMNS);
    expect(remainder).toBe(`time_created >= NOW()`);
  });
});

describe("joinFilterClause", () => {
  test("wraps existing OR filters so new clauses apply to all rows", () => {
    expect(
      joinFilterClause(`status = 'active' OR status = 'pending'`, `id > 10`),
    ).toBe(`(status = 'active' OR status = 'pending') AND (id > 10)`);
    expect(joinFilterClause(``, `id > 10`)).toBe(`id > 10`);
  });
});

describe("toQuickLiteral", () => {
  test("preserves explicitly quoted strings", () => {
    expect(toQuickLiteral(`'null'`)).toBe(`'null'`);
    expect(toQuickLiteral(`'123'`)).toBe(`'123'`);
    expect(toQuickLiteral(`'true'`)).toBe(`'true'`);
    expect(toQuickLiteral(`null`)).toBe(`NULL`);
    expect(toQuickLiteral(`123`)).toBe(`123`);
  });
  test("emits mssql-compatible booleans", () => {
    expect(toQuickLiteral(`true`, "mssql")).toBe(`1`);
    expect(toQuickLiteral(`false`, "mssql")).toBe(`0`);
    expect(toQuickLiteral(`true`, "postgres")).toBe(`TRUE`);
  });
});

describe("parseQuickFilter", () => {
  const cols = ["status", "enabled", "name"];
  test("uses per-engine CAST for contains", () => {
    expect(parseQuickFilter(`name ~ foo`, cols, "mysql")).toContain("CAST(`name` AS CHAR)");
    expect(parseQuickFilter(`name ~ foo`, cols, "clickhouse")).toContain("AS String");
    expect(parseQuickFilter(`name ~ foo`, cols, "mssql")).toContain("NVARCHAR(MAX)");
    expect(parseQuickFilter(`name ~ foo`, cols, "postgres")).toContain("AS TEXT");
  });
  test("mssql booleans become 1/0", () => {
    expect(parseQuickFilter(`enabled = true`, cols, "mssql")).toBe(`[enabled] = 1`);
    expect(parseQuickFilter(`enabled = true`, cols, "postgres")).toBe(`"enabled" = TRUE`);
  });
  test("quoted 'null' stays a string", () => {
    expect(parseQuickFilter(`status = 'null'`, cols, "postgres")).toBe(
      `"status" = 'null'`,
    );
  });
});

describe("buildRuleClause engine CAST", () => {
  test("contains rebuild keeps the working per-engine cast", () => {
    const rule = {
      id: "t",
      enabled: true,
      column: "name",
      operator: "contains" as const,
      value: "foo",
    };
    expect(buildRuleClause(rule, "mysql")).toContain("CAST(`name` AS CHAR)");
    expect(buildRuleClause(rule, "clickhouse")).toContain("AS String");
    expect(buildRuleClause(rule, "mssql")).toContain("NVARCHAR(MAX)");
    expect(buildRuleClause(rule, "postgres")).toContain("AS TEXT");
  });
  test("mysql quick-filter contains round-trips through parse", () => {
    const clause = parseQuickFilter(`name ~ foo`, ["name"], "mysql")!;
    const roundTripped = parseSegmentToRule(clause, ["name"]);
    expect(roundTripped).toMatchObject({ column: "name", operator: "contains" });
  });
});
