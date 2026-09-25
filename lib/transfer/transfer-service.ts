/**
 * Main transfer service for migrating projects between database providers
 * Handles orchestration of database, storage, auth, and settings transfers
 * Server-side only due to Node.js dependencies
 */

import type {
  TransferSource,
  TransferDestination,
  TransferOptions,
  TransferProgress,
  TransferPackage,
  TransferResult,
  ProviderAdapter,
  TransferStep,
} from "./transfer-types";

const TRANSFER_VERSION = "1.0.0";

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
   * Transfer a complete project from source to destination
   */
  async transferProject(
    source: TransferSource,
    destination: TransferDestination,
    options: TransferOptions
  ): Promise<TransferResult> {
    const sourceAdapter = this.getAdapter(source.provider);
    const destAdapter = this.getAdapter(destination.provider);
    
    if (!sourceAdapter) {
      return { success: false, error: `No adapter found for source provider: ${source.provider}` };
    }
    
    if (!destAdapter) {
      return { success: false, error: `No adapter found for destination provider: ${destination.provider}` };
    }
    
    const steps = this.buildTransferSteps(options);
    const totalSteps = steps.length;
    
    try {
      // Validate connections
      await this.updateProgress(options, {
        currentStep: "validating",
        totalSteps,
        currentStepIndex: 0,
        percentage: 0,
        message: "Validating source connection...",
      });
      
      const sourceValid = await sourceAdapter.validateConnection(source.connectionString);
      if (!sourceValid) {
        return { success: false, error: "Source connection validation failed" };
      }
      
      await this.updateProgress(options, {
        currentStep: "validating",
        totalSteps,
        currentStepIndex: 0,
        percentage: 5,
        message: "Validating destination connection...",
      });
      
      const destValid = await destAdapter.validateConnection(destination.connectionString);
      if (!destValid) {
        return { success: false, error: "Destination connection validation failed" };
      }
      
      // Export from source
      const package_ = await this.exportFromSource(sourceAdapter, source, options, steps, totalSteps);
      
      // Import to destination
      await this.importToDestination(destAdapter, destination, package_, options, steps, totalSteps);

      const stats = this.calculateStats(package_);
      const warnings = this.collectWarnings(package_);
      
      await this.updateProgress(options, {
        currentStep: "complete",
        totalSteps,
        currentStepIndex: totalSteps - 1,
        percentage: 100,
        message: "Transfer completed successfully",
        details: stats,
      });

      return { success: true, package: package_, stats, warnings: warnings.length > 0 ? warnings : undefined };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.updateProgress(options, {
        currentStep: steps[steps.length - 1],
        totalSteps,
        currentStepIndex: steps.length - 1,
        percentage: 0,
        message: "Transfer failed",
        error: errorMessage,
      });
      
      return { success: false, error: errorMessage };
    }
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
    
    // Export database
    if (options.includeDatabase) {
      await this.updateProgress(options, {
        currentStep: "exporting_schema",
        totalSteps,
        currentStepIndex: stepIndex,
        percentage: Math.round((stepIndex / totalSteps) * 100),
        message: "Exporting database schema...",
      });
      
      package_.database = await adapter.exportDatabase(source.connectionString, options);
      stepIndex++;
    }
    
    // Export storage
    if (options.includeStorage && adapter.exportStorage) {
      await this.updateProgress(options, {
        currentStep: "exporting_storage",
        totalSteps,
        currentStepIndex: stepIndex,
        percentage: Math.round((stepIndex / totalSteps) * 100),
        message: "Exporting storage buckets and files...",
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
        message: "Exporting authentication data...",
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
        message: "Exporting project settings...",
      });
      
      package_.settings = await adapter.exportSettings(source.connectionString, options);
      stepIndex++;
    }
    
    return package_;
  }
  
  /**
   * Import all data to destination provider
   */
  private async importToDestination(
    adapter: ProviderAdapter,
    destination: TransferDestination,
    package_: TransferPackage,
    options: TransferOptions,
    steps: TransferStep[],
    totalSteps: number
  ): Promise<void> {
    let stepIndex = Math.floor(totalSteps / 2); // Start from middle for import steps
    
    // Import database
    if (package_.database && options.includeDatabase) {
      await this.updateProgress(options, {
        currentStep: "importing_schema",
        totalSteps,
        currentStepIndex: stepIndex,
        percentage: Math.round((stepIndex / totalSteps) * 100),
        message: "Importing database schema...",
      });
      
      await adapter.importDatabase(destination.connectionString, package_.database, options);
      stepIndex++;
    }
    
    // Import storage
    if (package_.storage && options.includeStorage && adapter.importStorage) {
      await this.updateProgress(options, {
        currentStep: "importing_storage",
        totalSteps,
        currentStepIndex: stepIndex,
        percentage: Math.round((stepIndex / totalSteps) * 100),
        message: "Importing storage buckets and files...",
      });
      
      await adapter.importStorage(destination.connectionString, package_.storage, options);
      stepIndex++;
    }
    
    // Import auth
    if (package_.auth && options.includeAuth && adapter.importAuth) {
      await this.updateProgress(options, {
        currentStep: "importing_auth",
        totalSteps,
        currentStepIndex: stepIndex,
        percentage: Math.round((stepIndex / totalSteps) * 100),
        message: "Importing authentication data...",
      });
      
      await adapter.importAuth(destination.connectionString, package_.auth, options);
      stepIndex++;
    }
    
    // Import settings
    if (package_.settings && options.includeSettings && adapter.importSettings) {
      await this.updateProgress(options, {
        currentStep: "importing_settings",
        totalSteps,
        currentStepIndex: stepIndex,
        percentage: Math.round((stepIndex / totalSteps) * 100),
        message: "Importing project settings...",
      });
      
      await adapter.importSettings(destination.connectionString, package_.settings, options);
      stepIndex++;
    }
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
    
    steps.push("finalizing", "complete");
    return steps;
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
    };
  }

  /**
   * Collect non-fatal export notes (skipped/failed tables) so the UI can
   * disclose them instead of reporting a clean success.
   */
  private collectWarnings(package_: TransferPackage): string[] {
    const warnings: string[] = [];
    if (package_.database?.warnings) warnings.push(...package_.database.warnings);
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
   * Export a transfer package to JSON for manual transfer
   */
  async exportPackage(source: TransferSource, options: TransferOptions): Promise<string> {
    const adapter = this.getAdapter(source.provider);
    if (!adapter) {
      throw new Error(`No adapter found for provider: ${source.provider}`);
    }
    
    const steps = this.buildTransferSteps(options);
    const package_ = await this.exportFromSource(adapter, source, options, steps, steps.length);
    
    return JSON.stringify(package_, null, 2);
  }
  
  /**
   * Import a transfer package from JSON
   */
  async importPackage(
    destination: TransferDestination,
    packageJson: string,
    options: TransferOptions
  ): Promise<void> {
    const adapter = this.getAdapter(destination.provider);
    if (!adapter) {
      throw new Error(`No adapter found for provider: ${destination.provider}`);
    }
    
    const package_: TransferPackage = JSON.parse(packageJson);
    
    // Validate package version
    if (package_.version !== TRANSFER_VERSION) {
      console.warn(`Package version ${package_.version} differs from expected ${TRANSFER_VERSION}`);
    }
    
    const steps = this.buildTransferSteps(options);
    await this.importToDestination(adapter, destination, package_, options, steps, steps.length);
  }
}

// Factory function to create service with adapters (server-side only)
export async function createTransferService(): Promise<TransferService> {
  const service = new TransferService();
  
  // Dynamically import adapters only on server side
  if (typeof process !== 'undefined' && process.versions?.node) {
    try {
      const { SupabaseAdapter } = await import("./adapters/supabase-adapter");
      service.registerAdapter(new SupabaseAdapter());
    } catch (error) {
      console.warn("Failed to load Supabase adapter:", error);
    }
    
    try {
      const { NeonAdapter } = await import("./adapters/neon-adapter");
      service.registerAdapter(new NeonAdapter());
    } catch (error) {
      console.warn("Failed to load Neon adapter:", error);
    }
    
    try {
      const { PostgresAdapter } = await import("./adapters/postgres-adapter");
      service.registerAdapter(new PostgresAdapter());
    } catch (error) {
      console.warn("Failed to load Postgres adapter:", error);
    }
  }
  
  return service;
}