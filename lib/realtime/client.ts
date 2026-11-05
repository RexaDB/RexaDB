// Browser-safe. Talks to the sidecar's /api/realtime/* routes.
import { API_BASE } from "@/lib/api-base";
import type { TableWatchEvent, TableWatchRequest } from "./types";

export interface SupabaseTableRealtimeStatus {
  published: boolean;
  fullReplicaIdentity: boolean;
}

export async function supabaseTableRealtime(
  connectionString: string,
  schema: string,
  table: string,
  changes?: { published?: boolean; fullReplicaIdentity?: boolean },
): Promise<SupabaseTableRealtimeStatus> {
  const res = await fetch(`${API_BASE}/api/realtime/supabase/table`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ connectionString, schema, table, ...changes }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.success === false) {
    throw new Error(json?.error || `Supabase Realtime request failed (${res.status})`);
  }
  return json.data as SupabaseTableRealtimeStatus;
}

/** Streams change events for one table. The stream ends after an error event. */
export function streamTableWatch(
  request: TableWatchRequest,
  onEvent: (event: TableWatchEvent) => void,
): { abort: () => void } {
  const controller = new AbortController();

  (async () => {
    try {
      const res = await fetch(`${API_BASE}/api/realtime/watch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        onEvent({ type: "error", message: `HTTP ${res.status}` });
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const emit = (frame: string) => {
        const line = frame.split("\n").find((part) => part.startsWith("data:"));
        if (!line) return;
        try {
          const event = JSON.parse(line.slice(5).trim());
          if (event?.type === "status" || event?.type === "change" || event?.type === "error") {
            onEvent(event as TableWatchEvent);
          }
        } catch {
          // ignore malformed frame
        }
      };
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() || "";
        for (const frame of frames) emit(frame);
      }
      if (!controller.signal.aborted) onEvent({ type: "status", status: "closed" });
    } catch (err) {
      if (controller.signal.aborted) return;
      onEvent({ type: "error", message: err instanceof Error ? err.message : "Live updates stopped" });
    }
  })();

  return { abort: () => controller.abort() };
}
