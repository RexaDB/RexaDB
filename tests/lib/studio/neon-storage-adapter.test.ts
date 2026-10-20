import { afterEach, describe, expect, it } from "bun:test";
import { buildNeonCliConnectionString } from "@/lib/neon-cli/pointer";
import { fetchStorageBuckets, fetchStorageObjects } from "@/lib/studio/storage-utils";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("Neon Storage data adapter", () => {
  const connection = buildNeonCliConnectionString({
    profile: "default",
    projectId: "project",
    branchId: "branch",
    database: "app",
    role: "owner",
  });

  it("maps Neon buckets to the shared Storage view model", async () => {
    globalThis.fetch = (async () => Response.json({
      success: true,
      data: [{ name: "assets", access_level: "public_read", created_at: "2026-10-20T00:00:00Z" }],
    })) as unknown as typeof fetch;

    const result = await fetchStorageBuckets(connection);
    expect(result.error).toBeUndefined();
    expect(result.buckets).toEqual([{
      id: "assets",
      name: "assets",
      public: true,
      file_size_limit: null,
      allowed_mime_types: null,
      created_at: "2026-10-20T00:00:00Z",
    }]);
  });

  it("maps Neon object keys to the shared file-browser model", async () => {
    globalThis.fetch = (async () => Response.json({
      success: true,
      data: ["avatars/user.png", "docs/readme.txt"],
    })) as unknown as typeof fetch;

    const result = await fetchStorageObjects(connection, "assets");
    expect(result.error).toBeUndefined();
    expect(result.objects.map(({ name, bucket_id }) => [name, bucket_id])).toEqual([
      ["avatars/user.png", "assets"],
      ["docs/readme.txt", "assets"],
    ]);
  });
});
