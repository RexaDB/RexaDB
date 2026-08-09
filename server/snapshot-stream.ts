import type { SnapshotProgressEvent } from "../lib/db/snapshot-types";

export async function handleSnapshotCreateStream(req: any, res: any) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  let aborted = false;
  req.on("close", () => { aborted = true; });

  const sendEvent = (event: string, data: unknown) => {
    if (aborted) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const { connectionString, connectionId, name, description, tableNames } = req.body || {};
    if (!connectionString || !connectionId || !name || !tableNames?.length) {
      sendEvent("error", { message: "Missing required fields: connectionString, connectionId, name, tableNames" });
      if (!aborted) res.end();
      return;
    }

    const { createSnapshotStream } = await import("../lib/db/snapshot-core");

    const meta = await createSnapshotStream(
      connectionString,
      name,
      description || "",
      connectionId,
      tableNames,
      (event: SnapshotProgressEvent) => {
        sendEvent("progress", event);
      },
    );

    if (!aborted) {
      sendEvent("complete", { meta });
      res.end();
    }
  } catch (error: any) {
    console.error("[snapshot-stream] error:", error?.message || error);
    if (!aborted) {
      sendEvent("error", { message: error?.message || "Internal server error" });
      res.end();
    }
  }
}
