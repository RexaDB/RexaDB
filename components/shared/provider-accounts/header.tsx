"use client";

import type { ReactNode } from "react";
import { ArrowLeft } from "@/lib/icon-theme/lucide-react";

export function ProviderAccountsHeader({
  logo,
  title,
  description,
  action,
  onBack,
}: {
  logo: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
  onBack?: () => void;
}) {
  return (
    <div className="mb-5 flex items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label="Back"
            className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2 text-sm text-muted-foreground hover:bg-muted/60 hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
        )}
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-studio-border bg-studio-bg/60">
          {logo}
        </div>
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
      {action}
    </div>
  );
}
