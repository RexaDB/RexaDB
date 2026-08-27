import { spawn, type ChildProcess } from "child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentSandboxCwd, sandboxProcessEnv } from "./sandbox-cwd";
import type { RexaMcpServerConfig } from "./mcp/config";
import { buildClaudeMcpConfigJson } from "./mcp/config";
import type { AgentProviderId, AgentStreamEvent } from "./provider-types";

export interface HarnessSpawnOptions {
  prompt: string;
  cwd?: string;
  env?: Record<string, string>;
  history?: Array<{ role: string; content: string }>;
  /** Provider mode id (plan/build, permission-mode, sandbox, custom agent). */
  mode?: string;
  /** RexaDB MCP server for live DB tools (stdio). */
  mcp?: RexaMcpServerConfig;
}

export interface HarnessClient {
  providerId: AgentProviderId;
  spawn(options: HarnessSpawnOptions): ChildProcess;
  parseLine(line: string): AgentStreamEvent | null;
  /**
   * All events decoded from one stdout line. Some harness messages carry text
   * AND multiple tool_use blocks — parseLine alone would drop all but the first.
   */
  parseLineAll?(line: string): AgentStreamEvent[];
}

/**
 * Bidirectional harnesses (t3code's ACP approach for Cursor / Grok Build):
 * JSON-RPC over stdio — initialize → session/new → session/prompt, with
 * session/update notifications streaming text deltas and tool-call lifecycles.
 */
export interface InteractiveHarnessClient extends HarnessClient {
  runPrompt(opts: {
    prompt: string;
    cwd?: string;
    env?: Record<string, string>;
    mode?: string;
    mcp?: RexaMcpServerConfig;
    onEvent: (event: AgentStreamEvent) => void;
    onSpawn?: (proc: ChildProcess) => void;
  }): Promise<{ exitCode: number }>;
}

function writeClaudeMcpConfig(cwd: string, mcp: RexaMcpServerConfig): string {
  const path = join(cwd, "rexadb-mcp-claude.json");
  writeFileSync(path, buildClaudeMcpConfigJson(mcp), "utf8");
  return path;
}

/** ACP mcpServers entry shape (Cursor / Grok session/new). */
function toAcpMcpServer(mcp: RexaMcpServerConfig) {
  return {
    name: mcp.name,
    command: mcp.command,
    args: mcp.args,
    env: Object.entries(mcp.env).map(([name, value]) => ({ name, value })),
  };
}

function resolveCwd(cwd?: string): string {
  return cwd || getAgentSandboxCwd();
}

function makeEnv(cwd: string, extra?: Record<string, string>): NodeJS.ProcessEnv {
  return { ...process.env, ...sandboxProcessEnv(cwd), ...extra } as NodeJS.ProcessEnv;
}

/** Spawn a process and immediately close stdin so CLIs don't hang waiting for input. */
function spawnCli(
  cmd: string,
  args: string[],
  options: { cwd?: string; env?: Record<string, string> },
): ChildProcess {
  const cwd = resolveCwd(options.cwd);
  const proc = spawn(cmd, args, {
    cwd,
    env: makeEnv(cwd, options.env),
    stdio: ["pipe", "pipe", "pipe"],
  });
  // Close stdin immediately — non-interactive CLIs that read stdin will hang forever otherwise
  proc.stdin?.end();
  // Suppress EPIPE errors if the process exits before we finish writing
  proc.on("error", () => {});
  return proc;
}

class RexaDbClient implements HarnessClient {
  providerId = "rexadb" as const;

  spawn(_options: HarnessSpawnOptions): ChildProcess {
    throw new Error(
      "RexaDB agent uses the built-in pi-coding-agent, not a CLI harness",
    );
  }

  parseLine(): null {
    return null;
  }
}

