import { afterEach, describe, expect, it } from "bun:test";

// Minimal browser shims for lib/api/actions-client (resolveApiUrl reads
// window.location.origin; api-base dynamic import is Tauri-guarded).
(globalThis as any).window ??= { location: { origin: "http://localhost" } };
(globalThis as any).localStorage ??= {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
};

const { getConnectionsResult } = await import(
  "@/lib/api/actions-client"
);

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function okRows(rows: unknown[]) {
  return { ok: true, json: async () => ({ success: true, data: rows }) };
}

describe("getConnectionsResult initial-load retry", () => {
  it("retries transient sidecar failures and returns rows", async () => {
    const rows = [{ id: 1, name: "pg", connectionString: "postgresql://u@localhost:5432/db" }];
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      if (calls <= 2) throw new Error("fetch failed");
      return okRows(rows) as unknown as Response;
    }) as unknown as typeof fetch;
    const res = await getConnectionsResult({ retries: 5, retryDelayMs: 1 });
    expect(res.ok).toBe(true);
    expect(res.data).toHaveLength(1);
    expect(calls).toBe(3);
  });

  it("reports failure instead of resolving empty after persistent outage", async () => {
    globalThis.fetch = (async () => {
      throw new Error("connection refused");
    }) as unknown as typeof fetch;
    const res = await getConnectionsResult({ retries: 2, retryDelayMs: 1 });
    expect(res.ok).toBe(false);
    expect(res.data).toEqual([]);
    expect(typeof res.error).toBe("string");
  });
});
