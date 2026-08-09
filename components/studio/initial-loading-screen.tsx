"use client";

import { LoadingDotSpinner } from "./loading-dot-spinner";

export function InitialLoadingScreen() {
  return (
    <div className="flex h-screen items-center justify-center bg-background text-muted-foreground">
      <LoadingDotSpinner size="sm" />
    </div>
  );
}
