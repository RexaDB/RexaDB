/**
 * Main transfer service for migrating projects between database providers
 * Handles orchestration of database, storage, auth, and settings transfers
 * Server-side only due to Node.js dependencies
 *
 * Effect APIs (`*Effect`) are preferred for the sidecar. Promise methods
 * remain as facades for dual-use callers and existing tests.
 */

import { Effect } from "effect";
import type {
  TransferSource,
  TransferDestination,
  TransferOptions,
  TransferProgress,
  TransferPackage,
  TransferResult,
  TransferStats,
  ProviderAdapter,
  TransferStep,
} from "./transfer-types";
import { TransferAdapterError, TransferFailedError } from "./errors";

const TRANSFER_VERSION = "1.0.0";

function toTransferFailed(cause: unknown, fallback: string): TransferFailedError {
  return new TransferFailedError({
    message: cause instanceof Error ? cause.message : fallback,
    cause,
  });
}

export class TransferService {
  private adapters: Map<string, ProviderAdapter> = new Map();
  
  constructor() {
    // Adapters will be registered dynamically to avoid client-side imports
  }
  
  registerAdapter(adapter: ProviderAdapter): void {
    this.adapters.set(adapter.type, adapter);
  }
  
  getAdapter(type: string): ProviderAdapter | undefined {
    return this.adapters.get(type);
  }
  
  /**
   * Transfer a complete project from source to destination (Effect).
   * Expected failures (missing adapter, validation) stay in TransferResult
   * (`success: false`) to match the existing HTTP/UI contract.
   */
  transferProjectEffect(
    source: TransferSource,
    destination: TransferDestination,
    options: TransferOptions,
  ): Effect.Effect<TransferResult, never> {
    const self = this;
    return Effect.gen(function* () {
      const sourceAdapter = self.getAdapter(source.provider);
      const destAdapter = self.getAdapter(destination.provider);

      if (!sourceAdapter) {
        return {
          success: false,
          error: `No adapter found for source provider: ${source.provider}`,
        } satisfies TransferResult;
      }

      if (!destAdapter) {
        return {
          success: false,
          error: `No adapter found for destination provider: ${destination.provider}`,
        } satisfies TransferResult;
      }

      const steps = self.buildTransferSteps(options);
      const totalSteps = steps.length;

      return yield* Effect.gen(function* () {
        yield* Effect.tryPromise({
          try: () =>
            self.updateProgress(options, {
              currentStep: "validating",
              totalSteps,
              currentStepIndex: 0,
              percentage: 0,
              message: "Validating source connection...",
            }),
          catch: (cause) => toTransferFailed(cause, "Progress update failed"),
        });

        const sourceValid = yield* Effect.tryPromise({
          try: () => sourceAdapter.validateConnection(source.connectionString),
          catch: (cause) =>
            toTransferFailed(cause, "Source connection validation failed"),
        });
        if (!sourceValid) {
          return {
            success: false,
            error: "Source connection validation failed",
          } satisfies TransferResult;
        }

        yield* Effect.tryPromise({
          try: () =>
            self.updateProgress(options, {
              currentStep: "validating",
              totalSteps,
              currentStepIndex: 0,
              percentage: 5,
              message: "Validating destination connection...",
            }),
          catch: (cause) => toTransferFailed(cause, "Progress update failed"),
        });

        const destValid = yield* Effect.tryPromise({
          try: () =>
            destAdapter.validateConnection(destination.connectionString),
          catch: (cause) =>
            toTransferFailed(cause, "Destination connection validation failed"),
        });
        if (!destValid) {
          return {
            success: false,
            error: "Destination connection validation failed",
          } satisfies TransferResult;
        }

        const package_ = yield* Effect.tryPromise({
          try: () =>
            self.exportFromSource(
              sourceAdapter,
              source,
              options,
              steps,
              totalSteps,
            ),
          catch: (cause) => toTransferFailed(cause, "Export from source failed"),
        });

        const { warnings: importWarnings, stats: importStats } =
          yield* Effect.tryPromise({
            try: () =>
              self.importToDestination(
                destAdapter,
                destination,
                package_,
                options,
                steps,
                totalSteps,
              ),
            catch: (cause) =>
              toTransferFailed(cause, "Import to destination failed"),
          });

        // Completion counts reflect IMPORT outcomes, not exports: import
        // stats override the export-based numbers so skipped/failed items
        // are never displayed as transferred.
        const stats = { ...self.calculateStats(package_), ...importStats };
        const warnings = TransferService.collapseWarnings([
          ...self.collectWarnings(package_),
          ...importWarnings,
        ]);

        yield* Effect.tryPromise({
          try: () =>
            self.updateProgress(options, {
              currentStep: "complete",
              totalSteps,
              currentStepIndex: totalSteps - 1,
              percentage: 100,
              message: "Transfer completed successfully",
              details: stats,
            }),
          catch: (cause) => toTransferFailed(cause, "Progress update failed"),
        });

        return {
          success: true,
          package: package_,
          stats,
          warnings: warnings.length > 0 ? warnings : undefined,
        } satisfies TransferResult;
      }).pipe(
        Effect.catch((error) =>
          Effect.gen(function* () {
            const errorMessage =
              error &&
              typeof error === "object" &&
              "message" in error &&
              typeof (error as { message: unknown }).message === "string"
                ? (error as { message: string }).message
                : String(error);
            yield* Effect.promise(async () => {
              try {
                await self.updateProgress(options, {
                  currentStep: steps[steps.length - 1],
                  totalSteps,
                  currentStepIndex: steps.length - 1,
                  percentage: 0,
                  message: "Transfer failed",
                  error: errorMessage,
                });
              } catch {
                // Ignore progress callback failures on the error path.
              }
            });
            return {
              success: false,
              error: errorMessage,
            } satisfies TransferResult;
          }),
        ),
      );
    });
  }

