/**
 * Server-side API handlers for transfer operations.
 * Runs real provider-to-provider transfers in the background with
 * pollable progress (see TransferService.transferProject).
 *
 * Effect APIs are primary for the sidecar; Promise facades keep call sites
 * that still await the older helpers working during the migration.
 */

import { Effect } from "effect";
import {
  createTransferServiceEffect,
  TransferService,
} from "@/lib/transfer/transfer-service";
// Side-effect import: registers the server query implementation for
// dual-use modules (storage-utils, auth/fetch). Server-only file — safe.
import "@/lib/transfer/transfer-server-query";
import type {
  TransferApiRequest,
  TransferApiResponse,
  TransferJobStatus,
} from "@/lib/transfer/transfer-client";
import type { TransferProgress } from "@/lib/transfer/transfer-types";
import { messageForError } from "./effect/errors";

type TransferServiceFactory = () => Effect.Effect<TransferService, never>;

let transferServiceFactory: TransferServiceFactory = createTransferServiceEffect;

type TransferJob = {
  progress: TransferProgress;
  done: boolean;
  result?: {
    success: boolean;
    stats?: Record<string, number>;
    warnings?: string[];
    error?: string;
    functionDiffs?: Array<{
      slug: string;
      targetProvider: string;
      diff: string;
      notes: string[];
    }>;
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

/**
 * Test-only: inject a TransferService factory (e.g. stub adapters) so job
 * lifecycle tests do not hit real databases. Pass `null` to restore default.
 */
export function setTransferServiceFactoryForTests(
  factory: TransferServiceFactory | null,
): void {
  transferServiceFactory = factory ?? createTransferServiceEffect;
}

/** Test-only: clear in-memory jobs and destination locks between cases. */
export function resetTransferJobsForTests(): void {
  jobs.clear();
  activeByDestination.clear();
}

export function getActiveTransferIdForDestination(
  destinationConnectionString: string,
): string | undefined {
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

/**
 * Start a transfer. Clash / start failures are returned in the success
 * envelope (`success: false`) to match the existing HTTP contract.
 */
export const handleTransferStartEffect = (
  request: TransferApiRequest,
): Effect.Effect<TransferApiResponse, never> =>
  Effect.sync(() => {
    pruneJobs();
    const clash = getActiveTransferIdForDestination(
      request.destinationConnectionString,
    );
    if (clash) {
      return {
        success: false,
        error: `Another transfer to this destination is already running (${clash}). Wait for it to finish before starting a new one — concurrent imports would corrupt the destination.`,
      } satisfies TransferApiResponse;
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

      // Background fiber; the client polls /progress/:transferId.
      Effect.runFork(executeTransferEffect(transferId, request));

      return { success: true, transferId } satisfies TransferApiResponse;
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Transfer failed to start",
      } satisfies TransferApiResponse;
    }
  });

export async function handleTransferStart(
  request: TransferApiRequest,
): Promise<TransferApiResponse> {
  return Effect.runPromise(handleTransferStartEffect(request));
}

const executeTransferEffect = (
  transferId: string,
  request: TransferApiRequest,
): Effect.Effect<void, never> =>
  Effect.gen(function* () {
    const job = jobs.get(transferId);
    if (!job) return;

    yield* Effect.gen(function* () {
      const service = yield* transferServiceFactory();
      const result = yield* service.transferProjectEffect(
        {
          provider: request.sourceProvider as
            | "supabase"
            | "neon"
            | "postgres"
            | "generic",
          connectionString: request.sourceConnectionString,
        },
        {
          provider: request.destinationProvider as
            | "supabase"
            | "neon"
            | "postgres"
            | "generic",
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
            diff:
              d.diff.length > 6000
                ? `${d.diff.slice(0, 6000)}\n… (truncated — full diff in exported package)`
                : d.diff,
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
        job.progress = {
          ...job.progress,
          error: result.error ?? "Transfer failed",
        };
      }
    }).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          const message = messageForError(error);
          console.error(`Transfer ${transferId} failed:`, error);
          job.result = { success: false, error: message };
          job.progress = { ...job.progress, error: message };
        }),
      ),
    );
  }).pipe(
    Effect.ensuring(
      Effect.sync(() => {
        const job = jobs.get(transferId);
        if (!job) return;
        job.done = true;
        touch(job);
        if (
          activeByDestination.get(request.destinationConnectionString) ===
          transferId
        ) {
          activeByDestination.delete(request.destinationConnectionString);
        }
      }),
    ),
  );

export const handleTransferProgressEffect = (
  transferId: string,
): Effect.Effect<TransferJobStatus, never> =>
  Effect.sync(() => {
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
        result: {
          success: false,
          error: `No transfer found for id ${transferId}`,
        },
      } satisfies TransferJobStatus;
    }
    return { ...job.progress, done: job.done, result: job.result };
  });

export async function handleTransferProgress(
  transferId: string,
): Promise<TransferJobStatus> {
  return Effect.runPromise(handleTransferProgressEffect(transferId));
}

export const handleTransferExportEffect = (
  request: TransferApiRequest,
): Effect.Effect<
  { success: boolean; packageJson?: string; error?: string },
  never
> =>
  Effect.gen(function* () {
    const service = yield* transferServiceFactory();
    const packageJson = yield* service.exportPackageEffect(
      {
        provider: request.sourceProvider as
          | "supabase"
          | "neon"
          | "postgres"
          | "generic",
        connectionString: request.sourceConnectionString,
      },
      request.options,
    );
    return { success: true as const, packageJson };
  }).pipe(
    Effect.catch((error) =>
      Effect.succeed({
        success: false as const,
        error: messageForError(error),
      }),
    ),
  );

export async function handleTransferExport(
  request: TransferApiRequest,
): Promise<{ success: boolean; packageJson?: string; error?: string }> {
  return Effect.runPromise(handleTransferExportEffect(request));
}
