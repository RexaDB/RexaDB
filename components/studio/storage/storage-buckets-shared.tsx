"use client";

import { useCallback, useEffect, useState } from "react";
import { runQuery } from "@/lib/api/actions-client";
import { fetchStorageBuckets } from "@/lib/studio/storage-utils";
import type { StorageBucket } from "@/lib/studio/storage-utils";

export const BUCKET_NAME_RE = /^[a-z0-9][a-z0-9._-]*$/;

export function validateBucketName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Bucket name is required.";
  if (!BUCKET_NAME_RE.test(trimmed)) {
    return "Use lowercase letters, numbers, dots, underscores, or hyphens.";
  }
  return null;
}

export function escapeBucketLiteral(name: string): string {
  return name.replace(/'/g, "''");
}

export function buildCreateBucketSql(name: string, isPublic: boolean): string {
  const lit = escapeBucketLiteral(name);
  return `INSERT INTO storage.buckets (id, name, public)\n         VALUES ('${lit}', '${lit}', ${isPublic})`;
}

export async function createStorageBucket(
  connectionString: string,
  name: string,
  isPublic: boolean,
): Promise<void> {
  const validationError = validateBucketName(name);
  if (validationError) throw new Error(validationError);
  const res = await runQuery(connectionString, buildCreateBucketSql(name, isPublic));
  if (res?.error) throw new Error(res.error);
}

export function useStorageBuckets(connectionString: string, opts?: {
  onError?: (message: string) => void;
}) {
  const [buckets, setBuckets] = useState<StorageBucket[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadBuckets = useCallback(async () => {
    if (!connectionString) return;
    setLoading(true);
    const { buckets, error } = await fetchStorageBuckets(connectionString);
    setBuckets(buckets);
    setLoadError(error ?? null);
    if (error) opts?.onError?.(error);
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionString]);

  useEffect(() => {
    void loadBuckets();
  }, [loadBuckets]);

  useEffect(() => {
    const onRefresh = () => void loadBuckets();
    window.addEventListener("studio:storage-buckets-changed", onRefresh);
    return () =>
      window.removeEventListener("studio:storage-buckets-changed", onRefresh);
  }, [loadBuckets]);

  const notifyBucketsChanged = useCallback(() => {
    window.dispatchEvent(new Event("studio:storage-buckets-changed"));
  }, []);

  return {
    buckets,
    loading,
    loadError,
    loadBuckets,
    notifyBucketsChanged,
    setBuckets,
  };
}
