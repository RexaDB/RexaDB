/**
 * Server-side API handlers for transfer operations.
 * Runs real provider-to-provider transfers in the background with
 * pollable progress (see TransferService.transferProject).
 */

import { createTransferService } from "@/lib/transfer/transfer-service";
// Side-effect import: registers the server query implementation for
// dual-use modules (storage-utils, auth/fetch). Server-only file — safe.
import "@/lib/transfer/transfer-server-query";
import type {
  TransferApiRequest,
  TransferApiResponse,
  TransferJobStatus,
} from "@/lib/transfer/transfer-client";
import type { TransferProgress } from "@/lib/transfer/transfer-types";

type TransferJob = {
  progress: TransferProgress;
  done: boolean;
  result?: {
    success: boolean;
    stats?: Record<string, number>;
    warnings?: string[];
    error?: string;
    functionDiffs?: Array<{ slug: string; targetProvider: string; diff: string; notes: string[] }>;
  };
  updatedAt: number;
};

const jobs = new Map<string, TransferJob>();

/**
 * One running transfer per destination connection. Two concurrent imports
 * into the same database interleave drops/creates and collide mid-flight
 * ("relation already exists", half-written schemas). The second starter
 * gets a clear rejection instead of a corrupted destination.
 */
const activeByDestination = new Map<string, string>();

export function getActiveTransferIdForDestination(destinationConnectionString: string): string | undefined {
  const id = activeByDestination.get(destinationConnectionString);
  return id && !jobs.get(id)?.done ? id : undefined;
}

const JOB_TTL_MS = 60 * 60 * 1000; // keep finished jobs for an hour

function touch(job: TransferJob): void {
  job.updatedAt = Date.now();
}

function pruneJobs(): void {
  const cutoff = Date.now() - JOB_TTL_MS;
  for (const [id, job] of jobs) {
    if (job.done && job.updatedAt < cutoff) jobs.delete(id);
  }
  for (const [dest, id] of activeByDestination) {
    if (jobs.get(id)?.done) activeByDestination.delete(dest);
  }
}

function newTransferId(): string {
  return `transfer_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

export async function handleTransferStart(request: TransferApiRequest): Promise<TransferApiResponse> {
  pruneJobs();
  const clash = getActiveTransferIdForDestination(request.destinationConnectionString);
  if (clash) {
    return {
      success: false,
      error: `Another transfer to this destination is already running (${clash}). Wait for it to finish before starting a new one — concurrent imports would corrupt the destination.`,
    };
  }
  try {
    const transferId = newTransferId();

    const job: TransferJob = {
      progress: {
        currentStep: "validating",
        totalSteps: 1,
        currentStepIndex: 0,
        percentage: 0,
        message: "Starting transfer...",
      },
      done: false,
      updatedAt: Date.now(),
    };
    jobs.set(transferId, job);
    activeByDestination.set(request.destinationConnectionString, transferId);

    // Run in the background; the client polls /progress/:transferId.
    void executeTransfer(transferId, request);

    return { success: true, transferId };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Transfer failed to start",
    };
  }
}

async function executeTransfer(transferId: string, request: TransferApiRequest): Promise<void> {
  const job = jobs.get(transferId);
  if (!job) return;
  try {
    const service = await createTransferService();
    const result = await service.transferProject(
      {
        provider: request.sourceProvider as "supabase" | "neon" | "postgres" | "generic",
        connectionString: request.sourceConnectionString,
      },
      {
        provider: request.destinationProvider as "supabase" | "neon" | "postgres" | "generic",
        connectionString: request.destinationConnectionString,
      },
      {
        ...request.options,
        onProgress: (progress) => {
          job.progress = progress;
          touch(job);
        },
      },
    );
    job.result = {
      success: result.success,
      stats: result.stats as Record<string, number> | undefined,
      warnings: result.warnings,
      error: result.error,
      // Compat diffs for the UI (truncated per diff so polling stays light).
      functionDiffs: result.package?.functions?.functions.flatMap((fn) =>
        fn.diffs.map((d) => ({
          slug: fn.slug,
          targetProvider: d.targetProvider,
          diff: d.diff.length > 6000 ? `${d.diff.slice(0, 6000)}\n… (truncated — full diff in exported package)` : d.diff,
          notes: d.notes,
        })),
      ),
    };
    if (result.success) {
      job.progress = {
        currentStep: "complete",
        totalSteps: job.progress.totalSteps,
        currentStepIndex: job.progress.totalSteps - 1,
        percentage: 100,
        message: "Transfer completed successfully",
        details: result.stats as Record<string, unknown> | undefined,
      };
    } else if (!job.progress.error) {
      job.progress = { ...job.progress, error: result.error ?? "Transfer failed" };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Transfer ${transferId} failed:`, error);
    job.result = { success: false, error: message };
    job.progress = { ...job.progress, error: message };
  } finally {
    job.done = true;
    touch(job);
    if (activeByDestination.get(request.destinationConnectionString) === transferId) {
      activeByDestination.delete(request.destinationConnectionString);
    }
  }
}

export async function handleTransferProgress(transferId: string): Promise<TransferJobStatus> {
  const job = jobs.get(transferId);
  if (!job) {
    return {
      currentStep: "validating",
      totalSteps: 1,
      currentStepIndex: 0,
      percentage: 0,
      message: "Unknown transfer",
      error: `No transfer found for id ${transferId}`,
      done: true,
      result: { success: false, error: `No transfer found for id ${transferId}` },
    };
  }
  return { ...job.progress, done: job.done, result: job.result };
}

export async function handleTransferExport(
  request: TransferApiRequest,
): Promise<{ success: boolean; packageJson?: string; error?: string }> {
  try {
    const service = await createTransferService();
    const packageJson = await service.exportPackage(
      {
        provider: request.sourceProvider as "supabase" | "neon" | "postgres" | "generic",
        connectionString: request.sourceConnectionString,
      },
      request.options,
    );
    return { success: true, packageJson };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Export failed",
    };
  }
}
