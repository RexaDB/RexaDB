import { describe, expect, test } from "bun:test";

import { coverCrop } from "@/lib/app-icon";

describe("coverCrop", () => {
  test("keeps a square image whole", () => {
    expect(coverCrop(500, 500)).toEqual({ x: 0, y: 0, size: 500 });
  });

  test("centers on the width of a wide image", () => {
    expect(coverCrop(1000, 400)).toEqual({ x: 300, y: 0, size: 400 });
  });

  test("centers on the height of a tall image", () => {
    expect(coverCrop(400, 1000)).toEqual({ x: 0, y: 300, size: 400 });
  });
});
