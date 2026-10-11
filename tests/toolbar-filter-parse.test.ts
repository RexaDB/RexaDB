import { describe, expect, test } from "bun:test";
import {
  decomposeFilterQuery,
  parseSegmentToRule,
  splitTopLevelAnd,
  stripBalancedOuterParens,
  stripLeadingWhereKeyword,
} from "@/components/studio/toolbar/toolbar-filter-sort";

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
    expect(parseSegmentToRule(`status = active`, COLUMNS)?.operator).toBe("eq");
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
});