// ─── Claude Code ─────────────────────────────────────────────────────────────
// Output: stream-json --verbose, one JSON object per line.
// Mirrors t3code's ClaudeAdapter SDK message handling: assistant content blocks
// (text + every tool_use with id/input), user tool_result blocks
// (tool_use_id + is_error + content), result subtypes → turn terminal state.
class ClaudeCodeClient implements HarnessClient {
  providerId = "claude-code" as const;

  spawn(options: HarnessSpawnOptions): ChildProcess {
    const cwd = resolveCwd(options.cwd);
    const args = ["--output-format", "stream-json", "--verbose"];
    if (options.mode) args.push("--permission-mode", options.mode);
    if (options.mcp) {
      args.push("--mcp-config", writeClaudeMcpConfig(cwd, options.mcp));
    }
    args.push("-p", options.prompt);
    return spawnCli("claude", args, { cwd, env: options.env });
  }

  parseLine(line: string): AgentStreamEvent | null {
    const events = this.parseLineAll(line);
    return events.length > 0 ? events[0] : null;
  }

  parseLineAll(line: string): AgentStreamEvent[] {
    try {
      const msg = JSON.parse(line);
      const events: AgentStreamEvent[] = [];

      // Assistant message with content blocks — emit text AND every tool_use
      if (msg.type === "assistant" && msg.message?.content) {
        const content = msg.message.content;
        if (Array.isArray(content)) {
          const textParts = content
            .filter((b: any) => b.type === "text")
            .map((b: any) => b.text)
            .join("");
          if (textParts) {
            events.push({ type: "text_delta", content: textParts });
          }
          for (const block of content) {
            if (block.type === "tool_use") {
              events.push({
                type: "tool_start",
                tool: block.name,
                toolCallId: block.id,
                input: block.input,
                content: JSON.stringify(block.input ?? {}),
              });
            }
          }
        } else if (typeof content === "string" && content) {
          events.push({ type: "text_delta", content });
        }
        return events;
      }

      // User message containing tool results — emit one event per result
      if (msg.type === "user" && msg.message?.content) {
        const content = msg.message.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === "tool_result") {
              events.push({
                type: "tool_output",
                toolCallId: block.tool_use_id,
                isError: block.is_error === true,
                output:
                  typeof block.content === "string"
                    ? block.content
                    : JSON.stringify(block.content ?? ""),
              });
            }
          }
        }
        return events;
      }

      // Result = final event (t3code's turnStatusFromResult)
      if (msg.type === "result") {
        if (msg.subtype === "success" || msg.subtype === "error_max_turns") {
          events.push({ type: "done" });
        } else if (msg.is_error || msg.error) {
          events.push({
            type: "error",
            content: msg.error || msg.result || "Claude Code error",
          });
        } else {
          events.push({ type: "done" });
        }
        return events;
      }

      // System events (init, hooks, api_retry) — ignore
      if (msg.type === "system") return events;
    } catch {
      if (line.trim().length > 0) {
        return [{ type: "text_delta", content: line }];
      }
    }
    return [];
  }
}

// ─── OpenCode ────────────────────────────────────────────────────────────────
// Output: run --format json, JSONL. Verified against opencode 1.18.x:
//   {"type":"step_start","part":{"type":"step-start"}}
//   {"type":"tool_use","part":{"type":"tool","tool":"read","callID":"…",
//     "state":{"status":"pending|running|completed|error","input":{},"output":"","error":""}}}
//   {"type":"text","part":{"type":"text","text":"…"}}
//   {"type":"step_finish","part":{"reason":"tool-calls"|"stop"}}
// CRITICAL: step_finish reason "tool-calls" is an INTERMEDIATE step boundary —
// treating it as done kills the stream mid-turn (tools never render).
class OpenCodeClient implements HarnessClient {
  providerId = "opencode" as const;