  /**
   * Transfer a complete project from source to destination (Promise facade).
   */
  async transferProject(
    source: TransferSource,
    destination: TransferDestination,
    options: TransferOptions,
  ): Promise<TransferResult> {
    return Effect.runPromise(
      this.transferProjectEffect(source, destination, options),
    );
  }
  
  /**
   * Export all data from source provider
   */
  private async exportFromSource(
    adapter: ProviderAdapter,
    source: TransferSource,
    options: TransferOptions,
    steps: TransferStep[],
    totalSteps: number
  ): Promise<TransferPackage> {
    const package_: TransferPackage = {
      version: TRANSFER_VERSION,
      exportedAt: new Date().toISOString(),
      sourceProvider: source.provider,
      sourceProjectId: source.projectId,
    };
    
    let stepIndex = 1;

    // Database
    if (options.includeDatabase) {
      await this.updateProgress(options, {
        currentStep: "exporting_schema",
        totalSteps,
        currentStepIndex: stepIndex,
        percentage: Math.round((stepIndex / totalSteps) * 100),
        message: "Phase 1 of 2 — exporting database schema...",
      });

      package_.database = await adapter.exportDatabase(
        source.connectionString,
        this.withItemReporting(options, "exporting_schema", stepIndex, totalSteps, "Phase 1 of 2 — exporting database"),
      );
      stepIndex++;
    }
    
    // Export storage
    if (options.includeStorage && adapter.exportStorage) {
      await this.updateProgress(options, {
        currentStep: "exporting_storage",
        totalSteps,
        currentStepIndex: stepIndex,
        percentage: Math.round((stepIndex / totalSteps) * 100),
        message: "Phase 1 of 2 — exporting storage buckets and files...",
      });
      
      package_.storage = await adapter.exportStorage(source.connectionString, options);
      stepIndex++;
    }
    
    // Export auth
    if (options.includeAuth && adapter.exportAuth) {
      await this.updateProgress(options, {
        currentStep: "exporting_auth",
        totalSteps,
        currentStepIndex: stepIndex,
        percentage: Math.round((stepIndex / totalSteps) * 100),
        message: "Phase 1 of 2 — exporting authentication data...",
      });
      
      package_.auth = await adapter.exportAuth(source.connectionString, options);
      stepIndex++;
    }
    
    // Export settings
    if (options.includeSettings && adapter.exportSettings) {
      await this.updateProgress(options, {
        currentStep: "exporting_settings",
        totalSteps,
        currentStepIndex: stepIndex,
        percentage: Math.round((stepIndex / totalSteps) * 100),
        message: "Phase 1 of 2 — exporting project settings...",
      });

      package_.settings = await adapter.exportSettings(source.connectionString, options);
      stepIndex++;
    }

    // Export edge functions
    if (options.includeEdgeFunctions && adapter.exportFunctions) {
      await this.updateProgress(options, {
        currentStep: "exporting_functions",
        totalSteps,
        currentStepIndex: stepIndex,
        percentage: Math.round((stepIndex / totalSteps) * 100),
        message: "Phase 1 of 2 — exporting edge functions...",
      });

      package_.functions = await adapter.exportFunctions(source.connectionString, options);
      stepIndex++;
    }

    return package_;
  }
  
