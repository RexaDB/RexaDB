import type { ChildProcess } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { getHarnessClient, type HarnessClient, type HarnessSpawnOptions, type InteractiveHarnessClient } from "./harness-clients";
import type { AgentProviderId, AgentStreamEvent } from "./provider-types";

/** Drive either CLI protocol to process exit, including trailing JSON and cancellation. */
export async function runHarness(
  provider: AgentProviderId,
  options: HarnessSpawnOptions,
  onEvent: (event: AgentStreamEvent) => void,
  signal: AbortSignal,
  client: HarnessClient = getHarnessClient(provider),
): Promise<void> {
  signal.throwIfAborted();
  let proc: ChildProcess | undefined;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    if (!proc || proc.exitCode !== null || proc.signalCode !== null) return;
    proc.kill("SIGTERM");
    killTimer = setTimeout(() => proc?.kill("SIGKILL"), 2_000);
    killTimer.unref();
  };
  signal.addEventListener("abort", stop, { once: true });
  let failure: string | undefined;
  const emit = (event: AgentStreamEvent) => {
    if (signal.aborted) return;
    if (event.type === "error") failure = event.content || event.message || "Local CLI failed.";
    // Wait for process exit so a premature done cannot hide a non-zero exit.
    if (event.type !== "done") onEvent(event);
  };
  try {
    if ("runPrompt" in client) {
      const result = await (client as InteractiveHarnessClient).runPrompt({
        ...options, onEvent: emit, onSpawn: (child) => { proc = child; if (signal.aborted) stop(); },
      });
      if (result.exitCode !== 0) throw new Error(`Local CLI exited with code ${result.exitCode}.`);
    } else {
      proc = client.spawn(options);
      const child = proc;
      await new Promise<void>((resolve, reject) => {
        let buffer = "";
        let stderr = "";
        const decoder = new StringDecoder("utf8");
        const parse = (line: string) => {
          if (!line.trim()) return;
          const events = client.parseLineAll ? client.parseLineAll(line) : [client.parseLine(line)].filter(Boolean) as AgentStreamEvent[];
          events.forEach(emit);
        };
        child.stdout?.on("data", (chunk: Buffer) => {
          buffer += decoder.write(chunk);
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          lines.forEach(parse);
        });
        child.stderr?.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-4_000); });
        child.once("error", reject);
        child.once("close", (code) => {
          parse(buffer + decoder.end());
          if (signal.aborted) reject(new DOMException("Stopped", "AbortError"));
          else if (code !== 0) reject(new Error(failure || stderr.trim() || `Local CLI exited with code ${code}.`));
          else resolve();
        });
        if (signal.aborted) stop();
      });
    }
    signal.throwIfAborted();
    if (failure) throw new Error(failure);
  } finally {
    signal.removeEventListener("abort", stop);
    if (killTimer) clearTimeout(killTimer);
  }
}
