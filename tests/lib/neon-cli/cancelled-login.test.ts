import { describe, it, expect, afterEach } from "bun:test";
import { runNeonAuthLogin } from "@/lib/neon-cli/cli-runner";
import { clearOidcDiscoveryCache } from "@/lib/neon-oauth/auth-flow";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  // discoverOidc caches under the real NEON_OAUTH_HOST key — a mocked
  // response left cached would poison every other test in this process.
  clearOidcDiscoveryCache();
});

/** Bun treats an unhandled promise rejection as fatal — a regression here
 * would kill the whole test run, which is exactly the guard we want. */
describe("runNeonAuthLogin cancellation", () => {
  it("rejects cleanly when the signal is already aborted (no unhandled rejection, no browser)", async () => {
    globalThis.fetch = (async (input: unknown) => {
      const url = String(input);
      if (url.includes("/.well-known/openid-configuration")) {
        return Response.json({
          authorization_endpoint: "https://oauth2.test.invalid/authorize",
          token_endpoint: "https://oauth2.test.invalid/token",
        });
      }
      throw new Error("unexpected fetch in test: " + url);
    }) as unknown as typeof fetch;

    let openedUrl = "";
    let logLines = 0;
    await expect(
      runNeonAuthLogin("TESTPROFILE", {
        onLog: () => {
          logLines++;
        },
        onOpenUrl: (url) => {
          openedUrl = url;
        },
        signal: AbortSignal.abort(),
      }),
    ).rejects.toThrow(/cancelled/i);

    expect(openedUrl).toBe("");
    expect(logLines).toBeGreaterThan(0);
  });
});