  /**
   * Import all data to destination provider. Returns user-visible warnings
   * plus the ACTUAL import counts, which override export-based stats —
   * skipped or failed items are never displayed as transferred.
   */
  private async importToDestination(
    adapter: ProviderAdapter,
    destination: TransferDestination,
    package_: TransferPackage,
    options: TransferOptions,
    steps: TransferStep[],
    totalSteps: number
  ): Promise<{ warnings: string[]; stats: Partial<TransferStats> }> {
    const warnings: string[] = [];
    const stats: Partial<TransferStats> = {};
    let stepIndex = Math.floor(totalSteps / 2); // Start from middle for import steps

    // Import database
    if (package_.database && options.includeDatabase) {
      await this.updateProgress(options, {
        currentStep: "importing_schema",
        totalSteps,
        currentStepIndex: stepIndex,
        percentage: Math.round((stepIndex / totalSteps) * 100),
        message: "Phase 2 of 2 — importing database schema...",
      });

      // Database import is transactional (resetAndApplySql): structural or
      // security-critical failures throw and roll back. Individual bad rows
      // degrade to warnings with honest counts — adapters report
      // stats.rowsTransferred (export total minus skipped rows), which
      // override the export-based completion counts below.
      const outcome = await adapter.importDatabase(
        destination.connectionString,
        package_.database,
        this.withImportReporting(options, stepIndex, totalSteps),
      );
      if (outcome?.warnings) warnings.push(...outcome.warnings);
      if (outcome?.stats) Object.assign(stats, outcome.stats);
      stepIndex++;
    }

    // Import storage
    if (package_.storage && options.includeStorage) {
      const bucketCount = package_.storage.buckets.length;
      const fileCount = package_.storage.files.length;
      if (adapter.importStorage) {
        await this.updateProgress(options, {
          currentStep: "importing_storage",
          totalSteps,
          currentStepIndex: stepIndex,
          percentage: Math.round((stepIndex / totalSteps) * 100),
          message: "Phase 2 of 2 — importing storage buckets and files...",
        });

        const outcome = await adapter.importStorage(destination.connectionString, package_.storage, options);
        if (outcome?.warnings) warnings.push(...outcome.warnings);
        if (outcome?.stats) Object.assign(stats, outcome.stats);
        stepIndex++;
      } else if (bucketCount > 0 || fileCount > 0) {
        warnings.push(
          `Storage not transferred: ${bucketCount} bucket(s) and ${fileCount} file(s) were exported, but the ${destination.provider} destination has no Supabase-compatible storage schema — they were skipped, not imported. Ordinary tables migrate with the database transfer.`,
        );
        stats.storageBucketsTransferred = 0;
        stats.storageFilesTransferred = 0;
      }
    }

    // Import auth
    if (package_.auth && options.includeAuth) {
      const userCount = package_.auth.users.length;
      const providerCount = package_.auth.providers.length;
      if (adapter.importAuth) {
        await this.updateProgress(options, {
          currentStep: "importing_auth",
          totalSteps,
          currentStepIndex: stepIndex,
          percentage: Math.round((stepIndex / totalSteps) * 100),
          message: "Phase 2 of 2 — importing authentication data...",
        });

        const outcome = await adapter.importAuth(destination.connectionString, package_.auth, options);
        if (outcome?.warnings) warnings.push(...outcome.warnings);
        if (outcome?.stats) Object.assign(stats, outcome.stats);
        stepIndex++;
      } else if (userCount > 0 || providerCount > 0) {
        warnings.push(
          `Auth not transferred: ${userCount} user(s) and ${providerCount} provider(s) were exported, but the ${destination.provider} destination has no GoTrue-compatible auth schema — they were skipped, not imported. Neon Auth lives in neon_auth tables and migrates with the database transfer.`,
        );
        stats.authUsersTransferred = 0;
        stats.authProvidersTransferred = 0;
      }
    }

    // Import settings
    if (package_.settings && options.includeSettings) {
      if (adapter.importSettings) {
        await this.updateProgress(options, {
          currentStep: "importing_settings",
          totalSteps,
          currentStepIndex: stepIndex,
          percentage: Math.round((stepIndex / totalSteps) * 100),
          message: "Phase 2 of 2 — importing project settings...",
        });

        const outcome = await adapter.importSettings(destination.connectionString, package_.settings, options);
        if (outcome?.warnings) warnings.push(...outcome.warnings);
        if (outcome?.stats) Object.assign(stats, outcome.stats);
        stepIndex++;
      } else {
        warnings.push(
          `Settings not transferred: the ${destination.provider} destination has no settings import support.`,
        );
      }
    }

    // Import edge functions
    if (package_.functions && options.includeEdgeFunctions) {
      const fnCount = package_.functions.functions.length;
      if (adapter.importFunctions) {
        await this.updateProgress(options, {
          currentStep: "importing_functions",
          totalSteps,
          currentStepIndex: stepIndex,
          percentage: Math.round((stepIndex / totalSteps) * 100),
          message: "Phase 2 of 2 — importing edge functions...",
        });

        const outcome = await adapter.importFunctions(destination.connectionString, package_.functions, options);
        if (outcome?.warnings) warnings.push(...outcome.warnings);
        if (outcome?.stats) Object.assign(stats, outcome.stats);
        stepIndex++;
      } else if (fnCount > 0) {
        warnings.push(
          `Edge functions not transferred: ${fnCount} function(s) exported, but the ${destination.provider} destination has no functions import support — sources preserved in the package; deploy manually.`,
        );
        stats.functionsTransferred = 0;
      }
    }

    return { warnings, stats };
  }
  
