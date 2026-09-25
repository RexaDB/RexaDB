import { describe, it, expect } from "bun:test";
import { sanitizeBucketName } from "@/lib/transfer/neon-storage";

describe("sanitizeBucketName", () => {
  it("keeps S3-safe names untouched", () => {
    expect(sanitizeBucketName("my-bucket-123")).toEqual({ name: "my-bucket-123", renamed: false });
    expect(sanitizeBucketName("550e8400-e29b-41d4-a716-446655440000")).toEqual({
      name: "550e8400-e29b-41d4-a716-446655440000",
      renamed: false,
    });
  });

  it("lowercases and replaces illegal characters", () => {
    const { name, renamed } = sanitizeBucketName("My_Bucket.Name!");
    expect(renamed).toBe(true);
    expect(name).toBe("my-bucket.name");
    expect(/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(name)).toBe(true);
  });

  it("pads names that are too short", () => {
    const { name } = sanitizeBucketName("ab");
    expect(name.length).toBeGreaterThanOrEqual(3);
  });
});
