import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as neonOauthApi from "@/lib/neon-oauth/api";
import { NEON_API_HOST } from "@/lib/neon-oauth/constants";
import { writeCredentials } from "@/lib/neon-oauth/credentials";

describe("Neon Realtime API", () => {
  const profile = "realtime-api-test";
  const base = `${NEON_API_HOST.replace(/\/+$/, "")}/projects/proj%201/branches/br-1/realtime`;
  let configDir: string;
  let previousConfigDir: string | undefined;
  let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;

  beforeEach(() => {
    previousConfigDir = process.env.NEON_CONFIG_DIR;
    configDir = mkdtempSync(join(tmpdir(), "neon-realtime-"));
    process.env.NEON_CONFIG_DIR = configDir;
    writeCredentials(profile, { access_token: "test-token", expires_at: Date.now() + 3_600_000 });
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
    if (previousConfigDir === undefined) delete process.env.NEON_CONFIG_DIR;
    else process.env.NEON_CONFIG_DIR = previousConfigDir;
    rmSync(configDir, { recursive: true, force: true });
  });

  function mockFetch(respond: () => Response) {
    fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async () => respond()) as unknown as typeof fetch);
  }

  function lastCall(): [string, RequestInit] {
    return fetchSpy.mock.calls.at(-1) as [string, RequestInit];
  }

  test("reads the branch Realtime state", async () => {
    mockFetch(() => Response.json({ enabled: true, pending: false, invocation_url: "wss://rt.example" }));

    const state = await neonOauthApi.getRealtimeState(profile, "proj 1", "br-1");

    expect(state).toEqual({ enabled: true, pending: false, invocation_url: "wss://rt.example" });
    const [url, init] = lastCall();
    expect(url).toBe(base);
    expect(init.method).toBeUndefined();
  });

  test("enables with an empty body unless origins are given", async () => {
    mockFetch(() => new Response(null, { status: 202 }));

    await neonOauthApi.enableRealtime(profile, "proj 1", "br-1");
    expect(lastCall()[0]).toBe(base);
    expect(lastCall()[1].method).toBe("POST");
    expect(JSON.parse(String(lastCall()[1].body))).toEqual({});

    await neonOauthApi.enableRealtime(profile, "proj 1", "br-1", ["https://app.example"]);
    expect(JSON.parse(String(lastCall()[1].body))).toEqual({ allowed_origins: ["https://app.example"] });
  });

  test("disables with DELETE and rotates via rotate_secret", async () => {
    mockFetch(() => new Response(null, { status: 202 }));

    await neonOauthApi.disableRealtime(profile, "proj 1", "br-1");
    expect(lastCall()[0]).toBe(base);
    expect(lastCall()[1].method).toBe("DELETE");

    await neonOauthApi.rotateRealtimeSecret(profile, "proj 1", "br-1");
    expect(lastCall()[0]).toBe(`${base}/rotate_secret`);
    expect(lastCall()[1].method).toBe("POST");
  });

  test("returns only the secret string", async () => {
    mockFetch(() => Response.json({ secret: "nrt_live_1abc", pending: false }));

    expect(await neonOauthApi.getRealtimeSecret(profile, "proj 1", "br-1")).toBe("nrt_live_1abc");
    expect(lastCall()[0]).toBe(`${base}/secret`);
  });
});
