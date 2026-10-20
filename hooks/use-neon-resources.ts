"use client";

import { useCallback, useEffect, useState } from "react";
import { createBucket, listBucketObjects, listBuckets, listFunctions, type NeonBucket, type NeonFunction } from "@/lib/neon-cli/client";
import { getNeonManagementPointer } from "@/lib/studio/neon-management";

export function useNeonResources(connectionString: string, kind: "buckets" | "functions") {
  const [items, setItems] = useState<Array<NeonBucket | NeonFunction>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const pointer = getNeonManagementPointer(connectionString);
    if (!pointer) { setItems([]); setError("Connect using a Neon account connection to manage services."); return; }
    setLoading(true); setError(null);
    try {
      const rows = kind === "buckets"
        ? await listBuckets(pointer.profile, pointer.projectId, pointer.branchId)
        : await listFunctions(pointer.profile, pointer.projectId, pointer.branchId);
      setItems(rows);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, [connectionString, kind]);
  const addBucket = useCallback(async (name: string, accessLevel: "private" | "public_read") => {
    const pointer = getNeonManagementPointer(connectionString);
    if (!pointer) throw new Error("Connect using a Neon account connection first.");
    await createBucket(pointer.profile, pointer.projectId, pointer.branchId, name, accessLevel);
    await load();
  }, [connectionString, load]);
  const getObjects = useCallback(async (bucket: string) => {
    const pointer = getNeonManagementPointer(connectionString);
    if (!pointer) throw new Error("Connect using a Neon account connection first.");
    return listBucketObjects(pointer.profile, pointer.projectId, pointer.branchId, pointer.database, pointer.role, bucket);
  }, [connectionString]);
  useEffect(() => { void load(); }, [load]);
  return { items, loading, error, refresh: load, addBucket, getObjects };
}
