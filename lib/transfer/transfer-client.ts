/**
 * Client-side transfer utilities
 * Calls server-side API endpoints for transfer operations
 */

import type { TransferOptions, TransferProgress, TransferStep } from "./transfer-types";
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
  // DEV-ONLY screen-recording mock (no UI changes). Arm from the devtools
  // console BEFORE clicking "Start transfer":
  //   window.__REXADB_MOCK_TRANSFER = { durationMs: 25000 }
  // Disarm with: delete window.__REXADB_MOCK_TRANSFER
  // (or use the window.__mockTransfer() / window.__mockTransferOff() helpers
  // registered below). Inert in production builds.
  const mockConfig = getMockTransferConfig();
  if (mockConfig) {
    return mockStartTransfer(request, onProgress, mockConfig);
  }
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
  if (getMockTransferConfig()) {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    return {
      success: true,
      packageJson: JSON.stringify(
        { mocked: true, exportedAt: new Date().toISOString(), version: "1" },
        null,
        2,
      ),
    };
  }
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

// ---------------------------------------------------------------------------
// DEV-ONLY mocked transfer for screen recordings.
// No UI changes: when armed, startTransfer() replays a realistic progress
// script through the normal onProgress callback and returns fake stats, so
// the wizard animates exactly like a real run. No network traffic, no DB
// writes. Inert in production builds.
// ---------------------------------------------------------------------------

export interface MockTransferConfig {
  /** Total simulated run time in ms. Default 30000. */
  durationMs?: number;
  /** Override the final stats shown on the complete screen. */
  stats?: Record<string, number>;
  /** Warnings shown on the complete screen. Default []. */
  warnings?: string[];
  /** Simulate a failure when this step is reached (for error-state footage). */
  failAtStep?: TransferStep;
  /** Error message for the simulated failure. */
  error?: string;
}

declare global {
  interface Window {
    __REXADB_MOCK_TRANSFER?: MockTransferConfig | true;
    __mockTransfer?: (config?: MockTransferConfig) => string;
    __mockTransferOff?: () => string;
    __mockTransferStatus?: () => unknown;
  }
}

function getMockTransferConfig(): MockTransferConfig | null {
  if (typeof window === "undefined") return null;
  // Belt and braces: the mock can only ever arm in development builds.
  if (process.env.NODE_ENV === "production") return null;
  const raw = window.__REXADB_MOCK_TRANSFER;
  if (!raw) return null;
  return raw === true ? {} : raw;
}

interface MockTick {
  step: TransferStep;
  message: string;
  item?: string;
}

function buildMockScript(request: TransferApiRequest): MockTick[] {
  const opts = request.options;
  const ticks: MockTick[] = [];
  const tables: Array<{ name: string; rows: number }> = [
    { name: "public.users", rows: 1240 },
    { name: "public.profiles", rows: 1188 },
    { name: "public.posts", rows: 5321 },
    { name: "public.comments", rows: 9874 },
    { name: "public.orders", rows: 2310 },
    { name: "public.order_items", rows: 4102 },
    { name: "public.products", rows: 486 },
    { name: "public.categories", rows: 24 },
    { name: "storage.buckets", rows: 3 },
    { name: "storage.objects", rows: 128 },
    { name: "auth.users", rows: 46 },
    { name: "auth.identities", rows: 59 },
  ];
  const buckets = [
    { name: "avatars", files: 52 },
    { name: "uploads", files: 61 },
    { name: "backups", files: 15 },
  ];

  ticks.push(
    { step: "validating", message: "Validating source connection…" },
    { step: "validating", message: "Validating destination connection…" },
    { step: "validating", message: "Connections validated" },
  );
  if (opts.includeDatabase) {
    ticks.push({ step: "exporting_schema", message: "Exporting database schema…" });
    for (const t of tables) {
      ticks.push({ step: "exporting_schema", message: `Found table ${t.name} (${t.rows.toLocaleString()} rows)`, item: t.name });
    }
    ticks.push({ step: "exporting_schema", message: `Schema exported (${tables.length} tables)` });
    ticks.push({ step: "importing_schema", message: "Importing database schema…" });
    for (const t of tables) {
      ticks.push({ step: "importing_schema", message: `Created table ${t.name}`, item: t.name });
    }
    ticks.push({ step: "importing_schema", message: "Schema imported" });
  }
  if (opts.includeStorage) {
    ticks.push({ step: "exporting_storage", message: "Exporting storage buckets…" });
    for (const b of buckets) {
      ticks.push({ step: "exporting_storage", message: `Exported bucket ${b.name} (${b.files} files)`, item: b.name });
    }
    ticks.push({ step: "importing_storage", message: "Importing storage buckets…" });
    for (const b of buckets) {
      ticks.push({ step: "importing_storage", message: `Uploaded ${b.files} files to ${b.name}`, item: b.name });
    }
    ticks.push({ step: "importing_storage", message: "Storage imported" });
  }
  if (opts.includeAuth) {
    ticks.push(
      { step: "exporting_auth", message: "Exporting auth users…" },
      { step: "exporting_auth", message: "Exported 46 users", item: "46 users" },
      { step: "exporting_auth", message: "Exported 2 OAuth providers", item: "OAuth providers" },
      { step: "importing_auth", message: "Importing auth users…" },
      { step: "importing_auth", message: "Imported 46 users", item: "46 users" },
      { step: "importing_auth", message: "Auth imported" },
    );
  }
  if (opts.includeSettings) {
    ticks.push(
      { step: "exporting_settings", message: "Exporting project settings…" },
      { step: "exporting_settings", message: "Settings exported" },
      { step: "importing_settings", message: "Importing project settings…" },
      { step: "importing_settings", message: "Settings imported" },
    );
  }
  // NOTE: no edge-function or finalizing ticks on purpose — the wizard's
  // displaySteps() doesn't render rows for those steps (runIndex would be
  // -1, i.e. visible dead air). Functions are still counted in final stats.
  return ticks;
}

