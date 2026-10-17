import { describe, it, expect, afterEach } from "bun:test";
import {
  refreshAccessToken,
  NeonRefreshRejectionError,
  NeonRefreshUnavailableError,
} from "@/lib/neon-oauth/auth-flow";

const HOST = "https://oauth2.test.invalid";
const originalFetch = globalThis.fetch;

/** Discovery must succeed so the test reaches the token endpoint. */
function discoveryJson(): Response {
  return Response.json({
    authorization_endpoint: `${HOST}/authorize`,
    token_endpoint: `${HOST}/token`,
  });
}

function mockFetch(handler: (url: string) => Response | Promise<Response>) {
  const stub = async (input: unknown) => handler(String(input));
  // The codebase only exercises the(fetch) surface used here.
  globalThis.fetch = stub as unknown as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("refreshAccessToken error classification", () => {
  it("treats a 400 from the token endpoint as a final rejection", async () => {
    mockFetch((url) =>
      url.includes("openid-configuration")
        ? discoveryJson()
        : new Response("invalid_grant", { status: 400 }),
    );
    expect(refreshAccessToken("rt", HOST)).rejects.toBeInstanceOf(NeonRefreshRejectionError);
  });

  it("treats a 5xx as transient/unavailable, not expired", async () => {
    mockFetch((url) =>
      url.includes("openid-configuration")
        ? discoveryJson()
        : new Response("upstream down", { status: 503 }),
    );
    expect(refreshAccessToken("rt", HOST)).rejects.toBeInstanceOf(NeonRefreshUnavailableError);
  });

  it("treats a network failure as transient/unavailable", async () => {
    mockFetch((url) => {
      if (url.includes("openid-configuration")) return discoveryJson();
      throw new TypeError("fetch failed");
    });
    expect(refreshAccessToken("rt", HOST)).rejects.toBeInstanceOf(NeonRefreshUnavailableError);
  });

  it("keeps the previous refresh token when the IdP does not rotate it", async () => {
    mockFetch((url) =>
      url.includes("openid-configuration")
        ? discoveryJson()
        : Response.json({ access_token: "at2", expires_in: 900 }),
    );
    const creds = await refreshAccessToken("kept-refresh-token", HOST);
    expect(creds.access_token).toBe("at2");
    expect(creds.refresh_token).toBe("kept-refresh-token");
    expect(creds.expires_at).toBeGreaterThan(Date.now());
  });
});