  spawn(options: HarnessSpawnOptions): ChildProcess {
    const cwd = resolveCwd(options.cwd);
    // Headless `run` has no TTY to answer permission prompts, so anything not
    // explicitly "allow"'d in the user's opencode config (e.g. our injected MCP
    // tool, which they can't have pre-approved) gets silently auto-denied —
    // surfacing as "The user rejected permission to use this specific tool call."
    // RexaDB's own DbToolsPermissions already gates reads/writes, so it's safe
    // to bypass opencode's interactive permission gate here.
    const args = ["run", "--format", "json", "--dir", cwd, "--auto"];
    if (options.mode) args.push("--agent", options.mode);
    const env = { ...options.env };
    // OpenCode discovers MCP from project/user config; write a local overlay
    // into the sandbox so this turn sees RexaDB tools.
    if (options.mcp) {
      const mcpPath = join(cwd, "opencode-mcp.json");
      writeFileSync(
        mcpPath,
        JSON.stringify(
          {
            mcp: {
              [options.mcp.name]: {
                type: "local",
                command: [options.mcp.command, ...options.mcp.args],
                enabled: true,
                environment: options.mcp.env,
              },
            },
          },
          null,
          2,
        ),
        "utf8",
      );
      env.OPENCODE_CONFIG = mcpPath;
    }
    args.push(options.prompt);
    return spawnCli("opencode", args, { cwd, env });
  }

  parseLine(line: string): AgentStreamEvent | null {
    const events = this.parseLineAll(line);
    return events.length > 0 ? events[0] : null;
  }

  parseLineAll(line: string): AgentStreamEvent[] {
    try {
      const msg = JSON.parse(line);
      const part = msg.part || {};
      const events: AgentStreamEvent[] = [];

      // Text content lives in part.text
      if (msg.type === "text" && part.text) {
        events.push({ type: "text_delta", content: part.text });
      }

      // Tool parts carry a full state snapshot; callID is the stable identity
      if (
        (msg.type === "tool_use" || part.type === "tool") &&
        (part.tool || part.name)
      ) {
        const state = part.state || {};
        const callId = part.callID || part.id;
        const status = state.status;
        events.push({
          type: "tool_start",
          tool: part.tool || part.name,
          toolCallId: callId,
          input: state.input,
          label: state.title || undefined,
        });
        if (status === "completed" || status === "error") {
          events.push({
            type: "tool_output",
            toolCallId: callId,
            isError: status === "error",
            output: state.output ?? state.error ?? "",
          });
        }
      }

      // Only the FINAL step finishes the turn; "tool-calls" means more steps follow
      if (msg.type === "step_finish") {
        const reason = part.reason;
        if (reason !== "tool-calls") {
          events.push({ type: "done" });
        }
      }
      return events;
    } catch {
      if (line.trim().length > 0) {
        return [{ type: "text_delta", content: line }];
      }
    }
    return [];
  }
}

// ─── Codex ───────────────────────────────────────────────────────────────────
// Output: exec --json, JSONL. Verified against codex CLI:
//   {"type":"thread.started","thread_id":"…"}
//   {"type":"turn.started"}
//   {"type":"item.started","item":{"id":"item_0","type":"command_execution","command":"…",…}}
//   {"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"…"}}
//   {"type":"turn.completed"} | {"type":"turn.failed","error":{"message"}} | {"type":"error","message"}
// Item types: agent_message, reasoning, command_execution, file_change,
// mcp_tool_call, web_search, todo_list, error.
class CodexClient implements HarnessClient {
  providerId = "codex" as const;

  spawn(options: HarnessSpawnOptions): ChildProcess {
    const cwd = resolveCwd(options.cwd);
    const args = ["exec", "--json", "--skip-git-repo-check", "--cd", cwd];
    if (options.mode) args.push("--sandbox", options.mode);
    args.push(options.prompt);
    return spawnCli("codex", args, { cwd, env: options.env });
  }

  parseLine(line: string): AgentStreamEvent | null {
    const events = this.parseLineAll(line);
    return events.length > 0 ? events[0] : null;
  }