function buildMockStats(request: TransferApiRequest): Record<string, number> {
  const opts = request.options;
  const tableRows = [1240, 1188, 5321, 9874, 2310, 4102, 486, 24, 3, 128, 46, 59];
  return {
    tablesTransferred: opts.includeDatabase ? 12 : 0,
    rowsTransferred: opts.includeDatabase ? tableRows.reduce((a, b) => a + b, 0) : 0,
    storageBucketsTransferred: opts.includeStorage ? 3 : 0,
    storageFilesTransferred: opts.includeStorage ? 128 : 0,
    authUsersTransferred: opts.includeAuth ? 46 : 0,
    authProvidersTransferred: opts.includeAuth ? 2 : 0,
    functionsTransferred: opts.includeEdgeFunctions ? 4 : 0,
  };
}

async function mockStartTransfer(
  request: TransferApiRequest,
  onProgress: ((progress: TransferProgress) => void) | undefined,
  config: MockTransferConfig,
): Promise<TransferApiResponse> {
  const script = buildMockScript(request);
  const durationMs = Math.max(0, config.durationMs ?? 30000);
  const perTickMs = script.length > 0 ? durationMs / (script.length + 1) : 0;

  // Step ordering mirrors the wizard's displaySteps() so the progress UI
  // (runIndex, badges, log groups) behaves exactly like a real run.
  const order: TransferStep[] = ["validating"];
  if (request.options.includeDatabase) order.push("exporting_schema", "importing_schema");
  if (request.options.includeStorage) order.push("exporting_storage", "importing_storage");
  if (request.options.includeAuth) order.push("exporting_auth", "importing_auth");
  if (request.options.includeSettings) order.push("exporting_settings", "importing_settings");
  order.push("complete");

  const totalSteps = order.length;
  for (let i = 0; i < script.length; i++) {
    const tick = script[i];
    if (config.failAtStep && tick.step === config.failAtStep) {
      const message = config.error ?? `Mocked failure at ${tick.step}`;
      try {
        onProgress?.({
          currentStep: tick.step,
          totalSteps,
          currentStepIndex: order.indexOf(tick.step),
          percentage: Math.round((i / (script.length + 1)) * 100),
          message,
          error: message,
        });
      } catch {
        // ignore progress-callback errors
      }
      await new Promise((resolve) => setTimeout(resolve, 800));
      return { success: false, error: message };
    }
    try {
      onProgress?.({
        currentStep: tick.step,
        totalSteps,
        currentStepIndex: order.indexOf(tick.step),
        percentage: Math.round((i / (script.length + 1)) * 100),
        message: tick.message,
        details: tick.item ? { item: tick.item } : undefined,
      });
    } catch {
      // ignore progress-callback errors
    }
    await new Promise((resolve) => setTimeout(resolve, perTickMs));
  }

  try {
    onProgress?.({
      currentStep: "complete",
      totalSteps,
      currentStepIndex: totalSteps - 1,
      percentage: 100,
      message: "Transfer complete",
    });
  } catch {
    // ignore progress-callback errors
  }
  await new Promise((resolve) => setTimeout(resolve, Math.min(600, perTickMs)));

  return {
    success: true,
    stats: config.stats ?? buildMockStats(request),
    warnings: config.warnings ?? [],
  };
}

if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
  window.__mockTransfer = (config: MockTransferConfig = {}) => {
    window.__REXADB_MOCK_TRANSFER = { durationMs: 30000, ...config };
    return "Mocked transfers ARMED (dev only, no UI changes). Open Transfer, pick source + destination, Start transfer. Disarm with __mockTransferOff().";
  };
  window.__mockTransferOff = () => {
    delete window.__REXADB_MOCK_TRANSFER;
    return "Mocked transfers OFF — real transfers restored.";
  };
  window.__mockTransferStatus = () => window.__REXADB_MOCK_TRANSFER ?? "off (real transfers)";
}