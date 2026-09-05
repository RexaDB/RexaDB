import type { ChildProcess } from "child_process";
import type { AgentStreamEvent } from "./provider-types";

/** First event from a decoded line, or null when empty. */
export function firstEvent(events: AgentStreamEvent[]): AgentStreamEvent | null {
  return events.length > 0 ? events[0]! : null;
}

/** Fallback for unparseable JSONL: surface the raw line as a text delta. */
export function textFallback(line: string): AgentStreamEvent[] {
  if (line.trim().length > 0) {
    return [{ type: "text_delta", content: line }];
  }
  return [];
}

/**
 * Base for JSONL CLI harnesses (Claude/OpenCode/Codex/Fx/Pi).
 * Implements `parseLine` via `parseLineAll` and converts JSON errors
 * into `textFallback`, removing 5 copies of each pattern.
 */
export abstract class JsonlHarnessClient {
  parseLine(line: string): AgentStreamEvent | null {
    return firstEvent(this.parseLineAll(line));
  }

  abstract parseLineAll(line: string): AgentStreamEvent[];

  protected fallback(line: string): AgentStreamEvent[] {
    return textFallback(line);
  }
}
