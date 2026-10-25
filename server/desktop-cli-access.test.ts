import { expect, test } from "bun:test";
import express from "express";
import { once } from "node:events";
import { desktopCliAccess } from "./desktop-cli-access";
import { DESKTOP_CLI_HEADER, isLocalCliRequest } from "../lib/agents/desktop-access";
import { refreshLocalCliProviders } from "../hooks/use-local-cli-providers";
import { apiFetch } from "../lib/api-base";

test("CLI endpoints are classified separately from ordinary API chat", () => {
  expect(isLocalCliRequest("/api/agents/detect")).toBe(true);
  expect(isLocalCliRequest("/API/Agents/Detect/")).toBe(true);
  expect(isLocalCliRequest("/API/Agent/Chat/Stream/", { provider: "cli:codex" })).toBe(true);
  expect(isLocalCliRequest("/api/agents/models/codex")).toBe(true);
  expect(isLocalCliRequest("/api/agents/chat/stream", { provider: "codex" })).toBe(true);
  expect(isLocalCliRequest("/api/agents/chat/stream", { provider: "rexadb" })).toBe(false);
  expect(isLocalCliRequest("/api/agent/chat/stream", JSON.stringify({ provider: "cli:codex" }))).toBe(true);
  expect(isLocalCliRequest("/api/agent/chat/stream", { provider: "anthropic" })).toBe(false);
  expect(isLocalCliRequest("/api/connections")).toBe(false);
});

test("web discovery is a no-op and CLI requests fail before any network call", async () => {
  const original = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = Object.assign(async () => { requests++; throw new Error("Unexpected network call"); }, { preconnect: original.preconnect });
  try {
    await refreshLocalCliProviders(true);
    await expect(apiFetch("/api/agents/detect")).rejects.toThrow("desktop app");
    await expect(apiFetch("/api/agent/chat/stream", { method: "POST", body: JSON.stringify({ provider: "cli:claude-code" }) })).rejects.toThrow("desktop app");
    expect(requests).toBe(0);
  } finally {
    globalThis.fetch = original;
  }
});

for (const token of ["", "test-native-session-secret"]) {
  test(`HTTP CLI access ${token ? "requires native-session proof" : "is disabled on a standalone server"}`, async () => {
    const app = express();
    let executions = 0;
    app.get("/cli", desktopCliAccess(token), (_req, res) => { executions++; res.sendStatus(204); });
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address() as { port: number };
    try {
      for (const supplied of [undefined, "wrong", "test-native-session-secret"]) {
        const response = await fetch(`http://127.0.0.1:${address.port}/cli`, {
          headers: supplied ? { [DESKTOP_CLI_HEADER]: supplied } : {},
        });
        expect(response.status).toBe(token && supplied === token ? 204 : 403);
      }
      expect(executions).toBe(token ? 1 : 0);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
}
