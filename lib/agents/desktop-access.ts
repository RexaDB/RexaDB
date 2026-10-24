export const DESKTOP_CLI_HEADER = "X-RexaDB-Desktop-CLI";
export const DESKTOP_CLI_ONLY = "Local CLI agents are available only in the RexaDB desktop app.";

/** Also covers the existing Agents harness endpoints, not just Ask AI. */
export function isLocalCliRequest(pathname: string, body?: unknown): boolean {
  // Express routes are case-insensitive and accept a trailing slash by default.
  pathname = pathname.toLowerCase().replace(/\/+$/, "");
  if (pathname === "/api/agents/detect" || pathname.startsWith("/api/agents/models/")) return true;
  if (pathname !== "/api/agent/chat/stream" && pathname !== "/api/agents/chat/stream") return false;
  try {
    const payload = typeof body === "string" ? JSON.parse(body) : body;
    if (!payload || typeof payload !== "object" || !("provider" in payload)) return false;
    return pathname === "/api/agents/chat/stream"
      ? payload.provider !== "rexadb"
      : String(payload.provider).startsWith("cli:");
  } catch {
    return false;
  }
}
