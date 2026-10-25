export {};
// Dispatch before importing the HTTP server: MCP stdout is exclusively JSON-RPC.
if (process.argv.includes("--agent-mcp")) {
  const { runAgentMcpStdio } = await import("../lib/agents/mcp/stdio");
  await runAgentMcpStdio();
} else {
  await import("./index");
}
