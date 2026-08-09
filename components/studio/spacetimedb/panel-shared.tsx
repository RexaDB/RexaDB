"use client";

import { Button } from "@/components/ui/button";
import { Loader2, X, RefreshCw } from "@/lib/icon-theme/lucide-react";

export function PanelRefreshButtons({
  loading,
  onRefresh,
  onClose,
}: {
  loading: boolean;
  onRefresh: () => void;
  onClose?: () => void;
}) {
  return (
    <>
      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onRefresh} disabled={loading}>
        <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
      </Button>
      {onClose && (
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
          <X className="w-3.5 h-3.5" />
        </Button>
      )}
    </>
  );
}

export function PanelLoadingError({
  loading,
  error,
  onRetry,
  loadingLabel,
}: {
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  loadingLabel: string;
}) {
  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground gap-2">
        <Loader2 className="w-4 h-4 animate-spin" />
        {loadingLabel}
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 p-8">
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" size="sm" onClick={onRetry}>Retry</Button>
      </div>
    );
  }
  return null;
}
