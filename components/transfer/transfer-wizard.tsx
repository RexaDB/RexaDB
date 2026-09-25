"use client";

import { useState, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  ArrowRight,
  ArrowLeft,
  Database,
  HardDrive,
  Shield,
  Settings,
  Loader2,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Download,
  RefreshCw,
  ChevronRight,
  Check,
  Circle,
  XCircle,
} from "@/lib/icon-theme/lucide-react";
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

const STEPS: Array<{ id: WizardStep; label: string }> = [
  { id: "select-sources", label: "Sources" },
  { id: "select-options", label: "Components" },
  { id: "confirm", label: "Confirm" },
  { id: "transferring", label: "Transfer" },
];

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
    description: "Tables, schemas and row data up to the per-table cap.",
  },
  {
    key: "includeStorage",
    icon: HardDrive,
    label: "Storage buckets & files",
    description: "Buckets plus file metadata. File contents never migrate over SQL.",
  },
  {
    key: "includeAuth",
    icon: Shield,
    label: "Authentication users & providers",
    description: "Users with password hashes when readable, identity links and OAuth providers.",
  },
  {
    key: "includeSettings",
    icon: Settings,
    label: "Project settings",
    description: "Project-level settings snapshot.",
  },
];

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
      transferOptions.includeAuth ? "auth users/providers" : null,
    ].filter(Boolean);
    if (parts.length === 0) return null;
    return `${destProvider === "generic" ? "The destination provider was not recognized" : `A ${destProvider} destination`} has no built-in storage or auth: ${parts.join(" and ")} will be skipped with a warning, not transferred.`;
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

  const activeStepIndex = STEPS.findIndex((s) => s.id === currentStep);
  const runSteps = useMemo(() => displaySteps(transferOptions), [transferOptions]);
  const runIndex = progress ? runSteps.indexOf(progress.currentStep) : -1;

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

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col gap-4 overflow-y-auto p-4 md:p-6">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold tracking-tight">Transfer Project</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Migrate database, storage, auth and settings between providers.
          </p>
        </div>
        {currentStep === "select-options" && (
          <Button
            variant="outline"
            size="sm"
            className="h-8 shrink-0 gap-1.5 text-xs"
            disabled={isTransferring || !sourceConnectionId}
            onClick={() => void handleExportPackage()}
          >
            <Download className="size-3.5 shrink-0" />
            Export package
          </Button>
        )}
      </div>

      {/* Slim stepper */}
      <div className="flex items-center gap-1 text-[11px]">
        {STEPS.map((step, i) => {
          const done = currentStep === "complete" || currentStep === "error" || i < activeStepIndex;
          const active = i === activeStepIndex && currentStep !== "complete" && currentStep !== "error";
          return (
            <span key={step.id} className="flex items-center gap-1">
              {i > 0 && <ChevronRight className="size-3 text-muted-foreground/50" />}
              <span
                className={cn(
                  "flex items-center gap-1 rounded-full px-2 py-0.5",
                  active && "bg-muted font-medium text-foreground",
                  done && "text-muted-foreground",
                  !done && !active && "text-muted-foreground/50",
                )}
              >
                {done ? <Check className="size-3" /> : null}
                {step.label}
              </span>
            </span>
          );
        })}
      </div>

      {currentStep === "select-sources" && (
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:items-center">
          <div className="rounded-xl border border-studio-border/60 p-3">
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">Source</div>
            <Select value={sourceConnectionId} onValueChange={setSourceConnectionId}>
              <SelectTrigger className="h-8 text-xs">
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

          <ArrowRight className="mx-auto size-4 shrink-0 rotate-90 text-muted-foreground/50 md:rotate-0" />

          <div className="rounded-xl border border-studio-border/60 p-3">
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">Destination</div>
            <Select value={destinationConnectionId} onValueChange={setDestinationConnectionId}>
              <SelectTrigger className="h-8 text-xs">
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
            <div className="flex gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-xs md:col-span-3">
              <AlertTriangle className="mt-px size-4 shrink-0 text-destructive" />
              <span>Source and destination cannot be the same connection.</span>
            </div>
          )}
        </div>
      )}

      {currentStep === "select-options" && (
        <div className="flex flex-col gap-3">
          <div className="overflow-hidden rounded-xl border border-studio-border/60">
            {COMPONENTS.map((c, i) => (
              <label
                key={c.key}
                htmlFor={`transfer-${c.key}`}
                className={cn(
                  "flex cursor-pointer items-start gap-3 px-3 py-2.5 hover:bg-muted/20",
                  i > 0 && "border-t border-studio-border/40",
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
            <div className="flex gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
              <AlertTriangle className="mt-px size-4 shrink-0 text-amber-600" />
              <span className="text-amber-800 dark:text-amber-200">{unsupportedNotice}</span>
            </div>
          )}
        </div>
      )}

      {currentStep === "confirm" && (
        <div className="flex flex-col gap-3">
          <div className="overflow-hidden rounded-xl border border-studio-border/60">
            <div className="flex items-center justify-between border-b border-studio-border/40 px-3 py-2">
              <span className="text-xs text-muted-foreground">Source</span>
              <span className="text-xs font-medium">{getSourceConnection()?.name}</span>
            </div>
            <div className="flex items-center justify-between border-b border-studio-border/40 px-3 py-2">
              <span className="text-xs text-muted-foreground">Destination</span>
              <span className="text-xs font-medium">{getDestinationConnection()?.name}</span>
            </div>
            <div className="flex items-center justify-between gap-2 px-3 py-2">
              <span className="shrink-0 text-xs text-muted-foreground">Components</span>
              <span className="flex flex-wrap justify-end gap-1">
                {transferOptions.includeDatabase && <Badge variant="secondary" className="text-[10px]">Database</Badge>}
                {transferOptions.includeStorage && <Badge variant="secondary" className="text-[10px]">Storage</Badge>}
                {transferOptions.includeAuth && <Badge variant="secondary" className="text-[10px]">Auth</Badge>}
                {transferOptions.includeSettings && <Badge variant="secondary" className="text-[10px]">Settings</Badge>}
              </span>
            </div>
          </div>

          <div className="flex gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-xs">
            <AlertTriangle className="mt-px size-4 shrink-0 text-destructive" />
            <span>
              This transfer modifies the destination database — schemas are dropped and recreated inside one
              transaction, so a failure rolls back. Still, make sure you have backups before proceeding.
            </span>
          </div>

          <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
            <div className="font-medium text-amber-800 dark:text-amber-200">Limitations</div>
            <ul className="mt-1.5 list-inside list-disc space-y-1 text-amber-700 dark:text-amber-300">
              <li>Storage migrates buckets + metadata only — file contents require Storage API access and are not copied.</li>
              <li>Auth users migrate with password hashes when readable; otherwise they must reset passwords. OAuth sign-ins need matching provider config.</li>
              <li>Neon / generic Postgres destinations have no storage or auth — those components are skipped with a warning.</li>
            </ul>
          </div>
        </div>
      )}

      {currentStep === "transferring" && (
        <div className="flex flex-col gap-3">
          <div className="rounded-xl border border-studio-border/60 p-3">
            <div className="flex items-center gap-2">
              {isTransferring ? (
                <Loader2 className="size-4 shrink-0 animate-spin text-primary" />
              ) : (
                <CheckCircle2 className="size-4 shrink-0 text-green-500" />
              )}
              <span className="text-sm font-medium">{progress?.message || "Preparing transfer..."}</span>
            </div>
            {progress && (
              <div className="mt-2.5">
                <Progress value={progress.percentage} className="h-1.5" />
                <div className="mt-1 text-[11px] text-muted-foreground">
                  Step {progress.currentStepIndex + 1} of {progress.totalSteps}
                </div>
              </div>
            )}
          </div>

          <div className="overflow-hidden rounded-xl border border-studio-border/60">
            {runSteps.map((step, i) => {
              const failed = Boolean(progress?.error) && i === runIndex;
              const done = runIndex > i || progress?.currentStep === "complete";
              const active = i === runIndex && !done && !failed;
              return (
                <div
                  key={step}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 text-xs",
                    i > 0 && "border-t border-studio-border/40",
                    active ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {failed ? (
                    <XCircle className="size-3.5 shrink-0 text-destructive" />
                  ) : done ? (
                    <CheckCircle2 className="size-3.5 shrink-0 text-green-500" />
                  ) : active ? (
                    <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
                  ) : (
                    <Circle className="size-3.5 shrink-0 opacity-40" />
                  )}
                  <span>{STEP_LABELS[step]}</span>
                  <span className="ml-auto font-mono text-[10px] opacity-60">{step}</span>
                </div>
              );
            })}
          </div>

          {progress?.error && (
            <div className="flex gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-xs">
              <AlertTriangle className="mt-px size-4 shrink-0 text-destructive" />
              <span className="break-words">{progress.error}</span>
            </div>
          )}
        </div>
      )}

      {currentStep === "complete" && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="size-5 shrink-0 text-green-500" />
            <h3 className="text-sm font-semibold">Transfer completed</h3>
          </div>

          {statCards.length > 0 && (
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
              {statCards.map((s) => (
                <div key={s.label} className="rounded-xl border border-studio-border/60 px-3 py-2.5">
                  <div className="text-xl font-semibold tracking-tight">{s.value}</div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">{s.label}</div>
                </div>
              ))}
            </div>
          )}

          {transferResult?.warnings && transferResult.warnings.length > 0 && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
              <div className="font-medium text-amber-800 dark:text-amber-200">Completed with warnings</div>
              <ul className="mt-1.5 list-inside list-disc space-y-1 text-amber-700 dark:text-amber-300">
                {transferResult.warnings.slice(0, 10).map((w, i) => (
                  <li key={i} className="break-words">{w}</li>
                ))}
                {transferResult.warnings.length > 10 && (
                  <li>…and {transferResult.warnings.length - 10} more (see server log)</li>
                )}
              </ul>
            </div>
          )}
        </div>
      )}

      {currentStep === "error" && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 text-destructive">
            <AlertCircle className="size-5 shrink-0" />
            <h3 className="text-sm font-semibold">Transfer failed</h3>
          </div>
          <div className="flex gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-xs">
            <AlertTriangle className="mt-px size-4 shrink-0 text-destructive" />
            <span className="break-words">{error || "An unknown error occurred"}</span>
          </div>
        </div>
      )}

      {/* Footer nav */}
      <div className="flex items-center justify-between border-t border-studio-border/60 pt-3">
        <div>
          {(currentStep === "select-options" || currentStep === "confirm") && (
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={prevStep}>
              <ArrowLeft className="size-3.5" />
              Back
            </Button>
          )}
          {currentStep === "error" && (
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={resetWizard}>
              <RefreshCw className="size-3.5" />
              Start over
            </Button>
          )}
        </div>
        <div>
          {(currentStep === "select-sources" || currentStep === "select-options" || currentStep === "confirm") && (
            <Button size="sm" className="h-8 gap-1.5 text-xs" disabled={!canProceed() || isTransferring} onClick={nextStep}>
              {currentStep === "confirm" ? (
                <>
                  <RefreshCw className="size-3.5" />
                  Start transfer
                </>
              ) : (
                <>
                  Next
                  <ArrowRight className="size-3.5" />
                </>
              )}
            </Button>
          )}
          {currentStep === "complete" && (
            <Button size="sm" className="h-8 text-xs" onClick={handleDone}>
              Done
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