  parseLineAll(line: string): AgentStreamEvent[] {
    try {
      const msg = JSON.parse(line);
      const events: AgentStreamEvent[] = [];

      if (msg.type === "thread.started" || msg.type === "turn.started") {
        return events;
      }

      if (msg.type === "turn.completed") {
        events.push({ type: "done" });
        return events;
      }

      if (msg.type === "turn.failed" || msg.type === "error") {
        events.push({
          type: "error",
          content: msg.error?.message ?? msg.message ?? "Codex turn failed",
        });
        return events;
      }

      const item = msg.item;
      if (!item) return events;

      // Assistant text arrives as a completed agent_message item
      if (item.type === "agent_message" && item.text) {
        events.push({ type: "text_delta", content: item.text });
        return events;
      }

      if (msg.type === "item.started" || msg.type === "item.completed") {
        const completed = msg.type === "item.completed";
        switch (item.type) {
          case "command_execution": {
            const command = item.command || "";
            const program = command.split(/\s+/)[0] || "command";
            events.push({
              type: "tool_start",
              tool: "bash",
              toolCallId: item.id,
              input: { command },
              label: `Running ${program}`,
            });
            if (completed) {
              events.push({
                type: "tool_output",
                toolCallId: item.id,
                isError: typeof item.exit_code === "number" ? item.exit_code !== 0 : false,
                output: item.aggregated_output ?? "",
              });
            }
            break;
          }
          case "file_change": {
            const changes = Array.isArray(item.changes) ? item.changes : [];
            events.push({
              type: "tool_start",
              tool: "edit",
              toolCallId: item.id,
              input: {},
              label: changes.length === 1 ? `Edit ${changes[0]?.path ?? "file"}` : `Changed ${changes.length} files`,
            });
            if (completed) {
              events.push({
                type: "tool_output",
                toolCallId: item.id,
                isError: item.status === "failed",
                output: changes.map((c: any) => c?.path).filter(Boolean).join("\n"),
              });
            }
            break;
          }
          case "mcp_tool_call": {
            events.push({
              type: "tool_start",
              tool: item.tool || "mcp",
              toolCallId: item.id,
              input: item.arguments,
              label: item.tool ? `MCP ${item.tool}` : undefined,
            });
            if (completed) {
              events.push({
                type: "tool_output",
                toolCallId: item.id,
                isError: item.status === "failed",
                output:
                  typeof item.result === "string"
                    ? item.result
                    : JSON.stringify(item.result ?? ""),
              });
            }
            break;
          }
          case "web_search": {
            events.push({
              type: "tool_start",
              tool: "websearch",
              toolCallId: item.id,
              input: { query: item.query },
              label: item.query ? `Search web ${item.query}` : "Search web",
            });
            if (completed) {
              events.push({ type: "tool_output", toolCallId: item.id, output: "" });
            }
            break;
          }
          case "error": {
            events.push({ type: "error", content: item.message || "Codex error" });
            break;
          }
          // reasoning, todo_list — not surfaced in the work log
        }
      }
      return events;
    } catch {
      if (line.trim().length > 0) {
        return [{ type: "text_delta", content: line }];
      }
    }
    return [];
  }
}

// ─── ACP (Cursor / Grok Build) ───────────────────────────────────────────────
// t3code drives both over ACP JSON-RPC on stdio instead of one-shot flags:
//   cursor-agent acp · grok agent stdio
// Handshake: initialize → session/new → session/prompt (blocks until the turn
// ends). Notifications arrive as session/update with update.sessionUpdate ∈
// agent_message_chunk | tool_call | tool_call_update | plan | current_mode_update.
interface JsonRpcPending {
  resolve: (result: any) => void;
  reject: (err: Error) => void;
}

class AcpInteractiveClient implements InteractiveHarnessClient {
  constructor(
    readonly providerId: AgentProviderId,
    private command: string,
    private args: string[],
  ) {}

  protected resolveArgs(mode?: string): string[] {
    if (this.providerId === "grok-build" && mode && mode !== "default") {
      return ["--permission-mode", mode, ...this.args];
    }
    return this.args;
  }

