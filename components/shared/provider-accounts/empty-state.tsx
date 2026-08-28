"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Plus, Loader2 } from "@/lib/icon-theme/lucide-react";

export function ProviderEmptyState({
  logo,
  title,
  description,
  actionLabel,
  onAction,
  actionDisabled,
  actionLoading,
}: {
  logo: ReactNode;
  title: string;
  description: string;
  actionLabel: string;
  onAction: () => void;
  actionDisabled?: boolean;
  actionLoading?: boolean;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-studio-border/60 bg-studio-bg/40 px-6 py-16 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-studio-border bg-studio-bg/60">
        {logo}
      </div>
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mt-1.5 max-w-sm text-xs leading-relaxed text-muted-foreground">
        {description}
      </p>
      <Button
        onClick={onAction}
        disabled={actionDisabled}
        className="mt-5 h-9 gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
      >
        {actionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
        {actionLabel}
      </Button>
    </div>
  );
}
