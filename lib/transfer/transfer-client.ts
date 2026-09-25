/**
 * Client-side transfer utilities
 * Calls server-side API endpoints for transfer operations
 */

import type { TransferOptions, TransferProgress } from "./transfer-types";
import { API_BASE } from "@/lib/api-base";

export interface TransferApiRequest {
  sourceConnectionString: string;
  sourceProvider: string;
  destinationConnectionString: string;
  destinationProvider: string;
  options: TransferOptions;
}

export interface FunctionDiffView {
  slug: string;
  targetProvider: string;
  diff: string;
  notes: string[];
}

export interface TransferApiResponse {
  success: boolean;
  error?: string;
  stats?: Record<string, number>;
  warnings?: string[];
  transferId?: string;
  functionDiffs?: FunctionDiffView[];
}

export interface TransferJobStatus extends TransferProgress {
  done: boolean;
  result?: { success: boolean; stats?: Record<string, number>; warnings?: string[]; error?: string; functionDiffs?: FunctionDiffView[] };
}

// Transfer endpoints live on the Express sidecar (same as every other
// /api/* route), not on the frontend origin — which in dev is the Next
// server and in the packaged app is the webview. Neither routes
// /api/transfer/*, so window.location-based URLs can never reach them.

export async function startTransfer(
  request: TransferApiRequest,
  onProgress?: (progress: TransferProgress) => void
): Promise<TransferApiResponse> {
  try {
    const response = await fetch(`${API_BASE}/api/transfer/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const error = await response.text();
      return { success: false, error };
    }

    const result = await response.json();

    // If the server started a background job, poll until it completes so the
    // caller gets the real outcome (success + stats) instead of an
    // immediately-returned "started" ack.
    if (result.transferId) {
      const finalStatus = await pollTransferProgress(result.transferId, onProgress);
      if (finalStatus?.result) {
        return {
          success: finalStatus.result.success,
          stats: finalStatus.result.stats,
          warnings: finalStatus.result.warnings,
          error: finalStatus.result.error,
          transferId: result.transferId,
          functionDiffs: finalStatus.result.functionDiffs,
        };
      }
      return { success: false, error: "Transfer progress lost before completion", transferId: result.transferId };
    }

    return result;
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Transfer failed' 
    };
  }
}

export async function exportTransferPackage(
  request: TransferApiRequest,
): Promise<{ success: boolean; packageJson?: string; error?: string }> {
  try {
    const response = await fetch(`${API_BASE}/api/transfer/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const error = await response.text();
      return { success: false, error };
    }

    return await response.json();
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Export failed",
    };
  }
}

async function pollTransferProgress(
  transferId: string,
  onProgress?: (progress: TransferProgress) => void,
): Promise<TransferJobStatus | null> {
  const startedAt = Date.now();
  const timeoutMs = 30 * 60 * 1000; // 30 minutes for large transfers
  const intervalMs = 1000;

  for (;;) {
    try {
      const response = await fetch(`${API_BASE}/api/transfer/progress/${transferId}`);
      if (response.ok) {
        const status = (await response.json()) as TransferJobStatus;
        if (status && typeof status.percentage === "number") {
          try {
            onProgress?.(status);
          } catch {
            // ignore progress-callback errors
          }
        }
        if (status?.done) return status;
      }
    } catch (error) {
      console.error("Progress polling error:", error);
    }
    if (Date.now() - startedAt > timeoutMs) {
      console.error("Transfer progress polling timed out");
      return null;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}