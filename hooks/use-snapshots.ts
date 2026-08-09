"use client";

import { useState, useCallback, useMemo } from "react";
import {
  createSnapshot as _createSnapshot,
  listSnapshots as _listSnapshots,
  getSnapshot as _getSnapshot,
  getSnapshotFull as _getSnapshotFull,
  deleteSnapshot as _deleteSnapshot,
  compareSnapshots as _compareSnapshots,
} from "@/lib/api/actions-client";
import type { DatabaseSnapshot, SnapshotMeta, SnapshotDiff, SnapshotProgressEvent } from "@/lib/db/snapshot-types";
import { API_BASE } from "@/lib/api-base";

export function useSnapshots(connectionIdP: string | number | null) {
  const connectionId = connectionIdP != null ? String(connectionIdP) : null;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = useCallback(async (
    connectionString: string,
    name: string,
    description: string,
    tableNames: string[],
    onProgress?: (event: SnapshotProgressEvent) => void,
  ): Promise<SnapshotMeta | null> => {
    if (!connectionId) return null;

    if (onProgress) {
      setError(null);
      setLoading(true);
      try {
        const meta = await createStreamed(connectionString, connectionId, name, description, tableNames, onProgress);
        setLoading(false);
        return meta;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to create snapshot";
        setError(msg);
        setLoading(false);
        return null;
      }
    }

    setLoading(true);
    setError(null);
    try {
      const res = await _createSnapshot(connectionString, name, description, connectionId);
      if (!res.success) { setError(res.error || "Failed to create snapshot"); return null; }
      return res.data as SnapshotMeta;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create snapshot");
      return null;
    } finally { setLoading(false); }
  }, [connectionId]);

  const list = useCallback(async (): Promise<SnapshotMeta[]> => {
    if (!connectionId) return [];
    setLoading(true);
    setError(null);
    try {
      const res = await _listSnapshots(connectionId);
      if (!res.success) { setError(res.error || "Failed to list snapshots"); return []; }
      return res.data as SnapshotMeta[];
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to list snapshots");
      return [];
    } finally { setLoading(false); }
  }, [connectionId]);

  const get = useCallback(async (snapshotId: string): Promise<DatabaseSnapshot | null> => {
    if (!connectionId) return null;
    setLoading(true);
    setError(null);
    try {
      const res = await _getSnapshot(connectionId, snapshotId);
      if (!res.success) { setError(res.error || "Failed to get snapshot"); return null; }
      return res.data as DatabaseSnapshot;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to get snapshot");
      return null;
    } finally { setLoading(false); }
  }, [connectionId]);

  const getFull = useCallback(async (snapshotId: string): Promise<DatabaseSnapshot | null> => {
    if (!connectionId) return null;
    setLoading(true);
    setError(null);
    try {
      const res = await _getSnapshotFull(connectionId, snapshotId);
      if (!res.success) { setError(res.error || "Failed to get snapshot"); return null; }
      return res.data as DatabaseSnapshot;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to get snapshot");
      return null;
    } finally { setLoading(false); }
  }, [connectionId]);

  const remove = useCallback(async (snapshotId: string): Promise<boolean> => {
    if (!connectionId) return false;
    setLoading(true);
    setError(null);
    try {
      const res = await _deleteSnapshot(connectionId, snapshotId);
      if (!res.success) { setError(res.error || "Failed to delete snapshot"); return false; }
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete snapshot");
      return false;
    } finally { setLoading(false); }
  }, [connectionId]);

  const compare = useCallback(async (
    olderId: string,
    newerId: string,
  ): Promise<SnapshotDiff | null> => {
    if (!connectionId) return null;
    setLoading(true);
    setError(null);
    try {
      const res = await _compareSnapshots(connectionId, olderId, newerId);
      if (!res.success) { setError(res.error || "Failed to compare snapshots"); return null; }
      return res.data as SnapshotDiff;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to compare snapshots");
      return null;
    } finally { setLoading(false); }
  }, [connectionId]);

  return useMemo(() => ({ loading, error, create, list, get, getFull, remove, compare }), [loading, error, create, list, get, getFull, remove, compare]);
}

function createStreamed(
  connectionString: string,
  connectionId: string,
  name: string,
  description: string,
  tableNames: string[],
  onProgress: (event: SnapshotProgressEvent) => void,
): Promise<SnapshotMeta | null> {
  return new Promise((resolve, reject) => {
    const url = `${API_BASE}/api/snapshots/create-stream`;

    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connectionString, connectionId, name, description, tableNames }),
    }).then(async (response) => {
      const reader = response.body?.getReader();
      if (!reader) { resolve(null); return; }

      const decoder = new TextDecoder();
      let buffer = "";
      let lastError = "Snapshot creation failed";

      // fallow-ignore-next-line code-duplication
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        let eventType = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith("data: ")) {
            const data = line.slice(6);
            try {
              const parsed = JSON.parse(data);
              if (eventType === "progress") {
                onProgress(parsed);
              } else if (eventType === "complete") {
                resolve(parsed.meta);
                return;
              } else if (eventType === "error") {
                lastError = parsed.message || lastError;
                reject(new Error(lastError));
                return;
              }
            } catch { /* skip malformed lines */ }
          }
        }
      }
      reject(new Error(lastError));
    }).catch((err) => {
      reject(err instanceof Error ? err : new Error("Snapshot creation failed"));
    });
  });
}
