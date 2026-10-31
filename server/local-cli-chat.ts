import type { Request, Response } from "express";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getLocalCliProviderId } from "../lib/agents/local-provider";
import { detectProvider } from "../lib/agents/detect-providers";
import { readServerProviderCache } from "../lib/agents/provider-cache-server";
import { runHarness } from "../lib/agents/run-harness";
import { buildRexaMcpServerConfig } from "../lib/agents/mcp/config";
import { REXADB_PLAN_MODE } from "../lib/agents/app-modes";
import { materializeAgentSandbox } from "../lib/agents/sandbox-cwd";
import { buildAgentInstructions } from "../lib/ai/system-prompt";
import { isStudioArtifact } from "../lib/ai/studio-artifacts";
import type { AgentChatRequest, AgentStreamEvent } from "../lib/ai/types";

/** The sidebar's permissions never enable database writes, regardless of CLI defaults. */
export function localChatMode(permissionMode: unknown) {
  return { ...REXADB_PLAN_MODE, allowSqlRead: permissionMode === "schema_with_data", allowSqlWrite: false };
}

export function localChatPrompt(input: AgentChatRequest): string {
  const history = (input.history || []).filter((m) => m.role === "user" || m.role === "assistant");
  return [
    buildAgentInstructions({ ...input, schemaContext: input.lightSchemaContext, permissionMode: input.permissionMode || "schema_only", workflowContext: input.lightWorkflowContext }),
    "Use the RexaDB MCP tools for live database access when available. If a tool is unavailable, explain that limitation; never invent query results.",
    `Dashboard context: ${JSON.stringify(input.lightDashboardContext || [])}`,
    // Replay only this RexaDB chat, never a CLI's unrelated last session.
    `Previous conversation (JSON): ${JSON.stringify(history)}`,
    `User request:\n${input.prompt}`,
  ].join("\n\n");
}

export async function handleLocalCliChat(req: Request, res: Response): Promise<void> {
  const input = req.body as AgentChatRequest;
  const provider = getLocalCliProviderId(String(input.provider || ""));
  if (!provider || typeof input.prompt !== "string" || !input.prompt.trim() ||
      typeof input.model !== "string" || !input.model.trim() ||
      typeof input.connectionString !== "string" || typeof input.dbType !== "string") {
    res.status(400).json({ error: "A supported local CLI, model, prompt and database context are required." });
    return;
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  // IncomingMessage 'close' also fires on a fully received POST. Only a closed
  // response/aborted request means the user disconnected while streaming.
  res.once("close", abort);
  req.once("aborted", abort);
  let cwd: string | undefined;
  let fullText = "";
  let artifactCount = 0;
  let artifactOffset = 0;
  const emit = (event: AgentStreamEvent) => {
    if (!controller.signal.aborted) res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  // The MCP tools write here so results survive however a CLI reports tool output.
  const drainArtifacts = (file: string) => {
    if (!existsSync(file)) return;
    const content = readFileSync(file, "utf8");
    const end = content.lastIndexOf("\n") + 1;
    if (end <= artifactOffset) return;
    const lines = content.slice(artifactOffset, end).split("\n").filter(Boolean);
    artifactOffset = end;
    for (const line of lines) {
      const artifact = JSON.parse(line);
      if (!isStudioArtifact(artifact)) continue;
      artifactCount += 1;
      emit({ type: "artifact", artifact });
    }
  };
  try {
    const cached = readServerProviderCache()?.providers.find((p) => p.id === provider);
    const detected = await detectProvider(provider, { cached, signal: controller.signal });
    if (!detected?.available || detected.status !== "installed") {
      res.status(400).json({ error: detected?.available
        ? `Sign in to ${detected.name} in your terminal, then refresh local CLIs.`
        : `Install ${provider} on the machine running RexaDB, then refresh local CLIs.` });
      return;
    }
    controller.signal.throwIfAborted();
    cwd = mkdtempSync(join(tmpdir(), "rexadb-cli-chat-"));
    materializeAgentSandbox(cwd, { dbType: input.dbType, connectionId: input.connectionId, selectedNamespace: input.selectedNamespace, schemaContext: input.lightSchemaContext || [] });
    const artifactFile = join(cwd, ".rexadb-artifacts.jsonl");
    const mode = localChatMode(input.permissionMode);
    const mcp = input.connectionString ? buildRexaMcpServerConfig({ connectionString: input.connectionString, dbType: input.dbType, appMode: mode, studioArtifactFile: artifactFile }) : undefined;
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    res.flushHeaders();
    await runHarness(provider, {
      prompt: localChatPrompt(input), model: input.model, cwd,
      binaryPath: detected.binaryPath, mode: mode.mapsToProviderMode?.[provider], mcp,
    }, (event) => {
      switch (event.type) {
        case "text_delta":
        case "assistant_delta": {
          const message = event.content || event.message || "";
          fullText += message;
          emit({ type: "assistant_delta", message });
          break;
        }
        case "tool_start":
          emit({ type: "step", message: event.label || `Using ${event.tool || "tool"}` });
          emit({ type: "tool_start", tool: event.tool || "tool", command: JSON.stringify(event.input || {}) });
          break;
        case "tool_output":
          drainArtifacts(artifactFile);
          emit({ type: "tool_output", output: event.output || "" });
          emit({ type: "tool_end", exitCode: event.isError ? 1 : 0 });
          break;
        // runHarness propagates failures after exit; do not emit a success event.
      }
    }, controller.signal);
    drainArtifacts(artifactFile);
    if (!fullText.trim() && artifactCount === 0) throw new Error("The local CLI returned no response. Check its sign-in and usage limits.");
    emit({ type: "assistant_done", message: fullText });
  } catch (error) {
    if (!controller.signal.aborted) {
      const message = error instanceof Error ? error.message : "Local CLI request failed.";
      if (!res.headersSent) res.status(500).json({ error: message });
      else emit({ type: "error", message });
    }
  } finally {
    res.off("close", abort);
    req.off("aborted", abort);
    if (cwd) rmSync(cwd, { recursive: true, force: true });
    if (!res.writableEnded) res.end();
  }
}
