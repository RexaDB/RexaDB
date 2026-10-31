export {};
// Dispatch before importing the HTTP server: MCP stdout is exclusively JSON-RPC.
if (process.argv.includes("--agent-mcp")) {
  const { runAgentMcpStdio } = await import("../lib/agents/mcp/stdio");
  await runAgentMcpStdio();
} else if (process.argv.includes("--agent-studio-tool")) {
  const { runStudioToolCli } = await import("../lib/agents/mcp/studio-tool-cli");
  await runStudioToolCli();
} else {
  await import("./index");
}
