import type { AgentStreamEvent } from "./types";

export async function* readSseStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): AsyncGenerator<AgentStreamEvent> {
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() || "";

    for (const event of events) {
      const line = event.split("\n").find((part) => part.startsWith("data:"));
      if (!line) continue;
      yield JSON.parse(line.slice(5).trim()) as AgentStreamEvent;
    }
  }
}