  spawn(options: HarnessSpawnOptions): ChildProcess {
    // One-shot compat only — real turns go through runPrompt (stdin must stay open).
    const cwd = resolveCwd(options.cwd);
    const proc = spawn(this.command, this.resolveArgs(options.mode), {
      cwd,
      env: makeEnv(cwd, options.env),
      stdio: ["pipe", "pipe", "pipe"],
    });
    proc.on("error", () => {});
    return proc;
  }

  parseLine(): null {
    return null;
  }

  async runPrompt(opts: {
    prompt: string;
    cwd?: string;
    env?: Record<string, string>;
    mode?: string;
    mcp?: RexaMcpServerConfig;
    onEvent: (event: AgentStreamEvent) => void;
    onSpawn?: (proc: ChildProcess) => void;
  }): Promise<{ exitCode: number }> {
    const cwd = resolveCwd(opts.cwd);
    const proc = spawn(this.command, this.resolveArgs(opts.mode), {
      cwd,
      env: makeEnv(cwd, opts.env),
      stdio: ["pipe", "pipe", "pipe"],
    });
    proc.on("error", () => {});
    opts.onSpawn?.(proc);

    let buffer = "";
    let nextId = 1;
    const pending = new Map<number, JsonRpcPending>();
    let exitCode = 0;

    const send = (method: string, params: unknown): number => {
      const id = nextId++;
      const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
      proc.stdin?.write(payload);
      return id;
    };
    const notify = (method: string, params: unknown) => {
      proc.stdin?.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
    };
    const request = <T = any>(method: string, params: unknown): Promise<T> =>
      new Promise<T>((resolve, reject) => {
        const id = send(method, params);
        pending.set(id, { resolve, reject });
      });

    proc.stdout?.setEncoding("utf8");
    proc.stdout?.on("data", (chunk: string) => {
      buffer += chunk;
      let idx: number;
      while ((idx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        let msg: any;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.id !== undefined && pending.has(msg.id)) {
          const p = pending.get(msg.id)!;
          pending.delete(msg.id);
          if (msg.error) {
            p.reject(new Error(msg.error.message || "ACP request failed"));
          } else {
            p.resolve(msg.result);
          }
        } else if (msg.method === "session/update") {
          this.handleSessionUpdate(msg.params?.update, opts.onEvent);
        }
      }
    });

    const exited = new Promise<void>((resolve) =>
      proc.on("close", (code) => {
        exitCode = code ?? 0;
        resolve();
      }),
    );

    try {
      await request("initialize", {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
      });
      notify("initialized", {});
      const session = await request<{ sessionId: string }>("session/new", {
        cwd,
        mcpServers: opts.mcp ? [toAcpMcpServer(opts.mcp)] : [],
      });
      const promptResult = await request<{ stopReason?: string }>("session/prompt", {
        sessionId: session.sessionId,
        prompt: [{ type: "text", text: opts.prompt }],
      });
      opts.onEvent({ type: "done" });
      if (promptResult?.stopReason && promptResult.stopReason !== "end_turn") {
        // cancelled / max_tokens etc. — surface as a soft error note
        if (promptResult.stopReason === "refusal") {
          opts.onEvent({ type: "error", content: "Model refused the request" });
        }
      }
    } catch (err: any) {
      opts.onEvent({ type: "error", content: err?.message || "ACP harness error" });
      try {
        proc.kill("SIGTERM");
      } catch {}
      throw err;
    } finally {
      try {
        proc.kill("SIGTERM");
      } catch {}
    }

    await Promise.race([exited, new Promise((r) => setTimeout(r, 2000))]);
    return { exitCode };
  }

