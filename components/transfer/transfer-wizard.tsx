"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
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
  Download,
  Upload,
  RefreshCw,
} from "@/lib/icon-theme/lucide-react";
import { startTransfer, exportTransferPackage } from "@/lib/transfer/transfer-client";
import type {
  TransferOptions,
  TransferProgress,
  ProviderType,
} from "@/lib/transfer/transfer-types";

interface TransferWizardProps {
  connections: Array<{
    id: string;
    name: string;
    connectionString: string;
    connectionType: string;
  }>;
  onComplete?: (result: { success: boolean; stats?: Record<string, number> }) => void;
  onCancel?: () => void;
}

type WizardStep = "select-sources" | "select-options" | "confirm" | "transferring" | "complete" | "error";

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
        onComplete?.(result);
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
  }, [sourceConnectionId, transferOptions, connections]);

  const canProceed = () => {
    if (currentStep === "select-sources") {
      return sourceConnectionId && destinationConnectionId && sourceConnectionId !== destinationConnectionId;
    }
    return true;
  };

  const nextStep = () => {
    if (currentStep === "select-sources") setCurrentStep("select-options");
    else if (currentStep === "select-options") setCurrentStep("confirm");
    else if (currentStep === "confirm") handleStartTransfer();
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

  return (
    <div className="max-w-4xl mx-auto p-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <RefreshCw className="h-5 w-5" />
            Project Transfer Wizard
          </CardTitle>
          <CardDescription>
            Transfer your entire project between database providers including database, storage, auth, and settings.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Step indicator */}
          <div className="flex items-center justify-between mb-6">
            {["select-sources", "select-options", "confirm", "transferring", "complete"].map((step, index) => (
              <div key={step} className="flex items-center">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                    currentStep === step
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {index + 1}
                </div>
                {index < 4 && <div className="w-12 h-0.5 bg-muted mx-2" />}
              </div>
            ))}
          </div>

          {/* Step content */}
          {currentStep === "select-sources" && (
            <div className="space-y-6">
              <div className="space-y-2">
                <Label>Source Connection</Label>
                <Select value={sourceConnectionId} onValueChange={setSourceConnectionId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select source database" />
                  </SelectTrigger>
                  <SelectContent>
                    {connections.map((conn) => (
                      <SelectItem key={conn.id} value={conn.id}>
                        <div className="flex items-center gap-2">
                          <Database className="h-4 w-4" />
                          {conn.name}
                          <Badge variant="outline" className="ml-2">{conn.connectionType}</Badge>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex justify-center">
                <ArrowRight className="h-6 w-6 text-muted-foreground" />
              </div>

              <div className="space-y-2">
                <Label>Destination Connection</Label>
                <Select value={destinationConnectionId} onValueChange={setDestinationConnectionId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select destination database" />
                  </SelectTrigger>
                  <SelectContent>
                    {connections
                      .filter((c) => c.id !== sourceConnectionId)
                      .map((conn) => (
                        <SelectItem key={conn.id} value={conn.id}>
                          <div className="flex items-center gap-2">
                            <Database className="h-4 w-4" />
                            {conn.name}
                            <Badge variant="outline" className="ml-2">{conn.connectionType}</Badge>
                          </div>
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>

              {sourceConnectionId && destinationConnectionId && sourceConnectionId === destinationConnectionId && (
                <div className="p-3 rounded-lg border border-destructive/50 bg-destructive/10 text-destructive">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="h-4 w-4" />
                    <span className="font-medium">Invalid selection</span>
                  </div>
                  <p className="text-sm mt-1">
                    Source and destination cannot be the same connection.
                  </p>
                </div>
            )}
            </div>
          )}

          {currentStep === "select-options" && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold">Select Transfer Components</h3>
              
              <div className="space-y-3">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="include-database"
                    checked={transferOptions.includeDatabase}
                    onCheckedChange={(checked) =>
                      setTransferOptions({ ...transferOptions, includeDatabase: Boolean(checked) })
                    }
                  />
                  <Label htmlFor="include-database" className="flex items-center gap-2 cursor-pointer">
                    <Database className="h-4 w-4" />
                    Database Schema & Data
                  </Label>
                </div>

                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="include-storage"
                    checked={transferOptions.includeStorage}
                    onCheckedChange={(checked) =>
                      setTransferOptions({ ...transferOptions, includeStorage: Boolean(checked) })
                    }
                  />
                  <Label htmlFor="include-storage" className="flex items-center gap-2 cursor-pointer">
                    <HardDrive className="h-4 w-4" />
                    Storage Buckets & Files
                  </Label>
                </div>

                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="include-auth"
                    checked={transferOptions.includeAuth}
                    onCheckedChange={(checked) =>
                      setTransferOptions({ ...transferOptions, includeAuth: Boolean(checked) })
                    }
                  />
                  <Label htmlFor="include-auth" className="flex items-center gap-2 cursor-pointer">
                    <Shield className="h-4 w-4" />
                    Authentication Users & Providers
                  </Label>
                </div>

                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="include-settings"
                    checked={transferOptions.includeSettings}
                    onCheckedChange={(checked) =>
                      setTransferOptions({ ...transferOptions, includeSettings: Boolean(checked) })
                    }
                  />
                  <Label htmlFor="include-settings" className="flex items-center gap-2 cursor-pointer">
                    <Settings className="h-4 w-4" />
                    Project Settings
                  </Label>
                </div>
              </div>

              <div className="pt-4 border-t">
                <Button
                  variant="outline"
                  onClick={handleExportPackage}
                  disabled={isTransferring}
                  className="gap-2"
                >
                  <Download className="h-4 w-4" />
                  Export Package Only
                </Button>
              </div>
            </div>
          )}

          {currentStep === "confirm" && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold">Confirm Transfer</h3>
              
              <div className="p-3 rounded-lg border border-border bg-muted">
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4" />
                  <span className="font-medium">Important</span>
                </div>
                <p className="text-sm mt-1 text-muted-foreground">
                  This transfer will modify the destination database. Make sure you have backups before proceeding.
                </p>
              </div>

              <div className="p-3 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20">
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-amber-600" />
                  <span className="font-medium text-amber-800 dark:text-amber-200">Limitations</span>
                </div>
                <ul className="text-sm mt-2 text-amber-700 dark:text-amber-300 list-disc list-inside space-y-1">
                  <li>Storage files require API access and are not currently transferred</li>
                  <li>Auth users are limited to 1000 and don't retain passwords/sign-in state</li>
                  <li>Some providers (Neon, generic Postgres) don't support storage/auth transfer</li>
                  <li>Database transfer is destructive - it drops and recreates schemas</li>
                </ul>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between items-center p-3 bg-muted rounded">
                  <span className="font-medium">Source:</span>
                  <span>{getSourceConnection()?.name}</span>
                </div>
                <div className="flex justify-between items-center p-3 bg-muted rounded">
                  <span className="font-medium">Destination:</span>
                  <span>{getDestinationConnection()?.name}</span>
                </div>
              </div>

              <div className="space-y-2">
                <h4 className="font-medium">Components to transfer:</h4>
                <ul className="space-y-1">
                  {transferOptions.includeDatabase && <li>✓ Database Schema & Data</li>}
                  {transferOptions.includeStorage && <li>✓ Storage Buckets & Files</li>}
                  {transferOptions.includeAuth && <li>✓ Authentication Users & Providers</li>}
                  {transferOptions.includeSettings && <li>✓ Project Settings</li>}
                </ul>
              </div>
            </div>
          )}

          {currentStep === "transferring" && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                {isTransferring ? (
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                ) : (
                  <CheckCircle2 className="h-5 w-5 text-green-500" />
                )}
                <h3 className="text-lg font-semibold">
                  {progress?.message || "Preparing transfer..."}
                </h3>
              </div>

              {progress && (
                <>
                  <Progress value={progress.percentage} className="h-2" />
                  <div className="text-sm text-muted-foreground">
                    Step {progress.currentStepIndex + 1} of {progress.totalSteps}: {progress.currentStep}
                  </div>
                </>
              )}

              {progress?.error && (
                <div className="p-3 rounded-lg border border-destructive/50 bg-destructive/10 text-destructive">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="h-4 w-4" />
                    <span className="font-medium">Error</span>
                  </div>
                  <p className="text-sm mt-1">{progress.error}</p>
                </div>
              )}
            </div>
          )}

          {currentStep === "complete" && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 text-green-600">
                <CheckCircle2 className="h-8 w-8" />
                <h3 className="text-xl font-semibold">Transfer Completed Successfully!</h3>
              </div>

              {transferResult?.warnings && transferResult.warnings.length > 0 && (
                <div className="p-3 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 text-amber-600" />
                    <span className="font-medium text-amber-800 dark:text-amber-200">Completed with warnings</span>
                  </div>
                  <ul className="text-sm mt-2 text-amber-700 dark:text-amber-300 list-disc list-inside space-y-1">
                    {transferResult.warnings.slice(0, 10).map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                    {transferResult.warnings.length > 10 && (
                      <li>…and {transferResult.warnings.length - 10} more (see console)</li>
                    )}
                  </ul>
                </div>
              )}

              {transferResult?.stats && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-muted rounded">
                    <div className="text-2xl font-bold">{transferResult.stats.tablesTransferred}</div>
                    <div className="text-sm text-muted-foreground">Tables Transferred</div>
                  </div>
                  <div className="p-4 bg-muted rounded">
                    <div className="text-2xl font-bold">{transferResult.stats.rowsTransferred}</div>
                    <div className="text-sm text-muted-foreground">Rows Transferred</div>
                  </div>
                  <div className="p-4 bg-muted rounded">
                    <div className="text-2xl font-bold">{transferResult.stats.storageBucketsTransferred}</div>
                    <div className="text-sm text-muted-foreground">Storage Buckets</div>
                  </div>
                  <div className="p-4 bg-muted rounded">
                    <div className="text-2xl font-bold">{transferResult.stats.storageFilesTransferred}</div>
                    <div className="text-sm text-muted-foreground">Storage Files</div>
                  </div>
                  <div className="p-4 bg-muted rounded">
                    <div className="text-2xl font-bold">{transferResult.stats.authUsersTransferred}</div>
                    <div className="text-sm text-muted-foreground">Auth Users</div>
                  </div>
                  <div className="p-4 bg-muted rounded">
                    <div className="text-2xl font-bold">{transferResult.stats.authProvidersTransferred}</div>
                    <div className="text-sm text-muted-foreground">Auth Providers</div>
                  </div>
                </div>
              )}
            </div>
          )}

          {currentStep === "error" && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 text-red-600">
                <AlertCircle className="h-8 w-8" />
                <h3 className="text-xl font-semibold">Transfer Failed</h3>
              </div>

              <div className="p-3 rounded-lg border border-destructive/50 bg-destructive/10 text-destructive">
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4" />
                  <span className="font-medium">Error</span>
                </div>
                <p className="text-sm mt-1">{error || "An unknown error occurred"}</p>
              </div>
            </div>
          )}

          {/* Navigation buttons */}
          <div className="flex justify-between mt-6 pt-4 border-t">
            {currentStep !== "transferring" && currentStep !== "complete" && currentStep !== "error" && (
              <Button
                variant="outline"
                onClick={prevStep}
                disabled={currentStep === "select-sources"}
                className="gap-2"
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </Button>
            )}

            {currentStep === "error" && (
              <Button variant="outline" onClick={resetWizard} className="gap-2">
                <RefreshCw className="h-4 w-4" />
                Start Over
              </Button>
            )}

            {currentStep === "complete" && (
              <Button onClick={onCancel} className="gap-2">
                Done
              </Button>
            )}

            {currentStep !== "transferring" && currentStep !== "complete" && currentStep !== "error" && (
              <Button
                onClick={nextStep}
                disabled={!canProceed() || isTransferring}
                className="gap-2 ml-auto"
              >
                {currentStep === "confirm" ? (
                  <>
                    <RefreshCw className="h-4 w-4" />
                    Start Transfer
                  </>
                ) : (
                  <>
                    Next
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}