  /**
   * Build the list of transfer steps based on options
   */
  private buildTransferSteps(options: TransferOptions): TransferStep[] {
    const steps: TransferStep[] = ["validating"];

    if (options.includeDatabase) {
      steps.push("exporting_schema", "exporting_data", "importing_schema", "importing_data");
    }

    if (options.includeStorage) {
      steps.push("exporting_storage", "importing_storage");
    }

    if (options.includeAuth) {
      steps.push("exporting_auth", "importing_auth");
    }

    if (options.includeSettings) {
      steps.push("exporting_settings", "importing_settings");
    }

    if (options.includeEdgeFunctions) {
      steps.push("exporting_functions", "importing_functions");
    }

    steps.push("finalizing", "complete");
    return steps;
  }
  
  /**
   * Wrap options so per-item reports (per table, per chunk) surface as
   * progress details: "what's running right now" for long phases.
   */
  private withItemReporting(    options: TransferOptions,
    step: TransferStep,
    stepIndex: number,
    totalSteps: number,
    message: string,
  ): TransferOptions {
    return {
      ...options,
      onItem: (info) => {
        void this.updateProgress(options, {
          currentStep: step,
          totalSteps,
          currentStepIndex: stepIndex,
          percentage: Math.round((stepIndex / totalSteps) * 100),
          message: `${message} — ${info.item}${info.itemTotal > 1 ? ` (${info.itemIndex}/${info.itemTotal})` : ""}`,
          details: { item: info.item, itemIndex: info.itemIndex, itemTotal: info.itemTotal },
        });
      },
    };
  }

