"use client";

import { useState, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  ArrowRightLeft,
  Database,
  HardDrive,
  Shield,
  Settings,
  Loader2,
  Check,
  Download,
} from "@/lib/icon-theme/lucide-react";
import TaskRows from "@/components/studio/ai/task-rows";
import type { Task } from "@/lib/ai/task-types";
import { startTransfer, exportTransferPackage } from "@/lib/transfer/transfer-client";
import type {
  TransferOptions,
  TransferProgress,
  TransferStep,
  ProviderType,
} from "@/lib/transfer/transfer-types";

interface TransferWizardProps {
  connections: Array<{
    id: string;
    name: string;
    connectionString: string;
    connectionType: string;
  }>;
  onComplete?: (result: { success: boolean; stats?: Record<string, number>; warnings?: string[] }) => void;
  onCancel?: () => void;
}

type WizardStep = "select-sources" | "select-options" | "confirm" | "transferring" | "complete" | "error";

const STEP_LABELS: Record<TransferStep, string> = {
  validating: "Validating connections",
  exporting_schema: "Exporting database",
  exporting_data: "Exporting table data",
  exporting_storage: "Exporting storage",
  exporting_auth: "Exporting auth",
  exporting_settings: "Exporting settings",
  importing_schema: "Importing database",
  importing_data: "Importing table data",
  importing_storage: "Importing storage",
  importing_auth: "Importing auth",
  importing_settings: "Importing settings",
  finalizing: "Finalizing",
  complete: "Complete",
};

function displaySteps(options: TransferOptions): TransferStep[] {
  const steps: TransferStep[] = ["validating"];
  if (options.includeDatabase) steps.push("exporting_schema", "importing_schema");
  if (options.includeStorage) steps.push("exporting_storage", "importing_storage");
  if (options.includeAuth) steps.push("exporting_auth", "importing_auth");
  if (options.includeSettings) steps.push("exporting_settings", "importing_settings");
  steps.push("complete");
  return steps;
}

const COMPONENTS: Array<{
  key: "includeDatabase" | "includeStorage" | "includeAuth" | "includeSettings";
  icon: typeof Database;
  label: string;
  description: string;
}> = [
  {
    key: "includeDatabase",
    icon: Database,
    label: "Database schema & data",
    description: "Tables, schemas and row data up to the per-table cap — including Neon Auth's neon_auth tables.",
  },
  {
    key: "includeStorage",
    icon: HardDrive,
    label: "Storage buckets & files",
    description: "Supabase buckets plus file metadata. File contents never migrate over SQL.",
  },
  {
    key: "includeAuth",
    icon: Shield,
    label: "Authentication users & providers",
    description: "Supabase GoTrue users with password hashes when readable, identity links and OAuth providers.",
  },
  {
    key: "includeSettings",
    icon: Settings,
    label: "Project settings",
    description: "Project-level settings snapshot.",
  },
];

const pillButton =
  "h-11 flex-1 rounded-full border border-border bg-card px-8 text-sm font-medium text-foreground shadow-sm hover:bg-muted/50";

const statusPill =
  "mx-auto mt-5 flex w-full max-w-[440px] items-center justify-center rounded-full border border-border bg-card px-8 py-3 text-center shadow-sm";

