/**
 * Core types for the database provider transfer system
 * Supports transferring entire projects between providers (Supabase, Neon, etc.)
 */

export type ProviderType = "supabase" | "neon" | "postgres" | "generic";

export interface TransferSource {
  provider: ProviderType;
  connectionString: string;
  projectId?: string;
  projectName?: string;
  metadata?: Record<string, unknown>;
}

export interface TransferDestination {
  provider: ProviderType;
  connectionString: string;
  projectId?: string;
  projectName?: string;
  metadata?: Record<string, unknown>;
}

export interface TransferOptions {
  includeDatabase: boolean;
  includeStorage: boolean;
  includeAuth: boolean;
  includeEdgeFunctions?: boolean;
  includeSettings: boolean;
  batchSize?: number;
  onProgress?: (progress: TransferProgress) => void;
}

export interface TransferProgress {
  currentStep: TransferStep;
  totalSteps: number;
  currentStepIndex: number;
  percentage: number;
  message: string;
  details?: Record<string, unknown>;
  error?: string;
}

export type TransferStep =
  | "validating"
  | "exporting_schema"
  | "exporting_data"
  | "exporting_storage"
  | "exporting_auth"
  | "exporting_settings"
  | "importing_schema"
  | "importing_data"
  | "importing_storage"
  | "importing_auth"
  | "importing_settings"
  | "finalizing"
  | "complete";

export interface DatabaseExport {
  schemaSql: string;
  dataSql?: string;
  tables: string[];
  rowCounts: Record<string, number>;
  /**
   * Rows actually exported per table (excludes tables skipped by the row
   * cap or failed reads). Stats must be computed from this when present —
   * rowCounts reflects the source, not what reached the destination.
   */
  exportedRowCounts?: Record<string, number>;
  /** Non-fatal export notes (skipped tables, failed reads) surfaced to users. */
  warnings?: string[];
}

export interface StorageExport {
  buckets: Array<{
    id: string;
    name: string;
    public: boolean;
    file_size_limit: number | null;
    allowed_mime_types: string[] | null;
  }>;
  files: Array<{
    bucketId: string;
    path: string;
    metadata: Record<string, unknown>;
    contentBase64?: string;
    size?: number;
  }>;
}

export interface AuthExport {
  users: Array<{
    id: string;
    email: string;
    email_confirmed_at?: string;
    created_at: string;
    updated_at: string;
    raw_user_meta_data?: Record<string, unknown>;
  }>;
  providers: Array<{
    id: string;
    name: string;
    provider: string;
    secret: string;
  }>;
  policies?: Array<{
    id: string;
    name: string;
    schema: string;
    table: string;
    definition: string;
  }>;
}

export interface SettingsExport {
  projectSettings: Record<string, unknown>;
  apiKeys?: Array<{
    name: string;
    key: string;
  }>;
  databaseSettings?: Record<string, unknown>;
}

export interface TransferPackage {
  version: string;
  exportedAt: string;
  sourceProvider: ProviderType;
  sourceProjectId?: string;
  database?: DatabaseExport;
  storage?: StorageExport;
  auth?: AuthExport;
  settings?: SettingsExport;
  metadata?: Record<string, unknown>;
}

export interface TransferResult {
  success: boolean;
  package?: TransferPackage;
  error?: string;
  warnings?: string[];
  stats?: {
    tablesTransferred: number;
    rowsTransferred: number;
    storageBucketsTransferred: number;
    storageFilesTransferred: number;
    authUsersTransferred: number;
    authProvidersTransferred: number;
  };
}

export interface ProviderAdapter {
  type: ProviderType;
  
  validateConnection(connectionString: string): Promise<boolean>;
  
  exportDatabase(connectionString: string, options: TransferOptions): Promise<DatabaseExport>;
  importDatabase(connectionString: string, data: DatabaseExport, options: TransferOptions): Promise<void>;
  
  exportStorage?(connectionString: string, options: TransferOptions): Promise<StorageExport>;
  importStorage?(connectionString: string, data: StorageExport, options: TransferOptions): Promise<void>;
  
  exportAuth?(connectionString: string, options: TransferOptions): Promise<AuthExport>;
  importAuth?(connectionString: string, data: AuthExport, options: TransferOptions): Promise<void>;
  
  exportSettings?(connectionString: string, options: TransferOptions): Promise<SettingsExport>;
  importSettings?(connectionString: string, data: SettingsExport, options: TransferOptions): Promise<void>;
  
  getProjectInfo?(connectionString: string): Promise<{ name: string; id: string }>;
}