"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Loader2, XCircle, ArrowRight, FileJson, Database } from "@/lib/icon-theme/lucide-react";
import {
  getSettingsMigrationStatus,
  triggerSettingsMigration,
  clearMigratedSqliteSettings,
} from "@/lib/api/actions-client";
import { cn } from "@/lib/utils";

interface Step {
  id: string;
  label: string;
  status: "pending" | "active" | "done" | "error";
}

const INITIAL_STEPS: Step[] = [
  { id: "read", label: "Reading settings from database...", status: "pending" },
  { id: "write", label: "Writing settings file...", status: "pending" },
  { id: "verify", label: "Verifying migration...", status: "pending" },
  { id: "complete", label: "Migration complete!", status: "pending" },
];

interface SettingsMigrationDialogProps {
  /** Called after migration completes successfully */
  onComplete?: () => void;
  /** Called when user dismisses without migrating */
  onDismiss?: () => void;
  /** If true, always show (for testing) */
  forceShow?: boolean;
}

export function SettingsMigrationDialog({
  onComplete,
  onDismiss,
  forceShow,
}: SettingsMigrationDialogProps) {
  const [checking, setChecking] = useState(true);
  const [migrationNeeded, setMigrationNeeded] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [steps, setSteps] = useState<Step[]>(INITIAL_STEPS);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        const res = await getSettingsMigrationStatus();
        if (cancelled) return;
        if (res.success && res.data) {
          setMigrationNeeded(res.data.migrationNeeded);
        }
      } catch {
        // Silently skip if API unavailable
      } finally {
        if (!cancelled) setChecking(false);
      }
    }
    if (!forceShow) {
      check();
    } else {
      setMigrationNeeded(true);
      setChecking(false);
    }
    return () => { cancelled = true; };
  }, [forceShow]);

  const updateStep = (id: string, status: Step["status"]) => {
    setSteps((prev) =>
      prev.map((s) => (s.id === id ? { ...s, status } : s)),
    );
  };

  const handleMigrate = useCallback(async () => {
    setMigrating(true);
    setError(null);
    setSteps(INITIAL_STEPS);

    try {
      updateStep("read", "active");
      const res = await triggerSettingsMigration();
      if (!res.success) {
        updateStep("read", "error");
        setError(res.error || "Migration failed");
        setMigrating(false);
        return;
      }

      updateStep("read", "done");
      updateStep("write", "done");
      updateStep("verify", "done");
      updateStep("complete", "done");

      // Optionally clear SQLite after successful migration
      try {
        await clearMigratedSqliteSettings();
      } catch {
        // Non-critical
      }

      setMigrating(false);
    } catch (err: any) {
      updateStep("read", "error");
      setError(err.message || "Migration failed");
      setMigrating(false);
    }
  }, []);

  const handleContinue = () => {
    setDismissed(true);
    onComplete?.();
  };

  const handleDismiss = () => {
    setDismissed(true);
    onDismiss?.();
  };

  if (dismissed) return null;
  if (checking) return null;
  if (!migrationNeeded) return null;

  const isComplete = steps.find((s) => s.id === "complete")?.status === "done";
  const hasError = steps.some((s) => s.status === "error");

  return (
    <Dialog open={true} onOpenChange={() => {}}>
      <DialogContent className="max-w-md" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Database className="w-4 h-4 text-blue-500" />
            <span>Settings Migration</span>
          </DialogTitle>
          <DialogDescription>
            We&apos;ve moved settings to a JSON file for better performance and
            editability. Your settings will be migrated automatically.
          </DialogDescription>
        </DialogHeader>

        {/* Steps */}
        <div className="space-y-2.5 py-2">
          {steps.map((step) => (
            <div key={step.id} className="flex items-center gap-3">
              {step.status === "done" && (
                <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
              )}
              {step.status === "active" && (
                <Loader2 className="w-4 h-4 text-blue-500 animate-spin shrink-0" />
              )}
              {step.status === "error" && (
                <XCircle className="w-4 h-4 text-red-500 shrink-0" />
              )}
              {step.status === "pending" && (
                <div className="w-4 h-4 rounded-full border-2 border-muted shrink-0" />
              )}
              <span
                className={cn(
                  "text-xs transition-colors",
                  step.status === "done" && "text-green-600 dark:text-green-400",
                  step.status === "active" && "text-blue-600 dark:text-blue-400 font-medium",
                  step.status === "error" && "text-red-600 dark:text-red-400",
                  step.status === "pending" && "text-muted-foreground",
                )}
              >
                {step.label}
              </span>
            </div>
          ))}
        </div>

        {/* Error */}
        {error && (
          <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-3">
            <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
            <p className="text-xs text-muted-foreground mt-1">
              Your settings are still safely stored in the database. You can try
              again or continue using the app as before.
            </p>
          </div>
        )}

        {/* File path hint */}
        {isComplete && (
          <div className="rounded-lg bg-muted/50 border border-border p-3">
            <div className="flex items-start gap-2">
              <FileJson className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-medium text-foreground">
                  Settings stored at:
                </p>
                <p className="text-xs text-muted-foreground font-mono mt-0.5 break-all">
                  ~/.config/Rexa DB/settings.json
                </p>
              </div>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          {!isComplete && !hasError && (
            <Button
              variant="outline"
              onClick={handleDismiss}
              disabled={migrating}
              className="text-xs"
            >
              Not now
            </Button>
          )}
          {!isComplete && !migrating && !hasError && (
            <Button onClick={handleMigrate} className="text-xs gap-1.5">
              <ArrowRight className="w-3.5 h-3.5" />
              Migrate Settings
            </Button>
          )}
          {hasError && !migrating && (
            <Button onClick={handleMigrate} variant="outline" className="text-xs">
              Retry Migration
            </Button>
          )}
          {hasError && !migrating && (
            <Button onClick={handleDismiss} variant="ghost" className="text-xs">
              Continue without migrating
            </Button>
          )}
          {isComplete && (
            <Button onClick={handleContinue} className="text-xs gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Continue
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
