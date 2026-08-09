"use client";

import { useState } from "react";
import { comparePostgresSchemas, applyPostgresSchemaToTarget } from "@/lib/api/actions-client";

// Small, self-contained hook; splitting further would add indirection without real reuse.
type SchemaCompareResult = {
  isEqual: boolean;
  missingInTarget: string[];
  extraInTarget: string[];
  sourceCount: number;
  targetCount: number;
};

type UseSchemaCompareState = {
  loading: boolean;
  applying: boolean;
  error: string | null;
  result: SchemaCompareResult | null;
  runCompare: (source: string, target: string) => Promise<boolean>;
  applySourceToTarget: (source: string, target: string) => Promise<{ ok: boolean; appliedCount: number }>;
  reset: () => void;
};

export function useSchemaCompare(): UseSchemaCompareState {
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SchemaCompareResult | null>(null);

  const runCompare = async (source: string, target: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await comparePostgresSchemas(source, target);
      if (!res.success || !res.data) {
        setError(res.error || "Failed to compare schemas.");
        setResult(null);
        return false;
      }
      setResult(res.data as SchemaCompareResult);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to compare schemas.");
      setResult(null);
      return false;
    } finally {
      setLoading(false);
    }
  };

  const applySourceToTarget = async (source: string, target: string) => {
    setApplying(true);
    setError(null);
    try {
      const res = await applyPostgresSchemaToTarget(source, target);
      if (!res.success) {
        setError(res.error || "Failed to apply schema changes.");
        return { ok: false, appliedCount: 0 };
      }
      const appliedCount = typeof (res as any)?.data?.appliedCount === "number" ? (res as any).data.appliedCount : 0;
      return { ok: true, appliedCount };
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to apply schema changes.");
      return { ok: false, appliedCount: 0 };
    } finally {
      setApplying(false);
    }
  };

  const reset = () => {
    setError(null);
    setResult(null);
  };

  return { loading, applying, error, result, runCompare, applySourceToTarget, reset };
}