  /**
   * Wrap import options so per-item reports (schema statement, data
   * chunk) surface as progress details, keeping the reporter's own step
   * (schema vs data) instead of the phase default.
   */
  private withImportReporting(
    options: TransferOptions,
    stepIndex: number,
    totalSteps: number,
  ): TransferOptions {
    return {
      ...options,
      onItem: (info) => {
        void this.updateProgress(options, {
          currentStep: info.step,
          totalSteps,
          currentStepIndex: stepIndex,
          percentage: Math.round((stepIndex / totalSteps) * 100),
          message: `Phase 2 of 2 — ${info.item}${info.itemTotal > 1 ? ` (${info.itemIndex}/${info.itemTotal})` : ""}`,
          details: { item: info.item, itemIndex: info.itemIndex, itemTotal: info.itemTotal },
        });
      },
    };
  }

  /**
   * Calculate transfer statistics from rows actually exported — never from
   * source row counts, which would claim rows that were skipped or failed.
   */
  private calculateStats(package_: TransferPackage) {
    const exported = package_.database?.exportedRowCounts;
    const counts = exported ?? package_.database?.rowCounts;
    return {
      tablesTransferred: package_.database?.tables.length || 0,
      rowsTransferred: Object.values(counts || {}).reduce((a, b) => a + b, 0),
      storageBucketsTransferred: package_.storage?.buckets.length || 0,
      storageFilesTransferred: package_.storage?.files.length || 0,
      authUsersTransferred: package_.auth?.users.length || 0,
      authProvidersTransferred: package_.auth?.providers.length || 0,
      functionsTransferred: package_.functions?.functions.length || 0,
    };
  }

  /**
   * Collapse repetitive warnings (per-row skips, per-table notes) so the
   * completion screen stays readable: identical-shape messages group with
   * a ×N suffix, order of first appearance preserved, capped with overflow.
   */
  static collapseWarnings(warnings: string[]): string[] {
    const keyOf = (w: string) =>
      w
        .replace(/'[^']*'/g, "'$'")
        .replace(/"[^"]*"/g, '"$"')
        .replace(/\b\d[\d,]*(?:\.\d+)?\b/g, "#");
    const groups = new Map<string, { sample: string; count: number }>();
    for (const w of warnings) {
      const key = keyOf(w);
      const g = groups.get(key);
      if (g) g.count++;
      else groups.set(key, { sample: w, count: 1 });
    }
    const out: string[] = [];
    for (const { sample, count } of groups.values()) {
      out.push(count > 1 ? `${sample} (×${count})` : sample);
      if (out.length >= 25) break;
    }
    const shown = [...groups.values()].slice(0, 25).reduce((a, g) => a + g.count, 0);
    if (shown < warnings.length) {
      out.push(`+${warnings.length - shown} more — see server log.`);
    }
    return out;
  }
  /** Non-fatal export notes from every package section. */
  private collectWarnings(package_: TransferPackage): string[] {
    const warnings: string[] = [];
    if (package_.database?.warnings) warnings.push(...package_.database.warnings);
    if (package_.storage?.warnings) warnings.push(...package_.storage.warnings);
    if (package_.auth?.warnings) warnings.push(...package_.auth.warnings);
    if (package_.functions?.warnings) warnings.push(...package_.functions.warnings);
    return warnings;
  }
  
  /**
   * Update progress callback if provided
   */
  private async updateProgress(options: TransferOptions, progress: TransferProgress): Promise<void> {
    if (options.onProgress) {
      try {
        await Promise.resolve(options.onProgress(progress));
      } catch (error) {
        console.error("Progress callback error:", error);
      }
    }
  }
  