  /** Ported from t3code AcpRuntimeModel.parseSessionUpdateEvent. */
  private handleSessionUpdate(
    update: any,
    onEvent: (event: AgentStreamEvent) => void,
  ) {
    if (!update) return;
    switch (update.sessionUpdate) {
      case "agent_message_chunk": {
        if (update.content?.type === "text" && update.content.text) {
          onEvent({ type: "text_delta", content: update.content.text });
        }
        break;
      }
      case "tool_call":
      case "tool_call_update": {
        const toolCallId = update.toolCallId;
        if (!toolCallId) break;
        // ACP statuses: pending | in_progress | inProgress | completed | failed
        const rawStatus = String(update.status || "").toLowerCase();
        const failed = rawStatus === "failed";
        const settled = failed || rawStatus === "completed";
        const label =
          update.title ||
          (update.kind ? `${update.kind} tool call` : undefined);
        onEvent({
          type: "tool_start",
          tool: update.kind || "tool",
          toolCallId,
          input: update.rawInput,
          label,
        });
        if (settled) {
          const output = this.extractAcpOutput(update);
          onEvent({
            type: "tool_output",
            toolCallId,
            isError: failed,
            output,
          });
        }
        break;
      }
      // plan / current_mode_update — not surfaced yet
    }
  }

  private extractAcpOutput(update: any): string {
    if (typeof update.rawOutput === "string" && update.rawOutput) {
      return update.rawOutput;
    }
    if (Array.isArray(update.content)) {
      return update.content
        .map((c: any) => (typeof c?.text === "string" ? c.text : ""))
        .filter(Boolean)
        .join("\n");
    }
    return "";
  }
}

// ─── Grok Build (legacy one-shot fallback shapes kept tolerant) ──────────────
class GrokBuildClient extends AcpInteractiveClient {
  providerId = "grok-build" as const;
  constructor() {
    super("grok-build", "grok", ["agent", "stdio"]);
  }
}

// ─── Cursor ──────────────────────────────────────────────────────────────────
class CursorClient extends AcpInteractiveClient {
  providerId = "cursor" as const;
  constructor() {
    super("cursor", "cursor-agent", ["acp"]);
  }
}

// ─── fx ──────────────────────────────────────────────────────────────────────
// Output: ask --json, JSONL events
class FxClient implements HarnessClient {
  providerId = "fx" as const;

  spawn(options: HarnessSpawnOptions): ChildProcess {
    const cwd = resolveCwd(options.cwd);
    const args = ["ask", "--json"];
    if (options.mode === "auto") args.push("--auto");
    if (options.mode === "yolo") args.push("--yolo");
    args.push(options.prompt);
    return spawnCli("fx", args, { cwd, env: options.env });
  }

  parseLine(line: string): AgentStreamEvent | null {
    const events = this.parseLineAll(line);
    return events.length > 0 ? events[0] : null;
  }

  parseLineAll(line: string): AgentStreamEvent[] {
    try {
      const msg = JSON.parse(line);
      const events: AgentStreamEvent[] = [];
      if (msg.type === "text" || msg.type === "content" || msg.type === "assistant") {
        const content = msg.text || msg.content || msg.message || "";
        if (content) events.push({ type: "text_delta", content });
      }
      if (msg.type === "tool_use" || msg.type === "tool_call") {
        events.push({
          type: "tool_start",
          tool: msg.name,
          toolCallId: msg.id,
          input: msg.input,
        });
      }
      if (msg.type === "tool_result" || msg.type === "tool_output") {
        events.push({
          type: "tool_output",
          toolCallId: msg.id,
          isError: msg.is_error === true,
          output: msg.output || msg.result || "",
        });
      }
      if (msg.type === "done" || msg.type === "complete" || msg.type === "end") {
        events.push({ type: "done" });
      }
      return events;
    } catch {
      if (line.trim().length > 0) {
        return [{ type: "text_delta", content: line }];
      }
    }
    return [];
  }
}