export function TransferWizard({ connections, onComplete, onCancel }: TransferWizardProps) {
  const [currentStep, setCurrentStep] = useState<WizardStep>("select-sources");
  const [sourceConnectionId, setSourceConnectionId] = useState<string>("");
  const [destinationConnectionId, setDestinationConnectionId] = useState<string>("");
  const [transferOptions, setTransferOptions] = useState<TransferOptions>({
    includeDatabase: true,
    includeStorage: true,
    includeAuth: true,
    includeSettings: true,
    batchSize: 100,
  });
  const [progress, setProgress] = useState<TransferProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [transferResult, setTransferResult] = useState<{ success: boolean; stats?: Record<string, number>; warnings?: string[] } | null>(null);
  const [isTransferring, setIsTransferring] = useState(false);

  const getProviderType = (connectionType: string): ProviderType => {
    if (connectionType.includes("supabase")) return "supabase";
    if (connectionType.includes("neon")) return "neon";
    if (connectionType.includes("postgres") || connectionType.includes("postgresql")) return "postgres";
    return "generic";
  };

  const getSourceConnection = () => connections.find(c => c.id === sourceConnectionId);
  const getDestinationConnection = () => connections.find(c => c.id === destinationConnectionId);

  const destProvider: ProviderType | null = useMemo(() => {
    const dest = getDestinationConnection();
    return dest ? getProviderType(dest.connectionType) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destinationConnectionId, connections]);

  const unsupportedNotice = useMemo(() => {
    if (!destProvider || destProvider === "supabase") return null;
    const parts = [
      transferOptions.includeStorage ? "storage buckets/files" : null,
      transferOptions.includeAuth ? "GoTrue users/providers" : null,
    ].filter(Boolean);
    if (parts.length === 0) return null;
    const destName = destProvider === "generic" ? "This destination" : `A ${destProvider} destination`;
    return `${destName} has no Supabase-compatible storage or auth schemas: ${parts.join(" and ")} will be skipped with a warning, not transferred. Ordinary tables — including Neon Auth's neon_auth tables — migrate with the database.`;
  }, [destProvider, transferOptions.includeStorage, transferOptions.includeAuth]);

  // Completion is user-acknowledged: the complete step (stats + warnings)
  // stays mounted until Done is clicked. Auto-firing onComplete used to
  // unmount the wizard before warnings could be read.
  const handleDone = useCallback(() => {
    if (transferResult?.success && onComplete) {
      onComplete({
        success: true,
        stats: transferResult.stats,
        warnings: transferResult.warnings,
      });
    } else {
      onCancel?.();
    }
  }, [transferResult, onComplete, onCancel]);

  const handleStartTransfer = useCallback(async () => {
    const source = getSourceConnection();
    const destination = getDestinationConnection();

    if (!source || !destination) {
      setError("Please select both source and destination connections");
      setCurrentStep("error");
      return;
    }

    setIsTransferring(true);
    setCurrentStep("transferring");
    setError(null);

    try {
      const result = await startTransfer(
        {
          sourceConnectionString: source.connectionString,
          sourceProvider: getProviderType(source.connectionType),
          destinationConnectionString: destination.connectionString,
          destinationProvider: getProviderType(destination.connectionType),
          options: transferOptions,
        },
        (progress) => {
          setProgress(progress);
        }
      );

      setTransferResult({
        success: result.success,
        stats: result.stats,
        warnings: result.warnings,
      });

      if (result.success) {
        setCurrentStep("complete");
      } else {
        setError(result.error || "Transfer failed");
        setCurrentStep("error");
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "An unexpected error occurred";
      setError(errorMessage);
      setCurrentStep("error");
    } finally {
      setIsTransferring(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceConnectionId, destinationConnectionId, transferOptions, connections, onComplete]);

  const handleExportPackage = useCallback(async () => {
    const source = getSourceConnection();
    if (!source) return;

    setIsTransferring(true);
    setError(null);
    try {
      // Build a real transfer package from the source via the server.
      const result = await exportTransferPackage({
        sourceConnectionString: source.connectionString,
        sourceProvider: getProviderType(source.connectionType),
        destinationConnectionString: "",
        destinationProvider: "generic",
        options: transferOptions,
      });

      if (!result.success || !result.packageJson) {
        throw new Error(result.error || "Export failed");
      }

      // Create and download the file
      const blob = new Blob([result.packageJson], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `transfer-package-${source.name}-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success("Transfer package exported successfully");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
      setCurrentStep("error");
    } finally {
      setIsTransferring(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceConnectionId, transferOptions, connections]);

  const canProceed = () => {
    if (currentStep === "select-sources") {
      return Boolean(sourceConnectionId && destinationConnectionId && sourceConnectionId !== destinationConnectionId);
    }
    return true;
  };

  const nextStep = () => {
    if (currentStep === "select-sources") setCurrentStep("select-options");
    else if (currentStep === "select-options") setCurrentStep("confirm");
    else if (currentStep === "confirm") void handleStartTransfer();
  };

  const prevStep = () => {
    if (currentStep === "select-options") setCurrentStep("select-sources");
    else if (currentStep === "confirm") setCurrentStep("select-options");
  };

  const resetWizard = () => {
    setCurrentStep("select-sources");
    setProgress(null);
    setError(null);
    setTransferResult(null);
    setIsTransferring(false);
  };

  // Task capsules are transfer progress indicators only — they render
  // while the transfer runs, never as a wizard stepper.
  const runSteps = useMemo(() => displaySteps(transferOptions), [transferOptions]);
  const runIndex = progress ? runSteps.indexOf(progress.currentStep) : -1;
  const runTasks: Task[] = runSteps.map((step, i) => ({
    id: step,
    label: STEP_LABELS[step],
    status:
      progress?.currentStep === "complete" || runIndex > i
        ? "completed"
        : progress?.error && i === runIndex
          ? "failed"
          : i === runIndex
            ? "in_progress"
            : "pending",
  }));

  const stats = transferResult?.stats;
  const statCards = stats
    ? [
        { label: "Tables", value: stats.tablesTransferred },
        { label: "Rows", value: stats.rowsTransferred },
        { label: "Storage buckets", value: stats.storageBucketsTransferred },
        { label: "Storage files", value: stats.storageFilesTransferred },
        { label: "Auth users", value: stats.authUsersTransferred },
        { label: "Auth providers", value: stats.authProvidersTransferred },
      ]
    : [];

  const showNav = currentStep === "select-sources" || currentStep === "select-options" || currentStep === "confirm";

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex items-center justify-center gap-3">
        <span className="flex size-9 items-center justify-center rounded-full border border-border bg-card shadow-sm">
          <ArrowRightLeft className="size-4 text-foreground" />
        </span>
        <h2 className="text-2xl font-semibold tracking-tight">Transfer Project</h2>
      </div>

      {currentStep === "transferring" && (
        <div className="flex justify-center">
          <TaskRows tasks={runTasks} variant="Capsules" />
        </div>
      )}

      <div className="px-1 py-2">
        {currentStep === "select-sources" && (
          <div className="mx-auto flex w-full max-w-[440px] flex-col gap-3">
            <div className="rounded-[28px] border border-border bg-card p-4 shadow-sm">
              <div className="mb-1.5 text-xs font-medium text-muted-foreground">Source</div>
              <Select value={sourceConnectionId} onValueChange={setSourceConnectionId}>
                <SelectTrigger className="h-8 rounded-full text-xs">
                  <SelectValue placeholder="Select source database" />
                </SelectTrigger>
                <SelectContent>
                  {connections.map((conn) => (
                    <SelectItem key={conn.id} value={conn.id} className="text-xs">
                      <span className="flex items-center gap-2">
                        <Database className="size-3.5 shrink-0 text-muted-foreground" />
                        {conn.name}
                        <Badge variant="outline" className="ml-1 font-mono text-[10px]">{conn.connectionType}</Badge>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="rounded-[28px] border border-border bg-card p-4 shadow-sm">
              <div className="mb-1.5 text-xs font-medium text-muted-foreground">Destination</div>
              <Select value={destinationConnectionId} onValueChange={setDestinationConnectionId}>
                <SelectTrigger className="h-8 rounded-full text-xs">
                  <SelectValue placeholder="Select destination database" />
                </SelectTrigger>
                <SelectContent>
                  {connections
                    .filter((c) => c.id !== sourceConnectionId)
                    .map((conn) => (
                      <SelectItem key={conn.id} value={conn.id} className="text-xs">
                        <span className="flex items-center gap-2">
                          <Database className="size-3.5 shrink-0 text-muted-foreground" />
                          {conn.name}
                          <Badge variant="outline" className="ml-1 font-mono text-[10px]">{conn.connectionType}</Badge>
                        </span>
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            {sourceConnectionId && destinationConnectionId && sourceConnectionId === destinationConnectionId && (
              <div className={cn(statusPill, "!border-destructive/30 !bg-destructive/5")}>
                <span className="break-words text-xs leading-relaxed text-destructive">
                  Source and destination cannot be the same connection.
                </span>
              </div>
            )}
          </div>
        )}

        {currentStep === "select-options" && (
          <div className="flex flex-col gap-3">
            <div className="overflow-hidden rounded-[28px] border border-border bg-card shadow-sm">
              {COMPONENTS.map((c, i) => (
                <label
                  key={c.key}
                  htmlFor={`transfer-${c.key}`}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 px-4 py-3 hover:bg-muted/20",
                    i > 0 && "border-t border-border/60",
                  )}
                >
                  <Checkbox
                    id={`transfer-${c.key}`}
                    checked={transferOptions[c.key]}
                    onCheckedChange={(checked) =>
                      setTransferOptions({ ...transferOptions, [c.key]: Boolean(checked) })
                    }
                    className="mt-0.5"
                  />
                  <c.icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{c.label}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{c.description}</span>
                  </span>
                </label>
              ))}
            </div>

            {unsupportedNotice && (
              <div className={cn(statusPill, "!rounded-2xl !border-amber-500/30 !bg-amber-500/10")}>
                <span className="break-words text-xs leading-relaxed text-amber-700 dark:text-amber-300">
                  {unsupportedNotice}
                </span>
              </div>
            )}

            <div className="flex justify-center">
              <Button
                variant="outline"
                size="sm"
                className="h-8 shrink-0 gap-1.5 rounded-full text-xs"
                disabled={isTransferring || !sourceConnectionId}
                onClick={() => void handleExportPackage()}
              >
                <Download className="size-3.5 shrink-0" />
                Export package only
              </Button>
            </div>
          </div>
        )}

        {currentStep === "confirm" && (
          <div className="flex flex-col gap-3">
            <div className="overflow-hidden rounded-[28px] border border-border bg-card shadow-sm">
              <div className="flex items-center justify-between border-b border-border/60 px-4 py-2.5">
                <span className="text-xs text-muted-foreground">Source</span>
                <span className="text-xs font-medium">{getSourceConnection()?.name}</span>
              </div>
              <div className="flex items-center justify-between border-b border-border/60 px-4 py-2.5">
                <span className="text-xs text-muted-foreground">Destination</span>
                <span className="text-xs font-medium">{getDestinationConnection()?.name}</span>
              </div>
              <div className="flex items-center justify-between gap-2 px-4 py-2.5">
                <span className="shrink-0 text-xs text-muted-foreground">Components</span>
                <span className="flex flex-wrap justify-end gap-1">
                  {transferOptions.includeDatabase && <Badge variant="secondary" className="rounded-full text-[10px]">Database</Badge>}
                  {transferOptions.includeStorage && <Badge variant="secondary" className="rounded-full text-[10px]">Storage</Badge>}
                  {transferOptions.includeAuth && <Badge variant="secondary" className="rounded-full text-[10px]">Auth</Badge>}
                  {transferOptions.includeSettings && <Badge variant="secondary" className="rounded-full text-[10px]">Settings</Badge>}
                </span>
              </div>
            </div>

            <div className={cn(statusPill, "!rounded-2xl !border-destructive/30 !bg-destructive/5")}>
              <span className="break-words text-xs leading-relaxed text-destructive">
                This transfer modifies the destination database. Make sure you have backups before proceeding.
              </span>
            </div>

            <div className={cn(statusPill, "!rounded-2xl !border-amber-500/30 !bg-amber-500/10")}>
              <span className="break-words text-left text-xs leading-relaxed text-amber-700 dark:text-amber-300">
                Storage migrates buckets + metadata only — file contents (Supabase Storage API, Neon Object Storage) are not copied.
                Supabase auth users migrate with password hashes when readable; Neon Auth lives in neon_auth tables and migrates with the database.
                Supabase storage.* and auth.* schemas have no counterpart on Neon / generic Postgres and are skipped with a warning.
              </span>
            </div>
          </div>
        )}

        {currentStep === "transferring" && (
          <>
            {(progress?.message || progress?.error) && (
              <div className={cn(statusPill, progress?.error && "!border-destructive/30 !bg-destructive/5")}>
                <span className={cn("break-words text-xs leading-relaxed", progress?.error ? "text-destructive" : "text-muted-foreground")}>
                  {progress?.error ?? `${progress?.message}${progress ? ` — ${progress.percentage}%` : ""}`}
                </span>
              </div>
            )}
          </>
        )}

        {currentStep === "complete" && (
          <div className="flex flex-col gap-5">
            <div className={cn(statusPill, "!border-green-500/30 !bg-green-500/10")}>
              <span className="flex items-center gap-2 text-xs font-medium text-green-600 dark:text-green-400">
                <Check className="size-4" />
                Transfer completed
              </span>
            </div>

            {statCards.length > 0 && (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {statCards.map((s) => (
                  <div key={s.label} className="rounded-full border border-border bg-card px-3 py-2.5 text-center shadow-sm">
                    <div className="text-xl font-semibold tracking-tight">{s.value}</div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">{s.label}</div>
                  </div>
                ))}
              </div>
            )}

            {transferResult?.warnings && transferResult.warnings.length > 0 && (
              <div className={cn(statusPill, "!rounded-2xl !border-amber-500/30 !bg-amber-500/10")}>
                <span className="break-words text-left text-xs leading-relaxed text-amber-700 dark:text-amber-300">
                  Completed with warnings: {transferResult.warnings.slice(0, 5).join(" ")}
                  {transferResult.warnings.length > 5 ? ` (+${transferResult.warnings.length - 5} more — see server log)` : ""}
                </span>
              </div>
            )}
          </div>
        )}

        {currentStep === "error" && (
          <div className={cn(statusPill, "!rounded-xl !border-destructive/30 !bg-destructive/5")}>
            <span className="break-words text-xs leading-relaxed text-destructive">
              {error || "An unknown error occurred"}
            </span>
          </div>
        )}

        {showNav && (
          <div className="mx-auto mt-7 flex w-full max-w-[440px] items-center gap-2">
            {currentStep !== "select-sources" ? (
              <Button className={pillButton} onClick={prevStep}>
                Back
              </Button>
            ) : (
              <Button className={pillButton} onClick={() => onCancel?.()}>
                Cancel
              </Button>
            )}
            <Button className={pillButton} disabled={!canProceed() || isTransferring} onClick={nextStep}>
              {isTransferring ? (
                <Loader2 className="size-4 animate-spin" />
              ) : currentStep === "confirm" ? (
                "Start transfer"
              ) : (
                "Next"
              )}
            </Button>
          </div>
        )}

        {currentStep === "transferring" && !isTransferring && !progress?.error && (
          <div className="mx-auto mt-7 flex w-full max-w-[440px] items-center gap-2">
            <Button className={pillButton} onClick={() => onCancel?.()}>
              Close
            </Button>
          </div>
        )}

        {currentStep === "complete" && (
          <div className="mx-auto mt-7 flex w-full max-w-[440px] items-center gap-2">
            <Button className={pillButton} onClick={handleDone}>
              <Check className="size-4" />
              Done
            </Button>
          </div>
        )}

        {currentStep === "error" && (
          <div className="mx-auto mt-7 flex w-full max-w-[440px] items-center gap-2">
            <Button className={pillButton} onClick={resetWizard}>
              Start over
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
