import { describe, expect, test } from "bun:test";
import { countFittingItems } from "@/components/studio/toolbar/toolbar-layout";

describe("countFittingItems", () => {
  test("shows every item, with no more button, when all fit", () => {
    // 100 + 8 + 100 = 208
    expect(countFittingItems([100, 100], 208)).toBe(2);
  });

  test("reserves room for the more button once something overflows", () => {
    // All three need 316; with the 44px more button, two need 252.
    expect(countFittingItems([100, 100, 100], 300)).toBe(2);
    expect(countFittingItems([100, 100, 100], 251)).toBe(1);
  });

  test("shows nothing but the more button when even one item does not fit", () => {
    expect(countFittingItems([300, 100], 200)).toBe(0);
  });
});