// ─── pi ──────────────────────────────────────────────────────────────────────
// Output: --print --mode json, JSONL events
// Output: --print --mode json, JSONL — this is the raw pi-coding-agent
// AgentEvent stream (see @earendil-works/pi-agent-core's AgentEvent union),
// NOT the ad hoc {type:"text"|"tool_use"|"tool_result"|"done"} shape this
// parser used to assume. That mismatch meant every line failed every check
// below (JSON.parse succeeded, so the text-fallback branch never fired
// either) — no event was ever emitted, so the chat turn ended in total
// silence. Verified against pi 1.x:
//   {"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"…"}}
//   {"type":"tool_execution_start","toolCallId":"…","toolName":"…","args":{}}
//   {"type":"tool_execution_end","toolCallId":"…","toolName":"…","result":{"content":[…]},"isError":false}
//   {"type":"message_end","message":{"role":"assistant","stopReason":"error","errorMessage":"…"}}
//   {"type":"agent_end","messages":[…]}  — last event of the run
// pi-coding-agent has no MCP support ("intentionally does not include
// built-in MCP" per its own docs), so this harness runs off the prompt's
// inlined schema context plus pi's own read/bash tools in the sandbox —
// no live RexaDB DB tools here.
class PiClient implements HarnessClient {
  providerId = "pi" as const;

  spawn(options: HarnessSpawnOptions): ChildProcess {
    const cwd = resolveCwd(options.cwd);
    return spawnCli(
      "pi",
      ["--print", "--mode", "json", "--no-approve", options.prompt],
      { cwd, env: options.env },
    );
  }

  parseLine(line: string): AgentStreamEvent | null {
    const events = this.parseLineAll(line);
    return events.length > 0 ? events[0] : null;
  }

  parseLineAll(line: string): AgentStreamEvent[] {
    try {
      const msg = JSON.parse(line);
      const events: AgentStreamEvent[] = [];

      if (msg.type === "message_update") {
        const ev = msg.assistantMessageEvent;
        if (ev?.type === "text_delta" && ev.delta) {
          events.push({ type: "text_delta", content: ev.delta });
        }
        return events;
      }

      if (msg.type === "tool_execution_start") {
        events.push({
          type: "tool_start",
          tool: msg.toolName || "tool",
          toolCallId: msg.toolCallId,
          input: msg.args,
        });
        return events;
      }

      if (msg.type === "tool_execution_end") {
        const output = Array.isArray(msg.result?.content)
          ? msg.result.content
              .filter((part: any) => part.type === "text")
              .map((part: any) => part.text)
              .join("\n")
          : "";
        events.push({
          type: "tool_output",
          toolCallId: msg.toolCallId,
          isError: !!msg.isError,
          output,
        });
        return events;
      }

      if (msg.type === "message_end" && msg.message?.role === "assistant") {
        const m = msg.message;
        if (m.stopReason === "error" || m.errorMessage) {
          events.push({
            type: "error",
            content: m.errorMessage || `pi returned stopReason "${m.stopReason}".`,
          });
        }
        return events;
      }

      // agent_end is documented as the last event emitted for a run.
      if (msg.type === "agent_end") {
        events.push({ type: "done" });
        return events;
      }

      return events;
    } catch {
      if (line.trim().length > 0) {
        return [{ type: "text_delta", content: line }];
      }
    }
    return [];
  }
}

const CLIENTS: Record<AgentProviderId, () => HarnessClient> = {
  rexadb: () => new RexaDbClient(),
  "claude-code": () => new ClaudeCodeClient(),
  codex: () => new CodexClient(),
  opencode: () => new OpenCodeClient(),
  "grok-build": () => new GrokBuildClient(),
  cursor: () => new CursorClient(),
  fx: () => new FxClient(),
  pi: () => new PiClient(),
};

export function getHarnessClient(providerId: AgentProviderId): HarnessClient {
  const factory = CLIENTS[providerId];
  if (!factory) {
    throw new Error(`Unknown provider: ${providerId}`);
  }
  return factory();
}

export function spawnHarness(
  providerId: AgentProviderId,
  options: HarnessSpawnOptions,
): { process: ChildProcess; client: HarnessClient } {
  const client = getHarnessClient(providerId);
  const proc = client.spawn(options);
  return { process: proc, client };
}