  /**
   * Export a transfer package to JSON for manual transfer (Effect).
   */
  exportPackageEffect(
    source: TransferSource,
    options: TransferOptions,
  ): Effect.Effect<string, TransferAdapterError | TransferFailedError> {
    const self = this;
    return Effect.gen(function* () {
      const adapter = self.getAdapter(source.provider);
      if (!adapter) {
        return yield* Effect.fail(
          new TransferAdapterError({
            message: `No adapter found for provider: ${source.provider}`,
            provider: source.provider,
          }),
        );
      }

      const steps = self.buildTransferSteps(options);
      const package_ = yield* Effect.tryPromise({
        try: () =>
          self.exportFromSource(adapter, source, options, steps, steps.length),
        catch: (cause) => toTransferFailed(cause, "Export package failed"),
      });

      return JSON.stringify(package_, null, 2);
    });
  }

  /**
   * Export a transfer package to JSON for manual transfer (Promise facade).
   */
  async exportPackage(
    source: TransferSource,
    options: TransferOptions,
  ): Promise<string> {
    return Effect.runPromise(this.exportPackageEffect(source, options));
  }

  /**
   * Import a transfer package from JSON (Effect).
   */
  importPackageEffect(
    destination: TransferDestination,
    packageJson: string,
    options: TransferOptions,
  ): Effect.Effect<void, TransferAdapterError | TransferFailedError> {
    const self = this;
    return Effect.gen(function* () {
      const adapter = self.getAdapter(destination.provider);
      if (!adapter) {
        return yield* Effect.fail(
          new TransferAdapterError({
            message: `No adapter found for provider: ${destination.provider}`,
            provider: destination.provider,
          }),
        );
      }

      const package_ = yield* Effect.try({
        try: () => JSON.parse(packageJson) as TransferPackage,
        catch: (cause) =>
          toTransferFailed(cause, "Invalid transfer package JSON"),
      });

      if (package_.version !== TRANSFER_VERSION) {
        console.warn(
          `Package version ${package_.version} differs from expected ${TRANSFER_VERSION}`,
        );
      }

      const steps = self.buildTransferSteps(options);
      yield* Effect.tryPromise({
        try: () =>
          self.importToDestination(
            adapter,
            destination,
            package_,
            options,
            steps,
            steps.length,
          ),
        catch: (cause) => toTransferFailed(cause, "Import package failed"),
      });
    });
  }

  /**
   * Import a transfer package from JSON (Promise facade).
   */
  async importPackage(
    destination: TransferDestination,
    packageJson: string,
    options: TransferOptions,
  ): Promise<void> {
    return Effect.runPromise(
      this.importPackageEffect(destination, packageJson, options),
    );
  }
}

async function tryRegisterAdapter(
  service: TransferService,
  label: string,
  load: () => Promise<ProviderAdapter>,
): Promise<void> {
  try {
    service.registerAdapter(await load());
  } catch (error) {
    console.warn(`Failed to load ${label} adapter:`, error);
  }
}

/**
 * Create a TransferService with provider adapters registered (Effect).
 * Adapter load failures are logged and skipped (same as the Promise factory).
 */
export const createTransferServiceEffect = (): Effect.Effect<
  TransferService,
  never
> =>
  Effect.gen(function* () {
    const service = new TransferService();

    if (typeof process !== "undefined" && process.versions?.node) {
      yield* Effect.promise(() =>
        tryRegisterAdapter(service, "Supabase", async () => {
          const { SupabaseAdapter } = await import("./adapters/supabase-adapter");
          return new SupabaseAdapter();
        }),
      );
      yield* Effect.promise(() =>
        tryRegisterAdapter(service, "Neon", async () => {
          const { NeonAdapter } = await import("./adapters/neon-adapter");
          return new NeonAdapter();
        }),
      );
      yield* Effect.promise(() =>
        tryRegisterAdapter(service, "Postgres", async () => {
          const { PostgresAdapter } = await import("./adapters/postgres-adapter");
          return new PostgresAdapter();
        }),
      );
    }

    return service;
  });

/** Promise facade for createTransferServiceEffect. */
export async function createTransferService(): Promise<TransferService> {
  return Effect.runPromise(createTransferServiceEffect());
}
